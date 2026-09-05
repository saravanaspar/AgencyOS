import "server-only";

import { createClient, type RedisClientType } from "redis";

import { getRedisEnv } from "@/lib/validation/env";

type AgencyRedisClient = RedisClientType;

const WARNING_INTERVAL_MS = 60_000;
const RETRY_COOLDOWN_MS = 5 * 60_000;
let lastWarningAt = 0;

declare global {
  var __agencyOsRedisClient: AgencyRedisClient | undefined;
  var __agencyOsRedisConnectPromise: Promise<AgencyRedisClient | null> | undefined;
  var __agencyOsRedisRetryAfter: number | undefined;
}

export function safeRedisError(error: unknown): { code: string | null; name: string } {
  if (!error || typeof error !== "object") return { code: null, name: "UnknownError" };
  const code = "code" in error ? Reflect.get(error, "code") : null;
  const explicitName = "name" in error ? Reflect.get(error, "name") : null;
  const constructorName = error.constructor?.name;
  const name =
    typeof explicitName === "string" && explicitName !== "Error"
      ? explicitName
      : typeof constructorName === "string" && constructorName
        ? constructorName
        : "Error";
  return {
    code: typeof code === "string" ? code.slice(0, 40) : null,
    name: name.slice(0, 80),
  };
}

export function reportRedisFailure(error: unknown) {
  globalThis.__agencyOsRedisRetryAfter = Date.now() + RETRY_COOLDOWN_MS;
  const now = Date.now();
  if (now - lastWarningAt < WARNING_INTERVAL_MS) return;
  lastWarningAt = now;
  console.warn(
    "[AgencyOS] Redis operation failed; using database-safe fallback.",
    safeRedisError(error),
  );
}

function destroyClient(client: AgencyRedisClient) {
  try {
    client.destroy();
  } catch {
    // The client may already be closed. The next request will create a fresh client.
  }
}

async function connectRedisClient(): Promise<AgencyRedisClient | null> {
  let environment: ReturnType<typeof getRedisEnv>;
  try {
    environment = getRedisEnv();
  } catch (error) {
    reportRedisFailure(error);
    return null;
  }
  if (!environment) return null;

  const client = createClient({
    url: environment.redisUrl,
    name: "agencyos",
    keyPrefix: "agencyos:v1:",
    disableOfflineQueue: true,
    commandsQueueMaxLength: 100,
    socket: {
      connectTimeout: 750,
      reconnectStrategy: false,
    },
  });

  client.on("error", reportRedisFailure);
  globalThis.__agencyOsRedisClient = client;

  try {
    await client.connect();
    globalThis.__agencyOsRedisRetryAfter = undefined;
    return client;
  } catch (error) {
    reportRedisFailure(error);
    destroyClient(client);
    if (globalThis.__agencyOsRedisClient === client) {
      globalThis.__agencyOsRedisClient = undefined;
    }
    return null;
  }
}

export async function getRedisClient(): Promise<AgencyRedisClient | null> {
  if ((globalThis.__agencyOsRedisRetryAfter ?? 0) > Date.now()) return null;

  // Concurrent requests can arrive after connectRedisClient has published the
  // client but before node-redis marks it ready. Reuse that in-flight promise;
  // destroying the not-yet-ready client here aborts every waiter with
  // ClientClosedError and unnecessarily activates the fail-safe cooldown.
  const connecting = globalThis.__agencyOsRedisConnectPromise;
  if (connecting) return connecting;

  const existing = globalThis.__agencyOsRedisClient;
  if (existing?.isReady) return existing;
  if (existing) {
    destroyClient(existing);
    if (globalThis.__agencyOsRedisClient === existing) {
      globalThis.__agencyOsRedisClient = undefined;
    }
  }

  if (!globalThis.__agencyOsRedisConnectPromise) {
    globalThis.__agencyOsRedisConnectPromise = connectRedisClient().finally(() => {
      globalThis.__agencyOsRedisConnectPromise = undefined;
    });
  }

  return globalThis.__agencyOsRedisConnectPromise;
}

export async function closeRedisClient(): Promise<void> {
  const client = globalThis.__agencyOsRedisClient;
  globalThis.__agencyOsRedisClient = undefined;
  globalThis.__agencyOsRedisConnectPromise = undefined;
  globalThis.__agencyOsRedisRetryAfter = undefined;
  if (!client) return;
  destroyClient(client);
}
