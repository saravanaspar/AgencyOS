import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  atomicPrivateJson: vi.fn(),
  checkedCommand: vi.fn(),
  sha256File: vi.fn(),
  schemaVersion: 3,
}));

vi.mock("../../scripts/backup/process.mjs", () => ({
  atomicPrivateJson: mocks.atomicPrivateJson,
  checkedCommand: mocks.checkedCommand,
  sha256File: mocks.sha256File,
}));

import { prepareRestore } from "../../scripts/backup/restore-prepare.mjs";

const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");

async function restoreEnvironment() {
  const recoveryRoot = await mkdtemp(join(tmpdir(), "agencyos-restore-schema-test-"));
  return {
    NODE_ENV: "test",
    AGENCYOS_RESTORE_DRILL: "1",
    AGENCYOS_RESTORE_SNAPSHOT: "abc12345",
    AGENCYOS_RECOVERY_ID: "recovery-one",
    AGENCYOS_RECOVERY_ROOT: recoveryRoot,
    B2_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
    B2_BUCKET: "agencyos-backup",
    B2_PREFIX: "production/restic",
    B2_RESTORE_KEY_ID: "restore-id",
    B2_RESTORE_APPLICATION_KEY: "restore-key",
    RESTIC_PASSWORD: "repository-password",
  };
}

beforeEach(() => {
  mocks.atomicPrivateJson.mockReset();
  mocks.checkedCommand.mockReset();
  mocks.sha256File.mockReset();
  mocks.atomicPrivateJson.mockImplementation(async (path: string, value: unknown) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(value)}\n`);
  });
  mocks.sha256File.mockImplementation(async (path: string) => hash(await readFile(path)));
  mocks.checkedCommand.mockImplementation(async (input: { command: string; args: string[] }) => {
    if (input.command === "restic") {
      const destination = input.args.at(-1)!;
      const sourceRoot = join(destination, "snapshot", "stage", "current");
      const databaseDirectory = join(sourceRoot, "databases");
      await mkdir(databaseDirectory, { recursive: true });
      const agency = Buffer.from("agency-dump");
      const vaultwarden = Buffer.from("vaultwarden-dump");
      await writeFile(join(databaseDirectory, "agencyos.dump"), agency);
      await writeFile(join(databaseDirectory, "vaultwarden.dump"), vaultwarden);
      await writeFile(
        join(sourceRoot, "manifest.json"),
        JSON.stringify({
          schemaVersion: mocks.schemaVersion,
          runId: "backup-run-one",
          databases: {
            agencyos: { bytes: agency.length, sha256: hash(agency) },
            vaultwarden: { bytes: vaultwarden.length, sha256: hash(vaultwarden) },
          },
        }),
      );
    }
    return { status: "passed", stdoutText: "" };
  });
});

describe("backup restore manifest contract", () => {
  it("prepares a verified schema-v3 snapshot", async () => {
    mocks.schemaVersion = 3;
    const result = await prepareRestore({ environment: await restoreEnvironment() });
    expect(result).toMatchObject({
      status: "prepared",
      recoveryId: "recovery-one",
      snapshotId: "abc12345",
      backupRunId: "backup-run-one",
    });
    expect(
      mocks.checkedCommand.mock.calls.filter(([call]) => call.command === "pg_restore"),
    ).toHaveLength(2);
  });

  it("rejects a pre-cutover manifest before component restoration", async () => {
    mocks.schemaVersion = 2;
    await expect(prepareRestore({ environment: await restoreEnvironment() })).rejects.toThrow(
      "Restored backup manifest is invalid",
    );
    expect(mocks.atomicPrivateJson).not.toHaveBeenCalled();
  });
});
