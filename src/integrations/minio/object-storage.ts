import "server-only";

import * as Minio from "minio";

import { getMinioEnv } from "@/lib/validation/env";

export const MINIO_QUARANTINE_BUCKET = "private-file-quarantine";
export const MINIO_PRIVATE_BUCKET = "private-files";
export const MINIO_LEGACY_PROJECT_BUCKET = "project-attachments";
export const MINIO_DOCUMENT_TEMPLATE_BUCKET = "document-templates";

export const AGENCYOS_MINIO_BUCKETS = [
  MINIO_QUARANTINE_BUCKET,
  MINIO_PRIVATE_BUCKET,
  MINIO_LEGACY_PROJECT_BUCKET,
  MINIO_DOCUMENT_TEMPLATE_BUCKET,
] as const;

export type AgencyOsMinioBucket = (typeof AGENCYOS_MINIO_BUCKETS)[number];

const DEFAULT_REGION = "us-east-1";
const DEFAULT_MAX_OBJECT_BYTES = 32 * 1024 * 1024;
const MAX_OBJECT_KEY_BYTES = 1024;
const allowedBuckets = new Set<string>(AGENCYOS_MINIO_BUCKETS);

interface MinioConfiguration {
  endPoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
  region: string;
}

interface PutMinioObjectInput {
  bucket: string;
  objectName: string;
  body: Buffer;
  contentType: string;
  cacheControl?: string;
}

let cachedClient: Minio.Client | null = null;
let cachedClientKey = "";

export function parseMinioEndpoint(endpoint: string): {
  endPoint: string;
  port: number;
  useSSL: boolean;
} {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error("MINIO_ENDPOINT must be a valid HTTP or HTTPS URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("MINIO_ENDPOINT must use http:// or https://.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("MINIO_ENDPOINT must not contain credentials.");
  }
  if ((parsed.pathname && parsed.pathname !== "/") || parsed.search || parsed.hash) {
    throw new Error("MINIO_ENDPOINT must not contain a path, query, or fragment.");
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  if (!hostname) throw new Error("MINIO_ENDPOINT must include a hostname.");

  return {
    endPoint: hostname,
    port: parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80,
    useSSL: parsed.protocol === "https:",
  };
}

export function getMinioConfiguration(): MinioConfiguration {
  const environment = getMinioEnv();
  return {
    ...parseMinioEndpoint(environment.endpoint),
    accessKey: environment.accessKey,
    secretKey: environment.secretKey,
    region: environment.region || DEFAULT_REGION,
  };
}

export function assertMinioObjectLocation(bucket: string, objectName: string): void {
  if (!allowedBuckets.has(bucket)) throw new Error("minio-bucket-not-allowed");
  if (!objectName || objectName.startsWith("/") || objectName.includes("\\")) {
    throw new Error("minio-object-key-invalid");
  }
  if (Buffer.byteLength(objectName, "utf8") > MAX_OBJECT_KEY_BYTES) {
    throw new Error("minio-object-key-too-long");
  }
  const segments = objectName.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("minio-object-key-invalid");
  }
}

export function getMinioClient(): Minio.Client {
  const configuration = getMinioConfiguration();
  const key = JSON.stringify(configuration);
  if (cachedClient && cachedClientKey === key) return cachedClient;

  cachedClient = new Minio.Client(configuration);
  cachedClientKey = key;
  return cachedClient;
}

export function isMinioNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(Reflect.get(error, "code")) : "";
  return ["NoSuchKey", "NoSuchObject", "NoSuchBucket", "NotFound"].includes(code);
}

export async function putMinioObject(input: PutMinioObjectInput): Promise<void> {
  assertMinioObjectLocation(input.bucket, input.objectName);
  if (!Buffer.isBuffer(input.body)) throw new Error("minio-object-body-invalid");
  await getMinioClient().putObject(input.bucket, input.objectName, input.body, input.body.length, {
    "Content-Type": input.contentType,
    "Cache-Control": input.cacheControl ?? "private, no-store",
  });
}

export async function readMinioObject(
  bucket: string,
  objectName: string,
  options: { maxBytes?: number } = {},
): Promise<Buffer> {
  assertMinioObjectLocation(bucket, objectName);
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_OBJECT_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("minio-object-limit-invalid");
  }

  let stream: Awaited<ReturnType<Minio.Client["getObject"]>>;
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    stream = await getMinioClient().getObject(bucket, objectName);
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBytes) {
        stream.destroy();
        throw new Error("minio-object-too-large");
      }
      chunks.push(buffer);
    }
  } catch (error) {
    if (isMinioNotFoundError(error)) throw new Error("minio-object-not-found");
    throw error;
  }
  return Buffer.concat(chunks, size);
}

export async function removeMinioObject(bucket: string, objectName: string): Promise<void> {
  assertMinioObjectLocation(bucket, objectName);
  try {
    await getMinioClient().removeObject(bucket, objectName);
  } catch (error) {
    if (!isMinioNotFoundError(error)) throw error;
  }
}

export async function minioObjectExists(bucket: string, objectName: string): Promise<boolean> {
  assertMinioObjectLocation(bucket, objectName);
  try {
    await getMinioClient().statObject(bucket, objectName);
    return true;
  } catch (error) {
    if (isMinioNotFoundError(error)) return false;
    throw error;
  }
}
