export interface BackupMaintenanceOptions {
  environment?: Record<string, string | undefined>;
  mode?: "weekly" | "monthly";
}

export interface BackupMaintenanceStatus {
  schemaVersion: 1;
  status: "succeeded";
  mode: "weekly" | "monthly";
  checkedAt: string;
  startedAt: string;
  durationMs: number;
  retention: {
    daily: number;
    weekly: number;
    monthly: number;
    yearly: number;
  };
  pruneAttempted: boolean;
}

export function runMaintenance(
  options?: BackupMaintenanceOptions,
): Promise<BackupMaintenanceStatus>;
