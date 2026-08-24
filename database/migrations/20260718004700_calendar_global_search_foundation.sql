-- Unified calendar and permission-aware global-search foundation.
-- Source-module dates remain authoritative; only agency-created events are stored here.

set lock_timeout = '10s';
set statement_timeout = '120s';

insert into public.permissions (module, resource, action, description, is_sensitive)
values
  ('calendar', 'event', 'view', 'View calendar events and authorized cross-module date projections.', false),
  ('calendar', 'event', 'create', 'Create meetings, holidays, interviews, licence expirations, and other agency events.', false),
  ('calendar', 'event', 'manage', 'Update or cancel calendar events within the granted scope.', true),
  ('search', 'records', 'view', 'Search metadata for records the member is already authorized to view.', false)
on conflict (module, resource, action) do update
set description = excluded.description, is_sensitive = excluded.is_sensitive;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'organization'
from public.role_templates as role_template
cross join public.permissions as permission
where permission.key = 'search.records.view'
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'organization'
from public.role_templates as role_template
cross join public.permissions as permission
where role_template.key in ('owner', 'system_administrator', 'operations_administrator')
  and permission.module = 'calendar'
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id,
  case when permission.key = 'calendar.event.manage' then 'team' else 'organization' end
from public.role_templates as role_template
cross join public.permissions as permission
where role_template.key in (
    'finance_manager', 'hr_manager', 'project_manager', 'team_lead', 'sales_manager',
    'support_manager', 'legal_manager'
  )
  and permission.key in ('calendar.event.view', 'calendar.event.create', 'calendar.event.manage')
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'own'
from public.role_templates as role_template
cross join public.permissions as permission
where role_template.key in ('accountant', 'sales_executive', 'support_agent', 'employee')
  and permission.key in ('calendar.event.view', 'calendar.event.create')
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'auditor', permission.id, 'organization'
from public.permissions as permission
where permission.key = 'calendar.event.view'
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_permissions (role_id, permission_id, scope, conditions)
select role.id, template_permission.permission_id, template_permission.scope,
  template_permission.conditions
from public.roles as role
join public.role_template_permissions as template_permission
  on template_permission.role_template_key = role.template_key
join public.permissions as permission on permission.id = template_permission.permission_id
where permission.module in ('calendar', 'search')
on conflict (role_id, permission_id) do update
set scope = excluded.scope, conditions = excluded.conditions, updated_at = now();

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  description text,
  event_type text not null default 'meeting',
  scope text not null default 'personal',
  visibility text not null default 'public',
  owner_membership_id uuid not null references public.memberships(id) on delete restrict,
  team_id uuid references public.teams(id) on delete set null,
  department_id uuid references public.departments(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  timezone text not null default 'UTC',
  recurrence_frequency text not null default 'none',
  recurrence_interval integer not null default 1,
  recurrence_until date,
  location text,
  meeting_url text,
  status text not null default 'active',
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  updated_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_events_title_valid check (char_length(btrim(title)) between 2 and 180),
  constraint calendar_events_description_valid check (
    description is null or char_length(btrim(description)) between 2 and 4000
  ),
  constraint calendar_events_type_valid check (event_type in (
    'meeting', 'holiday', 'interview', 'licence_expiration', 'probation_review', 'other'
  )),
  constraint calendar_events_scope_valid check (scope in (
    'personal', 'team', 'department', 'project', 'company'
  )),
  constraint calendar_events_visibility_valid check (visibility in ('public', 'private')),
  constraint calendar_events_dates_valid check (ends_at >= starts_at),
  constraint calendar_events_timezone_valid check (char_length(btrim(timezone)) between 1 and 80),
  constraint calendar_events_recurrence_valid check (
    recurrence_frequency in ('none', 'daily', 'weekly', 'monthly')
    and recurrence_interval between 1 and 52
    and (recurrence_frequency <> 'none' or recurrence_until is null)
  ),
  constraint calendar_events_location_valid check (
    location is null or char_length(btrim(location)) between 2 and 300
  ),
  constraint calendar_events_meeting_url_valid check (
    meeting_url is null or (char_length(btrim(meeting_url)) between 8 and 1000 and meeting_url ~ '^https://')
  ),
  constraint calendar_events_status_valid check (status in ('active', 'cancelled')),
  constraint calendar_events_scope_target_valid check (
    (scope = 'personal' and team_id is null and department_id is null and project_id is null)
    or (scope = 'team' and team_id is not null and department_id is null and project_id is null)
    or (scope = 'department' and department_id is not null and team_id is null and project_id is null)
    or (scope = 'project' and project_id is not null and team_id is null and department_id is null)
    or (scope = 'company' and team_id is null and department_id is null and project_id is null)
  )
);
create index calendar_events_range_idx
  on public.calendar_events (organization_id, starts_at, ends_at) where status = 'active';
create index calendar_events_owner_idx
  on public.calendar_events (organization_id, owner_membership_id, starts_at) where status = 'active';
create index calendar_events_scope_idx
  on public.calendar_events (organization_id, scope, team_id, department_id, project_id, starts_at)
  where status = 'active';

create table public.calendar_event_attendees (
  event_id uuid not null references public.calendar_events(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  response_status text not null default 'invited',
  added_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_id, membership_id),
  constraint calendar_attendees_response_valid check (
    response_status in ('invited', 'accepted', 'tentative', 'declined')
  )
);
create index calendar_event_attendees_membership_idx
  on public.calendar_event_attendees (membership_id, event_id);

create table public.calendar_event_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  calendar_event_id uuid not null references public.calendar_events(id) on delete cascade,
  event_type text not null,
  actor_membership_id uuid references public.memberships(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint calendar_event_events_type_valid check (char_length(btrim(event_type)) between 3 and 100),
  constraint calendar_event_events_details_object check (jsonb_typeof(details) = 'object')
);
create index calendar_event_events_history_idx
  on public.calendar_event_events (calendar_event_id, created_at desc);

create or replace function private.validate_calendar_event_tenant()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.memberships membership
    where membership.id = new.owner_membership_id
      and membership.organization_id = new.organization_id
      and membership.status = 'active'
  ) then
    raise exception using errcode = '23514', message = 'Calendar event owner must be active in its organization';
  end if;
  if not exists (
    select 1 from public.memberships membership
    where membership.id in (new.created_by_membership_id, new.updated_by_membership_id)
      and membership.organization_id = new.organization_id
    group by membership.organization_id having count(distinct membership.id) = 2
  ) and new.created_by_membership_id <> new.updated_by_membership_id then
    raise exception using errcode = '23514', message = 'Calendar event actors must belong to its organization';
  end if;
  if new.created_by_membership_id = new.updated_by_membership_id and not exists (
    select 1 from public.memberships membership
    where membership.id = new.created_by_membership_id and membership.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Calendar event actor must belong to its organization';
  end if;
  if new.team_id is not null and not exists (
    select 1 from public.teams team where team.id = new.team_id and team.organization_id = new.organization_id
  ) then raise exception using errcode = '23514', message = 'Calendar team must belong to its organization'; end if;
  if new.department_id is not null and not exists (
    select 1 from public.departments department
    where department.id = new.department_id and department.organization_id = new.organization_id
  ) then raise exception using errcode = '23514', message = 'Calendar department must belong to its organization'; end if;
  if new.project_id is not null and not exists (
    select 1 from public.projects project
    where project.id = new.project_id and project.organization_id = new.organization_id
  ) then raise exception using errcode = '23514', message = 'Calendar project must belong to its organization'; end if;
  return new;
end;
$$;

create or replace function private.validate_calendar_attendee_tenant()
returns trigger language plpgsql set search_path = '' as $$
declare v_organization_id uuid;
begin
  select organization_id into v_organization_id from public.calendar_events where id = new.event_id;
  if v_organization_id is null or not exists (
    select 1
    from public.memberships membership
    where membership.id = new.membership_id
      and membership.organization_id = v_organization_id
      and membership.status = 'active'
  ) or not exists (
    select 1
    from public.memberships membership
    where membership.id = new.added_by_membership_id
      and membership.organization_id = v_organization_id
      and membership.status = 'active'
  ) then
    raise exception using errcode = '23514', message = 'Calendar attendee and actor must be active in the event organization';
  end if;
  return new;
end;
$$;

create or replace function private.validate_calendar_event_history_tenant()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.calendar_events calendar_event
    where calendar_event.id = new.calendar_event_id
      and calendar_event.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Calendar history must match its event organization';
  end if;
  if new.actor_membership_id is not null and not exists (
    select 1 from public.memberships membership
    where membership.id = new.actor_membership_id and membership.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Calendar history actor must match its organization';
  end if;
  return new;
end;
$$;

create or replace function private.prevent_calendar_history_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '55000', message = 'Calendar history is append-only';
end;
$$;

create or replace function private.calendar_event_membership_access_allowed(
  p_event_id uuid,
  p_membership_id uuid,
  p_permission_key text
)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_event public.calendar_events%rowtype;
  v_department_id uuid;
begin
  select * into v_event from public.calendar_events where id = p_event_id;
  if v_event.id is null then return false; end if;
  if not private.membership_has_permission(p_membership_id, p_permission_key) then return false; end if;
  if v_event.owner_membership_id = p_membership_id or exists (
    select 1 from public.calendar_event_attendees attendee
    where attendee.event_id = p_event_id and attendee.membership_id = p_membership_id
  ) then return true; end if;
  if v_event.visibility = 'private' then return false; end if;
  if v_event.scope = 'company' then return true; end if;
  if v_event.scope = 'team' then return exists (
    select 1 from public.team_members team_member
    where team_member.team_id = v_event.team_id and team_member.membership_id = p_membership_id
  ); end if;
  if v_event.scope = 'department' then
    select department_id into v_department_id from public.memberships where id = p_membership_id;
    return v_department_id = v_event.department_id;
  end if;
  if v_event.scope = 'project' then return private.project_is_visible(
    v_event.project_id,
    p_membership_id,
    private.membership_effective_permission_scope(p_membership_id, p_permission_key)
  ); end if;
  return false;
end;
$$;

create or replace function private.calendar_event_management_allowed(
  p_event_id uuid,
  p_membership_id uuid
)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_event public.calendar_events%rowtype;
  v_scope text;
begin
  select * into v_event from public.calendar_events where id = p_event_id;
  if v_event.id is null then return false; end if;
  if v_event.owner_membership_id = p_membership_id then return true; end if;
  if v_event.visibility = 'private' then return false; end if;
  v_scope := private.membership_effective_permission_scope(
    p_membership_id, 'calendar.event.manage'
  );
  if v_scope is null then return false; end if;
  if v_scope = 'organization' then return true; end if;
  if v_event.scope = 'company' then return false; end if;
  if v_scope = 'selected_projects' and v_event.scope = 'project' then
    return private.project_is_visible(v_event.project_id, p_membership_id, v_scope);
  end if;
  return private.crm_scope_allows_membership(
    p_membership_id,
    v_scope,
    v_event.owner_membership_id,
    v_event.created_by_membership_id
  );
end;
$$;

create or replace function private.calendar_event_access_allowed(p_event_id uuid, p_permission_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.calendar_event_membership_access_allowed(
    p_event_id,
    private.current_membership_id((select organization_id from public.calendar_events where id = p_event_id)),
    p_permission_key
  )
$$;

create trigger calendar_events_set_updated_at before update on public.calendar_events
for each row execute function private.set_updated_at();
create trigger calendar_events_validate_tenant before insert or update on public.calendar_events
for each row execute function private.validate_calendar_event_tenant();
create trigger calendar_attendees_set_updated_at before update on public.calendar_event_attendees
for each row execute function private.set_updated_at();
create trigger calendar_attendees_validate_tenant before insert or update on public.calendar_event_attendees
for each row execute function private.validate_calendar_attendee_tenant();
create trigger calendar_event_events_validate_tenant before insert or update on public.calendar_event_events
for each row execute function private.validate_calendar_event_history_tenant();
create trigger calendar_event_events_immutable before update or delete on public.calendar_event_events
for each row execute function private.prevent_calendar_history_mutation();

alter table public.calendar_events enable row level security;
alter table public.calendar_event_attendees enable row level security;
alter table public.calendar_event_events enable row level security;

revoke all on public.calendar_events, public.calendar_event_attendees, public.calendar_event_events
from public, anon, authenticated;
grant select on public.calendar_events, public.calendar_event_attendees to authenticated;
grant select (id, organization_id, calendar_event_id, event_type, actor_membership_id, created_at)
  on public.calendar_event_events to authenticated;
grant all on public.calendar_events, public.calendar_event_attendees, public.calendar_event_events to service_role;

create policy calendar_events_select on public.calendar_events
for select to authenticated using (private.calendar_event_access_allowed(id, 'calendar.event.view'));
create policy calendar_event_attendees_select on public.calendar_event_attendees
for select to authenticated using (private.calendar_event_access_allowed(event_id, 'calendar.event.view'));
create policy calendar_event_events_select on public.calendar_event_events
for select to authenticated using (private.calendar_event_access_allowed(calendar_event_id, 'calendar.event.view'));

revoke all on function private.validate_calendar_event_tenant() from public, anon, authenticated;
revoke all on function private.validate_calendar_attendee_tenant() from public, anon, authenticated;
revoke all on function private.validate_calendar_event_history_tenant() from public, anon, authenticated;
revoke all on function private.prevent_calendar_history_mutation() from public, anon, authenticated;
revoke all on function private.calendar_event_membership_access_allowed(uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.calendar_event_management_allowed(uuid, uuid) from public, anon, authenticated;
revoke all on function private.calendar_event_access_allowed(uuid, text) from public, anon;
grant execute on function private.calendar_event_membership_access_allowed(uuid, uuid, text) to service_role;
grant execute on function private.calendar_event_management_allowed(uuid, uuid) to service_role;
grant execute on function private.calendar_event_access_allowed(uuid, text) to authenticated, service_role;
