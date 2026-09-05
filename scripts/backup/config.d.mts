export function requiredEnvironment(
  name: string,
  environment?: Record<string, string | undefined>,
): string;
export function boundedInteger(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
  environment?: Record<string, string | undefined>,
): number;
export function resticEnvironment(
  environment?: Record<string, string | undefined>,
  credentialKind?: "writer" | "maintenance" | "restore",
): Record<string, string>;
export function backupConfiguration(environment?: Record<string, string | undefined>): {
  maxAgeHours: number;
  [key: string]: unknown;
};
export function assertRestoreEnvironment(environment?: Record<string, string | undefined>): {
  snapshot: string;
  recoveryId: string;
  recoveryRoot: string;
};
