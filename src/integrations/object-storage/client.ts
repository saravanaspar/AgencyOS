import "server-only";

import {
  createS3CompatibleClient,
  type S3CompatibleClient,
} from "@/integrations/object-storage/s3-client.mjs";
import {
  AGENCYOS_OBJECT_STORAGE_BUCKETS,
  objectStorageConfiguration,
  resolveObjectStorageLocation,
  type ObjectStorageConfiguration,
} from "@/integrations/object-storage/config.mjs";

export {
  AGENCYOS_OBJECT_STORAGE_BUCKETS,
  OBJECT_STORAGE_DOCUMENT_TEMPLATE_BUCKET,
  OBJECT_STORAGE_PRIVATE_BUCKET,
  OBJECT_STORAGE_PROJECT_ATTACHMENTS_BUCKET,
  OBJECT_STORAGE_QUARANTINE_BUCKET,
  parseObjectStorageEndpoint,
} from "@/integrations/object-storage/config.mjs";

export type AgencyOsObjectStorageBucket = (typeof AGENCYOS_OBJECT_STORAGE_BUCKETS)[number];

const DEFAULT_MAX_OBJECT_BYTES = 32 * 1024 * 1024;
const MAX_OBJECT_KEY_BYTES = 1024;
const allowedBuckets = new Set<string>(AGENCYOS_OBJECT_STORAGE_BUCKETS);

interface PutObjectInput {
  bucket: string;
  objectName: string;
  body: Buffer;
  contentType: string;
  cacheControl?: string;
}

let cachedClient: S3CompatibleClient | null = null;
let cachedClientKey = "";

export function assertObjectStorageLocation(bucket: string, objectName: string): void {
  if (!allowedBuckets.has(bucket)) throw new Error("object-storage-bucket-not-allowed");
  if (!objectName || objectName.startsWith("/") || objectName.includes("\\")) {
    throw new Error("object-storage-key-invalid");
  }
  if (Buffer.byteLength(objectName, "utf8") > MAX_OBJECT_KEY_BYTES) {
    throw new Error("object-storage-key-too-long");
  }
  const segments = objectName.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("object-storage-key-invalid");
  }
}

function clientConfiguration(configuration: ObjectStorageConfiguration) {
  return {
    endpoint: configuration.endpoint,
    region: configuration.region,
    accessKey: configuration.accessKey,
    secretKey: configuration.secretKey,
  };
}

export function getObjectStorageClient(): S3CompatibleClient {
  const configuration = clientConfiguration(objectStorageConfiguration());
  const key = JSON.stringify(configuration);
  if (cachedClient && cachedClientKey === key) return cachedClient;
  cachedClient = createS3CompatibleClient(configuration);
  cachedClientKey = key;
  return cachedClient;
}

export function isObjectStorageNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(Reflect.get(error, "code")) : "";
  return ["NoSuchKey", "NoSuchObject", "NoSuchBucket", "NotFound"].includes(code);
}

function physicalLocation(bucket: string, objectName: string) {
  assertObjectStorageLocation(bucket, objectName);
  return resolveObjectStorageLocation(objectStorageConfiguration(), bucket, objectName);
}

export async function putObject(input: PutObjectInput): Promise<void> {
  if (!Buffer.isBuffer(input.body)) throw new Error("object-storage-body-invalid");
  const location = physicalLocation(input.bucket, input.objectName);
  await getObjectStorageClient().putObject(
    location.physicalBucket,
    location.physicalKey,
    input.body,
    input.body.length,
    {
      "Content-Type": input.contentType,
      "Cache-Control": input.cacheControl ?? "private, no-store",
    },
  );
}

async function readBoundedStream(
  stream: Awaited<ReturnType<S3CompatibleClient["getObject"]>>,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      stream.destroy();
      throw new Error("object-storage-object-too-large");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, size);
}

export async function readObject(
  bucket: string,
  objectName: string,
  options: { maxBytes?: number } = {},
): Promise<Buffer> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_OBJECT_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("object-storage-limit-invalid");
  }
  try {
    const location = physicalLocation(bucket, objectName);
    const stream = await getObjectStorageClient().getObject(
      location.physicalBucket,
      location.physicalKey,
    );
    return await readBoundedStream(stream, maxBytes);
  } catch (error) {
    if (isObjectStorageNotFoundError(error)) throw new Error("object-storage-object-not-found");
    throw error;
  }
}

export async function removeObject(bucket: string, objectName: string): Promise<void> {
  try {
    const location = physicalLocation(bucket, objectName);
    await getObjectStorageClient().removeObject(location.physicalBucket, location.physicalKey);
  } catch (error) {
    if (!isObjectStorageNotFoundError(error)) throw error;
  }
}

export async function objectExists(bucket: string, objectName: string): Promise<boolean> {
  try {
    const location = physicalLocation(bucket, objectName);
    await getObjectStorageClient().statObject(location.physicalBucket, location.physicalKey);
    return true;
  } catch (error) {
    if (isObjectStorageNotFoundError(error)) return false;
    throw error;
  }
}
