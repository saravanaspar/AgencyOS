import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertMatchingPostgresDatabase,
  assertRestoreEnvironment,
  assertSecureRecoveryPostgresUrl,
  backupConfiguration,
  resticEnvironment,
} from "../../scripts/backup/config.mjs";
import { evaluateBackupHealth } from "../../scripts/backup/health.mjs";
import { atomicPrivateJson, redactDiagnostic } from "../../scripts/backup/process.mjs";
import { captureObjectStorage } from "../../scripts/backup/run-backup.mjs";
import { backupIsStale, nextScheduledRun } from "../../scripts/backup/scheduler.mjs";

function backupEnvironment() {
  return {
    DATABASE_ADMIN_URL: "postgresql://agency:password@postgres:5432/agencyos",
    VAULTWARDEN_DATABASE_URL: "postgresql://vault:password@postgres:5432/vaultwarden",
    MINIO_ENDPOINT: "http://minio:9000",
    MINIO_ROOT_USER: "root-user",
    MINIO_ROOT_PASSWORD: "root-password",
    B2_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
    B2_BUCKET: "agencyos-backup",
    B2_PREFIX: "production/restic",
    B2_WRITER_KEY_ID: "writer-id",
    B2_WRITER_APPLICATION_KEY: "writer-key",
    RESTIC_PASSWORD: "repository-password",
  };
}

function cloudBackupEnvironment() {
  return {
    AGENCYOS_INFRA_MODE: "cloud",
    OBJECT_STORAGE_PROVIDER: "b2",
    DATABASE_ADMIN_URL:
      "postgresql://agency:password@ep-agency.us-east-2.aws.neon.tech/agencyos?sslmode=require",
    VAULTWARDEN_DATABASE_ADMIN_URL:
      "postgresql://vault:password@ep-vault.us-east-2.aws.neon.tech/vaultwarden?sslmode=require",
    OBJECT_STORAGE_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
    OBJECT_STORAGE_REGION: "us-west-004",
    OBJECT_STORAGE_ACCESS_KEY_ID: "runtime-key",
    OBJECT_STORAGE_BACKUP_ACCESS_KEY_ID: "source-key",
    OBJECT_STORAGE_BACKUP_SECRET_ACCESS_KEY: "source-secret",
    OBJECT_STORAGE_QUARANTINE_BUCKET: "agencyos-runtime",
    OBJECT_STORAGE_QUARANTINE_PREFIX: "private-file-quarantine",
    OBJECT_STORAGE_PRIVATE_FILES_BUCKET: "agencyos-runtime",
    OBJECT_STORAGE_PRIVATE_FILES_PREFIX: "private-files",
    OBJECT_STORAGE_PROJECT_ATTACHMENTS_BUCKET: "agencyos-runtime",
    OBJECT_STORAGE_PROJECT_ATTACHMENTS_PREFIX: "project-attachments",
    OBJECT_STORAGE_DOCUMENT_TEMPLATES_BUCKET: "agencyos-runtime",
    OBJECT_STORAGE_DOCUMENT_TEMPLATES_PREFIX: "document-templates",
    B2_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
    B2_BUCKET: "agencyos-backup",
    B2_PREFIX: "production/restic",
    B2_WRITER_KEY_ID: "writer-id",
    B2_WRITER_APPLICATION_KEY: "writer-key",
    RESTIC_PASSWORD: "repository-password",
  };
}

describe("backup operations contract", () => {
  it("builds a pinned-prefix restic environment without logging credentials", () => {
    const value = resticEnvironment(backupEnvironment());
    expect(value.RESTIC_REPOSITORY).toBe(
      "s3:https://s3.us-west-004.backblazeb2.com/agencyos-backup/production/restic",
    );
    expect(value.AWS_ACCESS_KEY_ID).toBe("writer-id");
    expect(JSON.stringify(value)).not.toContain("DATABASE_ADMIN_URL");
  });

  it("keeps local backups on canonical MinIO buckets using the existing root credentials", () => {
    const configuration = backupConfiguration(backupEnvironment());
    expect(configuration.objectStorage).toMatchObject({
      mode: "local",
      provider: "minio",
      endpoint: "http://minio:9000",
      accessKey: "root-user",
      secretKey: "root-password",
    });
    expect(configuration.objectStorage.locations).toEqual([
      { logicalBucket: "private-file-quarantine", bucket: "private-file-quarantine", prefix: "" },
      { logicalBucket: "private-files", bucket: "private-files", prefix: "" },
      { logicalBucket: "project-attachments", bucket: "project-attachments", prefix: "" },
      { logicalBucket: "document-templates", bucket: "document-templates", prefix: "" },
    ]);
  });

  it("uses the cloud source-read key and direct database URLs for hosted backups", () => {
    const environment = cloudBackupEnvironment();
    const configuration = backupConfiguration(environment);
    expect(configuration.agencyDatabaseUrl).toBe(environment.DATABASE_ADMIN_URL);
    expect(configuration.vaultwardenDatabaseUrl).toBe(environment.VAULTWARDEN_DATABASE_ADMIN_URL);
    expect(configuration.objectStorage.accessKey).toBe(
      environment.OBJECT_STORAGE_BACKUP_ACCESS_KEY_ID,
    );
    expect(configuration.objectStorage.secretKey).toBe(
      environment.OBJECT_STORAGE_BACKUP_SECRET_ACCESS_KEY,
    );
    expect(configuration.objectStorage.accessKey).not.toBe(
      environment.OBJECT_STORAGE_ACCESS_KEY_ID,
    );

    expect(() => backupConfiguration({ ...environment, B2_BUCKET: "agencyos-runtime" })).toThrow(
      "different buckets",
    );
    expect(() => backupConfiguration({ ...environment, B2_WRITER_KEY_ID: "source-key" })).toThrow(
      "different key IDs",
    );
    expect(() =>
      backupConfiguration({
        ...environment,
        DATABASE_ADMIN_URL:
          "postgresql://agency:password@ep-agency-pooler.us-east-2.aws.neon.tech/agencyos?sslmode=require",
      }),
    ).toThrow("direct, non-pooler");
  });

  it("matches Neon pooled and direct URLs without accepting another endpoint or database", () => {
    const pooled =
      "postgresql://agency:password@ep-agency-pooler.us-east-2.aws.neon.tech/agencyos?sslmode=require";
    const direct =
      "postgresql://agency_admin:password@ep-agency.us-east-2.aws.neon.tech/agencyos?sslmode=verify-full";
    expect(assertMatchingPostgresDatabase(pooled, direct, "AgencyOS").runtime.identity).toBe(
      "ep-agency.us-east-2.aws.neon.tech:neon/agencyos",
    );
    expect(() =>
      assertMatchingPostgresDatabase(
        pooled,
        "postgresql://agency:password@ep-other.us-east-2.aws.neon.tech/agencyos?sslmode=require",
        "AgencyOS",
      ),
    ).toThrow("same database cluster");
    expect(() =>
      assertMatchingPostgresDatabase(
        pooled,
        "postgresql://agency:password@ep-agency.us-east-2.aws.neon.tech/other?sslmode=require",
        "AgencyOS",
      ),
    ).toThrow("same database cluster");
  });

  it("requires TLS for remote recovery databases but permits the isolated local recovery service", () => {
    expect(() =>
      assertSecureRecoveryPostgresUrl(
        "postgresql://recovery:password@remote.example.com/agencyos_recovery",
        "RECOVERY_DATABASE_ADMIN_URL",
      ),
    ).toThrow("must require TLS");
    expect(
      assertSecureRecoveryPostgresUrl(
        "postgresql://recovery:password@remote.example.com/agencyos_recovery?sslmode=verify-full",
        "RECOVERY_DATABASE_ADMIN_URL",
      ).host,
    ).toBe("remote.example.com");
    expect(
      assertSecureRecoveryPostgresUrl(
        "postgresql://recovery:password@recovery-postgres:5432/agencyos_recovery",
        "RECOVERY_DATABASE_ADMIN_URL",
      ).host,
    ).toBe("recovery-postgres");
  });

  it("captures B2 prefixes without invoking the MinIO-only ready command", async () => {
    const target = await mkdtemp(join(tmpdir(), "agencyos-object-backup-test-"));
    const calls: Array<{ command: string; args: string[] }> = [];
    const configuration = backupConfiguration(cloudBackupEnvironment());
    try {
      await captureObjectStorage(configuration, target, {
        runCommand: async (call) => {
          calls.push({ command: call.command, args: call.args });
          return { status: "passed", stdoutText: "" };
        },
      });
      expect(calls).toHaveLength(8);
      expect(calls.every((call) => call.command === "mc")).toBe(true);
      expect(calls.flatMap((call) => call.args)).not.toContain("ready");
      expect(calls.filter((call) => call.args[0] === "mirror")).toHaveLength(4);
      expect(calls.filter((call) => call.args[0] === "ls")).toHaveLength(4);
    } finally {
      await rm(target, { recursive: true, force: true });
    }
  });

  it("enforces bounded configuration and minimum health freshness", () => {
    const environment = backupEnvironment();
    expect(backupConfiguration(environment).maxAgeHours).toBe(30);
    expect(() => backupConfiguration({ ...environment, BACKUP_MAX_AGE_HOURS: "1000" })).toThrow();
    const now = Date.parse("2026-09-04T12:00:00Z");
    expect(
      evaluateBackupHealth({
        success: { status: "succeeded", completedAt: "2026-09-04T10:00:00Z", snapshotId: "abc" },
        maintenance: null,
        now,
      }).healthy,
    ).toBe(true);
    expect(
      evaluateBackupHealth({
        success: { status: "succeeded", completedAt: "2026-09-02T00:00:00Z" },
        maintenance: null,
        now,
      }).reason,
    ).toBe("last-success-is-stale");
  });

  it("detects missed schedules and computes the next UTC run", () => {
    const now = new Date("2026-09-04T03:00:00Z");
    expect(nextScheduledRun({ now, hourUtc: 2, jitterMinutes: 0 }).toISOString()).toBe(
      "2026-09-05T02:00:00.000Z",
    );
    expect(backupIsStale(null, now.getTime(), 30)).toBe(true);
  });

  it("fails health on a newer backup failure and missing maintenance", () => {
    const success = { status: "succeeded", completedAt: "2026-09-04T10:00:00Z" };
    const now = Date.parse("2026-09-04T12:00:00Z");
    expect(
      evaluateBackupHealth({ success, maintenance: null, requireMaintenance: true, now }).healthy,
    ).toBe(false);
    expect(
      evaluateBackupHealth({
        success,
        maintenance: null,
        failure: { failedAt: "2026-09-04T11:00:00Z" },
        now,
      }).reason,
    ).toBe("latest-backup-failed");
  });

  it("writes status atomically with private permissions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agencyos-backup-test-"));
    const path = join(directory, "status.json");
    await atomicPrivateJson(path, { status: "succeeded" });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ status: "succeeded" });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("redacts credentials and refuses production or ambiguous restores", () => {
    const redacted = redactDiagnostic(
      "postgresql://user:hunter2@db/agency?token=abc password=hunter2",
    );
    expect(redacted).not.toContain("hunter2");
    expect(redacted).not.toContain("token=abc");
    expect(() =>
      assertRestoreEnvironment({
        NODE_ENV: "production",
        AGENCYOS_RESTORE_DRILL: "1",
        AGENCYOS_RESTORE_SNAPSHOT: "abc12345",
        AGENCYOS_RECOVERY_ID: "recovery-one",
      }),
    ).toThrow("must not be production");
  });

  it("uses DB-aware dumps, no-lock serialized restic, and non-destructive restore defaults", () => {
    const backup = readFileSync(join(process.cwd(), "scripts/backup/run-backup.mjs"), "utf8");
    const maintenance = readFileSync(
      join(process.cwd(), "scripts/backup/run-maintenance.mjs"),
      "utf8",
    );
    const restore = readFileSync(
      join(process.cwd(), "scripts/backup/restore-components.mjs"),
      "utf8",
    );
    expect(backup).toContain('"--format=custom"');
    expect(backup).toContain('"--skip-if-unchanged"');
    expect(backup).toContain("withFlock");
    expect(maintenance).toContain('"--keep-daily"');
    expect(maintenance).not.toContain('"--keep-within"');
    expect(maintenance).toContain('boundedInteger("BACKUP_KEEP_DAILY", 7, 1');
    expect(maintenance).toContain('boundedInteger("BACKUP_KEEP_WEEKLY", 4, 1');
    expect(maintenance).toContain('boundedInteger("BACKUP_KEEP_MONTHLY", 12, 1');
    expect(maintenance).toContain('boundedInteger("BACKUP_KEEP_YEARLY", 1, 1');
    expect(maintenance).not.toContain('"--prune"');
    expect(restore).toContain("is not empty; refusing to overwrite");
    expect(restore).not.toContain('"--clean"');
  });
});
