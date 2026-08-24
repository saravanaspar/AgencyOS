export const legalDeletionPermissionKeys = {
  view: "legal.deletion.view",
  request: "legal.deletion.request",
  execute: "legal.deletion.execute",
  configure: "legal.deletion.configure",
} as const;

export const legalDeletionTargetTypes = ["contract", "compliance_record"] as const;
export const legalDeletionStatuses = [
  "pending_approval",
  "approved",
  "rejected",
  "revision_requested",
  "cancelled",
  "expired",
  "invalidated",
  "purging",
  "purge_failed",
  "completed",
] as const;

export const legalDeletionPurgeClaimTimeoutMinutes = 15;

export function legalDeletionPurgeClaimStale(
  claimedAt: Date | string | null,
  now = Date.now(),
): boolean {
  if (claimedAt === null) return false;
  const claimedTime = claimedAt instanceof Date ? claimedAt.getTime() : Date.parse(claimedAt);
  return (
    Number.isFinite(claimedTime) &&
    claimedTime <= now - legalDeletionPurgeClaimTimeoutMinutes * 60 * 1000
  );
}

export type LegalDeletionTargetType = (typeof legalDeletionTargetTypes)[number];
export type LegalDeletionStatus = (typeof legalDeletionStatuses)[number];

export const legalDeletionTargetTypeLabels: Record<LegalDeletionTargetType, string> = {
  contract: "Contract",
  compliance_record: "Compliance record",
};

export const legalDeletionStatusLabels: Record<LegalDeletionStatus, string> = {
  pending_approval: "Pending approval",
  approved: "Approved",
  rejected: "Rejected",
  revision_requested: "Revision requested",
  cancelled: "Cancelled",
  expired: "Expired",
  invalidated: "Invalidated",
  purging: "Purging objects",
  purge_failed: "Purge retry required",
  completed: "Completed",
};

export type LegalDeletionBlockerCode =
  | "active-target"
  | "legal-hold"
  | "retention-active"
  | "shared-document"
  | "active-publication"
  | "pending-review"
  | "template-source"
  | "file-unavailable"
  | "missing-document";

export const legalDeletionBlockerLabels: Record<LegalDeletionBlockerCode, string> = {
  "active-target": "The legal record is not in a terminal lifecycle state.",
  "legal-hold": "A linked document is under legal hold.",
  "retention-active": "A linked document is still inside its retention period.",
  "shared-document": "A linked document or version is still used by another record or entity.",
  "active-publication": "A linked document still has an active publication.",
  "pending-review": "A linked document still has a pending review request.",
  "template-source": "A linked document is still registered as a contract template.",
  "file-unavailable": "A linked private file is not available for controlled deletion.",
  "missing-document": "The legal record has no deletable linked document objects.",
};

export function legalDeletionLifecycleEligible(input: {
  targetType: LegalDeletionTargetType;
  targetStatus: string;
}): boolean {
  if (input.targetType === "contract") {
    return ["terminated", "expired", "cancelled"].includes(input.targetStatus);
  }
  return ["closed", "archived"].includes(input.targetStatus);
}

export function legalDeletionRetentionEligible(
  retentionUntil: string | null,
  today = new Date().toISOString().slice(0, 10),
): boolean {
  return retentionUntil === null || retentionUntil <= today;
}
