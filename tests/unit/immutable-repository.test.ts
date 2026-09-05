import { describe, it, expect, vi } from "vitest";
const { commands } = vi.hoisted(() => ({
  commands: vi.fn().mockResolvedValue({ status: "passed" }),
}));
vi.mock("../../scripts/backup/process.mjs", () => ({ checkedCommand: commands }));
import { publishRepository } from "../../scripts/backup/repository.mjs";

describe("immutable repository publication", () => {
  it("uploads dependencies before snapshots without overwrite/delete or lock publication", async () => {
    commands.mockClear();
    await publishRepository(
      {
        commandTimeoutMs: 10000,
        restic: { RESTIC_REPOSITORY: "s3:https://example.test/bucket/repo" },
      },
      {
        B2_ENDPOINT: "https://example.test",
        B2_BUCKET: "bucket",
        B2_PREFIX: "repo",
        B2_WRITER_KEY_ID: "test-id",
        B2_WRITER_APPLICATION_KEY: "test-key",
      },
      "a".repeat(64),
    );
    const calls = commands.mock.calls.map(([call]) => call);
    const args = calls.map((call) => call.args);
    expect(args.findIndex((a) => a.includes("/repository/data"))).toBeLessThan(
      args.findIndex((a) => a.includes("/repository/snapshots")),
    );
    expect(args.at(-1)).toEqual(["cat", "snapshot", "a".repeat(64), "--no-lock"]);
    expect(args.flat()).not.toContain("--overwrite");
    expect(args.flat()).not.toContain("--remove");
    expect(args.flat()).not.toContain("rm");
    expect(JSON.stringify(args)).not.toContain("test-key");
  });
  it("does not publish snapshots after an object upload fails", async () => {
    commands.mockClear();
    commands.mockRejectedValueOnce(new Error("upload failed"));
    await expect(
      publishRepository(
        { commandTimeoutMs: 10000, restic: {} },
        {
          B2_ENDPOINT: "https://example.test",
          B2_BUCKET: "bucket",
          B2_PREFIX: "repo",
          B2_WRITER_KEY_ID: "test-id",
          B2_WRITER_APPLICATION_KEY: "test-key",
        },
        "a".repeat(64),
      ),
    ).rejects.toThrow("upload failed");
    expect(commands).toHaveBeenCalledTimes(1);
  });
});
