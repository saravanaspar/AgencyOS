export function nextScheduledRun(input: {
  now?: Date;
  hourUtc: number;
  jitterMinutes?: number;
}): Date;
export function backupIsStale(
  success: Record<string, unknown> | null,
  now?: number,
  maxAgeHours?: number,
): boolean;
