import type { Readable } from "node:stream";

export interface S3CompatibleClientConfiguration {
  endpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
}

export interface S3CompatibleClientOptions {
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  clock?: () => Date;
}

export interface S3ObjectMetadata {
  size: number;
  etag?: string;
  lastModified?: Date;
  metaData: Record<string, string>;
}

export interface S3ObjectLockConfiguration {
  objectLockEnabled?: string;
  mode?: string;
  unit?: "Days" | "Years";
  validity: number;
}

export class S3CompatibleError extends Error {
  code: string;
  statusCode: number;
}

export class S3CompatibleClient {
  constructor(configuration: S3CompatibleClientConfiguration, options?: S3CompatibleClientOptions);
  bucketExists(bucket: string): Promise<boolean>;
  makeBucket(bucket: string, region?: string): Promise<void>;
  putObject(
    bucket: string,
    key: string,
    body: Buffer | Uint8Array,
    size?: number,
    metadata?: Record<string, string>,
  ): Promise<void>;
  getObject(bucket: string, key: string): Promise<Readable>;
  statObject(bucket: string, key: string): Promise<S3ObjectMetadata>;
  removeObject(bucket: string, key: string): Promise<void>;
  getObjectLockConfig(bucket: string): Promise<S3ObjectLockConfiguration>;
}

export function createS3CompatibleClient(
  configuration: S3CompatibleClientConfiguration,
  options?: S3CompatibleClientOptions,
): S3CompatibleClient;
