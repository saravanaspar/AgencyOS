-- Organization-level governance for external AI data egress and provider execution evidence.
set lock_timeout = '10s';
set statement_timeout = '120s';

create table public.organization_ai_policies (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  enabled boolean not null default false,
  external_data_egress_enabled boolean not null default false,
  allowed_providers text[] not null default '{}'::text[],
  allowed_modules text[] not null default '{}'::text[],
  allow_low_risk_mutations boolean not null default false,
  updated_by_membership_id uuid references public.memberships(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_ai_policies_providers_valid check (
    allowed_providers <@ array['gemini', 'deepseek']::text[]
  ),
  constraint organization_ai_policies_modules_valid check (
    cardinality(allowed_modules) = 0
    or array_to_string(allowed_modules, ',') ~ '^[a-z][a-z0-9_]{1,63}(,[a-z][a-z0-9_]{1,63})*$'
  ),
  constraint organization_ai_policies_egress_consistent check (
    not enabled or external_data_egress_enabled
  )
);

insert into public.organization_ai_policies (organization_id)
select id from public.organizations
on conflict (organization_id) do nothing;

create or replace function private.create_default_ai_governance_policy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.organization_ai_policies (organization_id)
  values (new.id)
  on conflict (organization_id) do nothing;
  return new;
end;
$$;

create trigger organizations_create_ai_governance_policy
after insert on public.organizations
for each row execute function private.create_default_ai_governance_policy();

create trigger organization_ai_policies_set_updated_at
before update on public.organization_ai_policies
for each row execute function private.set_updated_at();

create table public.automation_ai_provider_events (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_membership_id uuid not null references public.memberships(id) on delete restrict,
  provider text not null,
  model text not null,
  status text not null,
  message_count integer not null,
  available_tool_count integer not null,
  duration_ms integer,
  error_code text,
  created_at timestamptz not null default now(),
  constraint automation_ai_provider_events_provider_valid check (provider in ('gemini', 'deepseek')),
  constraint automation_ai_provider_events_status_valid check (status in ('started', 'succeeded', 'failed')),
  constraint automation_ai_provider_events_model_bounded check (char_length(model) between 1 and 120),
  constraint automation_ai_provider_events_counts_valid check (message_count between 1 and 100 and available_tool_count between 0 and 256),
  constraint automation_ai_provider_events_duration_valid check (duration_ms is null or duration_ms between 0 and 3600000),
  constraint automation_ai_provider_events_error_bounded check (error_code is null or char_length(error_code) <= 120)
);

create index automation_ai_provider_events_org_created_idx
  on public.automation_ai_provider_events (organization_id, created_at desc, id desc);
create index automation_ai_provider_events_actor_created_idx
  on public.automation_ai_provider_events (actor_membership_id, created_at desc);

create or replace function private.validate_ai_provider_event_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.memberships membership
    where membership.id = new.actor_membership_id
      and membership.organization_id = new.organization_id
  ) then
    raise exception 'AI provider event actor must belong to the organization.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger automation_ai_provider_events_validate_tenant
before insert on public.automation_ai_provider_events
for each row execute function private.validate_ai_provider_event_tenant();
create trigger automation_ai_provider_events_no_update
before update on public.automation_ai_provider_events
for each row execute function private.prevent_automation_append_only_mutation();
create trigger automation_ai_provider_events_no_delete
before delete on public.automation_ai_provider_events
for each row execute function private.prevent_automation_append_only_mutation();

alter table public.organization_ai_policies enable row level security;
alter table public.automation_ai_provider_events enable row level security;

revoke all on public.organization_ai_policies from public, anon, authenticated;
revoke all on public.automation_ai_provider_events from public, anon, authenticated;
grant select on public.organization_ai_policies to authenticated;
grant select on public.automation_ai_provider_events to authenticated;
grant all on public.organization_ai_policies to service_role;
grant all on public.automation_ai_provider_events to service_role;

revoke all on function private.create_default_ai_governance_policy() from public, anon, authenticated;
revoke all on function private.validate_ai_provider_event_tenant() from public, anon, authenticated;
grant execute on function private.create_default_ai_governance_policy() to service_role;
grant execute on function private.validate_ai_provider_event_tenant() to service_role;

create policy organization_ai_policies_select_authorized
on public.organization_ai_policies for select to authenticated
using (
  private.has_permission(organization_id, 'automation.ai_execution.view')
  or private.has_permission(organization_id, 'settings.security.view')
);

create policy automation_ai_provider_events_select_authorized
on public.automation_ai_provider_events for select to authenticated
using (
  actor_membership_id = private.current_membership_id(organization_id)
  or private.has_permission(organization_id, 'automation.ai_execution.view')
);

comment on table public.organization_ai_policies is
  'Fail-closed organization policy controlling external AI providers, data egress, tool modules, and low-risk mutations.';
comment on table public.automation_ai_provider_events is
  'Append-only metadata-only AI provider execution evidence. Prompts, tool payloads, credentials, and model output are never stored.';
