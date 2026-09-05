import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";

export const migrationsDirectory = path.join(process.cwd(), "database", "migrations");

function isLocalDatabaseHost(hostname) {
  const normalizedHostname = hostname.replace(/^\[|\]$/g, "");
  return ["127.0.0.1", "localhost", "::1"].includes(normalizedHostname);
}

export function getAdminDatabaseUrl() {
  const adminUrl = process.env.DATABASE_ADMIN_URL?.trim();
  if (adminUrl) return adminUrl;

  const runtimeUrl = process.env.DATABASE_URL?.trim();
  if (!runtimeUrl) {
    throw new Error("Set DATABASE_ADMIN_URL to a direct PostgreSQL connection string.");
  }

  const parsed = new URL(runtimeUrl);
  const localHost = isLocalDatabaseHost(parsed.hostname);
  if (!localHost) {
    throw new Error(
      "DATABASE_ADMIN_URL is required for remote migrations. Keep DATABASE_URL for pooled runtime traffic.",
    );
  }
  return runtimeUrl;
}

export function redactDatabaseUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.password) parsed.password = "***";
    if (parsed.username) parsed.username = `${parsed.username.slice(0, 2)}***`;
    return parsed.toString();
  } catch {
    return "<invalid database url>";
  }
}

export function isLikelyPooledUrl(value) {
  const parsed = new URL(value);
  const port = parsed.port || "5432";
  return (
    parsed.hostname.includes("-pooler.") ||
    parsed.hostname.includes(".pooler.") ||
    port === "6543" ||
    parsed.searchParams.get("pgbouncer") === "true"
  );
}

export function assertDirectMigrationUrl(value) {
  if (isLikelyPooledUrl(value)) {
    throw new Error(
      `Refusing pooled migration connection ${redactDatabaseUrl(value)}. Use the provider's direct connection string in DATABASE_ADMIN_URL.`,
    );
  }
}

export function createAdminClient(value) {
  assertDirectMigrationUrl(value);
  return postgres(value, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 8,
    prepare: false,
    onnotice: () => undefined,
  });
}

export async function bootstrapPortableCompatibility(sql) {
  const [existing] = await sql`
    select
      to_regclass('auth.users') is not null as auth_users,
      to_regprocedure('auth.uid()') is not null as auth_uid,
      to_regclass('storage.buckets') is not null as storage_buckets
  `;

  await sql.unsafe(`
    create schema if not exists extensions;
    create schema if not exists auth;
    create schema if not exists storage;
  `);

  await sql.unsafe(`
    do $roles$
    begin
      if pg_catalog.to_regrole('anon') is null then
        create role anon nologin;
      end if;
      if pg_catalog.to_regrole('authenticated') is null then
        create role authenticated nologin;
      end if;
      if pg_catalog.to_regrole('service_role') is null then
        create role service_role nologin;
      end if;
      if pg_catalog.to_regrole('postgres') is null then
        create role postgres nologin;
      end if;
      if not pg_catalog.pg_has_role(current_user, 'postgres', 'MEMBER') then
        execute format('grant postgres to %I', current_user);
      end if;
    end
    $roles$;
  `);

  if (!existing?.auth_users) {
    await sql.unsafe(`
      create table auth.users (
        instance_id uuid,
        id uuid primary key,
        aud varchar(255),
        role varchar(255),
        email varchar(255),
        encrypted_password varchar(255),
        email_confirmed_at timestamptz,
        raw_app_meta_data jsonb not null default '{}'::jsonb,
        raw_user_meta_data jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      comment on table auth.users is 'AgencyOS migration replay compatibility only';
    `);
  }

  if (!existing?.auth_uid) {
    await sql.unsafe(`
      create function auth.uid()
      returns uuid
      language sql
      stable
      as 'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
      comment on function auth.uid() is 'AgencyOS migration replay compatibility only';
    `);
  }

  if (!existing?.storage_buckets) {
    await sql.unsafe(`
      create table storage.buckets (
        id text primary key,
        name text not null,
        public boolean not null default false,
        file_size_limit bigint,
        allowed_mime_types text[]
      );
      comment on table storage.buckets is 'AgencyOS migration replay compatibility only';
    `);
  }

  await sql.unsafe("create extension if not exists pgcrypto with schema extensions");
  await sql.unsafe("create extension if not exists pgtap with schema extensions");
}

export async function cleanupPortableCompatibility(sql) {
  const [state] = await sql`
    select
      case when to_regclass('auth.users') is null then null
        else obj_description(to_regclass('auth.users'), 'pg_class') end as auth_users_comment,
      case when to_regprocedure('auth.uid()') is null then null
        else obj_description(to_regprocedure('auth.uid()'), 'pg_proc') end as auth_uid_comment,
      case when to_regclass('storage.buckets') is null then null
        else obj_description(to_regclass('storage.buckets'), 'pg_class') end as storage_comment
  `;
  const marker = "AgencyOS migration replay compatibility only";

  if (state?.storage_comment === marker) {
    await sql.unsafe("drop table storage.buckets");
    await sql.unsafe("drop schema storage");
  }
  if (state?.auth_uid_comment === marker) {
    await sql.unsafe("drop function auth.uid()");
  }
  if (state?.auth_users_comment === marker) {
    await sql.unsafe("drop table auth.users");
  }
  if (state?.auth_uid_comment === marker || state?.auth_users_comment === marker) {
    await sql.unsafe("drop schema auth");
  }
}

export async function ensureAgencyMigrationHistory(sql) {
  await sql.unsafe(`
    create schema if not exists agency_migrations;
    create table if not exists agency_migrations.schema_migrations (
      version text primary key,
      name text not null,
      checksum text,
      applied_at timestamptz not null default now()
    );
  `);

  const hasSupabaseHistory = await sql`
    select to_regclass('supabase_migrations.schema_migrations') is not null as exists
  `;
  if (!hasSupabaseHistory[0]?.exists) return;

  await sql.unsafe(`
    insert into agency_migrations.schema_migrations (version, name, applied_at)
    select version::text, coalesce(nullif(name, ''), version::text), now()
    from supabase_migrations.schema_migrations
    on conflict (version) do nothing
  `);
}

export async function readMigrationFiles() {
  const names = (await fs.readdir(migrationsDirectory))
    .filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/.test(name))
    .sort();

  return Promise.all(
    names.map(async (fileName) => {
      const match = /^(\d{14})_(.+)\.sql$/.exec(fileName);
      if (!match) throw new Error(`Invalid migration filename: ${fileName}`);
      const sql = await fs.readFile(path.join(migrationsDirectory, fileName), "utf8");
      return {
        version: match[1],
        name: match[2],
        fileName,
        sql,
        checksum: crypto.createHash("sha256").update(sql).digest("hex"),
      };
    }),
  );
}

export async function readAppliedMigrations(sql) {
  const rows = await sql`
    select version, name, checksum, applied_at::text
    from agency_migrations.schema_migrations
    order by version
  `;
  return new Map(rows.map((row) => [row.version, row]));
}

export function connectionEnvironment(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const localHost = isLocalDatabaseHost(parsed.hostname);
  return {
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || "5432",
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
    PGSSLMODE: parsed.searchParams.get("sslmode") || (localHost ? "disable" : "require"),
  };
}
