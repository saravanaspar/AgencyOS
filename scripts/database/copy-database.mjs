import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import postgres from "postgres";

import {
  assertDirectMigrationUrl,
  bootstrapPortableCompatibility,
  cleanupPortableCompatibility,
  connectionEnvironment,
  redactDatabaseUrl,
} from "./portable-database.mjs";

const sourceUrl = process.env.SOURCE_DATABASE_ADMIN_URL?.trim();
const targetUrl = process.env.TARGET_DATABASE_ADMIN_URL?.trim();
const confirmation = process.env.AGENCYOS_DATABASE_COPY_CONFIRM?.trim();

if (!sourceUrl || !targetUrl) {
  throw new Error(
    "Set SOURCE_DATABASE_ADMIN_URL and TARGET_DATABASE_ADMIN_URL to direct PostgreSQL URLs.",
  );
}
if (confirmation !== "COPY_TO_EMPTY_TARGET") {
  throw new Error(
    "Set AGENCYOS_DATABASE_COPY_CONFIRM=COPY_TO_EMPTY_TARGET after confirming the target database contains no AgencyOS data.",
  );
}
assertDirectMigrationUrl(sourceUrl);
assertDirectMigrationUrl(targetUrl);
if (sourceUrl === targetUrl) throw new Error("Source and target database URLs are identical.");

for (const command of ["pg_dump", "pg_restore"]) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `${command} is required. Install PostgreSQL client tools before copying the database.`,
    );
  }
}

const source = postgres(sourceUrl, { max: 1, prepare: false, onnotice: () => undefined });
const target = postgres(targetUrl, { max: 1, prepare: false, onnotice: () => undefined });
const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "agencyos-db-copy-"));
const dumpPath = path.join(temporaryDirectory, "agencyos.dump");

async function tableCount(client, relation) {
  const rows = await client.unsafe(`select count(*)::bigint as count from ${relation}`);
  return Number(rows[0]?.count ?? 0);
}

try {
  const sourceState = await source`
    select
      to_regclass('public.identity_accounts') is not null as identity_ready,
      to_regclass('agency_migrations.schema_migrations') is not null as history_ready,
      to_regclass('public.identity_credentials') is not null as credentials_ready,
      exists(select 1 from agency_migrations.schema_migrations where version = '20260819006100') as identity_context_ready,
      (select count(*)::int from pg_constraint
        where contype = 'f' and confrelid = to_regclass('auth.users')) as legacy_auth_fk_count,
      (select count(*)::int
       from pg_proc procedure
       join pg_namespace namespace on namespace.oid = procedure.pronamespace
       where namespace.nspname in ('public', 'private')
         and procedure.prokind in ('f', 'p')
         and (pg_get_functiondef(procedure.oid) like '%auth.uid()%'
           or pg_get_functiondef(procedure.oid) like '%auth.users%')) as legacy_app_function_ref_count,
      (select count(*)::int
       from pg_views
       where schemaname in ('public', 'private')
         and (definition like '%auth.uid()%'
           or definition like '%auth.users%')) as legacy_app_view_ref_count,
      (select count(*)::int
       from pg_policies
       where schemaname in ('public', 'private')
         and (coalesce(qual, '') like '%auth.uid()%'
           or coalesce(with_check, '') like '%auth.uid()%'
           or coalesce(qual, '') like '%auth.users%'
           or coalesce(with_check, '') like '%auth.users%')) as legacy_app_policy_ref_count
  `;
  if (
    !sourceState[0]?.identity_ready ||
    !sourceState[0]?.history_ready ||
    !sourceState[0]?.credentials_ready ||
    !sourceState[0]?.identity_context_ready ||
    Number(sourceState[0]?.legacy_auth_fk_count ?? 0) !== 0 ||
    Number(sourceState[0]?.legacy_app_function_ref_count ?? 0) !== 0 ||
    Number(sourceState[0]?.legacy_app_view_ref_count ?? 0) !== 0 ||
    Number(sourceState[0]?.legacy_app_policy_ref_count ?? 0) !== 0
  ) {
    throw new Error(
      "Source is not cutover-ready. Apply all AgencyOS migrations, including first_party_auth and first_party_identity_context, before copying.",
    );
  }

  const [credentialReadiness] = await source`
    select
      count(distinct membership.user_id) filter (
        where credential.user_id is null
      )::int as active_users_without_credentials,
      count(distinct membership.user_id) filter (
        where account.email like '%@identity.invalid'
      )::int as active_users_without_login_email
    from public.memberships membership
    join public.identity_accounts account on account.id = membership.user_id
    left join public.identity_credentials credential on credential.user_id = membership.user_id
    where membership.status = 'active'
      and account.disabled_at is null
  `;
  const usersRequiringReset = Number(credentialReadiness?.active_users_without_credentials ?? 0);
  const usersWithoutLoginEmail = Number(credentialReadiness?.active_users_without_login_email ?? 0);
  if (usersWithoutLoginEmail > 0) {
    throw new Error(
      `${usersWithoutLoginEmail} active user${usersWithoutLoginEmail === 1 ? "" : "s"} ` +
        "do not have a real login email address. Assign a valid email before cutover; " +
        "AgencyOS will not copy a configuration that would permanently strand those users.",
    );
  }
  if (usersRequiringReset > 0) {
    const message =
      `${usersRequiringReset} active user${usersRequiringReset === 1 ? "" : "s"} ` +
      "do not have an AgencyOS password credential. This can happen for social/OAuth-only accounts " +
      "or unsupported legacy password hashes. Complete password reset for those users before cutover, " +
      "or set AGENCYOS_ALLOW_PASSWORD_RESET_USERS=1 to proceed knowingly.";
    if (process.env.AGENCYOS_ALLOW_PASSWORD_RESET_USERS !== "1") {
      throw new Error(message);
    }
    console.warn(`WARNING: ${message}`);
  } else {
    console.log("Credential readiness: every active user has an AgencyOS password credential.");
  }

  const targetState = await target`
    select to_regclass('public.organizations') is not null as organizations_exists
  `;
  if (targetState[0]?.organizations_exists) {
    throw new Error(
      "Target already contains AgencyOS schema/data. Copy only into a new empty database to avoid destructive merges.",
    );
  }

  console.log(`Source: ${redactDatabaseUrl(sourceUrl)}`);
  console.log(`Target: ${redactDatabaseUrl(targetUrl)}`);
  console.log("Bootstrapping target compatibility objects ...");
  await bootstrapPortableCompatibility(target);

  const dump = spawnSync(
    "pg_dump",
    [
      "--format=custom",
      "--no-owner",
      "--schema=public",
      "--schema=private",
      "--schema=agency_migrations",
      `--file=${dumpPath}`,
    ],
    {
      env: { ...process.env, ...connectionEnvironment(sourceUrl) },
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  if (dump.status !== 0) throw new Error(`pg_dump failed:\n${dump.stderr || dump.stdout}`);

  const targetEnvironment = connectionEnvironment(targetUrl);
  const restore = spawnSync(
    "pg_restore",
    ["--exit-on-error", "--no-owner", "--dbname", targetEnvironment.PGDATABASE, dumpPath],
    {
      env: { ...process.env, ...targetEnvironment },
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  if (restore.status !== 0) {
    throw new Error(`pg_restore failed:\n${restore.stderr || restore.stdout}`);
  }

  await cleanupPortableCompatibility(target);

  const relations = [
    "public.identity_accounts",
    "public.identity_credentials",
    "public.organizations",
    "public.memberships",
    "public.projects",
    "public.finance_invoices",
  ];
  for (const relation of relations) {
    const [sourceCount, targetCount] = await Promise.all([
      tableCount(source, relation),
      tableCount(target, relation),
    ]);
    if (sourceCount !== targetCount) {
      throw new Error(
        `Verification failed for ${relation}: source=${sourceCount}, target=${targetCount}.`,
      );
    }
    console.log(`Verified ${relation}: ${targetCount} row${targetCount === 1 ? "" : "s"}.`);
  }

  console.log("AgencyOS database copy completed and verified.");
} finally {
  await Promise.allSettled([source.end({ timeout: 5 }), target.end({ timeout: 5 })]);
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
}
