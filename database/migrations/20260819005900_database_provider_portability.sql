-- Transition AgencyOS application data away from the former provider-managed identity schema.
-- This migration is intentionally followed by first_party_auth, which moves authentication itself
-- into AgencyOS-owned PostgreSQL tables. The final database can live on Neon, local PostgreSQL,
-- or another compatible PostgreSQL provider.

set lock_timeout = '10s';
set statement_timeout = '120s';

create schema if not exists agency_migrations;

create table if not exists agency_migrations.schema_migrations (
  version text primary key,
  name text not null,
  checksum text,
  applied_at timestamptz not null default now()
);

-- Preserve existing Supabase CLI migration history when this migration is first
-- applied to the current Supabase database. Generic databases do not have this
-- schema, so the copy is intentionally conditional.
do $history$
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute $copy$
      insert into agency_migrations.schema_migrations (version, name, applied_at)
      select version::text, coalesce(nullif(name, ''), version::text), now()
      from supabase_migrations.schema_migrations
      on conflict (version) do nothing
    $copy$;
  end if;
end
$history$;

insert into agency_migrations.schema_migrations (version, name)
values ('20260819005900', 'database_provider_portability')
on conflict (version) do nothing;

create table if not exists public.identity_accounts (
  id uuid primary key,
  auth_provider text not null default 'supabase',
  provider_subject text not null,
  email text not null,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  disabled_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint identity_accounts_provider_not_blank check (btrim(auth_provider) <> ''),
  constraint identity_accounts_subject_not_blank check (btrim(provider_subject) <> ''),
  constraint identity_accounts_email_not_blank check (btrim(email) <> ''),
  constraint identity_accounts_metadata_object check (jsonb_typeof(raw_user_meta_data) = 'object'),
  unique (auth_provider, provider_subject)
);

create index if not exists identity_accounts_email_idx
  on public.identity_accounts (lower(email));

-- Backfill the application-owned identity mirror from Supabase Auth when the
-- managed auth schema is present. The generic bootstrap also provides a minimal
-- auth.users compatibility table for replaying historical migrations.
do $backfill$
begin
  if to_regclass('auth.users') is not null then
    execute $copy$
      insert into public.identity_accounts (
        id, auth_provider, provider_subject, email, email_confirmed_at,
        raw_user_meta_data, created_at, updated_at
      )
      select
        id,
        'supabase',
        id::text,
        coalesce(nullif(lower(email), ''), id::text || '@identity.invalid'),
        email_confirmed_at,
        coalesce(raw_user_meta_data, '{}'::jsonb),
        coalesce(created_at, now()),
        coalesce(updated_at, now())
      from auth.users
      on conflict (id) do update
      set email = excluded.email,
          email_confirmed_at = coalesce(
            excluded.email_confirmed_at,
            public.identity_accounts.email_confirmed_at
          ),
          raw_user_meta_data = excluded.raw_user_meta_data,
          updated_at = excluded.updated_at
    $copy$;
  end if;
end
$backfill$;

-- Every historical FK that pointed at Supabase's managed auth.users table is
-- re-pointed to the application-owned identity table without changing its
-- original ON DELETE / ON UPDATE semantics.
do $rewire$
declare
  foreign_key record;
  definition text;
begin
  if to_regclass('auth.users') is null then
    raise exception 'auth.users compatibility relation is required before portability migration';
  end if;

  for foreign_key in
    select
      constraint_row.conname,
      constraint_row.conrelid,
      pg_get_constraintdef(constraint_row.oid) as definition
    from pg_constraint as constraint_row
    where constraint_row.contype = 'f'
      and constraint_row.confrelid = 'auth.users'::regclass
  loop
    definition := replace(
      foreign_key.definition,
      'REFERENCES auth.users(id)',
      'REFERENCES public.identity_accounts(id)'
    );

    execute format(
      'alter table %s drop constraint %I',
      foreign_key.conrelid::regclass,
      foreign_key.conname
    );
    execute format(
      'alter table %s add constraint %I %s',
      foreign_key.conrelid::regclass,
      foreign_key.conname,
      definition
    );
  end loop;
end
$rewire$;

create or replace function private.sync_identity_account_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    update public.identity_accounts
    set disabled_at = coalesce(disabled_at, now()), updated_at = now()
    where id = old.id;
    return old;
  end if;

  insert into public.identity_accounts (
    id,
    auth_provider,
    provider_subject,
    email,
    email_confirmed_at,
    raw_user_meta_data,
    disabled_at,
    last_seen_at,
    created_at,
    updated_at
  ) values (
    new.id,
    'supabase',
    new.id::text,
    coalesce(nullif(lower(new.email), ''), new.id::text || '@identity.invalid'),
    new.email_confirmed_at,
    coalesce(new.raw_user_meta_data, '{}'::jsonb),
    null,
    now(),
    coalesce(new.created_at, now()),
    coalesce(new.updated_at, now())
  )
  on conflict (id) do update
  set email = excluded.email,
      email_confirmed_at = coalesce(
        excluded.email_confirmed_at,
        public.identity_accounts.email_confirmed_at
      ),
      raw_user_meta_data = excluded.raw_user_meta_data,
      disabled_at = null,
      last_seen_at = now(),
      updated_at = now();

  return new;
end;
$$;

do $auth_trigger$
begin
  if to_regclass('auth.users') is not null then
    execute 'drop trigger if exists agencyos_auth_user_sync on auth.users';
    execute $trigger$
      create trigger agencyos_auth_user_sync
      after insert or update of email, email_confirmed_at, raw_user_meta_data or delete
      on auth.users
      for each row execute function private.sync_identity_account_from_auth_user()
    $trigger$;
  end if;
end
$auth_trigger$;

-- Organization bootstrap must consult AgencyOS-owned identity state rather than
-- a database-provider-owned auth schema.
create or replace function private.bootstrap_organization(
  p_user_id uuid,
  p_legal_name text,
  p_slug text,
  p_country_code text default null,
  p_timezone text default 'UTC',
  p_default_currency text default 'USD'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_membership_id uuid;
  v_owner_role_id uuid;
begin
  if not exists (
    select 1 from public.identity_accounts
    where id = p_user_id and disabled_at is null
  ) then
    raise exception 'User does not exist';
  end if;

  insert into public.profiles (id)
  values (p_user_id)
  on conflict (id) do nothing;

  insert into public.organizations (
    slug, legal_name, country_code, timezone, default_currency, created_by
  ) values (
    lower(btrim(p_slug)),
    btrim(p_legal_name),
    case when p_country_code is null then null else upper(btrim(p_country_code)) end,
    coalesce(nullif(btrim(p_timezone), ''), 'UTC'),
    upper(btrim(p_default_currency)),
    p_user_id
  )
  returning id into v_organization_id;

  insert into public.memberships (
    organization_id, user_id, status, invitation_accepted_at, activated_at, invited_by
  ) values (
    v_organization_id, p_user_id, 'active', now(), now(), p_user_id
  )
  returning id into v_membership_id;

  insert into public.user_preferences (membership_id)
  values (v_membership_id);

  insert into public.roles (
    organization_id, template_key, key, name, description,
    is_system, is_privileged, created_by
  )
  select
    v_organization_id,
    template.key,
    template.key,
    template.name,
    template.description,
    true,
    template.is_privileged,
    p_user_id
  from public.role_templates as template;

  insert into public.role_permissions (
    role_id, permission_id, scope, conditions, granted_by
  )
  select
    role.id,
    template_permission.permission_id,
    template_permission.scope,
    template_permission.conditions,
    p_user_id
  from public.roles as role
  join public.role_template_permissions as template_permission
    on template_permission.role_template_key = role.template_key
  where role.organization_id = v_organization_id;

  select role.id
  into v_owner_role_id
  from public.roles as role
  where role.organization_id = v_organization_id
    and role.key = 'owner';

  insert into public.membership_roles (membership_id, role_id, assigned_by)
  values (v_membership_id, v_owner_role_id, p_user_id);

  insert into public.audit_events (
    organization_id, actor_user_id, actor_type, action,
    entity_type, entity_id, source, after_state
  ) values (
    v_organization_id,
    p_user_id,
    'user',
    'organization.created',
    'organization',
    v_organization_id::text,
    'system',
    jsonb_build_object(
      'id', v_organization_id,
      'slug', lower(btrim(p_slug)),
      'legal_name', btrim(p_legal_name)
    )
  );

  return v_organization_id;
end;
$$;

create or replace function private.membership_display_name(p_membership_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    employee.preferred_name,
    employee.legal_name,
    profile.display_name,
    nullif(trim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
    split_part(coalesce(identity_account.email, ''), '@', 1),
    'AgencyOS user'
  )
  from public.memberships as membership
  join public.identity_accounts as identity_account on identity_account.id = membership.user_id
  left join public.profiles as profile on profile.id = membership.user_id
  left join public.hr_employee_profiles as employee
    on employee.membership_id = membership.id
   and employee.organization_id = membership.organization_id
  where membership.id = p_membership_id
$$;

alter table public.identity_accounts enable row level security;

revoke all on public.identity_accounts from public, anon, authenticated;
grant all on public.identity_accounts to service_role;
revoke all on function private.sync_identity_account_from_auth_user() from public, anon, authenticated;
revoke all on function private.bootstrap_organization(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function private.membership_display_name(uuid) from public, anon, authenticated;
grant execute on function private.bootstrap_organization(uuid, text, text, text, text, text) to service_role;
grant execute on function private.membership_display_name(uuid) to service_role;

comment on table public.identity_accounts is
  'AgencyOS identity directory introduced during provider cutover; first_party_auth makes it authoritative.';
