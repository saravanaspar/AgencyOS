import "server-only";

import { randomUUID } from "node:crypto";

import { getRedisClient, reportRedisFailure } from "@/integrations/redis/client";
import { getDatabaseClient } from "@/integrations/postgres/database";

const LEASE_NAME_PATTERN = /^[a-z][a-z0-9:_-]{0,80}$/;
const MINIMUM_LEASE_MS = 1_000;
const MAXIMUM_LEASE_MS = 5 * 60_000;
const RELEASE_LEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

export type CoordinationMode = "redis" | "database-fallback";

export type RedisLeaseResult<T> =
  | { executed: true; coordination: CoordinationMode; value: T }
  | { executed: false; coordination: CoordinationMode };

export interface RedisLeaseOptions {
  name: string;
  ttlMs?: number;
}

function validatedLeaseName(name: string): string {
  if (!LEASE_NAME_PATTERN.test(name)) throw new Error("Redis lease name is invalid.");
  return name;
}

function leaseKey(name: string): string {
  return `lease:${validatedLeaseName(name)}`;
}

function leaseTtl(ttlMs: number | undefined): number {
  if (!Number.isFinite(ttlMs)) return 65_000;
  return Math.min(MAXIMUM_LEASE_MS, Math.max(MINIMUM_LEASE_MS, Math.floor(ttlMs ?? 65_000)));
}

/**
 * PostgreSQL is the correctness fallback when Redis is unavailable. A session-level
 * advisory lock is held on one reserved connection for the full operation so a
 * second process cannot execute the same worker concurrently.
 */
async function runWithDatabaseLease<T>(
  name: string,
  operation: () => Promise<T>,
): Promise<RedisLeaseResult<T>> {
  const database = getDatabaseClient();
  const reserved = await database.reserve();
  const lockName = `agencyos:${validatedLeaseName(name)}`;
  let acquired = false;
  try {
    const rows = await reserved<Array<{ acquired: boolean }>>`
      select pg_try_advisory_lock(hashtextextended(${lockName}, 0)) as acquired
    `;
    acquired = rows[0]?.acquired === true;
    if (!acquired) return { executed: false, coordination: "database-fallback" };
    return { executed: true, coordination: "database-fallback", value: await operation() };
  } finally {
    if (acquired) {
      try {
        await reserved`select pg_advisory_unlock(hashtextextended(${lockName}, 0))`;
      } catch {
        // Releasing the reserved connection also releases session advisory locks.
      }
    }
    await reserved.release();
  }
}

export async function runWithRedisLease<T>(
  options: RedisLeaseOptions,
  operation: () => Promise<T>,
): Promise<RedisLeaseResult<T>> {
  const client = await getRedisClient();
  if (!client) return runWithDatabaseLease(options.name, operation);

  const key = leaseKey(options.name);
  const token = randomUUID();
  let acquired: string | null;
  try {
    acquired = await client.set(key, token, { NX: true, PX: leaseTtl(options.ttlMs) });
  } catch (error) {
    reportRedisFailure(error);
    return runWithDatabaseLease(options.name, operation);
  }

  if (acquired !== "OK") return { executed: false, coordination: "redis" };

  try {
    return { executed: true, coordination: "redis", value: await operation() };
  } finally {
    try {
      await client.eval(RELEASE_LEASE_SCRIPT, { keys: [key], arguments: [token] });
    } catch (error) {
      reportRedisFailure(error);
      // The lease has a bounded TTL. Never release another worker's replacement token.
    }
  }
}
