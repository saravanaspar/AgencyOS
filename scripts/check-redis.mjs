import { randomUUID } from "node:crypto";
import process from "node:process";

import { createClient } from "redis";

const redisUrl = process.env.REDIS_URL?.trim();
if (!redisUrl) {
  console.error("REDIS_URL is not configured.");
  process.exit(1);
}

let parsed;
try {
  parsed = new URL(redisUrl);
} catch {
  console.error("REDIS_URL is not a valid URL.");
  process.exit(1);
}
if (!["redis:", "rediss:"].includes(parsed.protocol)) {
  console.error("REDIS_URL must use redis:// or rediss://.");
  process.exit(1);
}

const client = createClient({
  url: redisUrl,
  name: "agencyos-diagnostic",
  disableOfflineQueue: true,
  commandsQueueMaxLength: 10,
  socket: {
    connectTimeout: 2_000,
    socketTimeout: 2_000,
    reconnectStrategy: false,
  },
});
client.on("error", () => undefined);

const key = `agencyos:v1:diagnostic:${randomUUID()}`;
try {
  await client.connect();
  const pong = await client.ping();
  if (pong !== "PONG") throw new Error("PING failed");
  await client.set(key, "ok", { PX: 5_000, NX: true });
  const value = await client.get(key);
  await client.del(key);
  if (value !== "ok") throw new Error("Read/write check failed");
  console.log("Redis connection, authentication, read, write, TTL, and delete checks passed.");
} catch (error) {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  console.error("Redis check failed.", { code: typeof code === "string" ? code : null });
  process.exitCode = 1;
} finally {
  try {
    client.destroy();
  } catch {
    // The connection may already be closed.
  }
}
