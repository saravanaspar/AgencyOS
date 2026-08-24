import {
  createAdminClient,
  getAdminDatabaseUrl,
  isLikelyPooledUrl,
  redactDatabaseUrl,
} from "./portable-database.mjs";

const databaseUrl = getAdminDatabaseUrl();
const sql = createAdminClient(databaseUrl);

try {
  const rows = await sql`
    select
      version() as version,
      current_database() as database_name,
      to_regclass('public.identity_accounts') is not null as identity_accounts,
      to_regclass('public.identity_credentials') is not null as identity_credentials,
      to_regclass('public.identity_sessions') is not null as identity_sessions,
      to_regclass('public.identity_verification_tokens') is not null as identity_verification_tokens,
      to_regclass('public.identity_mfa_factors') is not null as identity_mfa_factors,
      to_regclass('agency_migrations.schema_migrations') is not null as migration_history,
      exists(select 1 from pg_extension where extname = 'pgcrypto') as pgcrypto,
      exists(select 1 from pg_extension where extname = 'pgtap') as pgtap,
      to_regclass('auth.users') is not null as legacy_auth_users,
      to_regprocedure('auth.uid()') is not null as legacy_auth_uid,
      to_regclass('storage.buckets') is not null as legacy_storage_buckets,
      (select count(*)::int from pg_constraint
        where contype = 'f' and confrelid = to_regclass('auth.users')) as legacy_auth_fk_count,
      (select count(*)::int
       from pg_proc procedure
       join pg_namespace namespace on namespace.oid = procedure.pronamespace
       where namespace.nspname in ('public', 'private')
         and procedure.prokind in ('f', 'p')
         and (pg_get_functiondef(procedure.oid) like '%auth.uid()%'
           or pg_get_functiondef(procedure.oid) like '%auth.users%')) as legacy_function_ref_count,
      (select count(*)::int
       from pg_views
       where schemaname in ('public', 'private')
         and (definition like '%auth.uid()%'
           or definition like '%auth.users%')) as legacy_view_ref_count,
      (select count(*)::int
       from pg_policies
       where schemaname in ('public', 'private')
         and (coalesce(qual, '') like '%auth.uid()%'
          or coalesce(with_check, '') like '%auth.uid()%'
          or coalesce(qual, '') like '%auth.users%'
          or coalesce(with_check, '') like '%auth.users%')) as legacy_policy_ref_count,
      (select count(distinct membership.user_id)::int
       from public.memberships membership
       join public.identity_accounts account on account.id = membership.user_id
       left join public.identity_credentials credential on credential.user_id = membership.user_id
       where membership.status = 'active'
         and account.disabled_at is null
         and credential.user_id is null) as active_users_without_credentials,
      (select count(distinct membership.user_id)::int
       from public.memberships membership
       join public.identity_accounts account on account.id = membership.user_id
       where membership.status = 'active'
         and account.disabled_at is null
         and account.email like '%@identity.invalid') as active_users_without_login_email
  `;
  const row = rows[0];
  if (!row) throw new Error("Database health query returned no row.");

  console.log(`Admin target: ${redactDatabaseUrl(databaseUrl)}`);
  console.log(`Database: ${row.database_name}`);
  console.log(`PostgreSQL: ${row.version}`);
  console.log(`Pooled admin URL: ${isLikelyPooledUrl(databaseUrl) ? "YES (invalid)" : "no"}`);
  console.log(`identity_accounts: ${row.identity_accounts ? "ready" : "missing"}`);
  console.log(`identity_credentials: ${row.identity_credentials ? "ready" : "missing"}`);
  console.log(`identity_sessions: ${row.identity_sessions ? "ready" : "missing"}`);
  console.log(
    `identity_verification_tokens: ${row.identity_verification_tokens ? "ready" : "missing"}`,
  );
  console.log(`identity_mfa_factors: ${row.identity_mfa_factors ? "ready" : "missing"}`);
  console.log(`agency migration history: ${row.migration_history ? "ready" : "missing"}`);
  console.log(`pgcrypto: ${row.pgcrypto ? "ready" : "missing"}`);
  console.log(`pgTAP: ${row.pgtap ? "ready" : "missing"}`);
  console.log(`legacy auth.users: ${row.legacy_auth_users ? "PRESENT" : "absent"}`);
  console.log(`legacy auth.uid(): ${row.legacy_auth_uid ? "PRESENT" : "absent"}`);
  console.log(`legacy storage.buckets: ${row.legacy_storage_buckets ? "PRESENT" : "absent"}`);
  console.log(`foreign keys targeting legacy auth.users: ${row.legacy_auth_fk_count}`);
  console.log(`functions referencing legacy auth objects: ${row.legacy_function_ref_count}`);
  console.log(`views referencing legacy auth objects: ${row.legacy_view_ref_count}`);
  console.log(`policies referencing legacy auth objects: ${row.legacy_policy_ref_count}`);
  console.log(`active users without local credentials: ${row.active_users_without_credentials}`);
  console.log(`active users without a real login email: ${row.active_users_without_login_email}`);

  if (
    !row.identity_accounts ||
    !row.identity_credentials ||
    !row.identity_sessions ||
    !row.identity_verification_tokens ||
    !row.identity_mfa_factors ||
    !row.migration_history ||
    !row.pgcrypto ||
    !row.pgtap ||
    row.legacy_auth_users ||
    row.legacy_auth_uid ||
    row.legacy_storage_buckets ||
    Number(row.legacy_auth_fk_count) !== 0 ||
    Number(row.legacy_function_ref_count) !== 0 ||
    Number(row.legacy_view_ref_count) !== 0 ||
    Number(row.legacy_policy_ref_count) !== 0 ||
    Number(row.active_users_without_credentials) !== 0 ||
    Number(row.active_users_without_login_email) !== 0
  ) {
    process.exitCode = 2;
  }
} finally {
  await sql.end({ timeout: 5 });
}
