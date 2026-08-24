-- Complete CRM connector lifecycle: OAuth, incremental checkpoints, schedules, health, and alerts.

set lock_timeout = '10s';
set statement_timeout = '120s';

alter table public.crm_import_connections
  add column auth_method text not null default 'manual',
  add column sync_enabled boolean not null default false,
  add column sync_interval_minutes integer not null default 60,
  add column next_sync_at timestamptz,
  add column sync_checkpoint jsonb not null default '{}'::jsonb,
  add column sync_cursor jsonb not null default '{}'::jsonb,
  add column sync_claimed_until timestamptz,
  add column consecutive_failures integer not null default 0,
  add column backoff_until timestamptz,
  add column last_rate_limited_at timestamptz,
  add column last_health_check_at timestamptz,
  add column last_health_status text not null default 'unknown',
  add column last_health_message text,
  add column credential_version integer not null default 1,
  add column credentials_expires_at timestamptz,
  add column last_credentials_rotated_at timestamptz;

alter table public.crm_import_connections
  add constraint crm_import_connections_auth_method_valid
    check (auth_method in ('manual', 'oauth', 'webhook_secret')),
  add constraint crm_import_connections_sync_interval_valid
    check (sync_interval_minutes in (15, 30, 60, 360, 720, 1440)),
  add constraint crm_import_connections_sync_checkpoint_object
    check (jsonb_typeof(sync_checkpoint) = 'object'),
  add constraint crm_import_connections_sync_cursor_object
    check (jsonb_typeof(sync_cursor) = 'object'),
  add constraint crm_import_connections_failure_count_nonnegative
    check (consecutive_failures >= 0),
  add constraint crm_import_connections_credential_version_positive
    check (credential_version > 0),
  add constraint crm_import_connections_health_status_valid
    check (last_health_status in ('unknown', 'healthy', 'degraded', 'unhealthy')),
  add constraint crm_import_connections_schedule_pull_only
    check (not sync_enabled or mode = 'pull');

update public.crm_import_connections
set auth_method = case
  when mode = 'webhook' then 'webhook_secret'
  when encrypted_credentials is not null then 'manual'
  else 'oauth'
end,
next_sync_at = case
  when mode = 'pull' and sync_enabled then now()
  else null
end;

create index crm_import_connections_due_sync_idx
  on public.crm_import_connections (next_sync_at, backoff_until)
  where mode = 'pull' and sync_enabled = true and status <> 'paused';

create table public.crm_connection_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.crm_import_connections(id) on delete cascade,
  severity text not null default 'warning',
  code text not null,
  message text not null,
  status text not null default 'open',
  occurrence_count integer not null default 1,
  first_occurred_at timestamptz not null default now(),
  last_occurred_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by_membership_id uuid references public.memberships(id) on delete set null,
  constraint crm_connection_notifications_severity_valid
    check (severity in ('info', 'warning', 'error')),
  constraint crm_connection_notifications_status_valid
    check (status in ('open', 'acknowledged', 'resolved')),
  constraint crm_connection_notifications_code_not_blank check (btrim(code) <> ''),
  constraint crm_connection_notifications_message_not_blank check (btrim(message) <> ''),
  constraint crm_connection_notifications_occurrence_positive check (occurrence_count > 0)
);

create unique index crm_connection_notifications_open_unique
  on public.crm_connection_notifications (connection_id, code)
  where status = 'open';

create index crm_connection_notifications_org_status_idx
  on public.crm_connection_notifications (organization_id, status, last_occurred_at desc);

create table private.crm_oauth_states (
  id uuid primary key default gen_random_uuid(),
  state_hash text not null unique,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.crm_import_connections(id) on delete cascade,
  provider text not null,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint crm_oauth_states_provider_valid
    check (provider in ('hubspot', 'salesforce', 'zoho', 'pipedrive')),
  constraint crm_oauth_states_hash_not_blank check (btrim(state_hash) <> '')
);

create index crm_oauth_states_expiry_idx on private.crm_oauth_states (expires_at);

create or replace function private.validate_crm_connection_notification_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_connection_organization_id uuid;
  v_membership_organization_id uuid;
begin
  select organization_id
  into v_connection_organization_id
  from public.crm_import_connections
  where id = new.connection_id;

  if v_connection_organization_id is null or v_connection_organization_id <> new.organization_id then
    raise exception using errcode = '23514', message = 'CRM connection notification must belong to the connection organization';
  end if;

  if new.acknowledged_by_membership_id is not null then
    select organization_id
    into v_membership_organization_id
    from public.memberships
    where id = new.acknowledged_by_membership_id;

    if v_membership_organization_id is null or v_membership_organization_id <> new.organization_id then
      raise exception using errcode = '23514', message = 'CRM notification acknowledgement must belong to the same organization';
    end if;
  end if;

  return new;
end;
$$;

create trigger crm_connection_notifications_validate_tenant
before insert or update of organization_id, connection_id, acknowledged_by_membership_id
on public.crm_connection_notifications
for each row execute function private.validate_crm_connection_notification_tenant();

create or replace function private.membership_has_permission(
  p_membership_id uuid,
  p_permission_key text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
begin
  select membership.organization_id
  into v_organization_id
  from public.memberships as membership
  join public.organizations as organization
    on organization.id = membership.organization_id
  where membership.id = p_membership_id
    and membership.status = 'active'
    and organization.status = 'active'
  limit 1;

  if v_organization_id is null then
    return false;
  end if;

  if exists (
    select 1
    from public.membership_permission_overrides as override_grant
    join public.permissions as permission on permission.id = override_grant.permission_id
    where override_grant.membership_id = p_membership_id
      and permission.key = p_permission_key
      and override_grant.effect = 'deny'
      and (override_grant.expires_at is null or override_grant.expires_at > now())
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.membership_permission_overrides as override_grant
    join public.permissions as permission on permission.id = override_grant.permission_id
    where override_grant.membership_id = p_membership_id
      and permission.key = p_permission_key
      and override_grant.effect = 'allow'
      and (override_grant.expires_at is null or override_grant.expires_at > now())
  ) then
    return true;
  end if;

  return exists (
    select 1
    from public.membership_roles as assignment
    join public.roles as role
      on role.id = assignment.role_id
     and role.organization_id = v_organization_id
     and role.status = 'active'
    join public.role_permissions as role_permission on role_permission.role_id = role.id
    join public.permissions as permission on permission.id = role_permission.permission_id
    where assignment.membership_id = p_membership_id
      and permission.key = p_permission_key
  );
end;
$$;

alter table public.crm_connection_notifications enable row level security;

revoke all on public.crm_connection_notifications from anon, authenticated;
revoke all on private.crm_oauth_states from public, anon, authenticated;
revoke all on function private.membership_has_permission(uuid, text) from public, anon, authenticated;

grant select on public.crm_connection_notifications to authenticated;
grant all on public.crm_connection_notifications to service_role;
grant all on private.crm_oauth_states to service_role;
grant execute on function private.membership_has_permission(uuid, text) to service_role;

create policy crm_connection_notifications_select_authorized
on public.crm_connection_notifications for select to authenticated
using (private.has_permission(organization_id, 'crm.import.view'));
