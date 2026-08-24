import "server-only";

import { createHash } from "node:crypto";

import { getRedisClient, reportRedisFailure } from "@/integrations/redis/client";

const MAX_CACHE_TTL_SECONDS = 300;
const DEFAULT_MAXIMUM_BYTES = 16 * 1024;
const CACHE_NAMESPACE_PATTERN = /^[a-z][a-z0-9:_-]{0,80}$/;

export interface RedisJsonCacheOptions<T> {
  namespace: string;
  identity: readonly string[];
  ttlSeconds: number;
  parse: (value: unknown) => T | null;
  maximumBytes?: number;
}

function normalizedTtl(ttlSeconds: number): number {
  if (!Number.isFinite(ttlSeconds)) return 1;
  return Math.min(MAX_CACHE_TTL_SECONDS, Math.max(1, Math.floor(ttlSeconds)));
}

function normalizedMaximumBytes(maximumBytes: number | undefined): number {
  if (!Number.isSafeInteger(maximumBytes) || (maximumBytes ?? 0) < 1) {
    return DEFAULT_MAXIMUM_BYTES;
  }
  return Math.min(maximumBytes ?? DEFAULT_MAXIMUM_BYTES, 512 * 1024);
}

export function createRedisCacheKey(namespace: string, identity: readonly string[]): string {
  if (!CACHE_NAMESPACE_PATTERN.test(namespace)) {
    throw new Error("Redis cache namespace is invalid.");
  }
  if (identity.length === 0 || identity.some((value) => !value)) {
    throw new Error("Redis cache identity is invalid.");
  }
  const digest = createHash("sha256").update(JSON.stringify(identity)).digest("hex");
  return `cache:${namespace}:${digest}`;
}

async function removeInvalidCacheEntry(
  client: NonNullable<Awaited<ReturnType<typeof getRedisClient>>>,
  key: string,
): Promise<void> {
  try {
    await client.del(key);
  } catch (error) {
    reportRedisFailure(error);
  }
}

export async function readThroughRedisJsonCache<T>(
  options: RedisJsonCacheOptions<T>,
  loader: () => Promise<T>,
): Promise<T> {
  const key = createRedisCacheKey(options.namespace, options.identity);
  const maximumBytes = normalizedMaximumBytes(options.maximumBytes);
  const client = await getRedisClient();

  if (client) {
    try {
      const cached = await client.get(key);
      if (cached) {
        if (Buffer.byteLength(cached, "utf8") > maximumBytes) {
          await removeInvalidCacheEntry(client, key);
        } else {
          let decoded: unknown;
          try {
            decoded = JSON.parse(cached) as unknown;
          } catch {
            await removeInvalidCacheEntry(client, key);
            decoded = null;
          }
          const parsed = decoded === null ? null : options.parse(decoded);
          if (parsed !== null) return parsed;
          if (decoded !== null) await removeInvalidCacheEntry(client, key);
        }
      }
    } catch (error) {
      reportRedisFailure(error);
      // Cache failures never replace the database as the source of truth.
    }
  }

  const loaded = await loader();
  if (!client) return loaded;

  try {
    const serialized = JSON.stringify(loaded);
    if (typeof serialized === "string" && Buffer.byteLength(serialized, "utf8") <= maximumBytes) {
      await client.set(key, serialized, { EX: normalizedTtl(options.ttlSeconds) });
    }
  } catch (error) {
    reportRedisFailure(error);
    // A successful database read must not fail because Redis is unavailable.
  }
  return loaded;
}

export async function invalidateRedisJsonCache(
  namespace: string,
  identity: readonly string[],
): Promise<void> {
  const client = await getRedisClient();
  if (!client) return;
  try {
    await client.del(createRedisCacheKey(namespace, identity));
  } catch (error) {
    reportRedisFailure(error);
    // Short TTLs keep stale display-only values bounded when invalidation cannot run.
  }
}

export async function getRedisCacheVersion(
  namespace: string,
  identity: readonly string[],
): Promise<number> {
  const client = await getRedisClient();
  if (!client) return 0;
  const key = createRedisCacheKey(`${namespace}:version`, identity);
  try {
    const value = await client.get(key);
    const parsed = Number(value ?? 0);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
  } catch (error) {
    reportRedisFailure(error);
    return 0;
  }
}

export async function bumpRedisCacheVersion(
  namespace: string,
  identity: readonly string[],
): Promise<void> {
  const client = await getRedisClient();
  if (!client) return;
  const key = createRedisCacheKey(`${namespace}:version`, identity);
  try {
    const transaction = client.multi();
    transaction.incr(key);
    transaction.expire(key, 86_400);
    await transaction.exec();
  } catch (error) {
    reportRedisFailure(error);
  }
}
