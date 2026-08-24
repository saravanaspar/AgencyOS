export const privateFileStatuses = [
  "quarantined",
  "scanning",
  "available",
  "rejected",
  "scan_failed",
  "deleted",
] as const;

export type PrivateFileStatus = (typeof privateFileStatuses)[number];

export const privateFileClassifications = ["internal", "confidential", "restricted"] as const;
export type PrivateFileClassification = (typeof privateFileClassifications)[number];

export const privateFileStatusLabels: Record<PrivateFileStatus, string> = {
  quarantined: "Queued for scan",
  scanning: "Scanning",
  available: "Available",
  rejected: "Blocked",
  scan_failed: "Scan unavailable",
  deleted: "Deleted",
};

export function privateFileRetryDelaySeconds(attempt: number): number {
  const normalized = Math.max(1, Math.min(attempt, 6));
  return Math.min(6 * 60 * 60, 30 * 2 ** (normalized - 1));
}

export function isPrivateFilePending(status: PrivateFileStatus): boolean {
  return status === "quarantined" || status === "scanning" || status === "scan_failed";
}
