-- Final security hardening and operational-readiness controls.
-- Adds organization policy, application session evidence, security events,
-- incident/restore-drill records, and immediate tenant-scoped revocation.

set lock_timeout = '10s';
set statement_timeout = '120s';

-- Every active member may inspect and revoke their own AgencyOS sessions.
insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'own'
from public.role_templates as role_template
join public.permissions as permission on permission.key = 'settings.security.view'
on conflict (role_template_key, permission_id) do update
set scope = case
  when public.role_template_permissions.scope = 'organization' then 'organization'
  else excluded.scope
end;

-- Existing administration templates retain organization-wide security control.
insert into public.role_template_permissions (role_template_key, permission_id, scope)
select template.key, permission.id, 'organization'
from (values
  ('owner'),
  ('system_administrator')
) as template(key)
join public.permissions as permission on permission.key in (
  'settings.security.view',
  'settings.security.manage_settings',
  'settings.security.revoke',
  'settings.security.reset_mfa'
)
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'auditor', permission.id, 'organization'
from public.permissions as permission
where permission.key = 'settings.security.view'
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

-- Synchronize existing roles with the updated security-view template and preserve
-- broader organization grants already held by privileged roles.
insert into public.role_permissions (role_id, permission_id, scope, conditions)
select role.id, template_permission.permission_id, template_permission.scope, template_permission.conditions
from public.roles as role
join public.role_template_permissions as template_permission
  on template_permission.role_template_key = role.template_key
join public.permissions as permission on permission.id = template_permission.permission_id
where permission.key like 'settings.security.%'
on conflict (role_id, permission_id) do update
set scope = case
      when public.role_permissions.scope = 'organization' then 'organization'
      else excluded.scope
    end,
    conditions = excluded.conditions,
    updated_at = now();

create table public.organization_security_policies (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  require_privileged_mfa boolean not null default true,
  recommend_mfa boolean not null default true,
  absolute_session_minutes integer not null default 720,
  idle_timeout_minutes integer not null default 30,
  reauthentication_minutes integer not null default 15,
  suspicious_failure_threshold integer not null default 5,
  suspicious_window_minutes integer not null default 15,
  login_limit_per_window integer not null default 10,
  password_reset_limit_per_window integer not null default 5,
  api_limit_per_minute integer not null default 120,
  worker_limit_per_minute integer not null default 60,
  export_limit_per_minute integer not null default 10,
  mcp_limit_per_minute integer not null default 30,
  updated_by_membership_id uuid references public.memberships(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_security_policy_session_bounds check (
    absolute_session_minutes between 30 and 10080
    and idle_timeout_minutes between 5 and 480
    and idle_timeout_minutes <= absolute_session_minutes
    and reauthentication_minutes between 5 and 120
  ),
  constraint organization_security_policy_detection_bounds check (
    suspicious_failure_threshold between 3 and 20
    and suspicious_window_minutes between 5 and 120
  ),
  constraint organization_security_policy_rate_bounds check (
    login_limit_per_window between 3 and 100
    and password_reset_limit_per_window between 1 and 30
    and api_limit_per_minute between 10 and 5000
    and worker_limit_per_minute between 5 and 1000
    and export_limit_per_minute between 1 and 100
    and mcp_limit_per_minute between 1 and 500
  )
);

insert into public.organization_security_policies (organization_id)
select id from public.organizations
on conflict (organization_id) do nothing;

create or replace function private.create_default_security_policy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.organization_security_policies (organization_id)
  values (new.id)
  on conflict (organization_id) do nothing;
  return new;
end;
$$;

create trigger organizations_create_security_policy
after insert on public.organizations
for each row execute function private.create_default_security_policy();

create table public.security_sessions (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'active',
  assurance_level text not null default 'aal1',
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  absolute_expires_at timestamptz not null,
  idle_expires_at timestamptz not null,
  reauthenticated_at timestamptz,
  revoked_at timestamptz,
  revoked_by_membership_id uuid references public.memberships(id) on delete set null,
  revocation_reason text,
  constraint security_sessions_status_valid check (status in ('active', 'revoked', 'expired')),
  constraint security_sessions_assurance_valid check (assurance_level in ('aal1', 'aal2')),
  constraint security_sessions_user_agent_bounded check (
    user_agent is null or char_length(user_agent) <= 500
  ),
  constraint security_sessions_expiry_valid check (
    absolute_expires_at > created_at and idle_expires_at > created_at
  ),
  constraint security_sessions_revocation_consistent check (
    (status = 'active' and revoked_at is null and revocation_reason is null)
    or (status in ('revoked', 'expired') and revoked_at is not null and revocation_reason is not null)
  ),
  unique (organization_id, membership_id, id)
);

create index security_sessions_membership_history_idx
  on public.security_sessions (membership_id, last_seen_at desc);
create index security_sessions_org_active_idx
  on public.security_sessions (organization_id, last_seen_at desc)
  where status = 'active';
create index security_sessions_expiry_idx
  on public.security_sessions (least(absolute_expires_at, idle_expires_at))
  where status = 'active';

create table public.security_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  membership_id uuid references public.memberships(id) on delete set null,
  session_id uuid,
  event_type text not null,
  severity text not null default 'info',
  ip_address inet,
  user_agent text,
  request_id text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint security_events_type_valid check (event_type ~ '^[a-z][a-z0-9._-]{2,119}$'),
  constraint security_events_severity_valid check (severity in ('info', 'warning', 'critical')),
  constraint security_events_user_agent_bounded check (
    user_agent is null or char_length(user_agent) <= 500
  ),
  constraint security_events_request_bounded check (
    request_id is null or char_length(request_id) <= 200
  ),
  constraint security_events_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint security_events_metadata_bounded check (octet_length(metadata::text) <= 16384)
);

create index security_events_org_time_idx
  on public.security_events (organization_id, occurred_at desc, id desc);
create index security_events_membership_time_idx
  on public.security_events (membership_id, occurred_at desc, id desc)
  where membership_id is not null;
create index security_events_type_time_idx
  on public.security_events (event_type, occurred_at desc, id desc);

create table public.security_incidents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  incident_number text not null,
  title text not null,
  severity text not null,
  status text not null default 'open',
  classification text not null,
  summary text not null,
  containment_summary text,
  evidence_reference text,
  communication_status text not null default 'not_required',
  detected_at timestamptz not null,
  contained_at timestamptz,
  resolved_at timestamptz,
  postmortem_due_at timestamptz,
  owner_membership_id uuid references public.memberships(id) on delete set null,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint security_incidents_number_not_blank check (btrim(incident_number) <> ''),
  constraint security_incidents_title_bounded check (char_length(btrim(title)) between 3 and 160),
  constraint security_incidents_severity_valid check (severity in ('low', 'medium', 'high', 'critical')),
  constraint security_incidents_status_valid check (
    status in ('open', 'investigating', 'contained', 'resolved', 'closed')
  ),
  constraint security_incidents_classification_valid check (
    classification in ('authentication', 'authorization', 'data_exposure', 'malware', 'availability', 'fraud', 'third_party', 'other')
  ),
  constraint security_incidents_summary_bounded check (char_length(btrim(summary)) between 10 and 4000),
  constraint security_incidents_containment_bounded check (
    containment_summary is null or char_length(containment_summary) <= 4000
  ),
  constraint security_incidents_evidence_bounded check (
    evidence_reference is null or char_length(evidence_reference) <= 500
  ),
  constraint security_incidents_communication_valid check (
    communication_status in ('not_required', 'pending', 'internal_sent', 'external_sent', 'complete')
  ),
  constraint security_incidents_resolution_consistent check (
    (status in ('resolved', 'closed') and resolved_at is not null)
    or (status not in ('resolved', 'closed'))
  ),
  unique (organization_id, incident_number)
);

create index security_incidents_org_status_idx
  on public.security_incidents (organization_id, status, detected_at desc);

create table public.security_incident_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  incident_id uuid not null references public.security_incidents(id) on delete restrict,
  event_type text not null,
  actor_membership_id uuid references public.memberships(id) on delete set null,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint security_incident_events_type_valid check (event_type ~ '^[a-z][a-z0-9._-]{2,119}$'),
  constraint security_incident_events_summary_bounded check (char_length(btrim(summary)) between 3 and 2000),
  constraint security_incident_events_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint security_incident_events_metadata_bounded check (octet_length(metadata::text) <= 8192)
);

create index security_incident_events_incident_time_idx
  on public.security_incident_events (incident_id, occurred_at asc, id asc);

create table public.security_restore_drills (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  drill_type text not null,
  status text not null,
  runbook_version text not null,
  started_at timestamptz not null,
  completed_at timestamptz,
  recovery_point_minutes integer,
  recovery_time_minutes integer,
  evidence_summary text not null,
  evidence_hash text,
  executed_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint security_restore_drills_type_valid check (
    drill_type in ('database', 'minio', 'configuration', 'redis', 'n8n', 'full')
  ),
  constraint security_restore_drills_status_valid check (status in ('passed', 'failed', 'partial')),
  constraint security_restore_drills_runbook_bounded check (char_length(btrim(runbook_version)) between 1 and 80),
  constraint security_restore_drills_time_valid check (
    completed_at is null or completed_at >= started_at
  ),
  constraint security_restore_drills_measurement_valid check (
    (recovery_point_minutes is null or recovery_point_minutes between 0 and 10080)
    and (recovery_time_minutes is null or recovery_time_minutes between 0 and 10080)
  ),
  constraint security_restore_drills_evidence_bounded check (
    char_length(btrim(evidence_summary)) between 10 and 4000
  ),
  constraint security_restore_drills_hash_valid check (
    evidence_hash is null or evidence_hash ~ '^[0-9a-f]{64}$'
  )
);

create index security_restore_drills_org_time_idx
  on public.security_restore_drills (organization_id, started_at desc, id desc);

create or replace function private.validate_security_membership_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_membership_organization_id uuid;
  v_membership_user_id uuid;
begin
  select organization_id, user_id
  into v_membership_organization_id, v_membership_user_id
  from public.memberships
  where id = new.membership_id;

  if v_membership_organization_id is null
     or v_membership_organization_id <> new.organization_id
     or v_membership_user_id <> new.user_id then
    raise exception using errcode = '23514', message = 'Security session membership must match its organization and user';
  end if;

  if new.revoked_by_membership_id is not null and not exists (
    select 1 from public.memberships
    where id = new.revoked_by_membership_id
      and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Security-session revoker must belong to the organization';
  end if;

  return new;
end;
$$;

create trigger security_sessions_validate_tenant
before insert or update of organization_id, membership_id, user_id, revoked_by_membership_id
on public.security_sessions
for each row execute function private.validate_security_membership_tenant();

create or replace function private.validate_security_event_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.membership_id is not null and not exists (
    select 1 from public.memberships
    where id = new.membership_id and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Security event membership must belong to the organization';
  end if;
  return new;
end;
$$;

create trigger security_events_validate_tenant
before insert on public.security_events
for each row execute function private.validate_security_event_tenant();

create or replace function private.validate_security_incident_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.memberships
    where id = new.created_by_membership_id and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Security incident creator must belong to the organization';
  end if;
  if new.owner_membership_id is not null and not exists (
    select 1 from public.memberships
    where id = new.owner_membership_id and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Security incident owner must belong to the organization';
  end if;
  return new;
end;
$$;

create trigger security_incidents_validate_tenant
before insert or update of organization_id, created_by_membership_id, owner_membership_id
on public.security_incidents
for each row execute function private.validate_security_incident_tenant();

create or replace function private.validate_security_incident_event_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.security_incidents
    where id = new.incident_id and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Security incident event must match its incident tenant';
  end if;
  if new.actor_membership_id is not null and not exists (
    select 1 from public.memberships
    where id = new.actor_membership_id and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Security incident event actor must belong to the organization';
  end if;
  return new;
end;
$$;

create trigger security_incident_events_validate_tenant
before insert on public.security_incident_events
for each row execute function private.validate_security_incident_event_tenant();

create or replace function private.validate_security_restore_drill_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.memberships
    where id = new.executed_by_membership_id and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Restore drill executor must belong to the organization';
  end if;
  return new;
end;
$$;

create trigger security_restore_drills_validate_tenant
before insert on public.security_restore_drills
for each row execute function private.validate_security_restore_drill_tenant();

create or replace function private.prevent_security_evidence_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Security evidence is append-only';
end;
$$;

create trigger security_events_prevent_update
before update on public.security_events
for each row execute function private.prevent_security_evidence_mutation();
create trigger security_events_prevent_delete
before delete on public.security_events
for each row execute function private.prevent_security_evidence_mutation();
create trigger security_incident_events_prevent_update
before update on public.security_incident_events
for each row execute function private.prevent_security_evidence_mutation();
create trigger security_incident_events_prevent_delete
before delete on public.security_incident_events
for each row execute function private.prevent_security_evidence_mutation();
create trigger security_restore_drills_prevent_update
before update on public.security_restore_drills
for each row execute function private.prevent_security_evidence_mutation();
create trigger security_restore_drills_prevent_delete
before delete on public.security_restore_drills
for each row execute function private.prevent_security_evidence_mutation();

create trigger organization_security_policies_set_updated_at
before update on public.organization_security_policies
for each row execute function private.set_updated_at();
create trigger security_incidents_set_updated_at
before update on public.security_incidents
for each row execute function private.set_updated_at();

create or replace function private.revoke_membership_security_sessions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'active' and new.status in ('suspended', 'deactivated') then
    update public.security_sessions
    set status = 'revoked',
        revoked_at = now(),
        revocation_reason = 'membership_' || new.status,
        revoked_by_membership_id = null
    where membership_id = new.id
      and organization_id = new.organization_id
      and status = 'active';

    insert into public.security_events (
      organization_id, membership_id, event_type, severity, metadata
    ) values (
      new.organization_id,
      new.id,
      'security.membership_sessions_revoked',
      'warning',
      jsonb_build_object('membershipStatus', new.status)
    );
  end if;
  return new;
end;
$$;

create trigger memberships_revoke_security_sessions
after update of status on public.memberships
for each row execute function private.revoke_membership_security_sessions();

alter table public.organization_security_policies enable row level security;
alter table public.security_sessions enable row level security;
alter table public.security_events enable row level security;
alter table public.security_incidents enable row level security;
alter table public.security_incident_events enable row level security;
alter table public.security_restore_drills enable row level security;

revoke all on public.organization_security_policies from anon, authenticated;
revoke all on public.security_sessions from anon, authenticated;
revoke all on public.security_events from anon, authenticated;
revoke all on public.security_incidents from anon, authenticated;
revoke all on public.security_incident_events from anon, authenticated;
revoke all on public.security_restore_drills from anon, authenticated;

grant select on public.organization_security_policies to authenticated;
grant select on public.security_sessions to authenticated;
grant select on public.security_events to authenticated;
grant select on public.security_incidents to authenticated;
grant select on public.security_incident_events to authenticated;
grant select on public.security_restore_drills to authenticated;

grant all on public.organization_security_policies to service_role;
grant all on public.security_sessions to service_role;
grant all on public.security_events to service_role;
grant all on public.security_incidents to service_role;
grant all on public.security_incident_events to service_role;
grant all on public.security_restore_drills to service_role;
grant usage, select on sequence public.security_events_id_seq to service_role;

create policy organization_security_policies_select
on public.organization_security_policies
for select to authenticated
using (
  private.is_active_member(organization_id)
  and private.has_permission(organization_id, 'settings.security.view')
);

create policy security_sessions_select
on public.security_sessions
for select to authenticated
using (
  private.is_active_member(organization_id)
  and private.has_permission(organization_id, 'settings.security.view')
  and (
    private.owns_membership(membership_id)
    or private.effective_permission_scope(organization_id, 'settings.security.view') = 'organization'
  )
);

create policy security_events_select
on public.security_events
for select to authenticated
using (
  private.is_active_member(organization_id)
  and private.has_permission(organization_id, 'settings.security.view')
  and (
    membership_id = private.current_membership_id(organization_id)
    or private.effective_permission_scope(organization_id, 'settings.security.view') = 'organization'
  )
);

create policy security_incidents_select
on public.security_incidents
for select to authenticated
using (
  private.is_active_member(organization_id)
  and private.has_permission(organization_id, 'settings.security.view')
  and private.effective_permission_scope(organization_id, 'settings.security.view') = 'organization'
);

create policy security_incident_events_select
on public.security_incident_events
for select to authenticated
using (
  private.is_active_member(organization_id)
  and private.has_permission(organization_id, 'settings.security.view')
  and private.effective_permission_scope(organization_id, 'settings.security.view') = 'organization'
);

create policy security_restore_drills_select
on public.security_restore_drills
for select to authenticated
using (
  private.is_active_member(organization_id)
  and private.has_permission(organization_id, 'settings.security.view')
  and private.effective_permission_scope(organization_id, 'settings.security.view') = 'organization'
);
