import "server-only";

import { randomUUID } from "node:crypto";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { withInfrastructureRetry } from "@/lib/server/retry";
import {
  financePermissionKeys,
  type CreditNoteStatus,
  type EstimateStatus,
  type InvoiceStatus,
} from "@/modules/finance/finance";
import type { FinanceFilters } from "@/modules/finance/schemas/finance";
import type { AuthorizationFailureReason } from "@/modules/permissions/server/authorization";
import { getCurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";
import { reportsPermissionKeys } from "@/modules/reports/reports";
import { loadFinanceExpenseData, type FinanceExpenseData } from "@/modules/finance/server/expenses";
import { loadFinanceReportData, type FinanceReportData } from "@/modules/finance/server/reports";
import { invoiceSourceFilter, paymentSourceFilter } from "@/modules/finance/server/source-filters";

export type {
  FinanceExpense,
  FinanceExpenseAllocation,
  FinanceExpenseCategory,
  FinanceExpenseEvent,
  FinanceExpenseMember,
  FinanceExpenseReceipt,
} from "@/modules/finance/server/expenses";
export type {
  FinanceClientStatement,
  FinanceClientStatementEntry,
  FinanceExpenseReportRow,
  FinanceProjectMargin,
  FinanceReportData,
  FinanceRevenueClient,
  FinanceRevenueMonth,
  FinanceRevenueService,
} from "@/modules/finance/server/reports";

export interface FinanceCompanyOption {
  id: string;
  name: string;
  currency: string;
  paymentTermsDays: number;
}

export interface FinanceContactOption {
  id: string;
  companyId: string | null;
  name: string;
  email: string | null;
  isBillingContact: boolean;
}

export interface FinanceProjectOption {
  id: string;
  companyId: string | null;
  code: string;
  name: string;
}

export interface FinanceCatalogItem {
  id: string;
  itemType: "service" | "product";
  name: string;
  sku: string | null;
  description: string | null;
  unit: string;
  standardRateMinor: number;
  taxCategory: string;
  taxRateBps: number;
  currency: string;
  isActive: boolean;
  defaultInvoiceDescription: string | null;
  updatedAt: string;
}

export interface FinanceDocumentLine {
  id: string;
  catalogItemId: string | null;
  position: number;
  description: string;
  quantityMilli: number;
  unitRateMinor: number;
  discountBps: number;
  taxBps: number;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
}

export interface FinanceDocumentSnapshotSummary {
  id: string;
  versionNumber: number;
  fileName: string;
  createdAt: string;
  downloadCount: number;
}

export interface FinanceDeliverySummary {
  id: string;
  recipientEmail: string;
  subject: string;
  status: "pending" | "delivered" | "failed";
  providerReference: string | null;
  errorCode: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface FinanceEstimateVersionSummary {
  id: string;
  versionNumber: number;
  reason: string | null;
  createdAt: string;
}

export interface FinanceInvoiceCorrectionSummary {
  id: string;
  displayNumber: string;
  status: InvoiceStatus;
  correctionReason: string | null;
  createdAt: string;
}

export interface FinanceCreditNoteSummary {
  id: string;
  displayNumber: string;
  status: CreditNoteStatus;
  totalMinor: number;
  issueDate: string | null;
}

export interface FinanceInvoiceAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  status: string;
  createdAt: string;
  downloadHref: string | null;
}

export interface FinancePaymentRefund {
  id: string;
  refundDate: string;
  amountMinor: number;
  refundMethod: string;
  transactionReference: string | null;
  reason: string;
  createdAt: string;
}

export interface FinanceInvoicePaymentHistory {
  allocationId: string;
  paymentId: string;
  paymentDate: string;
  amountMinor: number;
  currency: string;
  paymentMethod: string;
  transactionReference: string | null;
  reconciliationStatus: string;
}

export interface FinanceEstimate {
  id: string;
  estimateNumber: string;
  companyId: string;
  companyName: string;
  contactId: string | null;
  projectId: string | null;
  projectName: string | null;
  issueDate: string;
  expiryDate: string | null;
  currency: string;
  status: EstimateStatus;
  approvalStatus: "not_required" | "pending" | "approved" | "rejected";
  clientAcceptanceStatus: "pending" | "accepted" | "rejected" | "expired";
  clientDecisionNote: string | null;
  clientDecisionRecordedAt: string | null;
  notes: string | null;
  terms: string | null;
  internalNotes: string | null;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  versionNumber: number;
  convertedInvoiceId: string | null;
  lines: FinanceDocumentLine[];
  snapshots: FinanceDocumentSnapshotSummary[];
  deliveries: FinanceDeliverySummary[];
  versions: FinanceEstimateVersionSummary[];
  deliveryRequestToken: string;
  updatedAt: string;
}

export interface FinanceInvoice {
  id: string;
  draftReference: string;
  invoiceNumber: string | null;
  displayNumber: string;
  companyId: string;
  companyName: string;
  contactId: string | null;
  projectId: string | null;
  projectName: string | null;
  sourceEstimateId: string | null;
  correctionOfInvoiceId: string | null;
  correctionOfInvoiceNumber: string | null;
  correctionReason: string | null;
  purchaseOrderReference: string | null;
  exchangeRate: number | null;
  issueDate: string | null;
  dueDate: string | null;
  servicePeriodStart: string | null;
  servicePeriodEnd: string | null;
  currency: string;
  status: InvoiceStatus;
  approvalStatus: "not_required" | "pending" | "approved" | "rejected";
  notes: string | null;
  terms: string | null;
  bankDetails: string | null;
  internalNotes: string | null;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  amountPaidMinor: number;
  creditedMinor: number;
  creditDueMinor: number;
  balanceMinor: number;
  issuedAt: string | null;
  voidReason: string | null;
  disputeReason: string | null;
  disputedAt: string | null;
  disputeResolvedAt: string | null;
  disputeResolutionNote: string | null;
  lines: FinanceDocumentLine[];
  attachments: FinanceInvoiceAttachment[];
  snapshots: FinanceDocumentSnapshotSummary[];
  deliveries: FinanceDeliverySummary[];
  paymentHistory: FinanceInvoicePaymentHistory[];
  revisions: FinanceInvoiceCorrectionSummary[];
  creditNotes: FinanceCreditNoteSummary[];
  deliveryRequestToken: string;
  updatedAt: string;
}

export interface FinanceCreditNote {
  id: string;
  creditNoteNumber: string | null;
  displayNumber: string;
  originalInvoiceId: string;
  originalInvoiceNumber: string;
  companyId: string;
  companyName: string;
  projectId: string | null;
  projectName: string | null;
  issueDate: string | null;
  currency: string;
  status: CreditNoteStatus;
  approvalStatus: "not_required" | "pending" | "approved" | "rejected";
  reason: string;
  internalNotes: string | null;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  issuedAt: string | null;
  voidReason: string | null;
  lines: FinanceDocumentLine[];
  snapshots: FinanceDocumentSnapshotSummary[];
  deliveries: FinanceDeliverySummary[];
  deliveryRequestToken: string;
  updatedAt: string;
}

export interface FinancePayment {
  id: string;
  paymentDate: string;
  amountMinor: number;
  allocatedMinor: number;
  currency: string;
  paymentMethod: string;
  transactionReference: string | null;
  companyId: string;
  companyName: string;
  reconciliationStatus: string;
  refundState: "none" | "partial" | "full";
  refundedMinor: number;
  notes: string | null;
  refunds: FinancePaymentRefund[];
  snapshots: FinanceDocumentSnapshotSummary[];
  receiptRequestToken: string;
  allocations: Array<{
    id: string;
    invoiceId: string;
    invoiceNumber: string;
    amountMinor: number;
  }>;
  createdAt: string;
}

export interface FinanceWorkspaceData extends FinanceExpenseData, FinanceReportData {
  organizationId: string;
  defaultCurrency: string;
  locale: string;
  filters: FinanceFilters;
  companies: FinanceCompanyOption[];
  contacts: FinanceContactOption[];
  projects: FinanceProjectOption[];
  catalogItems: FinanceCatalogItem[];
  estimates: FinanceEstimate[];
  invoices: FinanceInvoice[];
  creditNotes: FinanceCreditNote[];
  payments: FinancePayment[];
  summary: {
    draftEstimateValueMinor: number;
    outstandingMinor: number;
    overdueMinor: number;
    paidThisMonthMinor: number;
    currency: string;
  };
  capabilities: {
    canViewCatalog: boolean;
    canManageCatalog: boolean;
    canViewEstimates: boolean;
    canCreateEstimates: boolean;
    canUpdateEstimates: boolean;
    canRecordEstimateAcceptance: boolean;
    canConvertEstimates: boolean;
    canViewInvoices: boolean;
    canCreateInvoices: boolean;
    canUpdateInvoices: boolean;
    canIssueInvoices: boolean;
    canVoidInvoices: boolean;
    canCorrectInvoices: boolean;
    canManageInvoiceAttachments: boolean;
    canManageInvoiceStatus: boolean;
    canViewCreditNotes: boolean;
    canCreateCreditNotes: boolean;
    canIssueCreditNotes: boolean;
    canVoidCreditNotes: boolean;
    canViewPayments: boolean;
    canCreatePayments: boolean;
    canReconcilePayments: boolean;
    canRefundPayments: boolean;
    canViewExpenses: boolean;
    canCreateExpenses: boolean;
    canManageExpenses: boolean;
    canPayExpenses: boolean;
    canManageExpenseCategories: boolean;
    canManageExpenseReceipts: boolean;
    canViewReports: boolean;
    canExportReports: boolean;
    canDownloadDocuments: boolean;
    canSendDocuments: boolean;
  };
}

export type FinanceWorkspaceResult =
  | { allowed: true; data: FinanceWorkspaceData }
  | { allowed: false; reason: AuthorizationFailureReason };

interface OrganizationRow {
  default_currency: string;
  number_format: string;
}
interface CompanyRow {
  id: string;
  name: string;
  currency: string;
  payment_terms_days: number;
}
interface ContactRow {
  id: string;
  company_id: string | null;
  name: string;
  email: string | null;
  is_billing_contact: boolean;
}
interface ProjectRow {
  id: string;
  company_id: string | null;
  code: string;
  name: string;
}
interface CatalogRow {
  id: string;
  item_type: FinanceCatalogItem["itemType"];
  name: string;
  sku: string | null;
  description: string | null;
  unit: string;
  standard_rate_minor: string | number;
  tax_category: string;
  tax_rate_bps: number;
  currency: string;
  is_active: boolean;
  default_invoice_description: string | null;
  updated_at: Date;
}
interface EstimateRow {
  id: string;
  estimate_number: string;
  company_id: string;
  company_name: string;
  contact_id: string | null;
  project_id: string | null;
  project_name: string | null;
  issue_date: string;
  expiry_date: string | null;
  currency: string;
  status: EstimateStatus;
  approval_status: FinanceEstimate["approvalStatus"];
  client_acceptance_status: FinanceEstimate["clientAcceptanceStatus"];
  client_decision_note: string | null;
  client_decision_recorded_at: Date | null;
  notes: string | null;
  terms: string | null;
  internal_notes: string | null;
  subtotal_minor: string | number;
  discount_minor: string | number;
  tax_minor: string | number;
  total_minor: string | number;
  version_number: number;
  converted_invoice_id: string | null;
  updated_at: Date;
}
interface InvoiceRow {
  id: string;
  draft_reference: string;
  invoice_number: string | null;
  company_id: string;
  company_name: string;
  contact_id: string | null;
  project_id: string | null;
  project_name: string | null;
  source_estimate_id: string | null;
  correction_of_invoice_id: string | null;
  correction_of_invoice_number: string | null;
  correction_reason: string | null;
  purchase_order_reference: string | null;
  exchange_rate: string | number | null;
  issue_date: string | null;
  due_date: string | null;
  service_period_start: string | null;
  service_period_end: string | null;
  currency: string;
  status: InvoiceStatus;
  approval_status: FinanceInvoice["approvalStatus"];
  notes: string | null;
  terms: string | null;
  bank_details: string | null;
  internal_notes: string | null;
  subtotal_minor: string | number;
  discount_minor: string | number;
  tax_minor: string | number;
  total_minor: string | number;
  amount_paid_minor: string | number;
  credited_minor: string | number;
  credit_due_minor: string | number;
  balance_minor: string | number;
  issued_at: Date | null;
  void_reason: string | null;
  dispute_reason: string | null;
  disputed_at: Date | null;
  dispute_resolved_at: Date | null;
  dispute_resolution_note: string | null;
  updated_at: Date;
}
interface CreditNoteRow {
  id: string;
  credit_note_number: string | null;
  original_invoice_id: string;
  original_invoice_number: string;
  company_id: string;
  company_name: string;
  project_id: string | null;
  project_name: string | null;
  issue_date: string | null;
  currency: string;
  status: CreditNoteStatus;
  approval_status: FinanceCreditNote["approvalStatus"];
  reason: string;
  internal_notes: string | null;
  subtotal_minor: string | number;
  discount_minor: string | number;
  tax_minor: string | number;
  total_minor: string | number;
  issued_at: Date | null;
  void_reason: string | null;
  updated_at: Date;
}

interface LineRow {
  id: string;
  parent_id: string;
  catalog_item_id: string | null;
  position: number;
  description: string;
  quantity_milli: string | number;
  unit_rate_minor: string | number;
  discount_bps: number;
  tax_bps: number;
  subtotal_minor: string | number;
  discount_minor: string | number;
  tax_minor: string | number;
  total_minor: string | number;
}
interface PaymentRow {
  id: string;
  payment_date: string;
  amount_minor: string | number;
  allocated_minor: string | number;
  currency: string;
  payment_method: string;
  transaction_reference: string | null;
  company_id: string;
  company_name: string;
  reconciliation_status: string;
  refund_state: "none" | "partial" | "full";
  refunded_minor: string | number;
  notes: string | null;
  created_at: Date;
}
interface InvoiceAttachmentRow {
  id: string;
  invoice_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: string | number;
  sha256: string;
  status: string;
  created_at: Date;
}
interface PaymentRefundRow {
  id: string;
  payment_id: string;
  refund_date: string;
  amount_minor: string | number;
  refund_method: string;
  transaction_reference: string | null;
  reason: string;
  created_at: Date;
}
interface AllocationRow {
  id: string;
  payment_id: string;
  invoice_id: string;
  invoice_number: string;
  amount_minor: string | number;
  payment_date: string;
  currency: string;
  payment_method: string;
  transaction_reference: string | null;
  reconciliation_status: string;
}
interface SnapshotSummaryRow {
  id: string;
  entity_type: "estimate" | "invoice" | "credit_note" | "payment_receipt";
  entity_id: string;
  version_number: number;
  file_name: string;
  created_at: Date;
  download_count: number;
}
interface DeliverySummaryRow {
  id: string;
  entity_type: "estimate" | "invoice" | "credit_note" | "payment_receipt";
  entity_id: string;
  recipient_email: string;
  subject: string;
  status: FinanceDeliverySummary["status"];
  provider_reference: string | null;
  error_code: string | null;
  sent_at: Date | null;
  created_at: Date;
}
interface EstimateVersionRow {
  id: string;
  estimate_id: string;
  version_number: number;
  reason: string | null;
  created_at: Date;
}
interface SummaryRow {
  draft_estimate_value_minor: string | number;
  outstanding_minor: string | number;
  overdue_minor: string | number;
  paid_this_month_minor: string | number;
}

function mapLine(row: LineRow): FinanceDocumentLine {
  return {
    id: row.id,
    catalogItemId: row.catalog_item_id,
    position: row.position,
    description: row.description,
    quantityMilli: Number(row.quantity_milli),
    unitRateMinor: Number(row.unit_rate_minor),
    discountBps: row.discount_bps,
    taxBps: row.tax_bps,
    subtotalMinor: Number(row.subtotal_minor),
    discountMinor: Number(row.discount_minor),
    taxMinor: Number(row.tax_minor),
    totalMinor: Number(row.total_minor),
  };
}

export async function getFinanceWorkspaceData(
  filters: FinanceFilters,
): Promise<FinanceWorkspaceResult> {
  const permissionResult = await getCurrentPermissionContext();
  if (!permissionResult.allowed) return permissionResult;
  const context = permissionResult.context;
  if (!context.permissions.has(financePermissionKeys.workspace)) {
    return { allowed: false, reason: "insufficient-permission" };
  }

  const capabilities: FinanceWorkspaceData["capabilities"] = {
    canViewCatalog: context.permissions.has(financePermissionKeys.catalogView),
    canManageCatalog: context.permissions.has(financePermissionKeys.catalogManage),
    canViewEstimates: context.permissions.has(financePermissionKeys.estimateView),
    canCreateEstimates: context.permissions.has(financePermissionKeys.estimateCreate),
    canUpdateEstimates: context.permissions.has(financePermissionKeys.estimateUpdate),
    canRecordEstimateAcceptance: context.permissions.has(financePermissionKeys.estimateAccept),
    canConvertEstimates: context.permissions.has(financePermissionKeys.estimateConvert),
    canViewInvoices: context.permissions.has(financePermissionKeys.invoiceView),
    canCreateInvoices: context.permissions.has(financePermissionKeys.invoiceCreate),
    canUpdateInvoices: context.permissions.has(financePermissionKeys.invoiceUpdate),
    canIssueInvoices: context.permissions.has(financePermissionKeys.invoiceIssue),
    canVoidInvoices: context.permissions.has(financePermissionKeys.invoiceVoid),
    canCorrectInvoices: context.permissions.has(financePermissionKeys.invoiceCorrect),
    canManageInvoiceAttachments: context.permissions.has(
      financePermissionKeys.invoiceAttachmentManage,
    ),
    canManageInvoiceStatus: context.permissions.has(financePermissionKeys.invoiceStatusManage),
    canViewCreditNotes: context.permissions.has(financePermissionKeys.creditNoteView),
    canCreateCreditNotes: context.permissions.has(financePermissionKeys.creditNoteCreate),
    canIssueCreditNotes: context.permissions.has(financePermissionKeys.creditNoteIssue),
    canVoidCreditNotes: context.permissions.has(financePermissionKeys.creditNoteVoid),
    canViewPayments: context.permissions.has(financePermissionKeys.paymentView),
    canCreatePayments: context.permissions.has(financePermissionKeys.paymentCreate),
    canReconcilePayments: context.permissions.has(financePermissionKeys.paymentReconcile),
    canRefundPayments: context.permissions.has(financePermissionKeys.paymentRefund),
    canViewExpenses: context.permissions.has(financePermissionKeys.expenseView),
    canCreateExpenses: context.permissions.has(financePermissionKeys.expenseCreate),
    canManageExpenses: context.permissions.has(financePermissionKeys.expenseManage),
    canPayExpenses: context.permissions.has(financePermissionKeys.expensePay),
    canManageExpenseCategories: context.permissions.has(
      financePermissionKeys.expenseCategoryManage,
    ),
    canManageExpenseReceipts: context.permissions.has(financePermissionKeys.expenseReceiptManage),
    canViewReports: context.permissions.has(financePermissionKeys.reportView),
    canExportReports: context.permissions.has(reportsPermissionKeys.export),
    canDownloadDocuments: context.permissions.has(financePermissionKeys.documentDownload),
    canSendDocuments: context.permissions.has(financePermissionKeys.documentSend),
  };

  const allowedTabs: Array<[FinanceFilters["tab"], boolean]> = [
    ["invoices", capabilities.canViewInvoices],
    ["estimates", capabilities.canViewEstimates],
    ["credit_notes", capabilities.canViewCreditNotes],
    ["catalog", capabilities.canViewCatalog],
    ["payments", capabilities.canViewPayments],
    ["expenses", capabilities.canViewExpenses],
    ["reports", capabilities.canViewReports],
  ];
  const effectiveFilters = allowedTabs.find(([tab]) => tab === filters.tab)?.[1]
    ? filters
    : { ...filters, tab: allowedTabs.find(([, allowed]) => allowed)?.[0] ?? filters.tab };

  const database = getDatabaseClient();
  const organizationId = context.membership.organizationId;
  const search = effectiveFilters.q
    ? `%${effectiveFilters.q.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`
    : null;

  try {
    const [
      organizationRows,
      companyRows,
      contactRows,
      projectRows,
      catalogRows,
      estimateRows,
      estimateLineRows,
      invoiceRows,
      invoiceLineRows,
      invoiceAttachmentRows,
      creditNoteRows,
      creditNoteLineRows,
      paymentRows,
      allocationRows,
      paymentRefundRows,
      snapshotRows,
      deliveryRows,
      estimateVersionRows,
      summaryRows,
      expenseData,
      reportData,
    ] = await withInfrastructureRetry(
      () =>
        Promise.all([
          database<OrganizationRow[]>`
            select default_currency, number_format
            from public.organizations
            where id = ${organizationId}::uuid
            limit 1
          `,
          database<CompanyRow[]>`
            select id, coalesce(display_name, legal_name) as name, currency, payment_terms_days
            from public.crm_companies
            where organization_id = ${organizationId}::uuid and client_status <> 'inactive'
            order by name
            limit 1000
          `,
          database<ContactRow[]>`
            select id, company_id,
              trim(concat_ws(' ', first_name, last_name)) as name,
              email, is_billing_contact
            from public.crm_contacts
            where organization_id = ${organizationId}::uuid and status = 'active'
            order by is_billing_contact desc, name
            limit 2000
          `,
          database<ProjectRow[]>`
            select id, company_id, code, name
            from public.projects
            where organization_id = ${organizationId}::uuid
              and archived_at is null
              and closure_status <> 'closed'
            order by updated_at desc
            limit 1000
          `,
          capabilities.canViewCatalog
            ? database<CatalogRow[]>`
                select id, item_type, name, sku, description, unit, standard_rate_minor,
                  tax_category, tax_rate_bps, currency, is_active, default_invoice_description, updated_at
                from public.finance_catalog_items
                where organization_id = ${organizationId}::uuid
                  and (
                    ${search}::text is null
                    or name ilike ${search} escape '\\'
                    or sku ilike ${search} escape '\\'
                  )
                order by is_active desc, lower(name)
                limit 500
              `
            : Promise.resolve([] as CatalogRow[]),
          capabilities.canViewEstimates
            ? database<EstimateRow[]>`
                select estimate.id, estimate.estimate_number, estimate.company_id,
                  coalesce(company.display_name, company.legal_name) as company_name,
                  estimate.contact_id, estimate.project_id, project.name as project_name,
                  estimate.issue_date::text, estimate.expiry_date::text, estimate.currency,
                  estimate.status, estimate.approval_status, estimate.client_acceptance_status,
                  estimate.client_decision_note, estimate.client_decision_recorded_at,
                  estimate.notes, estimate.terms, estimate.internal_notes,
                  estimate.subtotal_minor, estimate.discount_minor, estimate.tax_minor, estimate.total_minor,
                  estimate.version_number, estimate.converted_invoice_id, estimate.updated_at
                from public.finance_estimates as estimate
                join public.crm_companies as company on company.id = estimate.company_id
                left join public.projects as project on project.id = estimate.project_id
                where estimate.organization_id = ${organizationId}::uuid
                  and (${effectiveFilters.company}::uuid is null or estimate.company_id = ${effectiveFilters.company}::uuid)
                  and (${effectiveFilters.status}::text is null or estimate.status = ${effectiveFilters.status})
                  and (
                    ${search}::text is null
                    or estimate.estimate_number ilike ${search} escape '\\'
                    or company.legal_name ilike ${search} escape '\\'
                    or company.display_name ilike ${search} escape '\\'
                  )
                order by estimate.updated_at desc
                limit 100
              `
            : Promise.resolve([] as EstimateRow[]),
          capabilities.canViewEstimates
            ? database<LineRow[]>`
                select line.id, line.estimate_id as parent_id, line.catalog_item_id, line.position,
                  line.description, line.quantity_milli, line.unit_rate_minor, line.discount_bps,
                  line.tax_bps, line.subtotal_minor, line.discount_minor, line.tax_minor, line.total_minor
                from public.finance_estimate_lines as line
                join public.finance_estimates as estimate on estimate.id = line.estimate_id
                where estimate.organization_id = ${organizationId}::uuid
                order by line.estimate_id, line.position
                limit 5000
              `
            : Promise.resolve([] as LineRow[]),
          capabilities.canViewInvoices
            ? database<InvoiceRow[]>`
                select invoice.id, invoice.draft_reference, invoice.invoice_number, invoice.company_id,
                  coalesce(company.display_name, company.legal_name) as company_name,
                  invoice.contact_id, invoice.project_id, project.name as project_name,
                  invoice.source_estimate_id, invoice.correction_of_invoice_id,
                  original_invoice.invoice_number as correction_of_invoice_number,
                  invoice.correction_reason, invoice.purchase_order_reference, invoice.exchange_rate,
                  invoice.issue_date::text, invoice.due_date::text,
                  invoice.service_period_start::text, invoice.service_period_end::text,
                  invoice.currency, invoice.status, invoice.approval_status, invoice.notes, invoice.terms,
                  invoice.bank_details, invoice.internal_notes, invoice.subtotal_minor,
                  invoice.discount_minor, invoice.tax_minor, invoice.total_minor,
                  invoice.amount_paid_minor, invoice.credited_minor, invoice.credit_due_minor,
                  invoice.balance_minor, invoice.issued_at, invoice.void_reason,
                  invoice.dispute_reason, invoice.disputed_at, invoice.dispute_resolved_at,
                  invoice.dispute_resolution_note, invoice.updated_at
                from public.finance_invoices as invoice
                join public.crm_companies as company on company.id = invoice.company_id
                left join public.projects as project on project.id = invoice.project_id
                left join public.finance_invoices as original_invoice
                  on original_invoice.id = invoice.correction_of_invoice_id
                where invoice.organization_id = ${organizationId}::uuid
                  and (${effectiveFilters.company}::uuid is null or invoice.company_id = ${effectiveFilters.company}::uuid)
                  and (${effectiveFilters.status}::text is null or invoice.status = ${effectiveFilters.status})
                  ${invoiceSourceFilter(database, effectiveFilters)}
                  and (
                    ${search}::text is null
                    or invoice.invoice_number ilike ${search} escape '\\'
                    or invoice.draft_reference ilike ${search} escape '\\'
                    or company.legal_name ilike ${search} escape '\\'
                    or company.display_name ilike ${search} escape '\\'
                  )
                order by invoice.updated_at desc
                limit 100
              `
            : Promise.resolve([] as InvoiceRow[]),
          capabilities.canViewInvoices
            ? database<LineRow[]>`
                select line.id, line.invoice_id as parent_id, line.catalog_item_id, line.position,
                  line.description, line.quantity_milli, line.unit_rate_minor, line.discount_bps,
                  line.tax_bps, line.subtotal_minor, line.discount_minor, line.tax_minor, line.total_minor
                from public.finance_invoice_lines as line
                join public.finance_invoices as invoice on invoice.id = line.invoice_id
                where invoice.organization_id = ${organizationId}::uuid
                order by line.invoice_id, line.position
                limit 5000
              `
            : Promise.resolve([] as LineRow[]),
          capabilities.canViewInvoices
            ? database<InvoiceAttachmentRow[]>`
                select attachment.id, attachment.invoice_id, attachment.file_name,
                  attachment.mime_type, attachment.size_bytes, attachment.sha256,
                  private_file.status, attachment.created_at
                from public.finance_invoice_attachments as attachment
                join public.private_files as private_file on private_file.id = attachment.private_file_id
                where attachment.organization_id = ${organizationId}::uuid
                order by attachment.created_at desc
                limit 2000
              `
            : Promise.resolve([] as InvoiceAttachmentRow[]),
          capabilities.canViewCreditNotes
            ? database<CreditNoteRow[]>`
                select credit_note.id, credit_note.credit_note_number,
                  credit_note.original_invoice_id, invoice.invoice_number as original_invoice_number,
                  invoice.company_id, coalesce(company.display_name, company.legal_name) as company_name,
                  invoice.project_id, project.name as project_name, credit_note.issue_date::text,
                  credit_note.currency, credit_note.status, credit_note.approval_status,
                  credit_note.reason, credit_note.internal_notes, credit_note.subtotal_minor,
                  credit_note.discount_minor, credit_note.tax_minor, credit_note.total_minor,
                  credit_note.issued_at, credit_note.void_reason, credit_note.updated_at
                from public.finance_credit_notes as credit_note
                join public.finance_invoices as invoice on invoice.id = credit_note.original_invoice_id
                join public.crm_companies as company on company.id = invoice.company_id
                left join public.projects as project on project.id = invoice.project_id
                where credit_note.organization_id = ${organizationId}::uuid
                  and (${effectiveFilters.company}::uuid is null or invoice.company_id = ${effectiveFilters.company}::uuid)
                  and (${effectiveFilters.status}::text is null or credit_note.status = ${effectiveFilters.status})
                  and (
                    ${search}::text is null
                    or credit_note.credit_note_number ilike ${search} escape '\\'
                    or invoice.invoice_number ilike ${search} escape '\\'
                    or company.legal_name ilike ${search} escape '\\'
                    or company.display_name ilike ${search} escape '\\'
                  )
                order by credit_note.updated_at desc
                limit 100
              `
            : Promise.resolve([] as CreditNoteRow[]),
          capabilities.canViewCreditNotes
            ? database<LineRow[]>`
                select line.id, line.credit_note_id as parent_id, line.catalog_item_id, line.position,
                  line.description, line.quantity_milli, line.unit_rate_minor, line.discount_bps,
                  line.tax_bps, line.subtotal_minor, line.discount_minor, line.tax_minor, line.total_minor
                from public.finance_credit_note_lines as line
                join public.finance_credit_notes as credit_note on credit_note.id = line.credit_note_id
                where credit_note.organization_id = ${organizationId}::uuid
                order by line.credit_note_id, line.position
                limit 5000
              `
            : Promise.resolve([] as LineRow[]),
          capabilities.canViewPayments
            ? database<PaymentRow[]>`
                select payment.id, payment.payment_date::text, payment.amount_minor,
                  coalesce(sum(allocation.amount_minor), 0)::bigint as allocated_minor,
                  payment.currency, payment.payment_method, payment.transaction_reference,
                  payment.company_id, coalesce(company.display_name, company.legal_name) as company_name,
                  payment.reconciliation_status, payment.refund_state, payment.refunded_minor,
                  payment.notes, payment.created_at
                from public.finance_payments as payment
                join public.crm_companies as company on company.id = payment.company_id
                left join public.finance_payment_allocations as allocation on allocation.payment_id = payment.id
                where payment.organization_id = ${organizationId}::uuid
                  and (${effectiveFilters.company}::uuid is null or payment.company_id = ${effectiveFilters.company}::uuid)
                  ${paymentSourceFilter(database, effectiveFilters)}
                  and (
                    ${search}::text is null
                    or payment.transaction_reference ilike ${search} escape '\\'
                    or company.legal_name ilike ${search} escape '\\'
                    or company.display_name ilike ${search} escape '\\'
                  )
                group by payment.id, company.display_name, company.legal_name
                order by payment.payment_date desc, payment.created_at desc
                limit 100
              `
            : Promise.resolve([] as PaymentRow[]),
          capabilities.canViewPayments
            ? database<AllocationRow[]>`
                select allocation.id, allocation.payment_id, allocation.invoice_id,
                  coalesce(invoice.invoice_number, invoice.draft_reference) as invoice_number,
                  allocation.amount_minor, payment.payment_date::text, payment.currency,
                  payment.payment_method, payment.transaction_reference,
                  payment.reconciliation_status
                from public.finance_payment_allocations as allocation
                join public.finance_invoices as invoice on invoice.id = allocation.invoice_id
                join public.finance_payments as payment on payment.id = allocation.payment_id
                where allocation.organization_id = ${organizationId}::uuid
                order by allocation.created_at
                limit 5000
              `
            : Promise.resolve([] as AllocationRow[]),
          capabilities.canViewPayments
            ? database<PaymentRefundRow[]>`
                select id, payment_id, refund_date::text, amount_minor, refund_method,
                  transaction_reference, reason, created_at
                from public.finance_payment_refunds
                where organization_id = ${organizationId}::uuid
                order by refund_date desc, created_at desc
                limit 2000
              `
            : Promise.resolve([] as PaymentRefundRow[]),
          capabilities.canDownloadDocuments &&
          (capabilities.canViewEstimates ||
            capabilities.canViewInvoices ||
            capabilities.canViewCreditNotes ||
            capabilities.canViewPayments)
            ? database<SnapshotSummaryRow[]>`
                select snapshot.id, snapshot.entity_type, snapshot.entity_id,
                  snapshot.version_number, private_file.original_file_name as file_name,
                  snapshot.created_at,
                  count(private_event.id) filter (
                    where private_event.event_type = 'file.downloaded'
                  )::integer as download_count
                from public.finance_document_snapshots as snapshot
                join public.private_files as private_file on private_file.id = snapshot.private_file_id
                left join public.private_file_events as private_event
                  on private_event.file_id = private_file.id
                where snapshot.organization_id = ${organizationId}::uuid
                  and (
                    (${capabilities.canViewEstimates} and snapshot.entity_type = 'estimate')
                    or (${capabilities.canViewInvoices} and snapshot.entity_type = 'invoice')
                    or (${capabilities.canViewCreditNotes} and snapshot.entity_type = 'credit_note')
                    or (${capabilities.canViewPayments} and snapshot.entity_type = 'payment_receipt')
                  )
                group by snapshot.id, private_file.original_file_name
                order by snapshot.created_at desc
                limit 1000
              `
            : Promise.resolve([] as SnapshotSummaryRow[]),
          capabilities.canSendDocuments &&
          (capabilities.canViewEstimates ||
            capabilities.canViewInvoices ||
            capabilities.canViewCreditNotes)
            ? database<DeliverySummaryRow[]>`
                select id, entity_type, entity_id, recipient_email, subject, status,
                  provider_reference, error_code, sent_at, created_at
                from public.finance_email_deliveries
                where organization_id = ${organizationId}::uuid
                  and (
                    (${capabilities.canViewEstimates} and entity_type = 'estimate')
                    or (${capabilities.canViewInvoices} and entity_type = 'invoice')
                    or (${capabilities.canViewCreditNotes} and entity_type = 'credit_note')
                  )
                order by created_at desc
                limit 1000
              `
            : Promise.resolve([] as DeliverySummaryRow[]),
          capabilities.canViewEstimates
            ? database<EstimateVersionRow[]>`
                select version.id, version.estimate_id, version.version_number,
                  version.reason, version.created_at
                from public.finance_estimate_versions as version
                join public.finance_estimates as estimate on estimate.id = version.estimate_id
                where version.organization_id = ${organizationId}::uuid
                order by version.created_at desc
                limit 2000
              `
            : Promise.resolve([] as EstimateVersionRow[]),
          capabilities.canViewReports
            ? database<SummaryRow[]>`
                select
                  coalesce((
                    select sum(total_minor) from public.finance_estimates
                    where organization_id = ${organizationId}::uuid
                      and currency = organization.default_currency
                      and status in ('draft', 'pending_approval', 'approved', 'sent')
                  ), 0)::bigint as draft_estimate_value_minor,
                  coalesce((
                    select sum(balance_minor) from public.finance_invoices
                    where organization_id = ${organizationId}::uuid
                      and currency = organization.default_currency
                      and status not in ('draft', 'void', 'credited', 'paid')
                  ), 0)::bigint as outstanding_minor,
                  coalesce((
                    select sum(balance_minor) from public.finance_invoices
                    where organization_id = ${organizationId}::uuid
                      and currency = organization.default_currency
                      and due_date < current_date
                      and status not in ('draft', 'void', 'credited', 'paid')
                  ), 0)::bigint as overdue_minor,
                  coalesce((
                    select sum(amount_minor) from public.finance_payments
                    where organization_id = ${organizationId}::uuid
                      and currency = organization.default_currency
                      and payment_date >= date_trunc('month', current_date)::date
                  ), 0)::bigint as paid_this_month_minor
                from public.organizations as organization
                where organization.id = ${organizationId}::uuid
              `
            : Promise.resolve([] as SummaryRow[]),
          loadFinanceExpenseData(database, context, effectiveFilters),
          loadFinanceReportData(database, context, effectiveFilters),
        ]),
      { attempts: 2, operationName: "Finance workspace" },
    );

    const organization = organizationRows[0] ?? { default_currency: "USD", number_format: "en-US" };
    const estimateLinesByParent = new Map<string, FinanceDocumentLine[]>();
    for (const row of estimateLineRows) {
      const values = estimateLinesByParent.get(row.parent_id) ?? [];
      values.push(mapLine(row));
      estimateLinesByParent.set(row.parent_id, values);
    }
    const invoiceLinesByParent = new Map<string, FinanceDocumentLine[]>();
    for (const row of invoiceLineRows) {
      const values = invoiceLinesByParent.get(row.parent_id) ?? [];
      values.push(mapLine(row));
      invoiceLinesByParent.set(row.parent_id, values);
    }
    const creditNoteLinesByParent = new Map<string, FinanceDocumentLine[]>();
    for (const row of creditNoteLineRows) {
      const values = creditNoteLinesByParent.get(row.parent_id) ?? [];
      values.push(mapLine(row));
      creditNoteLinesByParent.set(row.parent_id, values);
    }
    const attachmentsByInvoice = new Map<string, FinanceInvoiceAttachment[]>();
    for (const row of invoiceAttachmentRows) {
      const values = attachmentsByInvoice.get(row.invoice_id) ?? [];
      values.push({
        id: row.id,
        fileName: row.file_name,
        mimeType: row.mime_type,
        sizeBytes: Number(row.size_bytes),
        sha256: row.sha256,
        status: row.status,
        createdAt: row.created_at.toISOString(),
        downloadHref: row.status === "available" ? `/api/finance/attachments/${row.id}` : null,
      });
      attachmentsByInvoice.set(row.invoice_id, values);
    }
    const refundsByPayment = new Map<string, FinancePaymentRefund[]>();
    for (const row of paymentRefundRows) {
      const values = refundsByPayment.get(row.payment_id) ?? [];
      values.push({
        id: row.id,
        refundDate: row.refund_date,
        amountMinor: Number(row.amount_minor),
        refundMethod: row.refund_method,
        transactionReference: row.transaction_reference,
        reason: row.reason,
        createdAt: row.created_at.toISOString(),
      });
      refundsByPayment.set(row.payment_id, values);
    }
    const allocationsByPayment = new Map<string, FinancePayment["allocations"]>();
    for (const row of allocationRows) {
      const values = allocationsByPayment.get(row.payment_id) ?? [];
      values.push({
        id: row.id,
        invoiceId: row.invoice_id,
        invoiceNumber: row.invoice_number,
        amountMinor: Number(row.amount_minor),
      });
      allocationsByPayment.set(row.payment_id, values);
    }

    const paymentHistoryByInvoice = new Map<string, FinanceInvoicePaymentHistory[]>();
    for (const row of allocationRows) {
      const values = paymentHistoryByInvoice.get(row.invoice_id) ?? [];
      values.push({
        allocationId: row.id,
        paymentId: row.payment_id,
        paymentDate: row.payment_date,
        amountMinor: Number(row.amount_minor),
        currency: row.currency,
        paymentMethod: row.payment_method,
        transactionReference: row.transaction_reference,
        reconciliationStatus: row.reconciliation_status,
      });
      paymentHistoryByInvoice.set(row.invoice_id, values);
    }
    const snapshotsByEntity = new Map<string, FinanceDocumentSnapshotSummary[]>();
    for (const row of snapshotRows) {
      const key = `${row.entity_type}:${row.entity_id}`;
      const values = snapshotsByEntity.get(key) ?? [];
      values.push({
        id: row.id,
        versionNumber: row.version_number,
        fileName: row.file_name,
        createdAt: row.created_at.toISOString(),
        downloadCount: row.download_count,
      });
      snapshotsByEntity.set(key, values);
    }
    const deliveriesByEntity = new Map<string, FinanceDeliverySummary[]>();
    for (const row of deliveryRows) {
      const key = `${row.entity_type}:${row.entity_id}`;
      const values = deliveriesByEntity.get(key) ?? [];
      values.push({
        id: row.id,
        recipientEmail: row.recipient_email,
        subject: row.subject,
        status: row.status,
        providerReference: row.provider_reference,
        errorCode: row.error_code,
        sentAt: row.sent_at?.toISOString() ?? null,
        createdAt: row.created_at.toISOString(),
      });
      deliveriesByEntity.set(key, values);
    }
    const versionsByEstimate = new Map<string, FinanceEstimateVersionSummary[]>();
    for (const row of estimateVersionRows) {
      const values = versionsByEstimate.get(row.estimate_id) ?? [];
      values.push({
        id: row.id,
        versionNumber: row.version_number,
        reason: row.reason,
        createdAt: row.created_at.toISOString(),
      });
      versionsByEstimate.set(row.estimate_id, values);
    }

    const revisionsByOriginal = new Map<string, FinanceInvoiceCorrectionSummary[]>();
    for (const row of invoiceRows) {
      if (!row.correction_of_invoice_id) continue;
      const values = revisionsByOriginal.get(row.correction_of_invoice_id) ?? [];
      values.push({
        id: row.id,
        displayNumber: row.invoice_number ?? row.draft_reference,
        status: row.status,
        correctionReason: row.correction_reason,
        createdAt: row.updated_at.toISOString(),
      });
      revisionsByOriginal.set(row.correction_of_invoice_id, values);
    }
    const creditNotesByInvoice = new Map<string, FinanceCreditNoteSummary[]>();
    for (const row of creditNoteRows) {
      const values = creditNotesByInvoice.get(row.original_invoice_id) ?? [];
      values.push({
        id: row.id,
        displayNumber: row.credit_note_number ?? "Credit note draft",
        status: row.status,
        totalMinor: Number(row.total_minor),
        issueDate: row.issue_date,
      });
      creditNotesByInvoice.set(row.original_invoice_id, values);
    }

    return {
      allowed: true,
      data: {
        organizationId,
        defaultCurrency: organization.default_currency,
        locale: organization.number_format,
        filters: effectiveFilters,
        companies: companyRows.map((row) => ({
          id: row.id,
          name: row.name,
          currency: row.currency,
          paymentTermsDays: row.payment_terms_days,
        })),
        contacts: contactRows.map((row) => ({
          id: row.id,
          companyId: row.company_id,
          name: row.name,
          email: row.email,
          isBillingContact: row.is_billing_contact,
        })),
        projects: projectRows.map((row) => ({
          id: row.id,
          companyId: row.company_id,
          code: row.code,
          name: row.name,
        })),
        catalogItems: catalogRows.map((row) => ({
          id: row.id,
          itemType: row.item_type,
          name: row.name,
          sku: row.sku,
          description: row.description,
          unit: row.unit,
          standardRateMinor: Number(row.standard_rate_minor),
          taxCategory: row.tax_category,
          taxRateBps: row.tax_rate_bps,
          currency: row.currency,
          isActive: row.is_active,
          defaultInvoiceDescription: row.default_invoice_description,
          updatedAt: row.updated_at.toISOString(),
        })),
        estimates: estimateRows.map((row) => ({
          id: row.id,
          estimateNumber: row.estimate_number,
          companyId: row.company_id,
          companyName: row.company_name,
          contactId: row.contact_id,
          projectId: row.project_id,
          projectName: row.project_name,
          issueDate: row.issue_date,
          expiryDate: row.expiry_date,
          currency: row.currency,
          status: row.status,
          approvalStatus: row.approval_status,
          clientAcceptanceStatus: row.client_acceptance_status,
          clientDecisionNote: row.client_decision_note,
          clientDecisionRecordedAt: row.client_decision_recorded_at?.toISOString() ?? null,
          notes: row.notes,
          terms: row.terms,
          internalNotes: row.internal_notes,
          subtotalMinor: Number(row.subtotal_minor),
          discountMinor: Number(row.discount_minor),
          taxMinor: Number(row.tax_minor),
          totalMinor: Number(row.total_minor),
          versionNumber: row.version_number,
          convertedInvoiceId: row.converted_invoice_id,
          lines: estimateLinesByParent.get(row.id) ?? [],
          snapshots: snapshotsByEntity.get(`estimate:${row.id}`) ?? [],
          deliveries: deliveriesByEntity.get(`estimate:${row.id}`) ?? [],
          versions: versionsByEstimate.get(row.id) ?? [],
          deliveryRequestToken: randomUUID(),
          updatedAt: row.updated_at.toISOString(),
        })),
        invoices: invoiceRows.map((row) => ({
          id: row.id,
          draftReference: row.draft_reference,
          invoiceNumber: row.invoice_number,
          displayNumber: row.invoice_number ?? row.draft_reference,
          companyId: row.company_id,
          companyName: row.company_name,
          contactId: row.contact_id,
          projectId: row.project_id,
          projectName: row.project_name,
          sourceEstimateId: row.source_estimate_id,
          correctionOfInvoiceId: row.correction_of_invoice_id,
          correctionOfInvoiceNumber: row.correction_of_invoice_number,
          correctionReason: row.correction_reason,
          purchaseOrderReference: row.purchase_order_reference,
          exchangeRate: row.exchange_rate === null ? null : Number(row.exchange_rate),
          issueDate: row.issue_date,
          dueDate: row.due_date,
          servicePeriodStart: row.service_period_start,
          servicePeriodEnd: row.service_period_end,
          currency: row.currency,
          status: row.status,
          approvalStatus: row.approval_status,
          notes: row.notes,
          terms: row.terms,
          bankDetails: row.bank_details,
          internalNotes: row.internal_notes,
          subtotalMinor: Number(row.subtotal_minor),
          discountMinor: Number(row.discount_minor),
          taxMinor: Number(row.tax_minor),
          totalMinor: Number(row.total_minor),
          amountPaidMinor: Number(row.amount_paid_minor),
          creditedMinor: Number(row.credited_minor),
          creditDueMinor: Number(row.credit_due_minor),
          balanceMinor: Number(row.balance_minor),
          issuedAt: row.issued_at?.toISOString() ?? null,
          voidReason: row.void_reason,
          disputeReason: row.dispute_reason,
          disputedAt: row.disputed_at?.toISOString() ?? null,
          disputeResolvedAt: row.dispute_resolved_at?.toISOString() ?? null,
          disputeResolutionNote: row.dispute_resolution_note,
          lines: invoiceLinesByParent.get(row.id) ?? [],
          attachments: attachmentsByInvoice.get(row.id) ?? [],
          snapshots: snapshotsByEntity.get(`invoice:${row.id}`) ?? [],
          deliveries: deliveriesByEntity.get(`invoice:${row.id}`) ?? [],
          paymentHistory: paymentHistoryByInvoice.get(row.id) ?? [],
          revisions: revisionsByOriginal.get(row.id) ?? [],
          creditNotes: creditNotesByInvoice.get(row.id) ?? [],
          deliveryRequestToken: randomUUID(),
          updatedAt: row.updated_at.toISOString(),
        })),
        creditNotes: creditNoteRows.map((row) => ({
          id: row.id,
          creditNoteNumber: row.credit_note_number,
          displayNumber: row.credit_note_number ?? "Credit note draft",
          originalInvoiceId: row.original_invoice_id,
          originalInvoiceNumber: row.original_invoice_number,
          companyId: row.company_id,
          companyName: row.company_name,
          projectId: row.project_id,
          projectName: row.project_name,
          issueDate: row.issue_date,
          currency: row.currency,
          status: row.status,
          approvalStatus: row.approval_status,
          reason: row.reason,
          internalNotes: row.internal_notes,
          subtotalMinor: Number(row.subtotal_minor),
          discountMinor: Number(row.discount_minor),
          taxMinor: Number(row.tax_minor),
          totalMinor: Number(row.total_minor),
          issuedAt: row.issued_at?.toISOString() ?? null,
          voidReason: row.void_reason,
          lines: creditNoteLinesByParent.get(row.id) ?? [],
          snapshots: snapshotsByEntity.get(`credit_note:${row.id}`) ?? [],
          deliveries: deliveriesByEntity.get(`credit_note:${row.id}`) ?? [],
          deliveryRequestToken: randomUUID(),
          updatedAt: row.updated_at.toISOString(),
        })),
        payments: paymentRows.map((row) => ({
          id: row.id,
          paymentDate: row.payment_date,
          amountMinor: Number(row.amount_minor),
          allocatedMinor: Number(row.allocated_minor),
          currency: row.currency,
          paymentMethod: row.payment_method,
          transactionReference: row.transaction_reference,
          companyId: row.company_id,
          companyName: row.company_name,
          reconciliationStatus: row.reconciliation_status,
          refundState: row.refund_state,
          refundedMinor: Number(row.refunded_minor),
          notes: row.notes,
          refunds: refundsByPayment.get(row.id) ?? [],
          snapshots: snapshotsByEntity.get(`payment_receipt:${row.id}`) ?? [],
          receiptRequestToken: randomUUID(),
          allocations: allocationsByPayment.get(row.id) ?? [],
          createdAt: row.created_at.toISOString(),
        })),
        ...expenseData,
        ...reportData,
        summary: {
          draftEstimateValueMinor: Number(summaryRows[0]?.draft_estimate_value_minor ?? 0),
          outstandingMinor: Number(summaryRows[0]?.outstanding_minor ?? 0),
          overdueMinor: Number(summaryRows[0]?.overdue_minor ?? 0),
          paidThisMonthMinor: Number(summaryRows[0]?.paid_this_month_minor ?? 0),
          currency: organization.default_currency,
        },
        capabilities,
      },
    };
  } catch (error) {
    console.warn("[AgencyOS] Finance workspace load failed.", {
      code: error && typeof error === "object" && "code" in error ? String(error.code) : null,
    });
    return { allowed: false, reason: "access-check-failed" };
  }
}
