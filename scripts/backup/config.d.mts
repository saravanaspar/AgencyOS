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
export function parsePostgresConnection(
  value: string,
  label: string,
): {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
  sslmode?: string;
};
export function postgresDatabaseIdentity(
  value: string,
  label: string,
): ReturnType<typeof parsePostgresConnection> & { normalizedHost: string; identity: string };
export function assertMatchingPostgresDatabase(
  runtimeUrl: string,
  adminUrl: string,
  label: string,
): {
  runtime: ReturnType<typeof postgresDatabaseIdentity>;
  admin: ReturnType<typeof postgresDatabaseIdentity>;
};
export function assertSecurePostgresUrl(
  value: string,
  label: string,
  options?: { direct?: boolean },
): ReturnType<typeof postgresDatabaseIdentity>;
export function assertSecureRecoveryPostgresUrl(
  value: string,
  label: string,
): ReturnType<typeof postgresDatabaseIdentity>;
export function resticEnvironment(
  environment?: Record<string, string | undefined>,
  credentialKind?: "writer" | "maintenance" | "restore",
): Record<string, string>;
export function backupConfiguration(environment?: Record<string, string | undefined>): {
  maxAgeHours: number;
  commandTimeoutMs: number;
  objectStorage: import("../../src/integrations/object-storage/config.mjs").ObjectStorageConfiguration;
  [key: string]: unknown;
};
export function assertRestoreEnvironment(environment?: Record<string, string | undefined>): {
  snapshot: string;
  recoveryId: string;
  recoveryRoot: string;
};
