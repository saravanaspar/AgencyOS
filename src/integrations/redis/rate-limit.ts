import "server-only";

import { getRedisClient, reportRedisFailure } from "@/integrations/redis/client";

const RATE_LIMIT_NAME_PATTERN = /^[a-z][a-z0-9:_-]{0,80}$/;

export type RedisRateLimitResult =
  { available: true; allowed: boolean; count: number } | { available: false };

export async function incrementRedisRateLimit(
  name: string,
  identity: string,
  limit: number,
  windowSeconds: number,
): Promise<RedisRateLimitResult> {
  if (!RATE_LIMIT_NAME_PATTERN.test(name)) throw new Error("Redis rate-limit name is invalid.");
  if (!identity || identity.length > 200) throw new Error("Redis rate-limit identity is invalid.");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
    throw new Error("Redis rate-limit maximum is invalid.");
  }
  if (!Number.isSafeInteger(windowSeconds) || windowSeconds < 1 || windowSeconds > 3_600) {
    throw new Error("Redis rate-limit window is invalid.");
  }

  const client = await getRedisClient();
  if (!client) return { available: false };
  const bucket = Math.floor(Date.now() / (windowSeconds * 1_000));
  const key = `rate:${name}:${identity}:${bucket}`;
  try {
    const count = await client.incr(key);
    if (count === 1) await client.expire(key, windowSeconds + 5);
    return { available: true, allowed: count <= limit, count };
  } catch (error) {
    reportRedisFailure(error);
    return { available: false };
  }
}
