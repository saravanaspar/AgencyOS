export const documentPermissionKeys = {
  workspace: "documents.workspace.view",
  folderManage: "documents.folder.manage",
  taxonomyManage: "documents.taxonomy.manage",
  view: "documents.document.view",
  create: "documents.document.create",
  update: "documents.document.update",
  download: "documents.document.download",
  comment: "documents.document.comment",
  manageAccess: "documents.document.manage_access",
  legalHold: "documents.document.legal_hold",
  archive: "documents.document.archive",
  submitApproval: "documents.document.submit_approval",
  publish: "documents.document.publish",
  withdraw: "documents.document.withdraw",
} as const;

export const documentClassifications = ["internal", "confidential", "restricted"] as const;
export const documentStatuses = ["active", "archived"] as const;
export const documentAccessLevels = ["viewer", "commenter", "editor"] as const;
export const documentReviewStatuses = [
  "pending",
  "approved",
  "rejected",
  "revision_requested",
  "cancelled",
  "expired",
  "invalidated",
] as const;
export const documentPublicationStatuses = ["active", "superseded", "withdrawn"] as const;
export const documentPublicationAudienceTypes = [
  "organization",
  "department",
  "team",
  "membership",
] as const;
export const documentEntityTypes = [
  "client",
  "contact",
  "lead",
  "project",
  "task",
  "invoice",
  "estimate",
  "employee",
  "contract",
  "ticket",
  "asset",
  "vendor",
  "purchase_order",
] as const;

export type DocumentClassification = (typeof documentClassifications)[number];
export type DocumentStatus = (typeof documentStatuses)[number];
export type DocumentAccessLevel = (typeof documentAccessLevels)[number];
export type DocumentReviewStatus = (typeof documentReviewStatuses)[number];
export type DocumentPublicationStatus = (typeof documentPublicationStatuses)[number];
export type DocumentPublicationAudienceType = (typeof documentPublicationAudienceTypes)[number];
export type DocumentEntityType = (typeof documentEntityTypes)[number];

export const documentClassificationLabels: Record<DocumentClassification, string> = {
  internal: "Internal",
  confidential: "Confidential",
  restricted: "Restricted",
};

export const documentAccessLevelLabels: Record<DocumentAccessLevel, string> = {
  viewer: "View and download",
  commenter: "View, download, and comment",
  editor: "Edit metadata and upload versions",
};

export const documentReviewStatusLabels: Record<DocumentReviewStatus, string> = {
  pending: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
  revision_requested: "Revision requested",
  cancelled: "Cancelled",
  expired: "Expired",
  invalidated: "Invalidated",
};

export const documentPublicationAudienceLabels: Record<DocumentPublicationAudienceType, string> = {
  organization: "Everyone in the organization",
  department: "Departments",
  team: "Teams",
  membership: "Named members",
};

export const documentEntityTypeLabels: Record<DocumentEntityType, string> = {
  client: "Client",
  contact: "Contact",
  lead: "Lead",
  project: "Project",
  task: "Task",
  invoice: "Invoice",
  estimate: "Estimate",
  employee: "Employee",
  contract: "Contract",
  ticket: "Support ticket",
  asset: "Asset",
  vendor: "Vendor",
  purchase_order: "Purchase order",
};

export function documentRetentionState(input: {
  legalHold: boolean;
  retentionUntil: string | null;
  today?: string;
}): "hold" | "expired" | "active" {
  if (input.legalHold) return "hold";
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  return input.retentionUntil && input.retentionUntil < today ? "expired" : "active";
}

export function documentReviewState(input: {
  reviewDate: string | null;
  expiryDate: string | null;
  today?: string;
}): "expired" | "review_due" | "current" {
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  if (input.expiryDate && input.expiryDate < today) return "expired";
  if (input.reviewDate && input.reviewDate <= today) return "review_due";
  return "current";
}

export function documentPublicationState(input: {
  status: DocumentPublicationStatus;
  effectiveAt: string;
  expiresAt: string | null;
  now?: Date;
}): "scheduled" | "published" | "expired" | "superseded" | "withdrawn" {
  if (input.status === "superseded") return "superseded";
  if (input.status === "withdrawn") return "withdrawn";
  const now = input.now ?? new Date();
  if (new Date(input.effectiveAt) > now) return "scheduled";
  if (input.expiresAt && new Date(input.expiresAt) <= now) return "expired";
  return "published";
}
