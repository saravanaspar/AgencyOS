export const vendorPermissionKeys = {
  workspace: "vendors.workspace.view",
  view: "vendors.vendor.view",
  create: "vendors.vendor.create",
  update: "vendors.vendor.update",
  viewSensitive: "vendors.vendor.view_sensitive",
  note: "vendors.vendor.note",
  linkContract: "vendors.vendor.link_contract",
  linkDocument: "vendors.vendor.link_document",
  manageCategories: "vendors.category.manage",
  requestView: "vendors.purchase_request.view",
  requestCreate: "vendors.purchase_request.create",
  requestSubmit: "vendors.purchase_request.submit",
  requestManage: "vendors.purchase_request.manage",
  quotationManage: "vendors.quotation.manage",
  purchaseOrderView: "vendors.purchase_order.view",
  purchaseOrderManage: "vendors.purchase_order.manage",
  purchaseOrderLinkDocument: "vendors.purchase_order.link_document",
  receiptRecord: "vendors.receipt.record",
  billView: "vendors.bill.view",
  billManage: "vendors.bill.manage",
  billSubmit: "vendors.bill.submit",
  billPayment: "vendors.bill.payment",
} as const;

export const vendorStatuses = ["prospect", "active", "on_hold", "inactive", "blocked"] as const;
export const vendorRiskClassifications = ["low", "medium", "high", "critical"] as const;
export const vendorNoteTypes = ["performance", "risk", "compliance", "general"] as const;
export const vendorContractRelationshipTypes = [
  "master_agreement",
  "statement_of_work",
  "data_processing",
  "service_level",
  "other",
] as const;
export const purchaseRequestStatuses = [
  "draft",
  "pending_approval",
  "approved",
  "revision_requested",
  "rejected",
  "cancelled",
  "sourcing",
  "ordered",
  "partially_received",
  "received",
  "closed",
] as const;
export const quotationStatuses = [
  "submitted",
  "selected",
  "rejected",
  "expired",
  "withdrawn",
] as const;
export const purchaseOrderStatuses = [
  "issued",
  "acknowledged",
  "partially_received",
  "received",
  "cancelled",
  "closed",
] as const;
export const receiptStatuses = ["partial", "complete", "rejected"] as const;
export const receiptConditions = ["accepted", "damaged", "rejected"] as const;
export const vendorBillStatuses = [
  "received",
  "matched",
  "pending_approval",
  "approved",
  "revision_requested",
  "rejected",
  "disputed",
  "partially_paid",
  "paid",
  "void",
] as const;
export const vendorBillMatchStatuses = ["pending", "matched", "exception"] as const;

export type VendorStatus = (typeof vendorStatuses)[number];
export type VendorRiskClassification = (typeof vendorRiskClassifications)[number];
export type VendorNoteType = (typeof vendorNoteTypes)[number];
export type VendorContractRelationshipType = (typeof vendorContractRelationshipTypes)[number];
export type PurchaseRequestStatus = (typeof purchaseRequestStatuses)[number];
export type QuotationStatus = (typeof quotationStatuses)[number];
export type PurchaseOrderStatus = (typeof purchaseOrderStatuses)[number];
export type ReceiptStatus = (typeof receiptStatuses)[number];
export type ReceiptCondition = (typeof receiptConditions)[number];
export type VendorBillStatus = (typeof vendorBillStatuses)[number];
export type VendorBillMatchStatus = (typeof vendorBillMatchStatuses)[number];

export const vendorStatusLabels: Record<VendorStatus, string> = {
  prospect: "Prospect",
  active: "Active",
  on_hold: "On hold",
  inactive: "Inactive",
  blocked: "Blocked",
};
export const vendorRiskLabels: Record<VendorRiskClassification, string> = {
  low: "Low risk",
  medium: "Medium risk",
  high: "High risk",
  critical: "Critical risk",
};
export const vendorNoteTypeLabels: Record<VendorNoteType, string> = {
  performance: "Performance",
  risk: "Risk",
  compliance: "Compliance",
  general: "General",
};
export const vendorContractRelationshipLabels: Record<VendorContractRelationshipType, string> = {
  master_agreement: "Master agreement",
  statement_of_work: "Statement of work",
  data_processing: "Data-processing agreement",
  service_level: "Service-level agreement",
  other: "Other contract",
};
export const purchaseRequestStatusLabels: Record<PurchaseRequestStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  approved: "Approved",
  revision_requested: "Revision requested",
  rejected: "Rejected",
  cancelled: "Cancelled",
  sourcing: "Sourcing",
  ordered: "Ordered",
  partially_received: "Partially received",
  received: "Received",
  closed: "Closed",
};
export const quotationStatusLabels: Record<QuotationStatus, string> = {
  submitted: "Submitted",
  selected: "Selected",
  rejected: "Rejected",
  expired: "Expired",
  withdrawn: "Withdrawn",
};
export const purchaseOrderStatusLabels: Record<PurchaseOrderStatus, string> = {
  issued: "Issued",
  acknowledged: "Acknowledged",
  partially_received: "Partially received",
  received: "Received",
  cancelled: "Cancelled",
  closed: "Closed",
};
export const receiptStatusLabels: Record<ReceiptStatus, string> = {
  partial: "Partial receipt",
  complete: "Complete receipt",
  rejected: "Rejected delivery",
};
export const receiptConditionLabels: Record<ReceiptCondition, string> = {
  accepted: "Accepted",
  damaged: "Damaged",
  rejected: "Rejected",
};
export const vendorBillStatusLabels: Record<VendorBillStatus, string> = {
  received: "Received",
  matched: "Matched",
  pending_approval: "Pending approval",
  approved: "Approved",
  revision_requested: "Revision requested",
  rejected: "Rejected",
  disputed: "Disputed",
  partially_paid: "Partially paid",
  paid: "Paid",
  void: "Void",
};
export const vendorBillMatchStatusLabels: Record<VendorBillMatchStatus, string> = {
  pending: "Pending match",
  matched: "Matched",
  exception: "Match exception",
};

function paddedKey(prefix: string, value: number): string {
  return `${prefix}-${String(value).padStart(6, "0")}`;
}

export function vendorKey(vendorNumber: number): string {
  return paddedKey("VEN", vendorNumber);
}

export function purchaseRequestKey(requestNumber: number): string {
  return paddedKey("PR", requestNumber);
}

export function purchaseOrderKey(purchaseOrderNumber: number): string {
  return paddedKey("PO", purchaseOrderNumber);
}

export function goodsReceiptKey(receiptNumber: number): string {
  return paddedKey("GRN", receiptNumber);
}

export function requestEstimatedTotalMinor(
  items: readonly { quantity: number; estimatedUnitPriceMinor: number }[],
): number {
  return Math.round(
    items.reduce((sum, item) => sum + item.quantity * item.estimatedUnitPriceMinor, 0),
  );
}

export function billMatchStatus(input: {
  purchaseOrderTotalMinor: number;
  billTotalMinor: number;
}): VendorBillMatchStatus {
  return input.purchaseOrderTotalMinor === input.billTotalMinor ? "matched" : "exception";
}
