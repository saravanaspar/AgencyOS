export interface ObjectStorageLocation {
  logicalBucket: string;
  bucket: string;
  prefix: string;
}
export interface ObjectStorageConfiguration {
  endpoint: string;
  hostname: string;
  port: number;
  useSSL: boolean;
  region: string;
  accessKey: string;
  secretKey: string;
  locations: ObjectStorageLocation[];
}
export const OBJECT_STORAGE_QUARANTINE_BUCKET: "private-file-quarantine";
export const OBJECT_STORAGE_PRIVATE_BUCKET: "private-files";
export const OBJECT_STORAGE_PROJECT_ATTACHMENTS_BUCKET: "project-attachments";
export const OBJECT_STORAGE_DOCUMENT_TEMPLATE_BUCKET: "document-templates";
export const AGENCYOS_OBJECT_STORAGE_BUCKETS: readonly [
  "private-file-quarantine",
  "private-files",
  "project-attachments",
  "document-templates",
];
export function parseObjectStorageEndpoint(
  value: string,
  label?: string,
): { value: string; hostname: string; port: number; useSSL: boolean };
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
  endpoint: string;
  region: string;
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
