export function evaluateBackupHealth(input: {
  success: Record<string, unknown> | null;
  maintenance: Record<string, unknown> | null;
  failure?: Record<string, unknown> | null;
  maintenanceFailure?: Record<string, unknown> | null;
  requireMaintenance?: boolean;
  now?: number;
  maxAgeHours?: number;
}): { healthy: boolean; reason: string; snapshotId?: unknown };
