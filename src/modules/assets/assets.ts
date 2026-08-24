export const assetPermissionKeys = {
  workspace: "assets.workspace.view",
  view: "assets.asset.view",
  create: "assets.asset.create",
  update: "assets.asset.update",
  assign: "assets.asset.assign",
  acknowledge: "assets.asset.acknowledge",
  maintain: "assets.asset.maintain",
  dispose: "assets.asset.dispose",
  linkDocument: "assets.asset.link_document",
  manageCategories: "assets.category.manage",
  requestView: "assets.request.view",
  requestCreate: "assets.request.create",
  requestSubmit: "assets.request.submit",
  requestManage: "assets.request.manage",
  requestCancel: "assets.request.cancel",
  returnRequestView: "assets.return_request.view",
  returnRequestAcknowledge: "assets.return_request.acknowledge",
  returnRequestManage: "assets.return_request.manage",
} as const;

export const assetCategoryKinds = [
  "computer",
  "mobile",
  "display",
  "accessory",
  "software",
  "access",
  "furniture",
  "other",
] as const;
export const assetOwnershipTypes = ["owned", "leased", "rented", "client_owned"] as const;
export const assetStatuses = [
  "ordered",
  "received",
  "available",
  "assigned",
  "under_repair",
  "lost",
  "stolen",
  "retired",
  "disposed",
] as const;
export const assetConditions = ["new", "good", "fair", "poor", "damaged", "missing"] as const;
export const assetDepreciationMethods = [
  "none",
  "straight_line",
  "declining_balance",
  "manual",
] as const;
export const assetMaintenanceTypes = [
  "inspection",
  "repair",
  "service",
  "upgrade",
  "calibration",
] as const;
export const assetMaintenanceStatuses = [
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
] as const;

export type AssetCategoryKind = (typeof assetCategoryKinds)[number];
export type AssetOwnershipType = (typeof assetOwnershipTypes)[number];
export type AssetStatus = (typeof assetStatuses)[number];
export type AssetCondition = (typeof assetConditions)[number];
export type AssetDepreciationMethod = (typeof assetDepreciationMethods)[number];
export type AssetMaintenanceType = (typeof assetMaintenanceTypes)[number];
export type AssetMaintenanceStatus = (typeof assetMaintenanceStatuses)[number];

export const assetRequestTypes = ["new_asset", "replacement", "temporary"] as const;
export const assetRequestStatuses = [
  "draft",
  "pending_approval",
  "approved",
  "revision_requested",
  "rejected",
  "fulfilled",
  "cancelled",
] as const;
export const assetReturnReasons = ["offboarding", "transfer", "manual", "expected_return"] as const;
export const assetReturnRequestStatuses = [
  "pending",
  "acknowledged",
  "completed",
  "cancelled",
  "overdue",
] as const;

export type AssetRequestType = (typeof assetRequestTypes)[number];
export type AssetRequestStatus = (typeof assetRequestStatuses)[number];
export type AssetReturnReason = (typeof assetReturnReasons)[number];
export type AssetReturnRequestStatus = (typeof assetReturnRequestStatuses)[number];

export const assetRequestTypeLabels: Record<AssetRequestType, string> = {
  new_asset: "New asset",
  replacement: "Replacement",
  temporary: "Temporary loan",
};
export const assetRequestStatusLabels: Record<AssetRequestStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  approved: "Approved",
  revision_requested: "Revision requested",
  rejected: "Rejected",
  fulfilled: "Fulfilled",
  cancelled: "Cancelled",
};
export const assetReturnReasonLabels: Record<AssetReturnReason, string> = {
  offboarding: "Offboarding",
  transfer: "Role or manager transfer",
  manual: "Manual request",
  expected_return: "Expected return reached",
};
export const assetReturnRequestStatusLabels: Record<AssetReturnRequestStatus, string> = {
  pending: "Pending acknowledgement",
  acknowledged: "Acknowledged",
  completed: "Completed",
  cancelled: "Cancelled",
  overdue: "Overdue",
};

export function assetRequestKey(sequence: number): string {
  return `AR-${String(sequence).padStart(6, "0")}`;
}

export const assetCategoryKindLabels: Record<AssetCategoryKind, string> = {
  computer: "Computer",
  mobile: "Mobile device",
  display: "Display",
  accessory: "Accessory",
  software: "Software licence",
  access: "Key or access card",
  furniture: "Furniture",
  other: "Other equipment",
};

export const assetOwnershipTypeLabels: Record<AssetOwnershipType, string> = {
  owned: "Company owned",
  leased: "Leased",
  rented: "Rented",
  client_owned: "Client owned",
};

export const assetStatusLabels: Record<AssetStatus, string> = {
  ordered: "Ordered",
  received: "Received",
  available: "Available",
  assigned: "Assigned",
  under_repair: "Under repair",
  lost: "Lost",
  stolen: "Stolen",
  retired: "Retired",
  disposed: "Disposed",
};

export const assetConditionLabels: Record<AssetCondition, string> = {
  new: "New",
  good: "Good",
  fair: "Fair",
  poor: "Poor",
  damaged: "Damaged",
  missing: "Missing",
};

export const assetDepreciationMethodLabels: Record<AssetDepreciationMethod, string> = {
  none: "Not depreciated",
  straight_line: "Straight line",
  declining_balance: "Declining balance",
  manual: "Manual schedule",
};

export const assetMaintenanceTypeLabels: Record<AssetMaintenanceType, string> = {
  inspection: "Inspection",
  repair: "Repair",
  service: "Service",
  upgrade: "Upgrade",
  calibration: "Calibration",
};

export const assetMaintenanceStatusLabels: Record<AssetMaintenanceStatus, string> = {
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function assetWarrantyState(input: {
  warrantyEndDate: string | null;
  today?: string;
}): "none" | "expired" | "expiring" | "active" {
  if (!input.warrantyEndDate) return "none";
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  if (input.warrantyEndDate < today) return "expired";
  const threshold = new Date(`${today}T00:00:00.000Z`);
  threshold.setUTCDate(threshold.getUTCDate() + 90);
  return input.warrantyEndDate <= threshold.toISOString().slice(0, 10) ? "expiring" : "active";
}

export function straightLineBookValueMinor(input: {
  purchasePriceMinor: number | null;
  salvageValueMinor: number | null;
  usefulLifeMonths: number | null;
  depreciationStartDate: string | null;
  asOf?: string;
}): number | null {
  if (
    input.purchasePriceMinor === null ||
    input.usefulLifeMonths === null ||
    !input.depreciationStartDate ||
    input.usefulLifeMonths <= 0
  ) {
    return null;
  }
  const salvage = Math.max(0, input.salvageValueMinor ?? 0);
  const depreciable = Math.max(0, input.purchasePriceMinor - salvage);
  const start = new Date(`${input.depreciationStartDate}T00:00:00.000Z`);
  const asOf = new Date(`${input.asOf ?? new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  if (asOf <= start) return input.purchasePriceMinor;
  const elapsedMonths = Math.max(
    0,
    (asOf.getUTCFullYear() - start.getUTCFullYear()) * 12 +
      (asOf.getUTCMonth() - start.getUTCMonth()),
  );
  const recognizedMonths = Math.min(input.usefulLifeMonths, elapsedMonths);
  const accumulated = Math.floor((depreciable * recognizedMonths) / input.usefulLifeMonths);
  return Math.max(salvage, input.purchasePriceMinor - accumulated);
}
