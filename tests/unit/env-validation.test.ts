import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getApplicationEnv,
  getAuditPipelineAlertEnv,
  getDatabaseEnv,
  getMinioEnv,
  getRedisEnv,
  validateProductionEnvironment,
} from "@/lib/validation/env";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("environment validation", () => {
  it("validates database and MinIO credentials independently", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://postgres:password@localhost:5432/postgres");
    vi.stubEnv("MINIO_ENDPOINT", "http://127.0.0.1:9000");
    vi.stubEnv("MINIO_ACCESS_KEY", "agencyos-local");
    vi.stubEnv("MINIO_SECRET_KEY", "test-secret");
    vi.stubEnv("MINIO_REGION", "us-east-1");

    expect(getDatabaseEnv()).toEqual({
      databaseUrl: "postgresql://postgres:password@localhost:5432/postgres",
      poolMax: 10,
    });
    expect(getMinioEnv()).toEqual({
      endpoint: "http://127.0.0.1:9000",
      accessKey: "agencyos-local",
      secretKey: "test-secret",
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

  it("rejects missing MinIO and database credentials", () => {
    vi.stubEnv("MINIO_ENDPOINT", "");
    vi.stubEnv("MINIO_ACCESS_KEY", "");
    vi.stubEnv("MINIO_SECRET_KEY", "");
    vi.stubEnv("DATABASE_URL", "");
    expect(() => getMinioEnv()).toThrow("Invalid MinIO environment");
    expect(() => getDatabaseEnv()).toThrow("Invalid database environment");
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
    vi.stubEnv("MINIO_REQUIRED", "1");
    vi.stubEnv("PRIVATE_FILE_SCANNER_REQUIRED", "1");
    vi.stubEnv("MINIO_ACCESS_KEY", "agencyos-app");
    vi.stubEnv("MINIO_SECRET_KEY", "m".repeat(32));
    vi.stubEnv("MINIO_REGION", "us-east-1");
  }

  it("allows only the authenticated exact-host private service topology when opted in", () => {
    stubProductionEnvironment();
    vi.stubEnv("AGENCYOS_TRUST_PRIVATE_SERVICE_NETWORK", "1");
    vi.stubEnv("REDIS_URL", `redis://default:${"r".repeat(32)}@redis:6379/0`);
    vi.stubEnv("MINIO_ENDPOINT", "http://minio:9000");
    vi.stubEnv("PRIVATE_FILE_SCANNER_URL", "clamav://clamav:3310");
    expect(() => validateProductionEnvironment()).not.toThrow();

    vi.stubEnv("REDIS_URL", `redis://default:${"r".repeat(32)}@redis-evil:6379/0`);
    expect(() => validateProductionEnvironment()).toThrow("REDIS_URL must use rediss://");
  });

  it("keeps remote production Redis and MinIO transport fail-closed", () => {
    stubProductionEnvironment();
    vi.stubEnv("AGENCYOS_TRUST_PRIVATE_SERVICE_NETWORK", "0");
    vi.stubEnv("REDIS_URL", `redis://default:${"r".repeat(32)}@redis.example.test:6379/0`);
    vi.stubEnv("MINIO_ENDPOINT", "http://files.example.test");
    vi.stubEnv("PRIVATE_FILE_SCANNER_URL", "https://scanner.example.test/scan");
    expect(() => validateProductionEnvironment()).toThrow("REDIS_URL must use rediss://");

    vi.stubEnv("REDIS_URL", `rediss://default:${"r".repeat(32)}@redis.example.test:6380/0`);
    expect(() => validateProductionEnvironment()).toThrow("MINIO_ENDPOINT must use HTTPS");
  });
});
