import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (file: string) => readFileSync(join(root, file), "utf8");
const portabilityMigration = source(
  "database/migrations/20260819005900_database_provider_portability.sql",
);
const authMigration = source("database/migrations/20260819006000_first_party_auth.sql");
const identityContextMigration = source(
  "database/migrations/20260819006100_first_party_identity_context.sql",
);
const migrationRunner = source("scripts/database/migrate.mjs");
const portabilityBootstrap = source("scripts/database/portable-database.mjs");
const portabilityRuntime = source("src/integrations/postgres/database.ts");
const credentialsRuntime = source("src/modules/identity/server/credentials.ts");
const packageJson = JSON.parse(source("package.json")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};

function runtimeSources(): string[] {
  const stack = [join(root, "src")];
  const files: string[] = [];
  while (stack.length > 0) {
    const directory = stack.pop();
    if (!directory) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (/\.(?:ts|tsx)$/.test(entry.name)) files.push(fullPath);
    }
  }
  return files.map((file) => readFileSync(file, "utf8"));
}

describe("database and authentication provider portability", () => {
  it("keeps the runtime database client ordinary PostgreSQL", () => {
    expect(portabilityRuntime).toContain("DATABASE_URL");
    expect(portabilityRuntime).not.toContain("createServerClient");
    expect(runtimeSources().every((contents) => !contents.includes("@supabase/"))).toBe(true);
    expect(runtimeSources().every((contents) => !contents.includes("auth.users"))).toBe(true);
  });

  it("owns credentials, sessions, verification tokens, and MFA in AgencyOS", () => {
    for (const table of [
      "identity_credentials",
      "identity_sessions",
      "identity_verification_tokens",
      "identity_mfa_factors",
    ]) {
      expect(authMigration).toContain(`create table public.${table}`);
    }
    expect(credentialsRuntime).toContain("extensions.crypt");
    expect(credentialsRuntime).toContain("extensions.gen_salt");
    expect(authMigration).toContain("auth_provider = 'agencyos'");
    expect(identityContextMigration).toContain("private.current_identity_id()");
    expect(identityContextMigration).toContain("request.identity.id");
  });

  it("re-homes legacy identity foreign keys without rewriting business tables", () => {
    expect(portabilityMigration).toContain("create table if not exists public.identity_accounts");
    expect(portabilityMigration).toContain("REFERENCES public.identity_accounts(id)");
    expect(portabilityMigration).toContain("agency_migrations.schema_migrations");
  });

  it("uses a forward-only provider-neutral migration runner and removes replay shims", () => {
    expect(migrationRunner).toContain("pg_advisory_lock");
    expect(migrationRunner).toContain("checksum");
    expect(migrationRunner).toContain("Forward-only migration history cannot be rewritten");
    expect(migrationRunner).toContain("cleanupPortableCompatibility");
    expect(portabilityBootstrap).toContain("AgencyOS migration replay compatibility only");
    expect(portabilityBootstrap).toContain("cleanupPortableCompatibility");
    expect(portabilityBootstrap).toContain('["127.0.0.1", "localhost", "::1"]');
    expect(portabilityBootstrap).toContain('hostname.replace(/^\\[|\\]$/g, "")');
    expect(portabilityBootstrap).toContain('localHost ? "disable" : "require"');
  });

  it("has no Supabase SDK, CLI, or runtime package dependency", () => {
    const packages = {
      ...(packageJson.dependencies ?? {}),
      ...(packageJson.devDependencies ?? {}),
    };
    expect(
      Object.keys(packages).some((name) => name.startsWith("@supabase/") || name === "supabase"),
    ).toBe(false);
    expect(
      Object.entries(packageJson.scripts ?? {}).some(([name, command]) =>
        /supabase/i.test(`${name} ${command}`),
      ),
    ).toBe(false);
  });

  it("refuses to strand active users without first-party credentials during provider copy", () => {
    const copy = source("scripts/database/copy-database.mjs");
    const doctor = source("scripts/database/doctor.mjs");
    expect(copy).toContain("legacy_app_function_ref_count");
    expect(copy).toContain("legacy_app_view_ref_count");
    expect(copy).toContain("legacy_app_policy_ref_count");
    expect(copy).toContain("active_users_without_credentials");
    expect(copy).toContain("active_users_without_login_email");
    expect(copy).toContain("AGENCYOS_ALLOW_PASSWORD_RESET_USERS");
    expect(copy).toContain("Complete password reset for those users before cutover");
    expect(doctor).toContain("active_users_without_credentials");
    expect(doctor).toContain("active_users_without_login_email");
  });

  it("bootstraps only extensions and temporary legacy objects needed to replay history", () => {
    expect(portabilityBootstrap).toContain("create extension if not exists pgcrypto");
    expect(portabilityBootstrap).toContain("create extension if not exists pgtap");
    expect(portabilityBootstrap).toContain("drop table auth.users");
    expect(portabilityBootstrap).toContain("drop table storage.buckets");
  });
});
