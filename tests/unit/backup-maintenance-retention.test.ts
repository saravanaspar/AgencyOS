import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  atomicPrivateJson: vi.fn().mockResolvedValue(undefined),
  checkedCommand: vi.fn().mockResolvedValue({ status: "passed", stdoutText: "" }),
}));

vi.mock("../../scripts/backup/process.mjs", () => ({
  atomicPrivateJson: mocks.atomicPrivateJson,
  checkedCommand: mocks.checkedCommand,
  redactDiagnostic: (value: unknown) => String(value),
  withFlock: vi.fn(),
}));

import { runMaintenance } from "../../scripts/backup/run-maintenance.mjs";

async function environment(overrides: Record<string, string> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "agencyos-maintenance-test-"));
  return {
    AGENCYOS_BACKUP_STATE_DIR: directory,
    AGENCYOS_RESTIC_LOCAL_DIR: join(directory, "repository"),
    B2_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
    B2_BUCKET: "agencyos-backup",
    B2_PREFIX: "production/restic",
    B2_MAINTENANCE_KEY_ID: "maintenance-id",
    B2_MAINTENANCE_APPLICATION_KEY: "maintenance-key",
    RESTIC_PASSWORD: "repository-password",
    ...overrides,
  };
}

beforeEach(() => {
  mocks.atomicPrivateJson.mockClear();
  mocks.checkedCommand.mockReset();
  mocks.checkedCommand.mockResolvedValue({ status: "passed", stdoutText: "" });
});

describe("backup maintenance retention", () => {
  it("passes exactly the 7 daily, 4 weekly, 12 monthly, and 1 yearly selectors", async () => {
    await runMaintenance({ environment: await environment(), mode: "monthly" });
    expect(mocks.checkedCommand).toHaveBeenCalledTimes(2);
    expect(mocks.checkedCommand.mock.calls[1]?.[0].args).toEqual([
      "forget",
      "--group-by",
      "host",
      "--keep-daily",
      "7",
      "--keep-weekly",
      "4",
      "--keep-monthly",
      "12",
      "--keep-yearly",
      "1",
    ]);
    expect(mocks.checkedCommand.mock.calls.flatMap(([call]) => call.args)).not.toContain(
      "--keep-within",
    );
    expect(mocks.checkedCommand.mock.calls.flatMap(([call]) => call.args)).not.toContain("--prune");
  });

  it("refuses remote pruning instead of invoking a destructive command", async () => {
    await expect(
      runMaintenance({
        environment: await environment({ BACKUP_PRUNE_ENABLED: "1" }),
        mode: "monthly",
      }),
    ).rejects.toThrow("Automatic pruning is disabled");
    const argumentsUsed = mocks.checkedCommand.mock.calls.flatMap(([call]) => call.args);
    expect(argumentsUsed).not.toContain("--prune");
    expect(argumentsUsed).not.toContain("delete");
    expect(argumentsUsed).not.toContain("rm");
  });
});
