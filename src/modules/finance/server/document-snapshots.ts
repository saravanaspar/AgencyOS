import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type { Sql, TransactionSql } from "postgres";

import { putObject, readObject, removeObject } from "@/integrations/object-storage/client";
import { getDatabaseClient } from "@/integrations/postgres/database";
import { toJsonValue } from "@/lib/server/json-value";
import type { FinanceDocumentTotals } from "@/modules/finance/calculations";
import {
  financePdfStyleFromInvoiceSettings,
  renderFinanceDocumentPdf,
  type FinancePdfInput,
  type FinancePdfLine,
} from "@/modules/finance/pdf";
import {
  PRIVATE_FILE_CLEAN_BUCKET,
  recordPrivateFileEvent,
} from "@/modules/private-files/server/private-files";
import {
  buildPrivateFileStoragePaths,
  privateFileContentDisposition,
} from "@/modules/private-files/server/file-policy";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

export type FinanceSnapshotEntityType = "estimate" | "invoice" | "credit_note" | "payment_receipt";

type QuerySql = Sql | TransactionSql;

export interface StoredFinanceDocumentSnapshot {
  id: string;
  entityType: FinanceSnapshotEntityType;
  entityId: string;
  versionNumber: number;
  documentNumber: string;
  privateFileId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storageBucket: string;
  storagePath: string;
  createdAt: string;
}

interface SnapshotRow {
  id: string;
  entity_type: FinanceSnapshotEntityType;
  entity_id: string;
  version_number: number;
  document_number: string;
  private_file_id: string;
  original_file_name: string;
  mime_type: string;
  size_bytes: string | number;
  sha256: string;
  storage_bucket: string;
  storage_path: string;
  created_at: Date;
}

interface DocumentSource {
  entityType: FinanceSnapshotEntityType;
  entityId: string;
  versionNumber: number;
  documentNumber: string;
  sourceHash: string;
  pdf: FinancePdfInput;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string"
    ? value
    : value === null || value === undefined
      ? ""
      : String(value);
}

function optionalString(value: unknown): string | null {
  const normalized = stringValue(value).trim();
  return normalized || null;
}

function addressValue(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return optionalString(value);
  if (typeof value === "object") {
    const values = Object.values(value as Record<string, unknown>)
      .map((entry) => optionalString(entry))
      .filter((entry): entry is string => Boolean(entry));
    return values.length ? values.join(", ") : null;
  }
  return optionalString(value);
}

function canonicalHash(value: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function mapSnapshot(row: SnapshotRow): StoredFinanceDocumentSnapshot {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    versionNumber: row.version_number,
    documentNumber: row.document_number,
    privateFileId: row.private_file_id,
    fileName: row.original_file_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    sha256: row.sha256,
    storageBucket: row.storage_bucket,
    storagePath: row.storage_path,
    createdAt: row.created_at.toISOString(),
  };
}

async function findStoredSnapshot(
  sql: QuerySql,
  input: {
    organizationId: string;
    entityType: FinanceSnapshotEntityType;
    entityId: string;
    versionNumber: number;
  },
): Promise<StoredFinanceDocumentSnapshot | null> {
  const rows = await sql<SnapshotRow[]>`
    select snapshot.id, snapshot.entity_type, snapshot.entity_id, snapshot.version_number,
      snapshot.document_number, snapshot.private_file_id, private_file.original_file_name,
      private_file.mime_type, private_file.size_bytes, private_file.sha256,
      private_file.storage_bucket, private_file.storage_path, snapshot.created_at
    from public.finance_document_snapshots as snapshot
    join public.private_files as private_file on private_file.id = snapshot.private_file_id
    where snapshot.organization_id = ${input.organizationId}::uuid
      and snapshot.entity_type = ${input.entityType}
      and snapshot.entity_id = ${input.entityId}::uuid
      and snapshot.version_number = ${input.versionNumber}
      and private_file.status = 'available'
    limit 1
  `;
  return rows[0] ? mapSnapshot(rows[0]) : null;
}

async function estimateSource(
  sql: QuerySql,
  organizationId: string,
  estimateId: string,
): Promise<DocumentSource> {
  const rows = await sql<
    Array<{
      id: string;
      estimate_number: string;
      version_number: number;
      issue_date: string;
      expiry_date: string | null;
      currency: string;
      status: string;
      notes: string | null;
      terms: string | null;
      subtotal_minor: string | number;
      discount_minor: string | number;
      tax_minor: string | number;
      total_minor: string | number;
      organization_name: string;
      organization_address: unknown;
      organization_tax_identifiers: unknown;
      organization_invoice_settings: unknown;
      client_name: string;
      client_address: unknown;
      client_tax_identifiers: unknown;
      payment_terms_days: number;
      contact_name: string | null;
      contact_email: string | null;
    }>
  >`
    select estimate.id, estimate.estimate_number, estimate.version_number,
      estimate.issue_date::text, estimate.expiry_date::text, estimate.currency,
      estimate.status, estimate.notes, estimate.terms, estimate.subtotal_minor,
      estimate.discount_minor, estimate.tax_minor, estimate.total_minor,
      coalesce(organization.trading_name, organization.legal_name) as organization_name,
      coalesce(organization.billing_address, organization.registered_address) as organization_address,
      organization.tax_identifiers as organization_tax_identifiers,
      organization.invoice_settings as organization_invoice_settings,
      coalesce(company.display_name, company.legal_name) as client_name,
      company.billing_address as client_address,
      company.tax_identifiers as client_tax_identifiers,
      company.payment_terms_days,
      nullif(concat_ws(' ', contact.first_name, contact.last_name), '') as contact_name,
      contact.email as contact_email
    from public.finance_estimates as estimate
    join public.organizations as organization on organization.id = estimate.organization_id
    join public.crm_companies as company on company.id = estimate.company_id
    left join public.crm_contacts as contact on contact.id = estimate.contact_id
    where estimate.id = ${estimateId}::uuid
      and estimate.organization_id = ${organizationId}::uuid
    for update of estimate
  `;
  const row = rows[0];
  if (!row) throw new Error("finance-document-not-found");
  if (!["approved", "sent", "accepted", "converted"].includes(row.status)) {
    throw new Error("finance-estimate-not-final");
  }

  const lineRows = await sql<
    Array<{
      description: string;
      quantity_milli: string | number;
      unit_rate_minor: string | number;
      discount_bps: number;
      tax_bps: number;
      subtotal_minor: string | number;
      discount_minor: string | number;
      tax_minor: string | number;
      total_minor: string | number;
    }>
  >`
    select description, quantity_milli, unit_rate_minor, discount_bps, tax_bps,
      subtotal_minor, discount_minor, tax_minor, total_minor
    from public.finance_estimate_lines
    where estimate_id = ${estimateId}::uuid
      and organization_id = ${organizationId}::uuid
    order by position
  `;
  if (!lineRows.length) throw new Error("finance-document-has-no-lines");
  const lines: FinancePdfLine[] = lineRows.map((line) => ({
    description: line.description,
    quantityMilli: Number(line.quantity_milli),
    unitRateMinor: Number(line.unit_rate_minor),
    discountBps: line.discount_bps,
    taxBps: line.tax_bps,
    subtotalMinor: Number(line.subtotal_minor),
    discountMinor: Number(line.discount_minor),
    taxMinor: Number(line.tax_minor),
    totalMinor: Number(line.total_minor),
  }));
  const totals: FinanceDocumentTotals = {
    subtotalMinor: Number(row.subtotal_minor),
    discountMinor: Number(row.discount_minor),
    taxMinor: Number(row.tax_minor),
    totalMinor: Number(row.total_minor),
    lineCount: lines.length,
  };
  const source = {
    documentNumber: row.estimate_number,
    versionNumber: row.version_number,
    issueDate: row.issue_date,
    expiryDate: row.expiry_date,
    currency: row.currency,
    seller: {
      name: row.organization_name,
      address: row.organization_address,
      taxIdentifiers: row.organization_tax_identifiers,
    },
    client: {
      name: row.client_name,
      address: row.client_address,
      taxIdentifiers: row.client_tax_identifiers,
      email: row.contact_email,
    },
    contactName: row.contact_name,
    paymentTermsDays: row.payment_terms_days,
    notes: row.notes,
    terms: row.terms,
    lines,
    totals,
    invoiceSettings: row.organization_invoice_settings,
  };

  return {
    entityType: "estimate",
    entityId: row.id,
    versionNumber: row.version_number,
    documentNumber: row.estimate_number,
    sourceHash: canonicalHash(source),
    pdf: {
      documentType: "Estimate",
      documentNumber: row.estimate_number,
      issueDate: row.issue_date,
      expiryDate: row.expiry_date,
      currency: row.currency,
      seller: {
        name: row.organization_name,
        address: addressValue(row.organization_address),
        taxIdentifiers: row.organization_tax_identifiers,
      },
      client: {
        name: row.client_name,
        address: addressValue(row.client_address),
        taxIdentifiers: row.client_tax_identifiers,
        email: row.contact_email,
      },
      contactName: row.contact_name,
      paymentTerms: `${row.payment_terms_days} days`,
      notes: row.notes,
      terms: row.terms,
      lines,
      totals,
      style: financePdfStyleFromInvoiceSettings(row.organization_invoice_settings, "Estimate"),
    },
  };
}

async function invoiceSource(
  sql: QuerySql,
  organizationId: string,
  invoiceId: string,
): Promise<DocumentSource> {
  const rows = await sql<
    Array<{
      id: string;
      invoice_number: string | null;
      exchange_rate: string | number | null;
      issue_date: string | null;
      due_date: string | null;
      service_period_start: string | null;
      service_period_end: string | null;
      purchase_order_reference: string | null;
      currency: string;
      notes: string | null;
      terms: string | null;
      bank_details: string | null;
      seller_snapshot: Record<string, unknown> | null;
      client_snapshot: Record<string, unknown> | null;
      calculation_snapshot: Record<string, unknown> | null;
      payment_snapshot: Record<string, unknown> | null;
    }>
  >`
    select id, invoice_number, exchange_rate, issue_date::text, due_date::text,
      service_period_start::text, service_period_end::text, purchase_order_reference,
      currency, notes, terms, bank_details, seller_snapshot, client_snapshot,
      calculation_snapshot, payment_snapshot
    from public.finance_invoices
    where id = ${invoiceId}::uuid
      and organization_id = ${organizationId}::uuid
      and issued_at is not null
    for update
  `;
  const row = rows[0];
  if (!row?.invoice_number || !row.issue_date) throw new Error("finance-invoice-not-issued");
  const seller = objectValue(row.seller_snapshot);
  const client = objectValue(row.client_snapshot);
  const calculation = objectValue(row.calculation_snapshot);
  const payment = objectValue(row.payment_snapshot);
  const sourceLines = Array.isArray(calculation.lines) ? calculation.lines : [];
  const lines: FinancePdfLine[] = sourceLines.map((value) => {
    const line = objectValue(value);
    return {
      description: stringValue(line.description),
      quantityMilli: Number(line.quantityMilli),
      unitRateMinor: Number(line.unitRateMinor),
      discountBps: Number(line.discountBps),
      taxBps: Number(line.taxBps),
      subtotalMinor: Number(line.subtotalMinor),
      discountMinor: Number(line.discountMinor),
      taxMinor: Number(line.taxMinor),
      totalMinor: Number(line.totalMinor),
    };
  });
  if (!lines.length) throw new Error("finance-document-has-no-lines");
  const totals: FinanceDocumentTotals = {
    subtotalMinor: Number(calculation.subtotalMinor),
    discountMinor: Number(calculation.discountMinor),
    taxMinor: Number(calculation.taxMinor),
    totalMinor: Number(calculation.totalMinor),
    lineCount: lines.length,
  };
  const contact = objectValue(client.contact);
  const source = {
    invoiceNumber: row.invoice_number,
    issueDate: row.issue_date,
    dueDate: row.due_date,
    servicePeriodStart: row.service_period_start,
    servicePeriodEnd: row.service_period_end,
    purchaseOrderReference: row.purchase_order_reference,
    currency: row.currency,
    exchangeRate: row.exchange_rate === null ? null : Number(row.exchange_rate),
    notes: row.notes,
    terms: row.terms,
    bankDetails: row.bank_details,
    seller,
    client,
    calculation,
    payment,
  };
  const servicePeriod = [row.service_period_start, row.service_period_end]
    .filter((value): value is string => Boolean(value))
    .join(" to ");

  return {
    entityType: "invoice",
    entityId: row.id,
    versionNumber: 1,
    documentNumber: row.invoice_number,
    sourceHash: canonicalHash(source),
    pdf: {
      documentType: "Invoice",
      documentNumber: row.invoice_number,
      issueDate: row.issue_date,
      dueDate: row.due_date,
      currency: row.currency,
      exchangeRate: row.exchange_rate === null ? null : Number(row.exchange_rate),
      seller: {
        name:
          optionalString(seller.tradingName) ?? optionalString(seller.legalName) ?? "Organization",
        address: addressValue(seller.billingAddress) ?? addressValue(seller.registeredAddress),
        taxIdentifiers: seller.taxIdentifiers,
      },
      client: {
        name: optionalString(client.displayName) ?? optionalString(client.legalName) ?? "Client",
        address: addressValue(client.billingAddress),
        taxIdentifiers: client.taxIdentifiers,
        email: optionalString(contact.email),
      },
      contactName: optionalString(contact.name),
      purchaseOrderReference: row.purchase_order_reference,
      servicePeriod: servicePeriod || null,
      paymentTerms: optionalString(payment.paymentTerms),
      bankDetails: optionalString(payment.bankDetails) ?? row.bank_details,
      notes: row.notes,
      terms: row.terms,
      lines,
      totals,
      style: financePdfStyleFromInvoiceSettings(seller.invoiceSettings, "Invoice"),
    },
  };
}

async function creditNoteSource(
  sql: QuerySql,
  organizationId: string,
  creditNoteId: string,
): Promise<DocumentSource> {
  const rows = await sql<
    Array<{
      id: string;
      credit_note_number: string | null;
      issue_date: string | null;
      currency: string;
      reason: string;
      internal_notes: string | null;
      seller_snapshot: Record<string, unknown> | null;
      client_snapshot: Record<string, unknown> | null;
      calculation_snapshot: Record<string, unknown> | null;
      original_invoice_snapshot: Record<string, unknown> | null;
    }>
  >`
    select id, credit_note_number, issue_date::text, currency, reason, internal_notes,
      seller_snapshot, client_snapshot, calculation_snapshot, original_invoice_snapshot
    from public.finance_credit_notes
    where id = ${creditNoteId}::uuid
      and organization_id = ${organizationId}::uuid
      and issued_at is not null
    for update
  `;
  const row = rows[0];
  if (!row?.credit_note_number || !row.issue_date) {
    throw new Error("finance-credit-note-not-issued");
  }

  const seller = objectValue(row.seller_snapshot);
  const client = objectValue(row.client_snapshot);
  const calculation = objectValue(row.calculation_snapshot);
  const originalInvoice = objectValue(row.original_invoice_snapshot);
  const sourceLines = Array.isArray(calculation.lines) ? calculation.lines : [];
  const lines: FinancePdfLine[] = sourceLines.map((value) => {
    const line = objectValue(value);
    return {
      description: stringValue(line.description),
      quantityMilli: Number(line.quantityMilli),
      unitRateMinor: Number(line.unitRateMinor),
      discountBps: Number(line.discountBps),
      taxBps: Number(line.taxBps),
      subtotalMinor: Number(line.subtotalMinor),
      discountMinor: Number(line.discountMinor),
      taxMinor: Number(line.taxMinor),
      totalMinor: Number(line.totalMinor),
    };
  });
  if (!lines.length) throw new Error("finance-document-has-no-lines");
  const totals: FinanceDocumentTotals = {
    subtotalMinor: Number(calculation.subtotalMinor),
    discountMinor: Number(calculation.discountMinor),
    taxMinor: Number(calculation.taxMinor),
    totalMinor: Number(calculation.totalMinor),
    lineCount: lines.length,
  };
  const contact = objectValue(client.contact);
  const originalInvoiceNumber = optionalString(originalInvoice.invoiceNumber);
  const source = {
    creditNoteNumber: row.credit_note_number,
    issueDate: row.issue_date,
    currency: row.currency,
    reason: row.reason,
    internalNotes: row.internal_notes,
    seller,
    client,
    calculation,
    originalInvoice,
  };

  return {
    entityType: "credit_note",
    entityId: row.id,
    versionNumber: 1,
    documentNumber: row.credit_note_number,
    sourceHash: canonicalHash(source),
    pdf: {
      documentType: "Credit Note",
      documentNumber: row.credit_note_number,
      issueDate: row.issue_date,
      currency: row.currency,
      seller: {
        name:
          optionalString(seller.tradingName) ?? optionalString(seller.legalName) ?? "Organization",
        address: addressValue(seller.billingAddress) ?? addressValue(seller.registeredAddress),
        taxIdentifiers: seller.taxIdentifiers,
      },
      client: {
        name: optionalString(client.displayName) ?? optionalString(client.legalName) ?? "Client",
        address: addressValue(client.billingAddress),
        taxIdentifiers: client.taxIdentifiers,
        email: optionalString(contact.email),
      },
      contactName: optionalString(contact.name),
      reference: originalInvoiceNumber ? `Original invoice ${originalInvoiceNumber}` : null,
      notes: row.reason,
      terms: "This credit note reduces the balance of the referenced invoice.",
      lines,
      totals,
      style: financePdfStyleFromInvoiceSettings(seller.invoiceSettings, "Credit Note"),
    },
  };
}

async function paymentReceiptSource(
  sql: QuerySql,
  organizationId: string,
  paymentId: string,
): Promise<DocumentSource> {
  const rows = await sql<
    Array<{
      id: string;
      payment_date: string;
      amount_minor: string | number;
      currency: string;
      payment_method: string;
      transaction_reference: string | null;
      bank_account: string | null;
      notes: string | null;
      organization_name: string;
      organization_address: unknown;
      organization_tax_identifiers: unknown;
      organization_invoice_settings: unknown;
      client_name: string;
      client_address: unknown;
      client_tax_identifiers: unknown;
    }>
  >`
    select payment.id, payment.payment_date::text, payment.amount_minor,
      payment.currency, payment.payment_method,
      payment.transaction_reference, payment.bank_account, payment.notes,
      coalesce(organization.trading_name, organization.legal_name) as organization_name,
      coalesce(organization.billing_address, organization.registered_address) as organization_address,
      organization.tax_identifiers as organization_tax_identifiers,
      organization.invoice_settings as organization_invoice_settings,
      coalesce(company.display_name, company.legal_name) as client_name,
      company.billing_address as client_address,
      company.tax_identifiers as client_tax_identifiers
    from public.finance_payments as payment
    join public.organizations as organization on organization.id = payment.organization_id
    join public.crm_companies as company on company.id = payment.company_id
    where payment.id = ${paymentId}::uuid
      and payment.organization_id = ${organizationId}::uuid
    for update of payment
  `;
  const row = rows[0];
  if (!row) throw new Error("finance-payment-not-found");

  const allocationRows = await sql<
    Array<{ invoice_number: string; amount_minor: string | number }>
  >`
    select coalesce(invoice.invoice_number, invoice.draft_reference) as invoice_number,
      allocation.amount_minor
    from public.finance_payment_allocations as allocation
    join public.finance_invoices as invoice on invoice.id = allocation.invoice_id
    where allocation.payment_id = ${paymentId}::uuid
      and allocation.organization_id = ${organizationId}::uuid
    order by allocation.created_at
  `;
  const lines: FinancePdfLine[] = allocationRows.map((allocation) => ({
    description: `Payment allocation to ${allocation.invoice_number}`,
    quantityMilli: 1000,
    unitRateMinor: Number(allocation.amount_minor),
    discountBps: 0,
    taxBps: 0,
    subtotalMinor: Number(allocation.amount_minor),
    discountMinor: 0,
    taxMinor: 0,
    totalMinor: Number(allocation.amount_minor),
  }));
  if (!lines.length) {
    lines.push({
      description: "Unallocated payment received",
      quantityMilli: 1000,
      unitRateMinor: Number(row.amount_minor),
      discountBps: 0,
      taxBps: 0,
      subtotalMinor: Number(row.amount_minor),
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: Number(row.amount_minor),
    });
  }
  const documentNumber =
    row.transaction_reference?.trim() ||
    `PAY-${row.id.replaceAll("-", "").slice(0, 12).toUpperCase()}`;
  const totals: FinanceDocumentTotals = {
    subtotalMinor: Number(row.amount_minor),
    discountMinor: 0,
    taxMinor: 0,
    totalMinor: Number(row.amount_minor),
    lineCount: lines.length,
  };
  const source = {
    paymentId: row.id,
    documentNumber,
    paymentDate: row.payment_date,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    paymentMethod: row.payment_method,
    transactionReference: row.transaction_reference,
    bankAccount: row.bank_account,
    notes: row.notes,
    allocations: allocationRows,
    seller: {
      name: row.organization_name,
      address: row.organization_address,
      taxIdentifiers: row.organization_tax_identifiers,
    },
    client: {
      name: row.client_name,
      address: row.client_address,
      taxIdentifiers: row.client_tax_identifiers,
    },
    invoiceSettings: row.organization_invoice_settings,
  };

  return {
    entityType: "payment_receipt",
    entityId: row.id,
    versionNumber: 1,
    documentNumber,
    sourceHash: canonicalHash(source),
    pdf: {
      documentType: "Payment Receipt",
      documentNumber,
      issueDate: row.payment_date,
      currency: row.currency,
      seller: {
        name: row.organization_name,
        address: addressValue(row.organization_address),
        taxIdentifiers: row.organization_tax_identifiers,
      },
      client: {
        name: row.client_name,
        address: addressValue(row.client_address),
        taxIdentifiers: row.client_tax_identifiers,
      },
      reference: `Method: ${row.payment_method.replaceAll("_", " ")}`,
      paymentMethod: row.payment_method.replaceAll("_", " "),
      paymentReference: row.transaction_reference,
      bankDetails: row.bank_account,
      notes: row.notes,
      terms: "This receipt confirms the payment recorded in AgencyOS.",
      lines,
      totals,
      style: financePdfStyleFromInvoiceSettings(
        row.organization_invoice_settings,
        "Payment Receipt",
      ),
    },
  };
}

async function loadDocumentSource(
  sql: QuerySql,
  organizationId: string,
  entityType: FinanceSnapshotEntityType,
  entityId: string,
): Promise<DocumentSource> {
  if (entityType === "estimate") return estimateSource(sql, organizationId, entityId);
  if (entityType === "invoice") return invoiceSource(sql, organizationId, entityId);
  if (entityType === "credit_note") return creditNoteSource(sql, organizationId, entityId);
  return paymentReceiptSource(sql, organizationId, entityId);
}

export async function ensureFinanceDocumentSnapshot(
  context: CurrentPermissionContext,
  entityType: FinanceSnapshotEntityType,
  entityId: string,
): Promise<StoredFinanceDocumentSnapshot> {
  const database = getDatabaseClient();
  let uploadedPath: string | null = null;

  try {
    return await database.begin(async (sql) => {
      const source = await loadDocumentSource(
        sql,
        context.membership.organizationId,
        entityType,
        entityId,
      );
      const existing = await findStoredSnapshot(sql, {
        organizationId: context.membership.organizationId,
        entityType,
        entityId,
        versionNumber: source.versionNumber,
      });
      if (existing) return existing;

      const rendered = await renderFinanceDocumentPdf({ ...source.pdf, locale: "en-US" });
      const snapshotId = randomUUID();
      const privateFileId = randomUUID();
      const paths = buildPrivateFileStoragePaths({
        organizationId: context.membership.organizationId,
        fileId: privateFileId,
        fileName: rendered.fileName,
      });
      uploadedPath = paths.cleanPath;
      try {
        await putObject({
          bucket: PRIVATE_FILE_CLEAN_BUCKET,
          objectName: paths.cleanPath,
          body: rendered.bytes,
          cacheControl: "private, no-store",
          contentType: "application/pdf",
        });
      } catch {
        throw new Error("finance-pdf-storage-failed");
      }

      await sql`
        insert into public.private_files (
          id, organization_id, uploaded_by_membership_id, module_key, entity_type, entity_id,
          classification, original_file_name, mime_type, size_bytes, sha256, status,
          clean_target_path, storage_bucket, storage_path, access_rules, metadata,
          scan_attempt_count, scan_engine, scan_signature, scan_requested_at,
          scan_completed_at, next_scan_at, available_at
        ) values (
          ${privateFileId}::uuid, ${context.membership.organizationId}::uuid,
          ${context.membership.id}::uuid, 'finance', 'finance_document', ${snapshotId}::uuid,
          'confidential', ${rendered.fileName}, 'application/pdf', ${rendered.bytes.length},
          ${rendered.sha256}, 'available', ${paths.cleanPath}, ${PRIVATE_FILE_CLEAN_BUCKET},
          ${paths.cleanPath},
          ${sql.json(toJsonValue({ viewPermission: "finance.document.download" }))},
          ${sql.json(toJsonValue({ entityType, entityId, versionNumber: source.versionNumber, generated: true, templateId: rendered.templateId }))},
          0, 'agencyos-generated', 'finance-pdf-invoice-ninja-v1', now(), now(), null, now()
        )
      `;
      await recordPrivateFileEvent(sql, {
        fileId: privateFileId,
        organizationId: context.membership.organizationId,
        eventType: "file.generated",
        actorMembershipId: context.membership.id,
        details: {
          moduleKey: "finance",
          entityType,
          entityId,
          versionNumber: source.versionNumber,
          documentNumber: source.documentNumber,
        },
      });
      const snapshotRows = await sql<SnapshotRow[]>`
        insert into public.finance_document_snapshots (
          id, organization_id, entity_type, entity_id, version_number, document_number,
          private_file_id, source_hash, created_by_membership_id
        ) values (
          ${snapshotId}::uuid, ${context.membership.organizationId}::uuid, ${entityType},
          ${entityId}::uuid, ${source.versionNumber}, ${source.documentNumber},
          ${privateFileId}::uuid, ${source.sourceHash}, ${context.membership.id}::uuid
        )
        returning id, entity_type, entity_id, version_number, document_number, private_file_id,
          ${rendered.fileName}::text as original_file_name,
          'application/pdf'::text as mime_type,
          ${rendered.bytes.length}::bigint as size_bytes,
          ${rendered.sha256}::text as sha256,
          ${PRIVATE_FILE_CLEAN_BUCKET}::text as storage_bucket,
          ${paths.cleanPath}::text as storage_path,
          created_at
      `;
      if (entityType === "invoice") {
        await sql`
          update public.finance_invoices
          set issued_pdf_file_id = coalesce(issued_pdf_file_id, ${privateFileId}::uuid)
          where id = ${entityId}::uuid
            and organization_id = ${context.membership.organizationId}::uuid
        `;
      } else if (entityType === "credit_note") {
        await sql`
          update public.finance_credit_notes
          set issued_pdf_file_id = coalesce(issued_pdf_file_id, ${privateFileId}::uuid)
          where id = ${entityId}::uuid
            and organization_id = ${context.membership.organizationId}::uuid
        `;
      }
      const stored = snapshotRows[0];
      if (!stored) throw new Error("finance-pdf-snapshot-not-stored");
      uploadedPath = null;
      return mapSnapshot(stored);
    });
  } catch (error) {
    if (uploadedPath) {
      await removeObject(PRIVATE_FILE_CLEAN_BUCKET, uploadedPath).catch(() => undefined);
    }
    throw error;
  }
}

export async function getFinanceDocumentSnapshot(
  organizationId: string,
  snapshotId: string,
): Promise<StoredFinanceDocumentSnapshot | null> {
  const rows = await getDatabaseClient()<SnapshotRow[]>`
    select snapshot.id, snapshot.entity_type, snapshot.entity_id, snapshot.version_number,
      snapshot.document_number, snapshot.private_file_id, private_file.original_file_name,
      private_file.mime_type, private_file.size_bytes, private_file.sha256,
      private_file.storage_bucket, private_file.storage_path, snapshot.created_at
    from public.finance_document_snapshots as snapshot
    join public.private_files as private_file on private_file.id = snapshot.private_file_id
    where snapshot.id = ${snapshotId}::uuid
      and snapshot.organization_id = ${organizationId}::uuid
      and private_file.status = 'available'
    limit 1
  `;
  return rows[0] ? mapSnapshot(rows[0]) : null;
}

export async function downloadFinanceSnapshotBytes(
  snapshot: StoredFinanceDocumentSnapshot,
): Promise<Buffer> {
  const buffer = await readObject(snapshot.storageBucket, snapshot.storagePath, {
    maxBytes: snapshot.sizeBytes + 1,
  }).catch(() => {
    throw new Error("finance-pdf-not-found");
  });
  if (buffer.length !== snapshot.sizeBytes) throw new Error("finance-pdf-size-mismatch");
  const digest = createHash("sha256").update(buffer).digest("hex");
  if (digest !== snapshot.sha256) throw new Error("finance-pdf-integrity-mismatch");
  return buffer;
}

export function financeSnapshotContentDisposition(fileName: string): string {
  return privateFileContentDisposition(fileName);
}
