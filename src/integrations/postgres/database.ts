import "server-only";

import postgres from "postgres";

import { getDatabaseEnv } from "@/lib/validation/env";

type AgencyDatabaseClient = ReturnType<typeof postgres>;

declare global {
  var __agencyOsDatabaseClient: AgencyDatabaseClient | undefined;
}

/**
 * Provider-neutral AgencyOS application database client.
 *
 * DATABASE_URL may point to Neon, local PostgreSQL, or any compatible managed
 * PostgreSQL instance. Schema migration tooling uses DATABASE_ADMIN_URL separately so
 * pooled runtime connections never need migration privileges.
 */
export function getDatabaseClient() {
  if (!globalThis.__agencyOsDatabaseClient) {
    const environment = getDatabaseEnv();

    globalThis.__agencyOsDatabaseClient = postgres(environment.databaseUrl, {
      max: environment.poolMax,
      idle_timeout: 20,
      connect_timeout: 3,
      connection: {
        statement_timeout: 8_000,
        lock_timeout: 3_000,
        idle_in_transaction_session_timeout: 10_000,
      },
      prepare: false,
      onnotice: () => undefined,
    });
  }

  return globalThis.__agencyOsDatabaseClient;
}

export async function closeDatabaseClient() {
  const databaseClient = globalThis.__agencyOsDatabaseClient;
  globalThis.__agencyOsDatabaseClient = undefined;
  if (databaseClient) {
    await databaseClient.end({ timeout: 5 });
  }
}
