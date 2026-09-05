import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getApplicationEnv,
  getAuditPipelineAlertEnv,
  getDatabaseEnv,
  getObjectStorageEnv,
  getRedisEnv,
  getRuntimeDependencyPolicy,
  validateProductionEnvironment,
} from "@/lib/validation/env";

afterEach(() => {
  vi.unstubAllEnvs();
});

function stubObjectStorage(endpoint = "http://object-storage:9000") {
  vi.stubEnv("OBJECT_STORAGE_ENDPOINT", endpoint);
  vi.stubEnv("OBJECT_STORAGE_REGION", "us-east-1");
  vi.stubEnv("OBJECT_STORAGE_ACCESS_KEY_ID", "agencyos-app");
  vi.stubEnv("OBJECT_STORAGE_SECRET_ACCESS_KEY", "m".repeat(32));
  vi.stubEnv("OBJECT_STORAGE_BUCKET", "agencyos-runtime");
}

function stubProductionEnvironment() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("APP_URL", "https://agency.example.test");
  vi.stubEnv("DATABASE_URL", "postgresql://agency:password@postgres:5432/agencyos");
  vi.stubEnv("INTERNAL_WORKER_SECRET", "w".repeat(32));
  vi.stubEnv("AUDIT_PIPELINE_ALERT_WEBHOOK_URL", "https://alerts.example.test/audit");
  vi.stubEnv("AUDIT_PIPELINE_ALERT_WEBHOOK_SECRET", "a".repeat(32));
  vi.stubEnv("AUTH_ENCRYPTION_KEY", "00".repeat(32));
  vi.stubEnv("CRM_CONNECTOR_ENCRYPTION_KEY", "11".repeat(32));
  vi.stubEnv("REDIS_REQUIRED", "1");
  vi.stubEnv("OBJECT_STORAGE_REQUIRED", "1");
  vi.stubEnv("PRIVATE_FILE_SCANNER_REQUIRED", "1");
  stubObjectStorage();
}

describe("environment validation", () => {
  it("validates database and object-storage connections independently", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://postgres:password@localhost:5432/postgres");
    stubObjectStorage("http://127.0.0.1:9000");

    expect(getDatabaseEnv()).toEqual({
      databaseUrl: "postgresql://postgres:password@localhost:5432/postgres",
      poolMax: 10,
    });
    expect(getObjectStorageEnv()).toMatchObject({
      endpoint: "http://127.0.0.1:9000",
      accessKey: "agencyos-app",
      secretKey: "m".repeat(32),
      region: "us-east-1",
    });
  });

  it("accepts both standard PostgreSQL URL schemes", () => {
    vi.stubEnv("DATABASE_URL", "postgres://postgres:password@localhost:5432/postgres");
    expect(getDatabaseEnv().databaseUrl).toBe(
      "postgres://postgres:password@localhost:5432/postgres",
    );
  });

  it("allows a bounded database pool override", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://postgres:password@localhost:5432/postgres");
    vi.stubEnv("DATABASE_POOL_MAX", "14");
    expect(getDatabaseEnv().poolMax).toBe(14);
    vi.stubEnv("DATABASE_POOL_MAX", "100");
    expect(() => getDatabaseEnv()).toThrow("Invalid database environment");
  });

  it("normalizes a trailing slash from the application URL", () => {
    vi.stubEnv("APP_URL", "http://localhost:3000/");
    expect(getApplicationEnv()).toEqual({
      appUrl: "http://localhost:3000",
      internalAppUrl: null,
    });
  });

  it("loads optional Redis configuration and rejects unsafe schemes", () => {
    vi.stubEnv("REDIS_URL", "rediss://agencyos:secret@redis.example.com:6380/0");
    expect(getRedisEnv()).toEqual({
      redisUrl: "rediss://agencyos:secret@redis.example.com:6380/0",
    });
    vi.stubEnv("REDIS_URL", "");
    expect(getRedisEnv()).toBeNull();
    vi.stubEnv("REDIS_URL", "https://redis.example.com");
    expect(() => getRedisEnv()).toThrow("Invalid Redis environment");
  });

  it("rejects missing common object-storage and database settings", () => {
    vi.stubEnv("OBJECT_STORAGE_ENDPOINT", "");
    vi.stubEnv("DATABASE_URL", "");
    expect(() => getObjectStorageEnv()).toThrow("OBJECT_STORAGE_ENDPOINT");
    expect(() => getDatabaseEnv()).toThrow("Invalid database environment");
  });

  it("uses the provider-neutral storage requirement flag", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("OBJECT_STORAGE_REQUIRED", "1");
    expect(getRuntimeDependencyPolicy().objectStorageRequired).toBe(true);
    vi.stubEnv("OBJECT_STORAGE_REQUIRED", "0");
    expect(getRuntimeDependencyPolicy().objectStorageRequired).toBe(false);
  });

  it("allows audit-pipeline alert configuration to be omitted only outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AUDIT_PIPELINE_ALERT_WEBHOOK_URL", "");
    vi.stubEnv("AUDIT_PIPELINE_ALERT_WEBHOOK_SECRET", "");
    expect(getAuditPipelineAlertEnv()).toBeNull();

    vi.stubEnv("NODE_ENV", "production");
    expect(() => getAuditPipelineAlertEnv()).toThrow("are required in production");
  });

  it("requires a paired HTTPS audit-pipeline webhook with an independent bearer secret", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AUDIT_PIPELINE_ALERT_WEBHOOK_URL", "https://alerts.example.test/audit");
    vi.stubEnv("AUDIT_PIPELINE_ALERT_WEBHOOK_SECRET", "a".repeat(32));
    expect(getAuditPipelineAlertEnv()).toEqual({
      webhookUrl: "https://alerts.example.test/audit",
      webhookSecret: "a".repeat(32),
    });

    vi.stubEnv("AUDIT_PIPELINE_ALERT_WEBHOOK_SECRET", "");
    expect(() => getAuditPipelineAlertEnv()).toThrow("must be configured together");
    vi.stubEnv("AUDIT_PIPELINE_ALERT_WEBHOOK_SECRET", "short");
    expect(() => getAuditPipelineAlertEnv()).toThrow("32 to 512 printable ASCII");
    vi.stubEnv("AUDIT_PIPELINE_ALERT_WEBHOOK_SECRET", "a".repeat(32));
    vi.stubEnv("AUDIT_PIPELINE_ALERT_WEBHOOK_URL", "http://alerts.example.test/audit");
    expect(() => getAuditPipelineAlertEnv()).toThrow("must use HTTPS");
    vi.stubEnv(
      "AUDIT_PIPELINE_ALERT_WEBHOOK_URL",
      "https://user:password@alerts.example.test/audit",
    );
    expect(() => getAuditPipelineAlertEnv()).toThrow("without credentials");
  });

  it("allows only the authenticated exact-host private service topology when opted in", () => {
    stubProductionEnvironment();
    vi.stubEnv("AGENCYOS_TRUST_PRIVATE_SERVICE_NETWORK", "1");
    vi.stubEnv("REDIS_URL", `redis://default:${"r".repeat(32)}@redis:6379/0`);
    vi.stubEnv("PRIVATE_FILE_SCANNER_URL", "clamav://clamav:3310");
    expect(() => validateProductionEnvironment()).not.toThrow();

    vi.stubEnv("OBJECT_STORAGE_ENDPOINT", "http://object-storage-evil:9000");
    expect(() => validateProductionEnvironment()).toThrow(
      "Remote OBJECT_STORAGE_ENDPOINT must use HTTPS",
    );
  });

  it("keeps every remote production dependency transport fail-closed", () => {
    stubProductionEnvironment();
    vi.stubEnv("AGENCYOS_TRUST_PRIVATE_SERVICE_NETWORK", "0");
    vi.stubEnv("PRIVATE_FILE_SCANNER_URL", "https://scanner.example.test/scan");
    vi.stubEnv("REDIS_URL", `redis://default:${"r".repeat(32)}@redis.example.test:6379/0`);
    expect(() => validateProductionEnvironment()).toThrow("Remote DATABASE_URL must require TLS");

    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://agency:password@db.example.test/agencyos?sslmode=require",
    );
    expect(() => validateProductionEnvironment()).toThrow("Remote REDIS_URL");

    vi.stubEnv("REDIS_URL", `rediss://default:${"r".repeat(32)}@redis.example.test:6380/0`);
    expect(() => validateProductionEnvironment()).toThrow(
      "Remote OBJECT_STORAGE_ENDPOINT must use HTTPS",
    );
  });

  it("accepts hosted services using the same common storage variables", () => {
    stubProductionEnvironment();
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://agency:password@ep-test-pooler.us-east-2.aws.neon.tech/agencyos?sslmode=require",
    );
    vi.stubEnv("REDIS_URL", "rediss://default:token@redis.example.test:6380");
    stubObjectStorage("https://s3.us-west-004.backblazeb2.com");
    vi.stubEnv("OBJECT_STORAGE_REGION", "us-west-004");
    vi.stubEnv("PRIVATE_FILE_SCANNER_URL", "clamav://clamav:3310");
    vi.stubEnv("AGENCYOS_TRUST_PRIVATE_SERVICE_NETWORK", "1");
    expect(getObjectStorageEnv().endpoint).toBe("https://s3.us-west-004.backblazeb2.com");
    expect(() => validateProductionEnvironment()).not.toThrow();

    vi.stubEnv("REDIS_URL", "rediss://redis.example.test:6380");
    expect(() => validateProductionEnvironment()).toThrow("authenticated native rediss://");

    vi.stubEnv("REDIS_URL", "rediss://default:token@redis.example.test:6380");
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://agency:password@ep-test-pooler.us-east-2.aws.neon.tech/agencyos?sslmode=disable",
    );
    expect(() => validateProductionEnvironment()).toThrow("Remote DATABASE_URL must require TLS");
  });

  it("does not accept removed provider-specific storage variables", () => {
    vi.stubEnv("MINIO_ENDPOINT", "http://127.0.0.1:9000");
    vi.stubEnv("MINIO_ACCESS_KEY", "legacy-key");
    vi.stubEnv("MINIO_SECRET_KEY", "legacy-secret");
    expect(() => getObjectStorageEnv()).toThrow("OBJECT_STORAGE_ENDPOINT");
  });
});
