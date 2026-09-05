export type InfrastructureMode = "local" | "cloud";
export type ObjectStorageProvider = "minio" | "b2";
export interface ObjectStorageLocation {
  logicalBucket: string;
  bucket: string;
  prefix: string;
}
export interface ObjectStorageConfiguration {
  mode: InfrastructureMode;
  provider: ObjectStorageProvider;
  endpoint: string;
  hostname: string;
  port: number;
  useSSL: boolean;
  region: string;
  accessKey: string;
  secretKey: string;
  locations: ObjectStorageLocation[];
}
export const AGENCYOS_OBJECT_STORAGE_BUCKETS: readonly string[];
export function infrastructureMode(
  environment?: Record<string, string | undefined>,
): InfrastructureMode;
export function objectStorageConfiguration(
  environment?: Record<string, string | undefined>,
  credentialKind?: "runtime" | "backup-source" | "recovery" | "descriptor",
): ObjectStorageConfiguration;
export function resolveObjectStorageLocation(
  configuration: ObjectStorageConfiguration,
  logicalBucket: string,
  objectName?: string,
): { logicalBucket: string; physicalBucket: string; physicalKey: string; prefix: string };
export function redactedObjectStorageDescriptor(configuration: ObjectStorageConfiguration): {
  provider: ObjectStorageProvider;
  locations: ObjectStorageLocation[];
};
export function normalizedObjectStorageDestination(
  configuration: ObjectStorageConfiguration,
  location: ObjectStorageLocation,
): string;
export function assertObjectStorageIsolation(
  source: ObjectStorageConfiguration,
  target: ObjectStorageConfiguration,
  label?: string,
): void;
export function assertRuntimeBackupIsolation(
  configuration: ObjectStorageConfiguration,
  environment?: Record<string, string | undefined>,
): void;
