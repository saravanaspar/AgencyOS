import { readFileSync } from "node:fs";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertRestoreEnvironment,
  backupConfiguration,
  resticEnvironment,
} from "../../scripts/backup/config.mjs";
import { evaluateBackupHealth } from "../../scripts/backup/health.mjs";
import { atomicPrivateJson, redactDiagnostic } from "../../scripts/backup/process.mjs";
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

describe("backup operations contract", () => {
  it("builds a pinned-prefix restic environment without logging credentials", () => {
    const value = resticEnvironment(backupEnvironment());
    expect(value.RESTIC_REPOSITORY).toBe(
      "s3:https://s3.us-west-004.backblazeb2.com/agencyos-backup/production/restic",
    );
    expect(value.AWS_ACCESS_KEY_ID).toBe("writer-id");
    expect(JSON.stringify(value)).not.toContain("DATABASE_ADMIN_URL");
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
    expect(maintenance).not.toContain('"--prune"');
    expect(restore).toContain("is not empty; refusing to overwrite");
    expect(restore).not.toContain('"--clean"');
  });
});
