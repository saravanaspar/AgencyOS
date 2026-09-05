import { z } from "zod";

const applicationEnvSchema = z.object({
  APP_URL: z.url(),
  INTERNAL_APP_URL: z.url().optional(),
});

const databaseEnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .trim()
    .refine((value) => value.startsWith("postgresql://") || value.startsWith("postgres://"), {
      message: "Database URL must use postgres:// or postgresql://.",
    }),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
});

const minioEnvSchema = z.object({
  MINIO_ENDPOINT: z.url(),
  MINIO_ACCESS_KEY: z.string().trim().min(3),
  MINIO_SECRET_KEY: z.string().trim().min(8),
  MINIO_REGION: z.string().trim().min(1).default("us-east-1"),
});

const redisEnvSchema = z.object({
  REDIS_URL: z
    .url()
    .refine((value) => value.startsWith("redis://") || value.startsWith("rediss://"), {
      message: "Redis URL must use redis:// or rediss://.",
    }),
});

export interface ApplicationEnv {
  appUrl: string;
  internalAppUrl: string | null;
}

export interface DatabaseEnv {
  databaseUrl: string;
  poolMax: number;
}

export interface MinioEnv {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  region: string;
}

export interface RedisEnv {
  redisUrl: string;
}

export interface AuditPipelineAlertEnv {
  webhookUrl: string;
  webhookSecret: string;
}

export interface RuntimeDependencyPolicy {
  redisRequired: boolean;
  minioRequired: boolean;
  privateFileScannerRequired: boolean;
}

function envFlag(name: string, defaultValue: boolean): boolean {
  const value = process.env[name]?.trim();
  if (!value) return defaultValue;
  if (value === "1" || value.toLowerCase() === "true") return true;
  if (value === "0" || value.toLowerCase() === "false") return false;
  throw new Error(`${name} must be 0/1 or true/false.`);
}

function normalizeUrl(value: string): string {
  return value.replace(/\/$/, "");
}

function assertNoUrlCredentials(label: string, value: string): void {
  const parsed = new URL(value);
  if (parsed.username || parsed.password) throw new Error(`${label} must not contain credentials.`);
}

function assertSecret(name: string, minimum = 32): void {
  const value = process.env[name]?.trim() ?? "";
  if (value.length < minimum)
    throw new Error(`${name} must contain at least ${minimum} characters.`);
}

function assertEncryptionKey(name: string): void {
  const value = process.env[name]?.trim() ?? "";
  const key = /^[a-f0-9]{64}$/i.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
  if (key.length !== 32) {
    throw new Error(`${name} must decode to exactly 32 bytes.`);
  }
}

function assertOptionalPair(firstName: string, secondName: string): void {
  const first = process.env[firstName]?.trim() ?? "";
  const second = process.env[secondName]?.trim() ?? "";
  if (Boolean(first) !== Boolean(second)) {
    throw new Error(`${firstName} and ${secondName} must be configured together.`);
  }
}

function validateOptionalCrmOAuthEnvironment(): void {
  for (const provider of ["HUBSPOT", "SALESFORCE", "ZOHO", "PIPEDRIVE"]) {
    assertOptionalPair(`${provider}_OAUTH_CLIENT_ID`, `${provider}_OAUTH_CLIENT_SECRET`);
  }
  const salesforceLogin = process.env.SALESFORCE_OAUTH_LOGIN_URL?.trim();
  if (salesforceLogin) {
    const url = new URL(salesforceLogin);
    if (
      url.protocol !== "https:" ||
      !["login.salesforce.com", "test.salesforce.com"].includes(url.hostname) ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new Error(
        "SALESFORCE_OAUTH_LOGIN_URL must be https://login.salesforce.com or https://test.salesforce.com.",
      );
    }
  }
}

export function getApplicationEnv(): ApplicationEnv {
  const result = applicationEnvSchema.safeParse({
    APP_URL: process.env.APP_URL,
    INTERNAL_APP_URL: process.env.INTERNAL_APP_URL || undefined,
  });

  if (!result.success) {
    throw new Error(`Invalid application environment: ${z.prettifyError(result.error)}`);
  }

  assertNoUrlCredentials("APP_URL", result.data.APP_URL);
  if (result.data.INTERNAL_APP_URL) {
    assertNoUrlCredentials("INTERNAL_APP_URL", result.data.INTERNAL_APP_URL);
  }

  return {
    appUrl: normalizeUrl(result.data.APP_URL),
    internalAppUrl: result.data.INTERNAL_APP_URL
      ? normalizeUrl(result.data.INTERNAL_APP_URL)
      : null,
  };
}

export function getDatabaseEnv(): DatabaseEnv {
  const result = databaseEnvSchema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_POOL_MAX: process.env.DATABASE_POOL_MAX || undefined,
  });

  if (!result.success) {
    throw new Error(`Invalid database environment: ${z.prettifyError(result.error)}`);
  }

  return {
    databaseUrl: result.data.DATABASE_URL,
    poolMax: result.data.DATABASE_POOL_MAX,
  };
}

export function getMinioEnv(): MinioEnv {
  const result = minioEnvSchema.safeParse({
    MINIO_ENDPOINT: process.env.MINIO_ENDPOINT,
    MINIO_ACCESS_KEY: process.env.MINIO_ACCESS_KEY,
    MINIO_SECRET_KEY: process.env.MINIO_SECRET_KEY,
    MINIO_REGION: process.env.MINIO_REGION || undefined,
  });

  if (!result.success) {
    throw new Error(`Invalid MinIO environment: ${z.prettifyError(result.error)}`);
  }

  return {
    endpoint: result.data.MINIO_ENDPOINT,
    accessKey: result.data.MINIO_ACCESS_KEY,
    secretKey: result.data.MINIO_SECRET_KEY,
    region: result.data.MINIO_REGION,
  };
}

export function getRedisEnv(): RedisEnv | null {
  const value = process.env.REDIS_URL?.trim();
  if (!value) return null;

  const result = redisEnvSchema.safeParse({ REDIS_URL: value });
  if (!result.success) {
    throw new Error(`Invalid Redis environment: ${z.prettifyError(result.error)}`);
  }

  return { redisUrl: result.data.REDIS_URL };
}

export function getAuditPipelineAlertEnv(): AuditPipelineAlertEnv | null {
  const webhookUrl = process.env.AUDIT_PIPELINE_ALERT_WEBHOOK_URL?.trim() ?? "";
  const webhookSecret = process.env.AUDIT_PIPELINE_ALERT_WEBHOOK_SECRET?.trim() ?? "";

  if (!webhookUrl && !webhookSecret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "AUDIT_PIPELINE_ALERT_WEBHOOK_URL and AUDIT_PIPELINE_ALERT_WEBHOOK_SECRET are required in production.",
      );
    }
    return null;
  }
  if (!webhookUrl || !webhookSecret) {
    throw new Error(
      "AUDIT_PIPELINE_ALERT_WEBHOOK_URL and AUDIT_PIPELINE_ALERT_WEBHOOK_SECRET must be configured together.",
    );
  }
  if (
    webhookSecret.length < 32 ||
    webhookSecret.length > 512 ||
    !/^[\x21-\x7e]+$/.test(webhookSecret)
  ) {
    throw new Error(
      "AUDIT_PIPELINE_ALERT_WEBHOOK_SECRET must contain 32 to 512 printable ASCII characters without spaces.",
    );
  }
  if (webhookUrl.length > 2_048) {
    throw new Error("AUDIT_PIPELINE_ALERT_WEBHOOK_URL is too long.");
  }

  let parsed: URL;
  try {
    parsed = new URL(webhookUrl);
  } catch {
    throw new Error("AUDIT_PIPELINE_ALERT_WEBHOOK_URL must be a valid HTTPS URL.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
    throw new Error(
      "AUDIT_PIPELINE_ALERT_WEBHOOK_URL must use HTTPS without credentials or a fragment.",
    );
  }

  return { webhookUrl: parsed.href, webhookSecret };
}

export function getRuntimeDependencyPolicy(): RuntimeDependencyPolicy {
  const production = process.env.NODE_ENV === "production";
  return {
    redisRequired: envFlag("REDIS_REQUIRED", production),
    minioRequired: envFlag("MINIO_REQUIRED", production),
    privateFileScannerRequired: envFlag("PRIVATE_FILE_SCANNER_REQUIRED", production),
  };
}

/** Fail closed at process startup for production-only invariants. */
export function validateProductionEnvironment(): void {
  if (process.env.NODE_ENV !== "production") return;

  const app = getApplicationEnv();
  const policy = getRuntimeDependencyPolicy();
  const database = getDatabaseEnv();
  if (!app.appUrl.startsWith("https://")) throw new Error("APP_URL must use HTTPS in production.");
  if (app.internalAppUrl && !/^https?:\/\//.test(app.internalAppUrl)) {
    throw new Error("INTERNAL_APP_URL must use HTTP or HTTPS.");
  }
  if (!database.databaseUrl) throw new Error("DATABASE_URL is required.");

  assertSecret("INTERNAL_WORKER_SECRET");
  getAuditPipelineAlertEnv();
  assertEncryptionKey("AUTH_ENCRYPTION_KEY");
  assertEncryptionKey("CRM_CONNECTOR_ENCRYPTION_KEY");
  validateOptionalCrmOAuthEnvironment();

  const trustPrivateServiceNetwork = envFlag("AGENCYOS_TRUST_PRIVATE_SERVICE_NETWORK", false);

  if (policy.redisRequired) {
    const redis = getRedisEnv();
    const parsed = redis ? new URL(redis.redisUrl) : null;
    const privateRedis =
      trustPrivateServiceNetwork &&
      parsed?.protocol === "redis:" &&
      parsed.hostname === "redis" &&
      (parsed.port || "6379") === "6379" &&
      parsed.username === "default" &&
      parsed.password.length >= 32 &&
      parsed.pathname === "/0" &&
      !parsed.search &&
      !parsed.hash;
    if (!redis?.redisUrl.startsWith("rediss://") && !privateRedis) {
      throw new Error("REDIS_URL must use rediss:// when Redis is required in production.");
    }
  }

  if (policy.minioRequired) {
    const minio = getMinioEnv();
    const privateMinio =
      trustPrivateServiceNetwork &&
      minio.endpoint === "http://minio:9000" &&
      minio.secretKey.length >= 32 &&
      minio.accessKey.toLowerCase() !== "minioadmin";
    if (!minio.endpoint.startsWith("https://") && !privateMinio) {
      throw new Error("MINIO_ENDPOINT must use HTTPS when MinIO is required in production.");
    }
  }

  if (policy.privateFileScannerRequired) {
    const scanner = process.env.PRIVATE_FILE_SCANNER_URL?.trim();
    const privateScanner = trustPrivateServiceNetwork && scanner === "clamav://clamav:3310";
    if (!scanner || (scanner.startsWith("clamav://") && !privateScanner)) {
      throw new Error("PRIVATE_FILE_SCANNER_URL is required in production.");
    }
  }
}
