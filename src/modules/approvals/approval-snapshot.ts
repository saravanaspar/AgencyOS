import { safeJsonObjectHash, validateSafeJsonObject } from "@/lib/security/safe-json-object";

const approvalSnapshotOptions = {
  label: "Approval snapshot",
  maximumBytes: 64 * 1024,
  maximumDepth: 20,
  maximumNodes: 5_000,
} as const;

export function validateApprovalSnapshot(snapshot: Record<string, unknown>): void {
  validateSafeJsonObject(snapshot, approvalSnapshotOptions);
}

export function approvalSnapshotHash(snapshot: Record<string, unknown>): string {
  return safeJsonObjectHash(snapshot, approvalSnapshotOptions);
}
