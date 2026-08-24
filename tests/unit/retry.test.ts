import { afterEach, describe, expect, it, vi } from "vitest";

import { isRetryableInfrastructureError, withInfrastructureRetry } from "@/lib/server/retry";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("bounded infrastructure retry", () => {
  it("retries a transient failure once and returns the successful result", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(Object.assign(new Error("connection timeout"), { code: "ETIMEDOUT" }))
      .mockResolvedValue("ready");

    await expect(withInfrastructureRetry(operation, { attempts: 2, baseDelayMs: 0 })).resolves.toBe(
      "ready",
    );
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not retry permanent failures", async () => {
    const operation = vi.fn<() => Promise<void>>().mockRejectedValue(new Error("invalid input"));

    await expect(
      withInfrastructureRetry(operation, { attempts: 3, baseDelayMs: 0 }),
    ).rejects.toThrow("invalid input");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("recognizes retryable database and network failures", () => {
    expect(isRetryableInfrastructureError({ code: "08006" })).toBe(true);
    expect(isRetryableInfrastructureError(new Error("Network error while loading"))).toBe(true);
    expect(isRetryableInfrastructureError(new Error("permission denied"))).toBe(false);
  });

  it("redacts connection strings from terminal diagnostics", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const failure = new Error(
      "connection closed for postgresql://admin:super-secret@db.example.test:5432/agencyos",
    );

    await expect(
      withInfrastructureRetry(() => Promise.reject(failure), {
        attempts: 1,
        baseDelayMs: 0,
        operationName: "Protected lookup",
      }),
    ).rejects.toThrow("connection closed");

    const serializedWarning = JSON.stringify(warning.mock.calls);
    expect(serializedWarning).toContain("[database-url-redacted]");
    expect(serializedWarning).not.toContain("super-secret");
  });
});
