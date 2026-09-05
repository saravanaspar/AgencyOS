export const financePermissionKeys = {
  workspace: "finance.workspace.view",
  catalogView: "finance.catalog.view",
  catalogManage: "finance.catalog.manage",
  estimateView: "finance.estimate.view",
  estimateCreate: "finance.estimate.create",
  estimateUpdate: "finance.estimate.update",
  estimateApprove: "finance.estimate.approve",
  estimateAccept: "finance.estimate.accept",
  estimateConvert: "finance.estimate.convert",
  invoiceView: "finance.invoice.view",
  invoiceCreate: "finance.invoice.create",
  invoiceUpdate: "finance.invoice.update",
  invoiceApprove: "finance.invoice.approve",
  invoiceIssue: "finance.invoice.issue",
  invoiceVoid: "finance.invoice.void",
  invoiceCorrect: "finance.invoice.correct",
  invoiceAttachmentManage: "finance.invoice_attachment.manage",
  invoiceStatusManage: "finance.invoice_status.manage",
  creditNoteView: "finance.credit_note.view",
  creditNoteCreate: "finance.credit_note.create",
  creditNoteApprove: "finance.credit_note.approve",
  creditNoteIssue: "finance.credit_note.issue",
  creditNoteVoid: "finance.credit_note.void",
  paymentView: "finance.payment.view",
  paymentCreate: "finance.payment.create",
  paymentReconcile: "finance.payment.reconcile",
  paymentRefund: "finance.payment.refund",
  expenseView: "finance.expense.view",
  expenseCreate: "finance.expense.create",
  expenseManage: "finance.expense.manage",
  expenseApprove: "finance.expense.approve",
  expensePay: "finance.expense.pay",
  expenseCategoryManage: "finance.expense_category.manage",
  expenseReceiptManage: "finance.expense_receipt.manage",
  reportView: "finance.report.view",
  cashForecastManage: "finance.cash_forecast.manage",
  collectionManage: "finance.collection.manage",
  documentDownload: "finance.document.download",
  documentSend: "finance.document.send",
} as const;

export const financeItemTypes = ["service", "product"] as const;
export type FinanceItemType = (typeof financeItemTypes)[number];

export const estimateStatuses = [
  "draft",
  "pending_approval",
  "approved",
  "sent",
  "accepted",
  "rejected",
  "expired",
  "converted",
  "cancelled",
] as const;
export type EstimateStatus = (typeof estimateStatuses)[number];

export const invoiceStatuses = [
  "draft",
  "pending_approval",
  "approved",
  "issued",
  "sent",
  "viewed",
  "partially_paid",
  "paid",
  "overdue",
  "disputed",
  "void",
  "credited",
] as const;
export type InvoiceStatus = (typeof invoiceStatuses)[number];

export const creditNoteStatuses = [
  "draft",
  "pending_approval",
  "approved",
  "issued",
  "sent",
  "void",
] as const;
export type CreditNoteStatus = (typeof creditNoteStatuses)[number];

export const approvalStatuses = ["not_required", "pending", "approved", "rejected"] as const;
export type FinanceApprovalStatus = (typeof approvalStatuses)[number];

export const paymentMethods = [
  "bank_transfer",
  "card",
  "cash",
  "cheque",
  "wallet",
  "other",
] as const;
export type PaymentMethod = (typeof paymentMethods)[number];

export const reconciliationStatuses = [
  "unreconciled",
  "matched",
  "reconciled",
  "exception",
] as const;
export type ReconciliationStatus = (typeof reconciliationStatuses)[number];

export const expenseTypes = ["employee", "project", "vendor"] as const;
export type FinanceExpenseType = (typeof expenseTypes)[number];

export const expensePaymentStatuses = [
  "unpaid",
  "scheduled",
  "paid",
  "reimbursed",
  "waived",
] as const;
export type FinanceExpensePaymentStatus = (typeof expensePaymentStatuses)[number];

export function financeStatusLabel(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
