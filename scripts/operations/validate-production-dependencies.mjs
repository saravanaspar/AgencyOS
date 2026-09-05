#!/usr/bin/env node
import { connect as connectTcp } from "node:net";
import { fileURLToPath } from "node:url";

import postgres from "postgres";
import { createClient } from "redis";

import {
  assertMatchingPostgresDatabase,
  assertSecurePostgresUrl,
  requiredEnvironment,
} from "../backup/config.mjs";
import { checkObjectStorage } from "../storage/check-object-storage.mjs";

function assertSecurePostgres(value, label, { direct = false } = {}) {
  return assertSecurePostgresUrl(value, label, { direct });
}

async function probePostgres(value) {
  const client = postgres(value, { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 1 });
  try {
    await client`select 1 as ready`;
  } finally {
    await client.end({ timeout: 2 });
  }
}

async function probeClamav(environment) {
  const value = requiredEnvironment("PRIVATE_FILE_SCANNER_URL", environment);
  if (
    value !== "clamav://clamav:3310" ||
    environment.AGENCYOS_TRUST_PRIVATE_SERVICE_NETWORK !== "1"
  ) {
    throw new Error("Production preflight requires the trusted private ClamAV service URL.");
  }
  await new Promise((resolve, reject) => {
    const socket = connectTcp({ host: "clamav", port: 3310 });
    let response = "";
    const timer = setTimeout(
      () => socket.destroy(new Error("ClamAV connection timed out.")),
      5_000,
    );
    socket.once("connect", () => {
      socket.write("zPING\0");
    });
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
      if (response.length > 128) {
        socket.destroy(new Error("ClamAV response exceeded its limit."));
      } else if (response.includes("PONG")) {
        clearTimeout(timer);
        socket.end();
        resolve();
      }
    });
    socket.once("error", reject);
  });
}

export async function validateProductionDependencies(environment = process.env) {
  const agencyRuntime = requiredEnvironment("DATABASE_URL", environment);
  const agencyAdmin = requiredEnvironment("DATABASE_ADMIN_URL", environment);
  const vaultRuntime = requiredEnvironment("VAULTWARDEN_DATABASE_URL", environment);
  const vaultAdmin = requiredEnvironment("VAULTWARDEN_DATABASE_ADMIN_URL", environment);
  assertSecurePostgres(agencyRuntime, "DATABASE_URL");
  assertSecurePostgres(agencyAdmin, "DATABASE_ADMIN_URL", {
    direct: true,
  });
  assertSecurePostgres(vaultRuntime, "VAULTWARDEN_DATABASE_URL");
  assertSecurePostgres(vaultAdmin, "VAULTWARDEN_DATABASE_ADMIN_URL", {
    direct: true,
  });
  const agencyPair = assertMatchingPostgresDatabase(
    agencyRuntime,
    agencyAdmin,
    "AgencyOS PostgreSQL",
  );
  const vaultPair = assertMatchingPostgresDatabase(
    vaultRuntime,
    vaultAdmin,
    "Vaultwarden PostgreSQL",
  );
  if (agencyPair.runtime.identity === vaultPair.runtime.identity) {
    throw new Error("AgencyOS and Vaultwarden must use separate hosted databases.");
  }
  await Promise.all([
    probePostgres(agencyRuntime),
    probePostgres(agencyAdmin),
    probePostgres(vaultRuntime),
    probePostgres(vaultAdmin),
  ]);

  const redisUrl = requiredEnvironment("REDIS_URL", environment);
  const redisParsed = new URL(redisUrl);
  if (
    redisParsed.protocol !== "rediss:" ||
    !redisParsed.username ||
    !redisParsed.password ||
    redisParsed.hash
  ) {
    throw new Error("Remote REDIS_URL must be an authenticated native rediss:// URL.");
  }
  const redis = createClient({
    url: redisUrl,
    socket: { connectTimeout: 10_000 },
    disableOfflineQueue: true,
  });
  try {
    await redis.connect();
    await redis.ping();
  } finally {
    if (redis.isOpen) await redis.quit();
  }
  await checkObjectStorage({ environment, destructiveProbe: true });
  await probeClamav(environment);
  console.log("Production dependencies passed validation.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  validateProductionDependencies().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
