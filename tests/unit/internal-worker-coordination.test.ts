import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runWithRedisLease: vi.fn(),
  incrementRedisRateLimit: vi.fn(),
}));

vi.mock("@/integrations/redis/coordination", () => ({
  runWithRedisLease: mocks.runWithRedisLease,
}));
vi.mock("@/integrations/redis/rate-limit", () => ({
  incrementRedisRateLimit: mocks.incrementRedisRateLimit,
}));

const { runWithRedisLease, incrementRedisRateLimit } = mocks;

import { runInternalWorkerRequest } from "@/lib/server/internal-worker";

beforeEach(() => {
  vi.clearAllMocks();
  incrementRedisRateLimit.mockResolvedValue({ available: true, allowed: true });
  runWithRedisLease.mockImplementation(async (_options, execute) => ({
    executed: true,
    coordination: "redis",
    value: await execute(),
  }));
});

const configuredSecret = "a".repeat(64);

function workerRequest(secret = configuredSecret) {
  return new Request("https://agency.example.test/api/internal/example", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });
}

describe("internal worker coordination", () => {
  it("rejects missing configuration and invalid bearer credentials before execution", async () => {
    const execute = vi.fn(async () => ({ processed: 1 }));
    const unconfigured = await runInternalWorkerRequest({
      request: workerRequest(),
      secret: undefined,
      leaseName: "example",
      execute,
      notConfiguredMessage: "Not configured.",
      unavailableMessage: "Unavailable.",
    });
    expect(unconfigured.status).toBe(503);

    const unauthorized = await runInternalWorkerRequest({
      request: workerRequest("wrong"),
      secret: configuredSecret,
      leaseName: "example",
      execute,
      notConfiguredMessage: "Not configured.",
      unavailableMessage: "Unavailable.",
    });
    expect(unauthorized.status).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });

  it("runs authorized work under the shared rate limit and lease", async () => {
    const execute = vi.fn(async () => ({ processed: 2 }));
    const response = await runInternalWorkerRequest({
      request: workerRequest(),
      secret: configuredSecret,
      leaseName: "example",
      execute,
      notConfiguredMessage: "Not configured.",
      unavailableMessage: "Unavailable.",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      summary: { processed: 2 },
      coordination: "redis",
    });
    expect(incrementRedisRateLimit).toHaveBeenCalledOnce();
    expect(runWithRedisLease).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
  });

  it("returns explicit responses for rate limits and an already-running lease", async () => {
    incrementRedisRateLimit.mockResolvedValueOnce({ available: true, allowed: false });
    const limited = await runInternalWorkerRequest({
      request: workerRequest(),
      secret: configuredSecret,
      leaseName: "example",
      execute: vi.fn(),
      notConfiguredMessage: "Not configured.",
      unavailableMessage: "Unavailable.",
    });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");

    incrementRedisRateLimit.mockResolvedValueOnce({ available: true, allowed: true });
    runWithRedisLease.mockResolvedValueOnce({ executed: false, coordination: "redis" });
    const skipped = await runInternalWorkerRequest({
      request: workerRequest(),
      secret: configuredSecret,
      leaseName: "example",
      execute: vi.fn(),
      notConfiguredMessage: "Not configured.",
      unavailableMessage: "Unavailable.",
    });
    expect(skipped.status).toBe(202);
    await expect(skipped.json()).resolves.toMatchObject({ ok: true, skipped: "already-running" });
  });
});
