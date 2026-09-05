"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { Sql, TransactionSql } from "postgres";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { toJsonValue } from "@/lib/server/json-value";
import {
  calculateFinanceDocument,
  parseMoneyToMinor,
  parsePercentToBps,
  parseQuantityToMilli,
} from "@/modules/finance/calculations";
import { financePermissionKeys } from "@/modules/finance/finance";
import {
  catalogItemStatusSchema,
  catalogItemCreateSchema,
  creditNoteCreateSchema,
  creditNoteIssueSchema,
  creditNoteVoidSchema,
  estimateCreateSchema,
  estimateClientDecisionSchema,
  estimateConvertSchema,
  financeApprovalDecisionSchema,
  financeDocumentEmailSchema,
  financeDocumentSnapshotSchema,
  invoiceCreateSchema,
  invoiceIssueSchema,
  invoiceRevisionSchema,
  invoiceStatusActionSchema,
  invoiceVoidSchema,
  paymentCreateSchema,
  paymentReconciliationSchema,
  paymentRefundSchema,
  type FinanceActionState,
  type FinanceLineInputSchema,
} from "@/modules/finance/schemas/finance";
import {
  buildFinanceDocumentEmailTemplate,
  deliverFinanceDocumentEmail,
} from "@/modules/finance/server/document-delivery";
import {
  downloadFinanceSnapshotBytes,
  ensureFinanceDocumentSnapshot,
} from "@/modules/finance/server/document-snapshots";
import { submitFinanceApprovalForRecord } from "@/modules/finance/server/approvals";
import { insertEstimateVersion } from "@/modules/finance/server/estimate-versions";
import { writeAuditEvent } from "@/modules/audit/server/write-audit-event";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

class FinanceActionError extends Error {}
type QuerySql = Sql | TransactionSql;

type PreparedLine = {
  catalogItemId: string | null;
  description: string;
  quantityMilli: number;
  unitRateMinor: number;
  discountBps: number;
  taxBps: number;
};

function values(formData: FormData): Record<string, FormDataEntryValue> {
  return Object.fromEntries(formData.entries());
}

function errorState(message: string, fieldErrors?: Record<string, string[]>): FinanceActionState {
  return { status: "error", message, fieldErrors };
}

function successState(message: string, entityId?: string): FinanceActionState {
  return { status: "success", message, entityId };
}

function refreshFinance(): void {
  revalidatePath("/finance");
  revalidatePath("/dashboard");
}

async function authorize(
  permission: string | readonly string[],
): Promise<CurrentPermissionContext> {
  const result = await authorizeCurrentUser(
    typeof permission === "string" ? [permission] : [...permission],
  );
  if (!result.allowed) {
    throw new FinanceActionError(
      result.reason === "insufficient-permission"
        ? "You do not have permission to perform this finance action."
        : "Your session or organization access is no longer active.",
    );
  }
  return result.context;
}

function prepareLines(lines: readonly FinanceLineInputSchema[], currency: string): PreparedLine[] {
  return lines.map((line) => ({
    catalogItemId: line.catalogItemId,
    description: line.description,
    quantityMilli: parseQuantityToMilli(line.quantity),
    unitRateMinor: parseMoneyToMinor(line.unitRate, currency),
    discountBps: parsePercentToBps(line.discountPercent),
    taxBps: parsePercentToBps(line.taxPercent),
  }));
}

function contentHash(value: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function validateDocumentReferences(
  sql: QuerySql,
  organizationId: string,
  input: { companyId: string; contactId: string | null; projectId: string | null },
): Promise<void> {
  const companyRows = await sql<{ id: string }[]>`
    select id from public.crm_companies
    where id = ${input.companyId}::uuid
      and organization_id = ${organizationId}::uuid
      and client_status <> 'inactive'
    limit 1
  `;
  if (!companyRows[0])
    throw new FinanceActionError("Choose an active client in this organization.");

  if (input.contactId) {
    const contactRows = await sql<{ id: string }[]>`
      select id from public.crm_contacts
      where id = ${input.contactId}::uuid
        and organization_id = ${organizationId}::uuid
        and company_id = ${input.companyId}::uuid
        and status = 'active'
      limit 1
    `;
    if (!contactRows[0])
      throw new FinanceActionError("Choose an active contact for the selected client.");
  }

  if (input.projectId) {
    const projectRows = await sql<{ id: string }[]>`
      select id from public.projects
      where id = ${input.projectId}::uuid
        and organization_id = ${organizationId}::uuid
        and archived_at is null
        and closure_status <> 'closed'
        and (company_id is null or company_id = ${input.companyId}::uuid)
      limit 1
    `;
    if (!projectRows[0])
      throw new FinanceActionError("Choose an active project for the selected client.");
  }
}

interface InvoiceDraftInsertInput {
  draftReference: string;
  companyId: string;
  contactId: string | null;
  projectId: string | null;
  sourceEstimateId: string | null;
  correctionOfInvoiceId?: string | null;
  correctionReason?: string | null;
  purchaseOrderReference: string | null;
  issueDate: string | null;
  dueDate: string | null;
  servicePeriodStart: string | null;
  servicePeriodEnd: string | null;
  currency: string;
  exchangeRate?: string | null;
  notes: string | null;
  terms: string | null;
  bankDetails: string | null;
  internalNotes: string | null;
  contentHash: string;
  lines: readonly PreparedLine[];
}

async function insertInvoiceDraft(
  sql: TransactionSql,
  context: CurrentPermissionContext,
  input: InvoiceDraftInsertInput,
): Promise<string> {
  const invoiceRows = await sql<{ id: string }[]>`
    insert into public.finance_invoices (
      organization_id, draft_reference, company_id, contact_id, project_id, source_estimate_id,
      correction_of_invoice_id, correction_reason, purchase_order_reference, issue_date, due_date,
      service_period_start, service_period_end,
      currency, exchange_rate, notes, terms, bank_details, internal_notes, content_hash,
      created_by_membership_id, created_by
    ) values (
      ${context.membership.organizationId}::uuid, ${input.draftReference}, ${input.companyId}::uuid,
      ${input.contactId}::uuid, ${input.projectId}::uuid, ${input.sourceEstimateId}::uuid,
      ${input.correctionOfInvoiceId ?? null}::uuid, ${input.correctionReason ?? null},
      ${input.purchaseOrderReference}, ${input.issueDate}::date, ${input.dueDate}::date,
      ${input.servicePeriodStart}::date, ${input.servicePeriodEnd}::date, ${input.currency},
      ${input.exchangeRate ?? null}::numeric, ${input.notes}, ${input.terms}, ${input.bankDetails}, ${input.internalNotes},
      ${input.contentHash}, ${context.membership.id}::uuid, ${context.user.id}::uuid
    )
    returning id
  `;
  const invoiceId = invoiceRows[0]?.id;
  if (!invoiceId) throw new FinanceActionError("The invoice draft could not be created.");

  for (const [index, line] of input.lines.entries()) {
    await sql`
      insert into public.finance_invoice_lines (
        organization_id, invoice_id, position, catalog_item_id, description,
        quantity_milli, unit_rate_minor, discount_bps, tax_bps
      ) values (
        ${context.membership.organizationId}::uuid, ${invoiceId}::uuid, ${index + 1},
        ${line.catalogItemId}::uuid, ${line.description}, ${line.quantityMilli},
        ${line.unitRateMinor}, ${line.discountBps}, ${line.taxBps}
      )
    `;
  }
  await sql`
    insert into public.finance_invoice_events (
      organization_id, invoice_id, event_type, event_data, actor_membership_id
    ) values (
      ${context.membership.organizationId}::uuid, ${invoiceId}::uuid, 'created',
      ${sql.json(
        toJsonValue({
          draftReference: input.draftReference,
          contentHash: input.contentHash,
          correctionOfInvoiceId: input.correctionOfInvoiceId ?? null,
        }),
      )},
      ${context.membership.id}::uuid
    )
  `;
  return invoiceId;
}

function databaseFailure(error: unknown, fallback: string): FinanceActionState {
  if (error instanceof FinanceActionError) return errorState(error.message);
  if (
    error instanceof Error &&
    /decimal|quantity|percentage|amount|calculated|approval policy|eligible approver|approval requires|self-approval|pending approval|approval submission|shared approval/i.test(
      error.message,
    )
  ) {
    return errorState(error.message);
  }

  const detail = (key: string): string | null => {
    if (!error || typeof error !== "object" || !(key in error)) return null;
    const value = Reflect.get(error, key);
    return value === null || value === undefined ? null : String(value);
  };
  const code = detail("code");
  const constraint = detail("constraint_name") ?? detail("constraint");
  console.warn("[AgencyOS] Finance action failed.", { code, constraint });

  if (code === "23505") {
    if (constraint?.includes("catalog"))
      return errorState("A finance item with this name or SKU already exists.");
    if (constraint?.includes("content"))
      return errorState("A matching draft already exists. Open the existing draft instead.");
    if (constraint?.includes("reference"))
      return errorState("This payment reference has already been recorded.");
  }
  if (code === "55000")
    return errorState(
      "Issued finance history is immutable. Use a void, revised invoice, or credit note correction.",
    );
  if (code === "23514" || code === "23503")
    return errorState(
      "One or more selected finance records are invalid or outside this organization.",
    );
  return errorState(fallback);
}

export async function createCatalogItemAction(
  _previousState: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  const parsed = catalogItemCreateSchema.safeParse(values(formData));
  if (!parsed.success)
    return errorState("Check the catalogue item fields.", parsed.error.flatten().fieldErrors);

  try {
    const context = await authorize(financePermissionKeys.catalogManage);
    const standardRateMinor = parseMoneyToMinor(parsed.data.standardRate, parsed.data.currency);
    const taxRateBps = parsePercentToBps(parsed.data.taxPercent);
    const database = getDatabaseClient();
    const rows = await database<{ id: string }[]>`
      insert into public.finance_catalog_items (
        organization_id, item_type, name, sku, description, unit, standard_rate_minor,
        tax_category, tax_rate_bps, currency, is_active, default_invoice_description,
        created_by_membership_id, created_by
      ) values (
        ${context.membership.organizationId}::uuid,
        ${parsed.data.itemType}, ${parsed.data.name}, ${parsed.data.sku}, ${parsed.data.description},
        ${parsed.data.unit}, ${standardRateMinor}, ${parsed.data.taxCategory}, ${taxRateBps},
        ${parsed.data.currency}, ${parsed.data.isActive}, ${parsed.data.defaultInvoiceDescription},
        ${context.membership.id}::uuid, ${context.user.id}::uuid
      )
      returning id
    `;
    const itemId = rows[0]?.id;
    if (!itemId) throw new FinanceActionError("The catalogue item could not be created.");

    await writeAuditEvent(database, context, {
      action: "finance.catalog_item.created",
      entityType: "finance_catalog_item",
      entityId: itemId,
      afterState: {
        itemType: parsed.data.itemType,
        name: parsed.data.name,
        sku: parsed.data.sku,
        currency: parsed.data.currency,
        standardRateMinor,
        taxRateBps,
      },
    });
    refreshFinance();
    return successState("Catalogue item created.", itemId);
  } catch (error) {
    return databaseFailure(error, "The catalogue item could not be created.");
  }
}

export async function setCatalogItemStatusAction(
  _previousState: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  const parsed = catalogItemStatusSchema.safeParse(values(formData));
  if (!parsed.success) return errorState("Check the catalogue item state.");

  try {
    const context = await authorize(financePermissionKeys.catalogManage);
    const rows = await getDatabaseClient()<Array<{ id: string; name: string; is_active: boolean }>>`
      update public.finance_catalog_items
      set is_active = ${parsed.data.isActive}
      where id = ${parsed.data.itemId}::uuid
        and organization_id = ${context.membership.organizationId}::uuid
      returning id, name, is_active
    `;
    const item = rows[0];
    if (!item) throw new FinanceActionError("Catalogue item was not found.");
    await writeAuditEvent(getDatabaseClient(), context, {
      action: item.is_active
        ? "finance.catalog_item.activated"
        : "finance.catalog_item.deactivated",
      entityType: "finance_catalog_item",
      entityId: item.id,
      afterState: { name: item.name, isActive: item.is_active },
    });
    refreshFinance();
    return successState(
      item.is_active ? "Catalogue item activated." : "Catalogue item deactivated.",
      item.id,
    );
  } catch (error) {
    return databaseFailure(error, "The catalogue item state could not be changed.");
  }
}

export async function createEstimateAction(
  _previousState: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  const parsed = estimateCreateSchema.safeParse(values(formData));
  if (!parsed.success)
    return errorState("Check the estimate fields.", parsed.error.flatten().fieldErrors);

  try {
    const context = await authorize(financePermissionKeys.estimateCreate);
    const preparedLines = prepareLines(parsed.data.lines, parsed.data.currency);
    calculateFinanceDocument(preparedLines);
    const hash = contentHash({
      companyId: parsed.data.companyId,
      contactId: parsed.data.contactId,
      projectId: parsed.data.projectId,
      issueDate: parsed.data.issueDate,
      expiryDate: parsed.data.expiryDate,
      currency: parsed.data.currency,
      notes: parsed.data.notes,
      terms: parsed.data.terms,
      lines: preparedLines,
    });
    const database = getDatabaseClient();
    const result = await database.begin(async (sql) => {
      await validateDocumentReferences(sql, context.membership.organizationId, parsed.data);
      const duplicateRows = await sql<{ id: string; estimate_number: string }[]>`
        select id, estimate_number from public.finance_estimates
        where organization_id = ${context.membership.organizationId}::uuid
          and content_hash = ${hash}
          and status in ('draft', 'pending_approval')
        limit 1
      `;
      if (duplicateRows[0]) return { ...duplicateRows[0], duplicate: true as const };

      const numberRows = await sql<{ value: string }[]>`
        select private.next_finance_document_number(
          ${context.membership.organizationId}::uuid,
          'estimate',
          extract(year from ${parsed.data.issueDate}::date)::integer,
          'EST'
        ) as value
      `;
      const estimateNumber = numberRows[0]?.value;
      if (!estimateNumber)
        throw new FinanceActionError("The estimate number could not be allocated.");

      const estimateRows = await sql<{ id: string }[]>`
        insert into public.finance_estimates (
          organization_id, estimate_number, company_id, contact_id, project_id,
          issue_date, expiry_date, currency, notes, terms, internal_notes, content_hash,
          created_by_membership_id, created_by
        ) values (
          ${context.membership.organizationId}::uuid, ${estimateNumber},
          ${parsed.data.companyId}::uuid, ${parsed.data.contactId}::uuid, ${parsed.data.projectId}::uuid,
          ${parsed.data.issueDate}::date, ${parsed.data.expiryDate}::date, ${parsed.data.currency},
          ${parsed.data.notes}, ${parsed.data.terms}, ${parsed.data.internalNotes}, ${hash},
          ${context.membership.id}::uuid, ${context.user.id}::uuid
        )
        returning id
      `;
      const estimateId = estimateRows[0]?.id;
      if (!estimateId) throw new FinanceActionError("The estimate could not be created.");

      for (const [index, line] of preparedLines.entries()) {
        await sql`
          insert into public.finance_estimate_lines (
            organization_id, estimate_id, position, catalog_item_id, description,
            quantity_milli, unit_rate_minor, discount_bps, tax_bps
          ) values (
            ${context.membership.organizationId}::uuid, ${estimateId}::uuid, ${index + 1},
            ${line.catalogItemId}::uuid, ${line.description}, ${line.quantityMilli},
            ${line.unitRateMinor}, ${line.discountBps}, ${line.taxBps}
          )
        `;
      }
      await insertEstimateVersion(sql, context, estimateId, "Estimate created");
      await writeAuditEvent(sql, context, {
        action: "finance.estimate.created",
        entityType: "finance_estimate",
        entityId: estimateId,
        afterState: { estimateNumber, companyId: parsed.data.companyId, contentHash: hash },
      });
      return { id: estimateId, estimate_number: estimateNumber, duplicate: false as const };
    });

    refreshFinance();
    if (result.duplicate) {
      return {
        status: "success",
        message: `Matching draft ${result.estimate_number} already exists.`,
        entityId: result.id,
        duplicateOfId: result.id,
      };
    }
    return successState(`Estimate ${result.estimate_number} created.`, result.id);
  } catch (error) {
    return databaseFailure(error, "The estimate could not be created.");
  }
}

export async function createInvoiceAction(
  _previousState: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  const parsed = invoiceCreateSchema.safeParse(values(formData));
  if (!parsed.success)
    return errorState("Check the invoice fields.", parsed.error.flatten().fieldErrors);

  try {
    const context = await authorize(financePermissionKeys.invoiceCreate);
    const preparedLines = prepareLines(parsed.data.lines, parsed.data.currency);
    calculateFinanceDocument(preparedLines);
    const hash = contentHash({
      companyId: parsed.data.companyId,
      contactId: parsed.data.contactId,
      projectId: parsed.data.projectId,
      sourceEstimateId: parsed.data.sourceEstimateId,
      purchaseOrderReference: parsed.data.purchaseOrderReference,
      issueDate: parsed.data.issueDate,
      dueDate: parsed.data.dueDate,
      servicePeriodStart: parsed.data.servicePeriodStart,
      servicePeriodEnd: parsed.data.servicePeriodEnd,
      currency: parsed.data.currency,
      exchangeRate: parsed.data.exchangeRate,
      notes: parsed.data.notes,
      terms: parsed.data.terms,
      bankDetails: parsed.data.bankDetails,
      lines: preparedLines,
    });
    const draftReference = `DRAFT-${new Date().getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const database = getDatabaseClient();
    const result = await database.begin(async (sql) => {
      await validateDocumentReferences(sql, context.membership.organizationId, parsed.data);
      const duplicateRows = await sql<{ id: string; draft_reference: string }[]>`
        select id, draft_reference from public.finance_invoices
        where organization_id = ${context.membership.organizationId}::uuid
          and content_hash = ${hash}
          and status in ('draft', 'pending_approval')
        limit 1
      `;
      if (duplicateRows[0]) return { ...duplicateRows[0], duplicate: true as const };

      const invoiceId = await insertInvoiceDraft(sql, context, {
        draftReference,
        companyId: parsed.data.companyId,
        contactId: parsed.data.contactId,
        projectId: parsed.data.projectId,
        sourceEstimateId: parsed.data.sourceEstimateId,
        purchaseOrderReference: parsed.data.purchaseOrderReference,
        issueDate: parsed.data.issueDate,
        dueDate: parsed.data.dueDate,
        servicePeriodStart: parsed.data.servicePeriodStart,
        servicePeriodEnd: parsed.data.servicePeriodEnd,
        currency: parsed.data.currency,
        exchangeRate: parsed.data.exchangeRate,
        notes: parsed.data.notes,
        terms: parsed.data.terms,
        bankDetails: parsed.data.bankDetails,
        internalNotes: parsed.data.internalNotes,
        contentHash: hash,
        lines: preparedLines,
      });
      await writeAuditEvent(sql, context, {
        action: "finance.invoice.created",
        entityType: "finance_invoice",
        entityId: invoiceId,
        afterState: { draftReference, companyId: parsed.data.companyId, contentHash: hash },
      });
      return { id: invoiceId, draft_reference: draftReference, duplicate: false as const };
    });

    refreshFinance();
    if (result.duplicate) {
      return {
        status: "success",
        message: `Matching draft ${result.draft_reference} already exists.`,
        entityId: result.id,
        duplicateOfId: result.id,
      };
    }
    return successState(`Invoice draft ${result.draft_reference} created.`, result.id);
  } catch (error) {
    return databaseFailure(error, "The invoice draft could not be created.");
  }
}

export async function createRevisedInvoiceAction(
  _previousState: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  const parsed = invoiceRevisionSchema.safeParse(values(formData));
  if (!parsed.success) {
    return errorState("Check the revised invoice fields.", parsed.error.flatten().fieldErrors);
  }

  try {
    const context = await authorize([
      financePermissionKeys.invoiceView,
      financePermissionKeys.invoiceCreate,
      financePermissionKeys.invoiceCorrect,
    ]);
    const database = getDatabaseClient();
    const result = await database.begin(async (sql) => {
      const invoiceRows = await sql<
        Array<{
          id: string;
          invoice_number: string | null;
          status: string;
          company_id: string;
          contact_id: string | null;
          project_id: string | null;
          purchase_order_reference: string | null;
          service_period_start: string | null;
          service_period_end: string | null;
          currency: string;
          exchange_rate: string | null;
          notes: string | null;
          terms: string | null;
          bank_details: string | null;
          internal_notes: string | null;
        }>
      >`
        select id, invoice_number, status, company_id, contact_id, project_id,
          purchase_order_reference, service_period_start::text, service_period_end::text,
          currency, exchange_rate::text, notes, terms, bank_details, internal_notes
        from public.finance_invoices
        where id = ${parsed.data.invoiceId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      const original = invoiceRows[0];
      if (
        !original?.invoice_number ||
        ["draft", "pending_approval", "approved", "void"].includes(original.status)
      ) {
        throw new FinanceActionError("Create revisions only from an issued, non-void invoice.");
      }

      const lineRows = await sql<
        Array<{
          catalog_item_id: string | null;
          description: string;
          quantity_milli: string | number;
          unit_rate_minor: string | number;
          discount_bps: number;
          tax_bps: number;
        }>
      >`
        select catalog_item_id, description, quantity_milli, unit_rate_minor, discount_bps, tax_bps
        from public.finance_invoice_lines
        where invoice_id = ${original.id}::uuid
        order by position
      `;
      if (!lineRows.length)
        throw new FinanceActionError("The original invoice has no billable lines.");
      const lines: PreparedLine[] = lineRows.map((line) => ({
        catalogItemId: line.catalog_item_id,
        description: line.description,
        quantityMilli: Number(line.quantity_milli),
        unitRateMinor: Number(line.unit_rate_minor),
        discountBps: line.discount_bps,
        taxBps: line.tax_bps,
      }));
      const hash = contentHash({
        correctionOfInvoiceId: original.id,
        correctionReason: parsed.data.reason,
        issueDate: parsed.data.issueDate,
        dueDate: parsed.data.dueDate,
        lines,
      });
      const duplicateRows = await sql<Array<{ id: string; draft_reference: string }>>`
        select id, draft_reference
        from public.finance_invoices
        where organization_id = ${context.membership.organizationId}::uuid
          and correction_of_invoice_id = ${original.id}::uuid
          and content_hash = ${hash}
          and status in ('draft', 'pending_approval')
        limit 1
      `;
      if (duplicateRows[0]) return { ...duplicateRows[0], duplicate: true as const };

      const draftReference = `REV-${new Date().getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
      const invoiceId = await insertInvoiceDraft(sql, context, {
        draftReference,
        companyId: original.company_id,
        contactId: original.contact_id,
        projectId: original.project_id,
        sourceEstimateId: null,
        correctionOfInvoiceId: original.id,
        correctionReason: parsed.data.reason,
        purchaseOrderReference: original.purchase_order_reference,
        issueDate: parsed.data.issueDate,
        dueDate: parsed.data.dueDate,
        servicePeriodStart: original.service_period_start,
        servicePeriodEnd: original.service_period_end,
        currency: original.currency,
        exchangeRate: original.exchange_rate,
        notes: original.notes,
        terms: original.terms,
        bankDetails: original.bank_details,
        internalNotes: original.internal_notes,
        contentHash: hash,
        lines,
      });
      await sql`
        insert into public.finance_invoice_events (
          organization_id, invoice_id, event_type, event_data, actor_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${original.id}::uuid, 'revision_created',
          ${sql.json(toJsonValue({ revisedInvoiceId: invoiceId, reason: parsed.data.reason }))},
          ${context.membership.id}::uuid
        )
      `;
      await writeAuditEvent(sql, context, {
        action: "finance.invoice.revision_created",
        entityType: "finance_invoice",
        entityId: invoiceId,
        afterState: {
          originalInvoiceId: original.id,
          originalInvoiceNumber: original.invoice_number,
          reason: parsed.data.reason,
        },
      });
      return { id: invoiceId, draft_reference: draftReference, duplicate: false as const };
    });

    refreshFinance();
    return successState(
      result.duplicate
        ? `A matching revised draft already exists (${result.draft_reference}).`
        : `Revised invoice draft ${result.draft_reference} created.`,
      result.id,
    );
  } catch (error) {
    return databaseFailure(error, "The revised invoice draft could not be created.");
  }
}

export async function createCreditNoteAction(
  _previousState: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  const parsed = creditNoteCreateSchema.safeParse(values(formData));
  if (!parsed.success) {
    return errorState("Check the credit note fields.", parsed.error.flatten().fieldErrors);
  }

  try {
    const context = await authorize([
      financePermissionKeys.invoiceView,
      financePermissionKeys.creditNoteCreate,
    ]);
    const database = getDatabaseClient();
    const result = await database.begin(async (sql) => {
      const invoiceRows = await sql<
        Array<{
          id: string;
          invoice_number: string | null;
          status: string;
          currency: string;
          total_minor: string | number;
          credited_minor: string | number;
        }>
      >`
        select id, invoice_number, status, currency, total_minor, credited_minor
        from public.finance_invoices
        where id = ${parsed.data.originalInvoiceId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      const invoice = invoiceRows[0];
      if (
        !invoice?.invoice_number ||
        ["draft", "pending_approval", "approved", "void", "credited"].includes(invoice.status)
      ) {
        throw new FinanceActionError("Create credit notes only for an open issued invoice.");
      }

      const preparedLines = prepareLines(parsed.data.lines, invoice.currency);
      const totals = calculateFinanceDocument(preparedLines);
      if (totals.totalMinor <= 0)
        throw new FinanceActionError("Credit note total must be greater than zero.");
      const remainingCredit = Number(invoice.total_minor) - Number(invoice.credited_minor);
      if (totals.totalMinor > remainingCredit) {
        throw new FinanceActionError(
          "Credit note total exceeds the remaining uncredited invoice amount.",
        );
      }
      const hash = contentHash({
        originalInvoiceId: invoice.id,
        reason: parsed.data.reason,
        lines: preparedLines,
      });
      const duplicateRows = await sql<Array<{ id: string }>>`
        select id
        from public.finance_credit_notes
        where organization_id = ${context.membership.organizationId}::uuid
          and original_invoice_id = ${invoice.id}::uuid
          and content_hash = ${hash}
          and status in ('draft', 'pending_approval')
        limit 1
      `;
      if (duplicateRows[0]) return { id: duplicateRows[0].id, duplicate: true as const };

      const noteRows = await sql<Array<{ id: string }>>`
        insert into public.finance_credit_notes (
          organization_id, original_invoice_id, currency, reason, internal_notes,
          content_hash, created_by_membership_id, created_by
        ) values (
          ${context.membership.organizationId}::uuid, ${invoice.id}::uuid, ${invoice.currency},
          ${parsed.data.reason}, ${parsed.data.internalNotes}, ${hash},
          ${context.membership.id}::uuid, ${context.user.id}::uuid
        )
        returning id
      `;
      const creditNoteId = noteRows[0]?.id;
      if (!creditNoteId)
        throw new FinanceActionError("The credit note draft could not be created.");
      for (const [index, line] of preparedLines.entries()) {
        await sql`
          insert into public.finance_credit_note_lines (
            organization_id, credit_note_id, position, catalog_item_id, description,
            quantity_milli, unit_rate_minor, discount_bps, tax_bps
          ) values (
            ${context.membership.organizationId}::uuid, ${creditNoteId}::uuid, ${index + 1},
            ${line.catalogItemId}::uuid, ${line.description}, ${line.quantityMilli},
            ${line.unitRateMinor}, ${line.discountBps}, ${line.taxBps}
          )
        `;
      }
      await sql`
        insert into public.finance_credit_note_events (
          organization_id, credit_note_id, event_type, event_data, actor_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${creditNoteId}::uuid, 'created',
          ${sql.json(toJsonValue({ originalInvoiceId: invoice.id, originalInvoiceNumber: invoice.invoice_number, contentHash: hash }))},
          ${context.membership.id}::uuid
        )
      `;
      await writeAuditEvent(sql, context, {
        action: "finance.credit_note.created",
        entityType: "finance_credit_note",
        entityId: creditNoteId,
        afterState: {
          originalInvoiceId: invoice.id,
          originalInvoiceNumber: invoice.invoice_number,
          totalMinor: totals.totalMinor,
          currency: invoice.currency,
        },
      });
      return { id: creditNoteId, duplicate: false as const };
    });

    refreshFinance();
    return successState(
      result.duplicate
        ? "A matching credit note draft already exists."
        : "Credit note draft created.",
      result.id,
    );
  } catch (error) {
    return databaseFailure(error, "The credit note draft could not be created.");
  }
}

export async function issueCreditNoteAction(
  _previousState: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  const parsed = creditNoteIssueSchema.safeParse(values(formData));
  if (!parsed.success) {
    return errorState("Check the credit note issue date.", parsed.error.flatten().fieldErrors);
  }

  try {
    const context = await authorize(financePermissionKeys.creditNoteIssue);
    const database = getDatabaseClient();
    const creditNoteNumber = await database.begin(async (sql) => {
      const noteRows = await sql<
        Array<{
          id: string;
          original_invoice_id: string;
          status: string;
          approval_status: string;
          approval_request_id: string | null;
          currency: string;
          total_minor: string | number;
        }>
      >`
        select id, original_invoice_id, status, approval_status, approval_request_id, currency, total_minor
        from public.finance_credit_notes
        where id = ${parsed.data.creditNoteId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      const note = noteRows[0];
      if (!note) throw new FinanceActionError("Credit note was not found.");
      if (
        note.status !== "approved" ||
        note.approval_status !== "approved" ||
        !note.approval_request_id
      ) {
        throw new FinanceActionError("Complete shared approval before issuing the credit note.");
      }
      if (Number(note.total_minor) <= 0) {
        throw new FinanceActionError(
          "Add at least one credit line before issuing the credit note.",
        );
      }

      const invoiceRows = await sql<
        Array<{
          id: string;
          invoice_number: string | null;
          status: string;
          currency: string;
          total_minor: string | number;
          credited_minor: string | number;
          seller_snapshot: Record<string, unknown> | null;
          client_snapshot: Record<string, unknown> | null;
        }>
      >`
        select id, invoice_number, status, currency, total_minor, credited_minor,
          seller_snapshot, client_snapshot
        from public.finance_invoices
        where id = ${note.original_invoice_id}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      const invoice = invoiceRows[0];
      if (
        !invoice?.invoice_number ||
        ["draft", "pending_approval", "approved", "void", "credited"].includes(invoice.status)
      ) {
        throw new FinanceActionError("The original invoice is not open for another credit.");
      }
      if (invoice.currency !== note.currency) {
        throw new FinanceActionError("Credit note currency must match the original invoice.");
      }
      const remainingCredit = Number(invoice.total_minor) - Number(invoice.credited_minor);
      if (Number(note.total_minor) > remainingCredit) {
        throw new FinanceActionError(
          "Credit note total exceeds the remaining uncredited invoice amount.",
        );
      }

      const snapshotRows = await sql<
        Array<{
          calculation_snapshot: Record<string, unknown>;
          original_invoice_snapshot: Record<string, unknown>;
        }>
      >`
        select
          jsonb_build_object(
            'currency', credit_note.currency,
            'subtotalMinor', credit_note.subtotal_minor,
            'discountMinor', credit_note.discount_minor,
            'taxMinor', credit_note.tax_minor,
            'totalMinor', credit_note.total_minor,
            'lines', coalesce((
              select jsonb_agg(jsonb_build_object(
                'position', line.position,
                'description', line.description,
                'quantityMilli', line.quantity_milli,
                'unitRateMinor', line.unit_rate_minor,
                'discountBps', line.discount_bps,
                'taxBps', line.tax_bps,
                'subtotalMinor', line.subtotal_minor,
                'discountMinor', line.discount_minor,
                'taxMinor', line.tax_minor,
                'totalMinor', line.total_minor
              ) order by line.position)
              from public.finance_credit_note_lines as line
              where line.credit_note_id = credit_note.id
            ), '[]'::jsonb)
          ) as calculation_snapshot,
          jsonb_build_object(
            'invoiceId', invoice.id,
            'invoiceNumber', invoice.invoice_number,
            'invoiceTotalMinor', invoice.total_minor,
            'amountPaidMinor', invoice.amount_paid_minor,
            'creditedBeforeMinor', invoice.credited_minor,
            'currency', invoice.currency
          ) as original_invoice_snapshot
        from public.finance_credit_notes as credit_note
        join public.finance_invoices as invoice on invoice.id = credit_note.original_invoice_id
        where credit_note.id = ${note.id}::uuid
        limit 1
      `;
      const snapshot = snapshotRows[0];
      if (!snapshot || !invoice.seller_snapshot || !invoice.client_snapshot) {
        throw new FinanceActionError("Credit note snapshot data could not be prepared.");
      }
      const numberRows = await sql<Array<{ value: string }>>`
        select private.next_finance_document_number(
          ${context.membership.organizationId}::uuid,
          'credit_note',
          extract(year from ${parsed.data.issueDate}::date)::integer,
          'CN'
        ) as value
      `;
      const allocated = numberRows[0]?.value;
      if (!allocated)
        throw new FinanceActionError("The credit note number could not be allocated.");

      await sql`
        update public.finance_credit_notes
        set credit_note_number = ${allocated}, issue_date = ${parsed.data.issueDate}::date,
          status = 'issued', issued_at = now(),
          seller_snapshot = ${sql.json(toJsonValue(invoice.seller_snapshot))},
          client_snapshot = ${sql.json(toJsonValue(invoice.client_snapshot))},
          calculation_snapshot = ${sql.json(toJsonValue(snapshot.calculation_snapshot))},
          original_invoice_snapshot = ${sql.json(toJsonValue(snapshot.original_invoice_snapshot))}
        where id = ${note.id}::uuid
      `;
      await sql`
        insert into public.finance_credit_note_events (
          organization_id, credit_note_id, event_type, event_data, actor_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${note.id}::uuid, 'issued',
          ${sql.json(toJsonValue({ creditNoteNumber: allocated, issueDate: parsed.data.issueDate, originalInvoiceId: invoice.id }))},
          ${context.membership.id}::uuid
        )
      `;
      await sql`
        insert into public.finance_invoice_events (
          organization_id, invoice_id, event_type, event_data, actor_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${invoice.id}::uuid, 'credit_note_issued',
          ${sql.json(toJsonValue({ creditNoteId: note.id, creditNoteNumber: allocated, totalMinor: Number(note.total_minor) }))},
          ${context.membership.id}::uuid
        )
      `;
      await writeAuditEvent(sql, context, {
        action: "finance.credit_note.issued",
        entityType: "finance_credit_note",
        entityId: note.id,
        afterState: {
          creditNoteNumber: allocated,
          originalInvoiceId: invoice.id,
          totalMinor: Number(note.total_minor),
          currency: note.currency,
        },
      });
      return allocated;
    });

    let pdfStored = true;
    try {
      await ensureFinanceDocumentSnapshot(context, "credit_note", parsed.data.creditNoteId);
    } catch (snapshotError) {
      pdfStored = false;
      console.warn("[AgencyOS] Issued credit note PDF generation failed.", {
        creditNoteId: parsed.data.creditNoteId,
        code: snapshotError instanceof Error ? snapshotError.message : "unknown",
      });
    }
    refreshFinance();
    return successState(
      pdfStored
        ? `Credit note ${creditNoteNumber} issued and applied with an immutable PDF snapshot.`
        : `Credit note ${creditNoteNumber} issued and applied. Generate its PDF before delivery.`,
      parsed.data.creditNoteId,
    );
  } catch (error) {
    return databaseFailure(error, "The credit note could not be issued.");
  }
}

export async function voidCreditNoteAction(
  _previousState: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  const parsed = creditNoteVoidSchema.safeParse(values(formData));
  if (!parsed.success) {
    return errorState("Check the void reason.", parsed.error.flatten().fieldErrors);
  }

  try {
    const context = await authorize(financePermissionKeys.creditNoteVoid);
    await getDatabaseClient().begin(async (sql) => {
      const rows = await sql<
        Array<{
          id: string;
          credit_note_number: string | null;
          original_invoice_id: string;
          status: string;
          total_minor: string | number;
        }>
      >`
        select id, credit_note_number, original_invoice_id, status, total_minor
        from public.finance_credit_notes
        where id = ${parsed.data.creditNoteId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      const note = rows[0];
      if (!note?.credit_note_number || !["issued", "sent"].includes(note.status)) {
        throw new FinanceActionError("Only an issued credit note can be voided.");
      }
      await sql`
        update public.finance_credit_notes
        set status = 'void', voided_at = now(), void_reason = ${parsed.data.reason}
        where id = ${note.id}::uuid
      `;
      await sql`
        insert into public.finance_credit_note_events (
          organization_id, credit_note_id, event_type, event_data, actor_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${note.id}::uuid, 'voided',
          ${sql.json(toJsonValue({ reason: parsed.data.reason }))}, ${context.membership.id}::uuid
        )
      `;
      await sql`
        insert into public.finance_invoice_events (
          organization_id, invoice_id, event_type, event_data, actor_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${note.original_invoice_id}::uuid,
          'credit_note_voided',
          ${sql.json(toJsonValue({ creditNoteId: note.id, creditNoteNumber: note.credit_note_number, totalMinor: Number(note.total_minor) }))},
          ${context.membership.id}::uuid
        )
      `;
      await writeAuditEvent(sql, context, {
        action: "finance.credit_note.voided",
        entityType: "finance_credit_note",
        entityId: note.id,
        afterState: { reason: parsed.data.reason, originalInvoiceId: note.original_invoice_id },
      });
    });
    refreshFinance();
    return successState(
      "Credit note voided and the invoice balance recalculated.",
      parsed.data.creditNoteId,
    );
  } catch (error) {
    return databaseFailure(error, "The credit note could not be voided.");
  }
}

export async function decideFinanceApprovalAction(
  _previousState: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  const parsed = financeApprovalDecisionSchema.safeParse(values(formData));
  if (!parsed.success) {
    return errorState("Check the approval decision.", parsed.error.flatten().fieldErrors);
  }
  const entityType = parsed.data.entityType;
  const label =
    entityType === "estimate" ? "Estimate" : entityType === "invoice" ? "Invoice" : "Credit note";
  const permission =
    entityType === "estimate"
      ? financePermissionKeys.estimateUpdate
      : entityType === "invoice"
        ? financePermissionKeys.invoiceUpdate
        : financePermissionKeys.creditNoteCreate;

  try {
    const context = await authorize(permission);
    const database = getDatabaseClient();
    const rows = await database<
      Array<{
        id: string;
        status: string;
        approval_status: string;
        total_minor: string | number;
        currency: string;
        content_hash: string;
        display_number: string;
      }>
    >`
      ${
        entityType === "estimate"
          ? database`
            select id, status, approval_status, total_minor, currency, content_hash,
              estimate_number as display_number
            from public.finance_estimates
            where id = ${parsed.data.entityId}::uuid
              and organization_id = ${context.membership.organizationId}::uuid
            limit 1
          `
          : entityType === "invoice"
            ? database`
              select id, status, approval_status, total_minor, currency, content_hash,
                coalesce(invoice_number, draft_reference) as display_number
              from public.finance_invoices
              where id = ${parsed.data.entityId}::uuid
                and organization_id = ${context.membership.organizationId}::uuid
              limit 1
            `
            : database`
              select id, status, approval_status, total_minor, currency, content_hash,
                coalesce(credit_note_number, left(id::text, 8)) as display_number
              from public.finance_credit_notes
              where id = ${parsed.data.entityId}::uuid
                and organization_id = ${context.membership.organizationId}::uuid
              limit 1
            `
      }
    `;
    const record = rows[0];
    if (!record) throw new FinanceActionError(`${label} was not found.`);
    if (record.status !== "draft") {
      throw new FinanceActionError("Only a draft can be submitted for approval.");
    }

    const amountMinor = Number(record.total_minor);
    if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
      throw new FinanceActionError("The finance total is outside the supported approval range.");
    }

    const submitted = await submitFinanceApprovalForRecord(
      context,
      {
        entityType,
        entityId: record.id,
        title: `${label} ${record.display_number}`,
        amountMinor,
        currency: record.currency,
        snapshot: {
          entityId: record.id,
          entityType,
          displayNumber: record.display_number,
          totalMinor: amountMinor,
          currency: record.currency,
          contentHash: record.content_hash,
        },
      },
      async (sql, requestId) => {
        if (entityType === "estimate") {
          const updated = await sql<{ id: string }[]>`
            update public.finance_estimates
            set status = 'pending_approval', approval_status = 'pending',
              approval_request_id = ${requestId}::uuid, approved_at = null,
              version_number = version_number + 1
            where id = ${record.id}::uuid
              and organization_id = ${context.membership.organizationId}::uuid
              and status = 'draft'
              and content_hash = ${record.content_hash}
            returning id
          `;
          if (!updated[0]) {
            throw new FinanceActionError(
              "The estimate changed before approval submission. Reload and try again.",
            );
          }
          await insertEstimateVersion(sql, context, record.id, "Submitted for shared approval");
        } else if (entityType === "invoice") {
          const updated = await sql<{ id: string }[]>`
            update public.finance_invoices
            set status = 'pending_approval', approval_status = 'pending',
              approval_request_id = ${requestId}::uuid, approved_at = null
            where id = ${record.id}::uuid
              and organization_id = ${context.membership.organizationId}::uuid
              and status = 'draft'
              and content_hash = ${record.content_hash}
            returning id
          `;
          if (!updated[0]) {
            throw new FinanceActionError(
              "The invoice changed before approval submission. Reload and try again.",
            );
          }
          await sql`
            insert into public.finance_invoice_events (
              organization_id, invoice_id, event_type, event_data, actor_membership_id
            ) values (
              ${context.membership.organizationId}::uuid, ${record.id}::uuid, 'submitted',
              ${sql.json(toJsonValue({ approvalRequestId: requestId }))},
              ${context.membership.id}::uuid
            )
          `;
        } else {
          const updated = await sql<{ id: string }[]>`
            update public.finance_credit_notes
            set status = 'pending_approval', approval_status = 'pending',
              approval_request_id = ${requestId}::uuid, approved_at = null
            where id = ${record.id}::uuid
              and organization_id = ${context.membership.organizationId}::uuid
              and status = 'draft'
              and content_hash = ${record.content_hash}
            returning id
          `;
          if (!updated[0]) {
            throw new FinanceActionError(
              "The credit note changed before approval submission. Reload and try again.",
            );
          }
          await sql`
            insert into public.finance_credit_note_events (
              organization_id, credit_note_id, event_type, event_data, actor_membership_id
            ) values (
              ${context.membership.organizationId}::uuid, ${record.id}::uuid, 'submitted',
              ${sql.json(toJsonValue({ approvalRequestId: requestId }))},
              ${context.membership.id}::uuid
            )
          `;
        }

        await writeAuditEvent(sql, context, {
          action: `finance.${entityType}.approval_submitted`,
          entityType: `finance_${entityType}`,
          entityId: record.id,
          beforeState: { status: record.status, approvalStatus: record.approval_status },
          afterState: {
            status: "pending_approval",
            approvalStatus: "pending",
            approvalRequestId: requestId,
          },
          changedFields: ["status", "approval_status", "approval_request_id"],
        });
      },
    );

    refreshFinance();
    return successState(
      `${label} submitted for shared approval. Track request ${submitted.requestId.slice(0, 8)} in Approvals.`,
      record.id,
    );
  } catch (error) {
    return databaseFailure(error, "The approval request could not be submitted.");
  }
}

export async function recordEstimateClientDecisionAction(
  _previousState: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  const parsed = estimateClientDecisionSchema.safeParse(values(formData));
  if (!parsed.success) {
    return errorState("Check the client decision evidence.", parsed.error.flatten().fieldErrors);
  }

  try {
    const context = await authorize(financePermissionKeys.estimateAccept);
    await getDatabaseClient().begin(async (sql) => {
      const rows = await sql<
        Array<{
          estimate_number: string;
          status: string;
          approval_status: string;
          converted_invoice_id: string | null;
        }>
      >`
        select estimate_number, status, approval_status, converted_invoice_id
        from public.finance_estimates
        where id = ${parsed.data.estimateId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      const estimate = rows[0];
      if (!estimate) throw new FinanceActionError("Estimate was not found.");
      if (estimate.converted_invoice_id || estimate.status === "converted") {
        throw new FinanceActionError("Converted estimates cannot change client acceptance.");
      }
      if (
        estimate.approval_status !== "approved" ||
        !["approved", "sent"].includes(estimate.status)
      ) {
        throw new FinanceActionError("Approve the estimate before recording a client decision.");
      }

      await sql`
        update public.finance_estimates
        set client_acceptance_status = ${parsed.data.decision},
          status = ${parsed.data.decision === "accepted" ? "accepted" : "rejected"},
          accepted_at = case when ${parsed.data.decision} = 'accepted' then now() else null end,
          client_decision_note = ${parsed.data.note},
          client_decision_recorded_at = now(),
          client_decision_recorded_by_membership_id = ${context.membership.id}::uuid,
          version_number = version_number + 1
        where id = ${parsed.data.estimateId}::uuid
      `;
      await insertEstimateVersion(
        sql,
        context,
        parsed.data.estimateId,
        `Client ${parsed.data.decision}`,
      );
      await writeAuditEvent(sql, context, {
        action: `finance.estimate.client_${parsed.data.decision}`,
        entityType: "finance_estimate",
        entityId: parsed.data.estimateId,
        afterState: {
          estimateNumber: estimate.estimate_number,
          clientAcceptanceStatus: parsed.data.decision,
          evidenceNote: parsed.data.note,
        },
      });
    });
    refreshFinance();
    return successState(
      parsed.data.decision === "accepted"
        ? "Client acceptance recorded."
        : "Client rejection recorded.",
      parsed.data.estimateId,
    );
  } catch (error) {
    return databaseFailure(error, "The client decision could not be recorded.");
  }
}

export async function convertEstimateToInvoiceAction(
  _previousState: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  const parsed = estimateConvertSchema.safeParse(values(formData));
  if (!parsed.success) {
    return errorState("Check the invoice conversion fields.", parsed.error.flatten().fieldErrors);
  }
  if (parsed.data.dueDate < parsed.data.issueDate) {
    return errorState("Due date cannot be before the issue date.");
  }

  try {
    const context = await authorize([
      financePermissionKeys.estimateConvert,
      financePermissionKeys.invoiceCreate,
    ]);
    const result = await getDatabaseClient().begin(async (sql) => {
      const rows = await sql<
        Array<{
          id: string;
          estimate_number: string;
          company_id: string;
          contact_id: string | null;
          project_id: string | null;
          currency: string;
          status: string;
          client_acceptance_status: string;
          notes: string | null;
          terms: string | null;
          internal_notes: string | null;
          converted_invoice_id: string | null;
        }>
      >`
        select id, estimate_number, company_id, contact_id, project_id, currency, status,
          client_acceptance_status, notes, terms, internal_notes, converted_invoice_id
        from public.finance_estimates
        where id = ${parsed.data.estimateId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      const estimate = rows[0];
      if (!estimate) throw new FinanceActionError("Estimate was not found.");
      if (estimate.converted_invoice_id) {
        return { invoiceId: estimate.converted_invoice_id, duplicate: true as const };
      }
      if (estimate.status !== "accepted" || estimate.client_acceptance_status !== "accepted") {
        throw new FinanceActionError("Record client acceptance before converting the estimate.");
      }

      const lineRows = await sql<
        Array<{
          catalog_item_id: string | null;
          description: string;
          quantity_milli: string | number;
          unit_rate_minor: string | number;
          discount_bps: number;
          tax_bps: number;
        }>
      >`
        select catalog_item_id, description, quantity_milli, unit_rate_minor, discount_bps, tax_bps
        from public.finance_estimate_lines
        where estimate_id = ${parsed.data.estimateId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        order by position
      `;
      if (!lineRows.length) throw new FinanceActionError("Estimate has no billable line items.");
      const preparedLines: PreparedLine[] = lineRows.map((line) => ({
        catalogItemId: line.catalog_item_id,
        description: line.description,
        quantityMilli: Number(line.quantity_milli),
        unitRateMinor: Number(line.unit_rate_minor),
        discountBps: line.discount_bps,
        taxBps: line.tax_bps,
      }));
      calculateFinanceDocument(preparedLines);
      const hash = contentHash({
        sourceEstimateId: estimate.id,
        companyId: estimate.company_id,
        contactId: estimate.contact_id,
        projectId: estimate.project_id,
        issueDate: parsed.data.issueDate,
        dueDate: parsed.data.dueDate,
        currency: estimate.currency,
        notes: estimate.notes,
        terms: estimate.terms,
        bankDetails: parsed.data.bankDetails,
        lines: preparedLines,
      });
      const draftReference = `DRAFT-${new Date().getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
      const invoiceId = await insertInvoiceDraft(sql, context, {
        draftReference,
        companyId: estimate.company_id,
        contactId: estimate.contact_id,
        projectId: estimate.project_id,
        sourceEstimateId: estimate.id,
        purchaseOrderReference: parsed.data.purchaseOrderReference,
        issueDate: parsed.data.issueDate,
        dueDate: parsed.data.dueDate,
        servicePeriodStart: null,
        servicePeriodEnd: null,
        currency: estimate.currency,
        notes: estimate.notes,
        terms: estimate.terms,
        bankDetails: parsed.data.bankDetails,
        internalNotes: estimate.internal_notes,
        contentHash: hash,
        lines: preparedLines,
      });
      await sql`
        update public.finance_estimates
        set status = 'converted', converted_invoice_id = ${invoiceId}::uuid,
          version_number = version_number + 1
        where id = ${estimate.id}::uuid
      `;
      await insertEstimateVersion(sql, context, estimate.id, "Converted to invoice");
      await writeAuditEvent(sql, context, {
        action: "finance.estimate.converted",
        entityType: "finance_estimate",
        entityId: estimate.id,
        afterState: {
          estimateNumber: estimate.estimate_number,
          invoiceId,
          draftReference,
        },
      });
      await writeAuditEvent(sql, context, {
        action: "finance.invoice.created_from_estimate",
        entityType: "finance_invoice",
        entityId: invoiceId,
        afterState: {
          sourceEstimateId: estimate.id,
          draftReference,
          contentHash: hash,
        },
      });
      return { invoiceId, duplicate: false as const };
    });

    refreshFinance();
    return successState(
      result.duplicate
        ? "This estimate is already linked to an invoice draft."
        : "Estimate converted to an invoice draft.",
      result.invoiceId,
    );
  } catch (error) {
    return databaseFailure(error, "The estimate could not be converted.");
  }
}

export async function issueInvoiceAction(
  _previousState: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  const parsed = invoiceIssueSchema.safeParse(values(formData));
  if (!parsed.success)
    return errorState("Check the invoice issue dates.", parsed.error.flatten().fieldErrors);
  if (parsed.data.dueDate < parsed.data.issueDate)
    return errorState("Due date cannot be before the issue date.");

  try {
    const context = await authorize(financePermissionKeys.invoiceIssue);
    const database = getDatabaseClient();
    const invoiceNumber = await database.begin(async (sql) => {
      const rows = await sql<
        Array<{
          id: string;
          status: string;
          approval_status: string;
          approval_request_id: string | null;
          total_minor: string | number;
          company_id: string;
          currency: string;
        }>
      >`
        select id, status, approval_status, approval_request_id, total_minor, company_id, currency
        from public.finance_invoices
        where id = ${parsed.data.invoiceId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      const invoice = rows[0];
      if (!invoice) throw new FinanceActionError("Invoice was not found.");
      if (
        invoice.status !== "approved" ||
        invoice.approval_status !== "approved" ||
        !invoice.approval_request_id
      ) {
        throw new FinanceActionError("Complete shared approval before issuing the invoice.");
      }
      if (Number(invoice.total_minor) <= 0)
        throw new FinanceActionError("Add at least one billable line before issuing the invoice.");

      const lineCountRows = await sql<{ count: number }[]>`
        select count(*)::integer as count from public.finance_invoice_lines
        where invoice_id = ${parsed.data.invoiceId}::uuid
      `;
      if ((lineCountRows[0]?.count ?? 0) === 0)
        throw new FinanceActionError("Add at least one invoice line.");

      const snapshotRows = await sql<
        Array<{
          seller_snapshot: Record<string, unknown>;
          client_snapshot: Record<string, unknown>;
          calculation_snapshot: Record<string, unknown>;
          payment_snapshot: Record<string, unknown>;
        }>
      >`
        select
          jsonb_build_object(
            'legalName', organization.legal_name,
            'tradingName', organization.trading_name,
            'registeredAddress', organization.registered_address,
            'billingAddress', organization.billing_address,
            'countryCode', organization.country_code,
            'taxIdentifiers', organization.tax_identifiers,
            'registrationNumbers', organization.registration_numbers,
            'invoiceSettings', organization.invoice_settings
          ) as seller_snapshot,
          jsonb_build_object(
            'companyId', company.id,
            'legalName', company.legal_name,
            'displayName', company.display_name,
            'billingAddress', company.billing_address,
            'taxIdentifiers', company.tax_identifiers,
            'registrationDetails', company.registration_details,
            'paymentTermsDays', company.payment_terms_days,
            'contact', case when contact.id is null then null else jsonb_build_object(
              'id', contact.id,
              'name', nullif(concat_ws(' ', contact.first_name, contact.last_name), ''),
              'email', contact.email
            ) end
          ) as client_snapshot,
          jsonb_build_object(
            'currency', invoice.currency,
            'exchangeRate', invoice.exchange_rate,
            'subtotalMinor', invoice.subtotal_minor,
            'discountMinor', invoice.discount_minor,
            'taxMinor', invoice.tax_minor,
            'totalMinor', invoice.total_minor,
            'lines', coalesce((
              select jsonb_agg(jsonb_build_object(
                'position', line.position,
                'description', line.description,
                'quantityMilli', line.quantity_milli,
                'unitRateMinor', line.unit_rate_minor,
                'discountBps', line.discount_bps,
                'taxBps', line.tax_bps,
                'subtotalMinor', line.subtotal_minor,
                'discountMinor', line.discount_minor,
                'taxMinor', line.tax_minor,
                'totalMinor', line.total_minor
              ) order by line.position)
              from public.finance_invoice_lines as line
              where line.invoice_id = invoice.id
            ), '[]'::jsonb)
          ) as calculation_snapshot,
          jsonb_build_object(
            'bankDetails', invoice.bank_details,
            'terms', invoice.terms,
            'dueDate', ${parsed.data.dueDate}::date,
            'paymentTerms', concat(company.payment_terms_days, ' days')
          ) as payment_snapshot
        from public.finance_invoices as invoice
        join public.organizations as organization on organization.id = invoice.organization_id
        join public.crm_companies as company on company.id = invoice.company_id
        left join public.crm_contacts as contact on contact.id = invoice.contact_id
        where invoice.id = ${parsed.data.invoiceId}::uuid
        limit 1
      `;
      const snapshot = snapshotRows[0];
      if (!snapshot) throw new FinanceActionError("Invoice snapshot data could not be prepared.");

      const numberRows = await sql<{ value: string }[]>`
        select private.next_finance_document_number(
          ${context.membership.organizationId}::uuid,
          'invoice',
          extract(year from ${parsed.data.issueDate}::date)::integer,
          'INV'
        ) as value
      `;
      const allocated = numberRows[0]?.value;
      if (!allocated) throw new FinanceActionError("The invoice number could not be allocated.");

      await sql`
        update public.finance_invoices
        set invoice_number = ${allocated}, issue_date = ${parsed.data.issueDate}::date,
          due_date = ${parsed.data.dueDate}::date, status = 'issued', issued_at = now(),
          balance_minor = total_minor,
          seller_snapshot = ${sql.json(toJsonValue(snapshot.seller_snapshot))},
          client_snapshot = ${sql.json(toJsonValue(snapshot.client_snapshot))},
          calculation_snapshot = ${sql.json(toJsonValue(snapshot.calculation_snapshot))},
          payment_snapshot = ${sql.json(toJsonValue(snapshot.payment_snapshot))}
        where id = ${parsed.data.invoiceId}::uuid
      `;
      await sql`
        insert into public.finance_invoice_events (
          organization_id, invoice_id, event_type, event_data, actor_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${parsed.data.invoiceId}::uuid, 'issued',
          ${sql.json(toJsonValue({ invoiceNumber: allocated, issueDate: parsed.data.issueDate, dueDate: parsed.data.dueDate }))},
          ${context.membership.id}::uuid
        )
      `;
      await writeAuditEvent(sql, context, {
        action: "finance.invoice.issued",
        entityType: "finance_invoice",
        entityId: parsed.data.invoiceId,
        afterState: {
          invoiceNumber: allocated,
          issueDate: parsed.data.issueDate,
          dueDate: parsed.data.dueDate,
        },
      });
      return allocated;
    });

    let pdfStored = true;
    try {
      await ensureFinanceDocumentSnapshot(context, "invoice", parsed.data.invoiceId);
    } catch (snapshotError) {
      pdfStored = false;
      console.warn("[AgencyOS] Issued invoice PDF generation failed.", {
        invoiceId: parsed.data.invoiceId,
        code: snapshotError instanceof Error ? snapshotError.message : "unknown",
      });
    }

    refreshFinance();
    return successState(
      pdfStored
        ? `Invoice ${invoiceNumber} issued with an immutable PDF snapshot.`
        : `Invoice ${invoiceNumber} issued. Generate its PDF before sending or downloading it.`,
      parsed.data.invoiceId,
    );
  } catch (error) {
    return databaseFailure(error, "The invoice could not be issued.");
  }
}

function documentViewPermission(
  entityType: "estimate" | "invoice" | "credit_note" | "payment_receipt",
): string {
  if (entityType === "estimate") return financePermissionKeys.estimateView;
  if (entityType === "invoice") return financePermissionKeys.invoiceView;
  if (entityType === "credit_note") return financePermissionKeys.creditNoteView;
  return financePermissionKeys.paymentView;
}

function documentGenerationError(error: unknown): FinanceActionState {
  const code = error instanceof Error ? error.message : "";
  if (code === "finance-estimate-not-final") {
    return errorState("Approve the estimate before generating its PDF snapshot.");
  }
  if (code === "finance-invoice-not-issued") {
    return errorState("Issue the invoice before generating its PDF snapshot.");
  }
  if (code === "finance-credit-note-not-issued") {
    return errorState("Issue the credit note before generating its PDF snapshot.");
  }
  if (code === "finance-payment-not-found") {
    return errorState("The payment was not found before its receipt could be generated.");
  }
  if (code === "finance-document-has-no-lines") {
    return errorState("Add at least one billable line before generating the PDF.");
  }
  if (code === "finance-document-not-found") {
    return errorState("The finance document was not found.");
  }
  console.warn("[AgencyOS] Finance PDF generation failed.", { code: code || "unknown" });
  return errorState("The immutable PDF snapshot could not be generated.");
}

export async function generateFinanceDocumentSnapshotAction(
  _previousState: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  const parsed = financeDocumentSnapshotSchema.safeParse(values(formData));
  if (!parsed.success) return errorState("Check the finance document details.");

  try {
    const context = await authorize([
      financePermissionKeys.documentDownload,
      documentViewPermission(parsed.data.entityType),
    ]);
    const snapshot = await ensureFinanceDocumentSnapshot(
      context,
      parsed.data.entityType,
      parsed.data.entityId,
    );
    await writeAuditEvent(getDatabaseClient(), context, {
      action: "finance.document.snapshot_generated",
      entityType: "finance_document_snapshot",
      entityId: snapshot.id,
      afterState: {
        sourceEntityType: snapshot.entityType,
        sourceEntityId: snapshot.entityId,
        documentNumber: snapshot.documentNumber,
        versionNumber: snapshot.versionNumber,
        privateFileId: snapshot.privateFileId,
      },
    });
    refreshFinance();
    return successState(`${snapshot.documentNumber} PDF snapshot is ready.`, parsed.data.entityId);
  } catch (error) {
    if (error instanceof FinanceActionError) return errorState(error.message);
    return documentGenerationError(error);
  }
}

async function loadFinanceEmailTemplate(
  sql: QuerySql,
  organizationId: string,
  entityType: "estimate" | "invoice" | "credit_note",
  entityId: string,
) {
  if (entityType === "estimate") {
    const rows = await sql<
      Array<{
        document_number: string;
        client_name: string;
        currency: string;
        total_minor: string | number;
      }>
    >`
      select estimate.estimate_number as document_number,
        coalesce(company.display_name, company.legal_name) as client_name,
        estimate.currency, estimate.total_minor
      from public.finance_estimates as estimate
      join public.crm_companies as company on company.id = estimate.company_id
      where estimate.id = ${entityId}::uuid and estimate.organization_id = ${organizationId}::uuid
      limit 1
    `;
    const row = rows[0];
    if (!row) throw new FinanceActionError("The estimate was not found.");
    return buildFinanceDocumentEmailTemplate({
      documentType: "Estimate",
      documentNumber: row.document_number,
      clientName: row.client_name,
      currency: row.currency,
      totalMinor: Number(row.total_minor),
    });
  }
  if (entityType === "invoice") {
    const rows = await sql<
      Array<{
        document_number: string;
        client_name: string;
        currency: string;
        total_minor: string | number;
        balance_minor: string | number;
        due_date: string | null;
      }>
    >`
      select coalesce(invoice.invoice_number, invoice.draft_reference) as document_number,
        coalesce(company.display_name, company.legal_name) as client_name,
        invoice.currency, invoice.total_minor, invoice.balance_minor, invoice.due_date::text
      from public.finance_invoices as invoice
      join public.crm_companies as company on company.id = invoice.company_id
      where invoice.id = ${entityId}::uuid and invoice.organization_id = ${organizationId}::uuid
      limit 1
    `;
    const row = rows[0];
    if (!row) throw new FinanceActionError("The invoice was not found.");
    return buildFinanceDocumentEmailTemplate({
      documentType: "Invoice",
      documentNumber: row.document_number,
      clientName: row.client_name,
      currency: row.currency,
      totalMinor: Number(row.total_minor),
      balanceMinor: Number(row.balance_minor),
      dueDate: row.due_date,
    });
  }
  const rows = await sql<
    Array<{
      document_number: string;
      client_name: string;
      currency: string;
      total_minor: string | number;
    }>
  >`
    select coalesce(credit_note.credit_note_number, 'Credit note') as document_number,
      coalesce(company.display_name, company.legal_name) as client_name,
      credit_note.currency, credit_note.total_minor
    from public.finance_credit_notes as credit_note
    join public.finance_invoices as invoice on invoice.id = credit_note.original_invoice_id
    join public.crm_companies as company on company.id = invoice.company_id
    where credit_note.id = ${entityId}::uuid and credit_note.organization_id = ${organizationId}::uuid
    limit 1
  `;
  const row = rows[0];
  if (!row) throw new FinanceActionError("The credit note was not found.");
  return buildFinanceDocumentEmailTemplate({
    documentType: "Credit Note",
    documentNumber: row.document_number,
    clientName: row.client_name,
    currency: row.currency,
    totalMinor: Number(row.total_minor),
  });
}

export async function sendFinanceDocumentAction(
  _previousState: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  const parsed = financeDocumentEmailSchema.safeParse(values(formData));
  if (!parsed.success) {
    return errorState("Check the email delivery fields.", parsed.error.flatten().fieldErrors);
  }

  try {
    const context = await authorize([
      financePermissionKeys.documentSend,
      documentViewPermission(parsed.data.entityType),
    ]);
    const database = getDatabaseClient();
    const snapshot = await ensureFinanceDocumentSnapshot(
      context,
      parsed.data.entityType,
      parsed.data.entityId,
    );

    const deliveryRows = await database<
      Array<{ id: string; status: "pending" | "delivered" | "failed"; error_code: string | null }>
    >`
      insert into public.finance_email_deliveries (
        organization_id, snapshot_id, request_token, entity_type, entity_id,
        recipient_email, subject, sent_by_membership_id
      ) values (
        ${context.membership.organizationId}::uuid, ${snapshot.id}::uuid,
        ${parsed.data.requestToken}::uuid, ${parsed.data.entityType},
        ${parsed.data.entityId}::uuid, ${parsed.data.recipientEmail}, ${parsed.data.subject},
        ${context.membership.id}::uuid
      )
      on conflict (organization_id, request_token) do nothing
      returning id, status, error_code
    `;

    let delivery = deliveryRows[0];
    if (!delivery) {
      const existingRows = await database<
        Array<{ id: string; status: "pending" | "delivered" | "failed"; error_code: string | null }>
      >`
        select id, status, error_code
        from public.finance_email_deliveries
        where organization_id = ${context.membership.organizationId}::uuid
          and request_token = ${parsed.data.requestToken}::uuid
        limit 1
      `;
      delivery = existingRows[0];
      if (!delivery) throw new FinanceActionError("The email delivery could not be recorded.");
      if (delivery.status === "delivered") {
        return successState("This email delivery was already completed.", parsed.data.entityId);
      }
      if (delivery.status === "failed") {
        return errorState(
          delivery.error_code === "email_not_configured"
            ? "Email delivery is not configured. Start a new attempt after configuration is complete."
            : "This email attempt already failed. Start a new attempt to retry it.",
        );
      }
      return errorState("This email delivery is already in progress.");
    }

    const pdfBytes = await downloadFinanceSnapshotBytes(snapshot);
    const message = await loadFinanceEmailTemplate(
      database,
      context.membership.organizationId,
      parsed.data.entityType,
      parsed.data.entityId,
    );
    const result = await deliverFinanceDocumentEmail({
      organizationId: context.membership.organizationId,
      deliveryId: delivery.id,
      recipientEmail: parsed.data.recipientEmail,
      subject: parsed.data.subject,
      documentNumber: snapshot.documentNumber,
      fileName: snapshot.fileName,
      pdfBytes,
      messageText: message.text,
      messageHtml: message.html,
    });

    await database.begin(async (sql) => {
      if (result.delivered) {
        await sql`
          update public.finance_email_deliveries
          set status = 'delivered', provider_reference = ${result.providerReference ?? null},
            error_code = null, sent_at = now()
          where id = ${delivery.id}::uuid and status = 'pending'
        `;
        if (parsed.data.entityType === "estimate") {
          await sql`
            update public.finance_estimates
            set status = case when status = 'approved' then 'sent' else status end
            where id = ${parsed.data.entityId}::uuid
              and organization_id = ${context.membership.organizationId}::uuid
          `;
        } else if (parsed.data.entityType === "invoice") {
          await sql`
            update public.finance_invoices
            set status = case when status = 'issued' then 'sent' else status end,
              sent_at = coalesce(sent_at, now())
            where id = ${parsed.data.entityId}::uuid
              and organization_id = ${context.membership.organizationId}::uuid
          `;
          await sql`
            insert into public.finance_invoice_events (
              organization_id, invoice_id, event_type, event_data, actor_membership_id
            ) values (
              ${context.membership.organizationId}::uuid, ${parsed.data.entityId}::uuid, 'sent',
              ${sql.json(toJsonValue({ deliveryId: delivery.id, recipientEmail: parsed.data.recipientEmail }))},
              ${context.membership.id}::uuid
            )
          `;
        } else {
          await sql`
            update public.finance_credit_notes
            set status = case when status = 'issued' then 'sent' else status end,
              sent_at = coalesce(sent_at, now())
            where id = ${parsed.data.entityId}::uuid
              and organization_id = ${context.membership.organizationId}::uuid
          `;
          await sql`
            insert into public.finance_credit_note_events (
              organization_id, credit_note_id, event_type, event_data, actor_membership_id
            ) values (
              ${context.membership.organizationId}::uuid, ${parsed.data.entityId}::uuid, 'sent',
              ${sql.json(toJsonValue({ deliveryId: delivery.id, recipientEmail: parsed.data.recipientEmail }))},
              ${context.membership.id}::uuid
            )
          `;
        }
      } else {
        await sql`
          update public.finance_email_deliveries
          set status = 'failed', provider_reference = ${result.providerReference ?? null},
            error_code = ${result.errorCode ?? "email_delivery_failed"}, sent_at = null
          where id = ${delivery.id}::uuid and status = 'pending'
        `;
      }

      await writeAuditEvent(sql, context, {
        action: result.delivered
          ? "finance.document.email_delivered"
          : "finance.document.email_failed",
        entityType: `finance_${parsed.data.entityType}`,
        entityId: parsed.data.entityId,
        afterState: {
          snapshotId: snapshot.id,
          deliveryId: delivery.id,
          recipientEmail: parsed.data.recipientEmail,
          status: result.delivered ? "delivered" : "failed",
          errorCode: result.errorCode ?? null,
        },
      });
    });

    refreshFinance();
    if (result.delivered) {
      return successState(
        `${snapshot.documentNumber} emailed to ${parsed.data.recipientEmail}.`,
        parsed.data.entityId,
      );
    }
    return errorState(
      result.errorCode === "email_not_configured"
        ? "Email delivery is not configured. The failed attempt was recorded."
        : "The email provider did not accept this document. The failed attempt was recorded.",
    );
  } catch (error) {
    if (error instanceof FinanceActionError) return errorState(error.message);
    const generatedFailure = documentGenerationError(error);
    if (generatedFailure.message !== "The immutable PDF snapshot could not be generated.") {
      return generatedFailure;
    }
    return databaseFailure(error, "The finance document could not be sent.");
  }
}

export async function voidInvoiceAction(
  _previousState: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  const parsed = invoiceVoidSchema.safeParse(values(formData));
  if (!parsed.success)
    return errorState("Check the void reason.", parsed.error.flatten().fieldErrors);

  try {
    const context = await authorize(financePermissionKeys.invoiceVoid);
    const database = getDatabaseClient();
    await database.begin(async (sql) => {
      const rows = await sql<
        Array<{
          status: string;
          amount_paid_minor: string | number;
          credited_minor: string | number;
          invoice_number: string | null;
        }>
      >`
        select status, amount_paid_minor, credited_minor, invoice_number
        from public.finance_invoices
        where id = ${parsed.data.invoiceId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      const invoice = rows[0];
      if (!invoice?.invoice_number)
        throw new FinanceActionError("Only an issued invoice can be voided.");
      if (["void", "credited"].includes(invoice.status))
        throw new FinanceActionError("This invoice is already closed.");
      if (Number(invoice.amount_paid_minor) > 0 || Number(invoice.credited_minor) > 0) {
        throw new FinanceActionError(
          "Invoices with payments or credits require a revised invoice or credit-note correction.",
        );
      }

      await sql`
        update public.finance_invoices
        set status = 'void', voided_at = now(), void_reason = ${parsed.data.reason}
        where id = ${parsed.data.invoiceId}::uuid
      `;
      await sql`
        insert into public.finance_invoice_events (
          organization_id, invoice_id, event_type, event_data, actor_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${parsed.data.invoiceId}::uuid, 'voided',
          ${sql.json(toJsonValue({ reason: parsed.data.reason }))}, ${context.membership.id}::uuid
        )
      `;
      await writeAuditEvent(sql, context, {
        action: "finance.invoice.voided",
        entityType: "finance_invoice",
        entityId: parsed.data.invoiceId,
        afterState: { status: "void", reason: parsed.data.reason },
      });
    });
    refreshFinance();
    return successState("Invoice voided.", parsed.data.invoiceId);
  } catch (error) {
    return databaseFailure(error, "The invoice could not be voided.");
  }
}

export async function createPaymentAction(
  _previousState: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  const parsed = paymentCreateSchema.safeParse(values(formData));
  if (!parsed.success)
    return errorState("Check the payment fields.", parsed.error.flatten().fieldErrors);

  try {
    const context = await authorize(financePermissionKeys.paymentCreate);
    const amountMinor = parseMoneyToMinor(parsed.data.amount, parsed.data.currency);
    const allocations = parsed.data.allocations.map((allocation) => ({
      invoiceId: allocation.invoiceId,
      amountMinor: parseMoneyToMinor(allocation.amount, parsed.data.currency),
    }));
    if (amountMinor <= 0 || allocations.some((allocation) => allocation.amountMinor <= 0)) {
      throw new FinanceActionError("Payment and allocation amounts must be greater than zero.");
    }
    const allocatedMinor = allocations.reduce(
      (total, allocation) => total + allocation.amountMinor,
      0,
    );
    if (allocatedMinor !== amountMinor) {
      throw new FinanceActionError("The payment amount must equal the invoice allocations.");
    }

    const database = getDatabaseClient();
    const paymentId = await database.begin(async (sql) => {
      const invoiceIds = allocations.map((allocation) => allocation.invoiceId);
      const invoiceRows = await sql<
        Array<{
          id: string;
          company_id: string;
          currency: string;
          balance_minor: string | number;
          status: string;
          invoice_number: string | null;
        }>
      >`
        select id, company_id, currency, balance_minor, status, invoice_number
        from public.finance_invoices
        where organization_id = ${context.membership.organizationId}::uuid
          and id in ${sql(invoiceIds)}
        for update
      `;
      if (invoiceRows.length !== allocations.length)
        throw new FinanceActionError("One or more invoices were not found.");
      const invoiceMap = new Map(invoiceRows.map((invoice) => [invoice.id, invoice]));
      for (const allocation of allocations) {
        const invoice = invoiceMap.get(allocation.invoiceId);
        if (!invoice?.invoice_number || ["draft", "void", "credited"].includes(invoice.status)) {
          throw new FinanceActionError("Payments can be allocated only to open issued invoices.");
        }
        if (
          invoice.company_id !== parsed.data.companyId ||
          invoice.currency !== parsed.data.currency
        ) {
          throw new FinanceActionError(
            "All allocations must use the selected client and currency.",
          );
        }
        if (allocation.amountMinor > Number(invoice.balance_minor)) {
          throw new FinanceActionError(
            `Allocation exceeds the balance of ${invoice.invoice_number}.`,
          );
        }
      }

      const paymentRows = await sql<{ id: string }[]>`
        insert into public.finance_payments (
          organization_id, payment_date, amount_minor, currency, payment_method,
          transaction_reference, bank_account, company_id, notes,
          entered_by_membership_id, created_by
        ) values (
          ${context.membership.organizationId}::uuid, ${parsed.data.paymentDate}::date,
          ${amountMinor}, ${parsed.data.currency}, ${parsed.data.paymentMethod},
          ${parsed.data.transactionReference}, ${parsed.data.bankAccount}, ${parsed.data.companyId}::uuid,
          ${parsed.data.notes}, ${context.membership.id}::uuid, ${context.user.id}::uuid
        )
        returning id
      `;
      const createdPaymentId = paymentRows[0]?.id;
      if (!createdPaymentId) throw new FinanceActionError("The payment could not be recorded.");

      for (const allocation of allocations) {
        const invoice = invoiceMap.get(allocation.invoiceId)!;
        const nextPaid = Number(invoice.balance_minor) === allocation.amountMinor;
        await sql`
          insert into public.finance_payment_allocations (
            organization_id, payment_id, invoice_id, amount_minor, created_by_membership_id
          ) values (
            ${context.membership.organizationId}::uuid, ${createdPaymentId}::uuid,
            ${allocation.invoiceId}::uuid, ${allocation.amountMinor}, ${context.membership.id}::uuid
          )
        `;
        await sql`
          update public.finance_invoices
          set amount_paid_minor = amount_paid_minor + ${allocation.amountMinor},
            balance_minor = balance_minor - ${allocation.amountMinor},
            status = case when balance_minor - ${allocation.amountMinor} = 0 then 'paid' else 'partially_paid' end
          where id = ${allocation.invoiceId}::uuid
        `;
        await sql`
          insert into public.finance_invoice_events (
            organization_id, invoice_id, event_type, event_data, actor_membership_id
          ) values (
            ${context.membership.organizationId}::uuid, ${allocation.invoiceId}::uuid, 'payment_recorded',
            ${sql.json(toJsonValue({ paymentId: createdPaymentId, amountMinor: allocation.amountMinor, paid: nextPaid }))},
            ${context.membership.id}::uuid
          )
        `;
      }
      await writeAuditEvent(sql, context, {
        action: "finance.payment.created",
        entityType: "finance_payment",
        entityId: createdPaymentId,
        afterState: {
          companyId: parsed.data.companyId,
          amountMinor,
          currency: parsed.data.currency,
          invoiceIds,
        },
      });
      return createdPaymentId;
    });

    refreshFinance();
    return successState("Payment recorded and allocated.", paymentId);
  } catch (error) {
    return databaseFailure(error, "The payment could not be recorded.");
  }
}

export async function reconcilePaymentAction(
  _previousState: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  const parsed = paymentReconciliationSchema.safeParse(values(formData));
  if (!parsed.success)
    return errorState("Check the reconciliation state.", parsed.error.flatten().fieldErrors);

  try {
    const context = await authorize(financePermissionKeys.paymentReconcile);
    const database = getDatabaseClient();
    const rows = await database<{ id: string }[]>`
      update public.finance_payments
      set reconciliation_status = ${parsed.data.reconciliationStatus}
      where id = ${parsed.data.paymentId}::uuid
        and organization_id = ${context.membership.organizationId}::uuid
      returning id
    `;
    if (!rows[0]) throw new FinanceActionError("Payment was not found.");
    await writeAuditEvent(database, context, {
      action: "finance.payment.reconciliation_updated",
      entityType: "finance_payment",
      entityId: parsed.data.paymentId,
      afterState: { reconciliationStatus: parsed.data.reconciliationStatus },
    });
    refreshFinance();
    return successState("Payment reconciliation updated.", parsed.data.paymentId);
  } catch (error) {
    return databaseFailure(error, "The reconciliation state could not be updated.");
  }
}

export async function updateInvoiceStatusAction(
  _previousState: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  const parsed = invoiceStatusActionSchema.safeParse(values(formData));
  if (!parsed.success) {
    return errorState("Check the invoice status evidence.", parsed.error.flatten().fieldErrors);
  }

  try {
    const context = await authorize([
      financePermissionKeys.invoiceView,
      financePermissionKeys.invoiceStatusManage,
    ]);
    const database = getDatabaseClient();
    const result = await database.begin(async (sql) => {
      const rows = await sql<
        Array<{
          id: string;
          status: string;
          issued_at: Date | null;
          sent_at: Date | null;
          viewed_at: Date | null;
          due_date: string | null;
          amount_paid_minor: string | number;
          balance_minor: string | number;
        }>
      >`
        select id, status, issued_at, sent_at, viewed_at, due_date::text,
          amount_paid_minor, balance_minor
        from public.finance_invoices
        where id = ${parsed.data.invoiceId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      const invoice = rows[0];
      if (!invoice?.issued_at || ["void", "credited"].includes(invoice.status)) {
        throw new FinanceActionError("Status evidence can be recorded only for an issued invoice.");
      }

      let nextStatus = invoice.status;
      let eventType: "viewed" | "disputed" | "dispute_resolved";
      if (parsed.data.action === "viewed") {
        if (invoice.viewed_at) {
          throw new FinanceActionError("Invoice view evidence has already been recorded.");
        }
        if (!["paid", "partially_paid", "overdue", "disputed"].includes(invoice.status)) {
          nextStatus = "viewed";
        }
        await sql`
          update public.finance_invoices
          set status = ${nextStatus}, viewed_at = coalesce(viewed_at, now())
          where id = ${invoice.id}::uuid
        `;
        eventType = "viewed";
      } else if (parsed.data.action === "disputed") {
        if (invoice.status === "disputed") {
          throw new FinanceActionError("This invoice is already disputed.");
        }
        nextStatus = "disputed";
        await sql`
          update public.finance_invoices
          set status = 'disputed', disputed_at = now(), dispute_reason = ${parsed.data.reason},
            dispute_resolved_at = null, dispute_resolution_note = null
          where id = ${invoice.id}::uuid
        `;
        eventType = "disputed";
      } else {
        if (invoice.status !== "disputed") {
          throw new FinanceActionError("Only a disputed invoice can be resolved.");
        }
        nextStatus =
          Number(invoice.balance_minor) <= 0
            ? "paid"
            : invoice.due_date && invoice.due_date < new Date().toISOString().slice(0, 10)
              ? "overdue"
              : Number(invoice.amount_paid_minor) > 0
                ? "partially_paid"
                : invoice.viewed_at
                  ? "viewed"
                  : invoice.sent_at
                    ? "sent"
                    : "issued";
        await sql`
          update public.finance_invoices
          set status = ${nextStatus}, dispute_resolved_at = now(),
            dispute_resolution_note = ${parsed.data.reason}
          where id = ${invoice.id}::uuid
        `;
        eventType = "dispute_resolved";
      }

      await sql`
        insert into public.finance_invoice_events (
          organization_id, invoice_id, event_type, event_data, actor_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${invoice.id}::uuid, ${eventType},
          ${sql.json(toJsonValue({ action: parsed.data.action, reason: parsed.data.reason, status: nextStatus }))},
          ${context.membership.id}::uuid
        )
      `;
      await writeAuditEvent(sql, context, {
        action: `finance.invoice.${eventType}`,
        entityType: "finance_invoice",
        entityId: invoice.id,
        beforeState: { status: invoice.status },
        afterState: { status: nextStatus, reason: parsed.data.reason },
      });
      return nextStatus;
    });
    refreshFinance();
    return successState(
      `Invoice status updated to ${result.replaceAll("_", " ")}.`,
      parsed.data.invoiceId,
    );
  } catch (error) {
    return databaseFailure(error, "The invoice status could not be updated.");
  }
}

export async function recordPaymentRefundAction(
  _previousState: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  const parsed = paymentRefundSchema.safeParse(values(formData));
  if (!parsed.success) {
    return errorState("Check the refund fields.", parsed.error.flatten().fieldErrors);
  }

  try {
    const context = await authorize([
      financePermissionKeys.paymentView,
      financePermissionKeys.paymentRefund,
    ]);
    const database = getDatabaseClient();
    const refundId = await database.begin(async (sql) => {
      const paymentRows = await sql<
        Array<{
          id: string;
          currency: string;
          amount_minor: string | number;
          refunded_minor: string | number;
        }>
      >`
        select id, currency, amount_minor, refunded_minor
        from public.finance_payments
        where id = ${parsed.data.paymentId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      const payment = paymentRows[0];
      if (!payment) throw new FinanceActionError("Payment was not found.");
      const amountMinor = parseMoneyToMinor(parsed.data.amount, payment.currency);
      if (amountMinor <= 0)
        throw new FinanceActionError("Refund amount must be greater than zero.");
      if (amountMinor > Number(payment.amount_minor) - Number(payment.refunded_minor)) {
        throw new FinanceActionError("Refund exceeds the remaining refundable payment amount.");
      }
      const rows = await sql<Array<{ id: string }>>`
        insert into public.finance_payment_refunds (
          organization_id, payment_id, refund_date, amount_minor, refund_method,
          transaction_reference, reason, recorded_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${payment.id}::uuid,
          ${parsed.data.refundDate}::date, ${amountMinor}, ${parsed.data.refundMethod},
          ${parsed.data.transactionReference}, ${parsed.data.reason}, ${context.membership.id}::uuid
        )
        returning id
      `;
      const id = rows[0]?.id;
      if (!id) throw new FinanceActionError("The refund could not be recorded.");
      await writeAuditEvent(sql, context, {
        action: "finance.payment.refund_recorded",
        entityType: "finance_payment_refund",
        entityId: id,
        afterState: {
          paymentId: payment.id,
          amountMinor,
          currency: payment.currency,
          refundMethod: parsed.data.refundMethod,
          transactionReference: parsed.data.transactionReference,
        },
      });
      return id;
    });
    refreshFinance();
    return successState("Payment refund recorded.", refundId);
  } catch (error) {
    return databaseFailure(error, "The payment refund could not be recorded.");
  }
}
