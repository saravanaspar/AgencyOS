import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

describe("Redis-backed coordination and caching contracts", () => {
  it("uses bounded, token-safe leases and preserves the database fallback", () => {
    const coordination = source("src/integrations/redis/coordination.ts");
    expect(coordination).toContain("NX: true");
    expect(coordination).toContain("PX: leaseTtl");
    expect(coordination).toContain('redis.call("GET", KEYS[1]) == ARGV[1]');
    expect(coordination).toContain('redis.call("DEL", KEYS[1])');
    expect(coordination).toContain('coordination: "database-fallback"');
    expect(coordination).toContain("pg_try_advisory_lock");
    expect(coordination).toContain("pg_advisory_unlock");
    expect(coordination).toContain("database.reserve()");
    expect(coordination).toContain("MAXIMUM_LEASE_MS");
  });

  it("keeps cache identities hashed, payloads bounded, and TTLs short", () => {
    const cache = source("src/integrations/redis/cache.ts");
    const counters = source("src/modules/identity/server/workspace-counters.ts");
    expect(cache).toContain('createHash("sha256")');
    expect(cache).toContain("MAX_CACHE_TTL_SECONDS = 300");
    expect(cache).toContain("512 * 1024");
    expect(cache).toContain("Buffer.byteLength");
    expect(cache).toContain("removeInvalidCacheEntry");
    expect(cache).toContain("JSON.stringify(identity)");
    expect(counters).toContain("WORKSPACE_COUNTER_TTL_SECONDS = 4");
    expect(counters).toContain("readThroughRedisJsonCache");
    expect(counters).toContain("invalidateRedisJsonCache");
  });

  it("preserves Redis-specific error classes in fallback warnings", () => {
    const client = source("src/integrations/redis/client.ts");
    expect(client).toContain("error.constructor?.name");
    expect(client).toContain("Redis operation failed; using database-safe fallback");
    expect(client).not.toContain("Redis unavailable; using database-safe fallback");
    expect(client.indexOf("if (connecting) return connecting")).toBeLessThan(
      client.indexOf("const existing = globalThis.__agencyOsRedisClient"),
    );
    expect(client).not.toContain("socketTimeout:");
  });

  it("does not cache authentication claims or effective permission grants", () => {
    const access = source("src/modules/identity/server/get-current-access-context.ts");
    const counters = source("src/modules/identity/server/workspace-counters.ts");
    expect(access).toContain("getCurrentIdentitySession");
    expect(access).toContain("getWorkspaceCounters");
    expect(counters).not.toContain("permissionRows");
    expect(counters).not.toContain("user_metadata");
  });
});
