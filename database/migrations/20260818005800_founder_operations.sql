-- Founder operating layer: truthful report delivery, shared report views, CRM forecasting,
-- project commercial truth, closure readiness, and capability-based executive access.

set lock_timeout = '10s';
set statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- Capability flags used by the dashboard and executive report visibility.
-- ---------------------------------------------------------------------------

insert into public.permissions (module, resource, action, description, is_sensitive)
values
  ('reports', 'founder_pack', 'view', 'View founder-level attention queues and executive report packs.', true),
  ('reports', 'management_pack', 'view', 'View management-level shared report packs.', true)
on conflict (module, resource, action) do update
set description = excluded.description,
    is_sensitive = excluded.is_sensitive;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template_key, permission.id, 'organization'
from (values ('owner')) as template(role_template_key)
join public.permissions as permission on permission.key = 'reports.founder_pack.view'
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template_key, permission.id, 'organization'
from (
  values
    ('owner'), ('operations_administrator'), ('finance_manager'), ('hr_manager'),
    ('project_manager'), ('sales_manager'), ('support_manager'), ('legal_manager')
) as template(role_template_key)
join public.permissions as permission on permission.key = 'reports.management_pack.view'
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_permissions (role_id, permission_id, scope, conditions)
select role.id, template_permission.permission_id, template_permission.scope, '{}'::jsonb
from public.roles as role
join public.role_template_permissions as template_permission
  on template_permission.role_template_key = role.template_key
join public.permissions as permission on permission.id = template_permission.permission_id
where permission.key in ('reports.founder_pack.view', 'reports.management_pack.view')
on conflict (role_id, permission_id) do update
set scope = excluded.scope,
    conditions = excluded.conditions,
    updated_at = now();

-- CRM follow-up completion is a distinct mutation from activity creation.
insert into public.permissions (module, resource, action, description, is_sensitive)
values ('crm', 'activity', 'update', 'Complete and reschedule permitted CRM activities and follow-ups.', false)
on conflict (module, resource, action) do update
set description = excluded.description, is_sensitive = excluded.is_sensitive;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select template.key, permission.id,
  case when template.key = 'sales_executive' then 'assigned_or_created' else 'organization' end
from (values ('owner'), ('sales_manager'), ('sales_executive')) as template(key)
join public.permissions permission on permission.key = 'crm.activity.update'
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_permissions (role_id, permission_id, scope, conditions)
select role.id, template_permission.permission_id, template_permission.scope, '{}'::jsonb
from public.roles role
join public.role_template_permissions template_permission
  on template_permission.role_template_key = role.template_key
join public.permissions permission on permission.id = template_permission.permission_id
where permission.key = 'crm.activity.update'
on conflict (role_id, permission_id) do update
set scope = excluded.scope, conditions = excluded.conditions, updated_at = now();

-- ---------------------------------------------------------------------------
-- Reports: relative periods, shared visibility, explicit audiences, optimistic
-- queue/undo grace, per-recipient delivery evidence, and truthful final status.
-- ---------------------------------------------------------------------------

alter table public.report_saved_views
  add column period_mode text not null default 'custom',
  add column visibility text not null default 'private',
  add column visibility_department_id uuid references public.departments(id) on delete set null,
  add column system_key text;

alter table public.report_saved_views
  drop constraint report_saved_views_section_check,
  add constraint report_saved_views_section_check check (
    section in ('overview', 'crm', 'projects', 'finance', 'hr', 'support', 'legal', 'founder_daily', 'founder_weekly')
  ),
  add constraint report_saved_views_system_key_check check (
    system_key is null or system_key ~ '^[a-z][a-z0-9._-]{2,79}$'
  );

create unique index report_saved_views_system_key_unique
  on public.report_saved_views (organization_id, owner_membership_id, system_key)
  where system_key is not null and status = 'active';

alter table public.report_snapshots
  drop constraint report_snapshots_section_check,
  add constraint report_snapshots_section_check check (
    section in ('overview', 'crm', 'projects', 'finance', 'hr', 'support', 'legal', 'founder_daily', 'founder_weekly')
  );

alter table public.report_saved_views
  add constraint report_saved_views_period_mode_check check (
    period_mode in (
      'custom', 'today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month',
      'quarter_to_date', 'last_quarter', 'year_to_date', 'trailing_7_days',
      'trailing_30_days', 'trailing_90_days'
    )
  ),
  add constraint report_saved_views_visibility_check check (
    visibility in ('private', 'founder', 'management', 'department', 'organization', 'named')
  ),
  add constraint report_saved_views_visibility_department_check check (
    (visibility = 'department' and visibility_department_id is not null)
    or (visibility <> 'department' and visibility_department_id is null)
  );

create table public.report_saved_view_recipients (
  saved_view_id uuid not null references public.report_saved_views(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  added_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (saved_view_id, membership_id)
);
create index report_saved_view_recipients_membership_idx
  on public.report_saved_view_recipients (organization_id, membership_id, saved_view_id);

alter table public.report_schedules
  add column audience text not null default 'owner',
  add column delivery_channels text[] not null default array['in_app']::text[],
  add column grace_seconds smallint not null default 5;

alter table public.report_schedules
  add constraint report_schedules_audience_check check (
    audience in ('owner', 'named', 'view_access', 'section_access')
  ),
  add constraint report_schedules_delivery_channels_check check (
    cardinality(delivery_channels) between 1 and 2
    and delivery_channels <@ array['in_app', 'email']::text[]
  ),
  add constraint report_schedules_grace_check check (grace_seconds between 0 and 30);

create table public.report_schedule_recipients (
  schedule_id uuid not null references public.report_schedules(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  added_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (schedule_id, membership_id)
);
create index report_schedule_recipients_membership_idx
  on public.report_schedule_recipients (organization_id, membership_id, schedule_id);

create table public.report_delivery_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  schedule_id uuid not null references public.report_schedules(id) on delete restrict,
  saved_view_id uuid not null references public.report_saved_views(id) on delete restrict,
  owner_membership_id uuid not null references public.memberships(id) on delete restrict,
  scheduled_for timestamptz not null,
  status text not null default 'queued',
  send_after timestamptz not null,
  undo_until timestamptz not null,
  recipient_count integer not null default 0,
  delivered_count integer not null default 0,
  failed_count integer not null default 0,
  suppressed_count integer not null default 0,
  cancelled_at timestamptz,
  cancelled_by_membership_id uuid references public.memberships(id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  locked_at timestamptz,
  lock_token uuid,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint report_delivery_batches_status_check check (
    status in ('queued', 'delivering', 'delivered', 'partially_failed', 'failed', 'cancelled')
  ),
  constraint report_delivery_batches_counts_check check (
    recipient_count >= 0 and delivered_count >= 0 and failed_count >= 0 and suppressed_count >= 0
  ),
  constraint report_delivery_batches_error_check check (error_code is null or char_length(error_code) <= 100),
  unique (schedule_id, scheduled_for)
);
create index report_delivery_batches_due_idx
  on public.report_delivery_batches (send_after, created_at)
  where status in ('queued', 'delivering');

create table public.report_delivery_recipients (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.report_delivery_batches(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recipient_membership_id uuid not null references public.memberships(id) on delete cascade,
  channel text not null,
  status text not null default 'queued',
  snapshot_id uuid references public.report_snapshots(id) on delete set null,
  provider_reference text,
  error_code text,
  attempt_count integer not null default 0,
  next_attempt_at timestamptz,
  delivered_at timestamptz,
  locked_at timestamptz,
  lock_token uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint report_delivery_recipients_channel_check check (channel in ('in_app', 'email')),
  constraint report_delivery_recipients_status_check check (
    status in ('queued', 'delivering', 'delivered', 'failed', 'suppressed', 'cancelled')
  ),
  constraint report_delivery_recipients_error_check check (error_code is null or char_length(error_code) <= 100),
  constraint report_delivery_recipients_attempt_check check (attempt_count between 0 and 10),
  unique (batch_id, recipient_membership_id, channel)
);
create index report_delivery_recipients_due_idx
  on public.report_delivery_recipients (next_attempt_at, created_at)
  where status in ('queued', 'failed');

alter table public.report_schedule_runs drop constraint report_schedule_runs_outcome_check;
alter table public.report_schedule_runs
  add constraint report_schedule_runs_outcome_check check (
    outcome in ('running', 'queued', 'delivered', 'partially_failed', 'failed', 'paused', 'cancelled')
  );

-- Scheduled snapshots are permission-filtered per recipient. A single schedule
-- occurrence can therefore own multiple snapshots without leaking owner data.
drop index if exists public.report_snapshots_schedule_run_unique;
create unique index report_snapshots_schedule_recipient_unique
  on public.report_snapshots (schedule_id, scheduled_for, owner_membership_id)
  where schedule_id is not null;

create or replace function private.report_section_permission(p_section text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_section
    when 'crm' then 'crm.workspace.view'
    when 'projects' then 'projects.workspace.view'
    when 'finance' then 'finance.workspace.view'
    when 'hr' then 'hr.workspace.view'
    when 'support' then 'support.workspace.view'
    when 'legal' then 'legal.workspace.view'
    when 'founder_daily' then 'reports.founder_pack.view'
    when 'founder_weekly' then 'reports.founder_pack.view'
    else 'reports.workspace.view'
  end
$$;

create or replace function private.report_saved_view_access_allowed(
  p_saved_view_id uuid,
  p_membership_id uuid
) returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_view public.report_saved_views%rowtype;
  v_membership public.memberships%rowtype;
begin
  select * into v_view from public.report_saved_views where id = p_saved_view_id and status = 'active';
  if v_view.id is null then return false; end if;

  select * into v_membership
  from public.memberships
  where id = p_membership_id
    and organization_id = v_view.organization_id
    and status = 'active';
  if v_membership.id is null then return false; end if;

  if not private.membership_has_permission(p_membership_id, 'reports.workspace.view') then return false; end if;
  if not private.membership_has_permission(p_membership_id, private.report_section_permission(v_view.section)) then return false; end if;
  if p_membership_id = v_view.owner_membership_id then return true; end if;

  return case v_view.visibility
    when 'organization' then true
    when 'founder' then private.membership_has_permission(p_membership_id, 'reports.founder_pack.view')
    when 'management' then private.membership_has_permission(p_membership_id, 'reports.management_pack.view')
    when 'department' then v_membership.department_id = v_view.visibility_department_id
    when 'named' then exists (
      select 1 from public.report_saved_view_recipients recipient
      where recipient.saved_view_id = v_view.id and recipient.membership_id = p_membership_id
    )
    else false
  end;
end;
$$;

revoke all on function private.report_section_permission(text) from public, anon;
revoke all on function private.report_saved_view_access_allowed(uuid, uuid) from public, anon;
grant execute on function private.report_section_permission(text) to authenticated, service_role;
grant execute on function private.report_saved_view_access_allowed(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- CRM: enforce stage requirements, keep immutable conversion/stage history,
-- add billing linkage and monthly forecast targets.
-- ---------------------------------------------------------------------------

alter table public.crm_leads add column closed_at timestamptz;

create table public.crm_lead_stage_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  from_stage_id uuid references public.crm_pipeline_stages(id) on delete set null,
  to_stage_id uuid not null references public.crm_pipeline_stages(id) on delete restrict,
  changed_by_membership_id uuid references public.memberships(id) on delete set null,
  entered_at timestamptz not null default now(),
  exited_at timestamptz,
  reason text,
  created_at timestamptz not null default now(),
  constraint crm_lead_stage_history_reason_check check (reason is null or char_length(reason) <= 500)
);
create index crm_lead_stage_history_lead_idx on public.crm_lead_stage_history (lead_id, entered_at desc);
create index crm_lead_stage_history_stage_idx on public.crm_lead_stage_history (organization_id, to_stage_id, entered_at desc);

create table public.crm_client_billing_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  source_lead_id uuid references public.crm_leads(id) on delete set null,
  billing_contact_id uuid references public.crm_contacts(id) on delete set null,
  currency text not null,
  payment_terms_days integer not null default 30,
  status text not null default 'active',
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_client_billing_profiles_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint crm_client_billing_profiles_terms_check check (payment_terms_days between 0 and 365),
  constraint crm_client_billing_profiles_status_check check (status in ('active', 'inactive')),
  unique (organization_id, company_id)
);

create table public.crm_lead_conversions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.crm_leads(id) on delete restrict,
  company_id uuid not null references public.crm_companies(id) on delete restrict,
  contact_id uuid references public.crm_contacts(id) on delete set null,
  billing_profile_id uuid references public.crm_client_billing_profiles(id) on delete set null,
  legal_contract_id uuid references public.legal_contracts(id) on delete set null,
  converted_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  source text,
  original_stage_id uuid references public.crm_pipeline_stages(id) on delete set null,
  original_estimated_value numeric(18,2),
  original_probability smallint,
  sales_cycle_days numeric(10,2),
  converted_at timestamptz not null default now(),
  evidence jsonb not null default '{}'::jsonb,
  constraint crm_lead_conversions_probability_check check (original_probability is null or original_probability between 0 and 100),
  constraint crm_lead_conversions_evidence_check check (jsonb_typeof(evidence) = 'object' and pg_column_size(evidence) <= 8192),
  unique (lead_id)
);
create index crm_lead_conversions_time_idx on public.crm_lead_conversions (organization_id, converted_at desc);

create table public.crm_forecast_targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  month date not null,
  currency text not null,
  target_value numeric(18,2) not null,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_forecast_targets_month_check check (month = date_trunc('month', month)::date),
  constraint crm_forecast_targets_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint crm_forecast_targets_value_check check (target_value >= 0),
  unique (organization_id, month, currency)
);

create or replace function private.crm_required_field_present(p_lead public.crm_leads, p_field text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_field
    when 'name' then btrim(coalesce(p_lead.name, '')) <> ''
    when 'source' then btrim(coalesce(p_lead.source, '')) <> ''
    when 'estimated_value' then p_lead.estimated_value is not null
    when 'expected_close_date' then p_lead.expected_close_date is not null
    when 'owner_membership_id' then p_lead.owner_membership_id is not null
    when 'email' then btrim(coalesce(p_lead.email, '')) <> ''
    when 'phone' then btrim(coalesce(p_lead.phone, '')) <> ''
    when 'company_name' then btrim(coalesce(p_lead.company_name, '')) <> ''
    when 'follow_up_at' then p_lead.follow_up_at is not null
    when 'notes' then btrim(coalesce(p_lead.notes, '')) <> ''
    else coalesce(nullif(btrim(p_lead.extra_fields ->> p_field), ''), '') <> ''
  end
$$;

create or replace function private.enforce_crm_stage_required_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_required jsonb;
  v_field text;
begin
  select required_fields into v_required
  from public.crm_pipeline_stages
  where id = new.stage_id and organization_id = new.organization_id;

  for v_field in select jsonb_array_elements_text(coalesce(v_required, '[]'::jsonb))
  loop
    if not private.crm_required_field_present(new, v_field) then
      raise exception using errcode = '23514', message = 'crm-stage-required-field:' || v_field;
    end if;
  end loop;

  if new.status = 'lost' and btrim(coalesce(new.lost_reason, '')) = '' then
    raise exception using errcode = '23514', message = 'crm-lost-reason-required';
  end if;

  if new.status in ('converted', 'lost') and new.closed_at is null then new.closed_at := now(); end if;
  if new.status not in ('converted', 'lost') then new.closed_at := null; end if;
  return new;
end;
$$;

create trigger crm_leads_enforce_stage_required_fields
before insert or update of stage_id, status, source, estimated_value, expected_close_date,
  owner_membership_id, email, phone, company_name, follow_up_at, notes, extra_fields, lost_reason
on public.crm_leads
for each row execute function private.enforce_crm_stage_required_fields();

create or replace function private.record_crm_lead_stage_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.crm_lead_stage_history (
      organization_id, lead_id, from_stage_id, to_stage_id, changed_by_membership_id, entered_at
    ) values (
      new.organization_id, new.id, null, new.stage_id,
      private.current_membership_id(new.organization_id), coalesce(new.created_at, now())
    );
    return new;
  end if;

  if new.stage_id is distinct from old.stage_id then
    update public.crm_lead_stage_history
    set exited_at = now()
    where lead_id = new.id and exited_at is null;
    insert into public.crm_lead_stage_history (
      organization_id, lead_id, from_stage_id, to_stage_id, changed_by_membership_id, entered_at
    ) values (
      new.organization_id, new.id, old.stage_id, new.stage_id,
      private.current_membership_id(new.organization_id), now()
    );
  end if;
  return new;
end;
$$;

create trigger crm_leads_record_stage_history
  after insert or update of stage_id on public.crm_leads
  for each row execute function private.record_crm_lead_stage_history();

-- Backfill one durable history entry for pre-existing leads.
insert into public.crm_lead_stage_history (organization_id, lead_id, to_stage_id, entered_at)
select lead.organization_id, lead.id, lead.stage_id, lead.created_at
from public.crm_leads as lead
where not exists (
  select 1 from public.crm_lead_stage_history history where history.lead_id = lead.id
);

-- ---------------------------------------------------------------------------
-- Projects: commercial model, historical labor-cost snapshots, personal saved
-- filters, reusable templates, task reminders, and closure readiness fields.
-- ---------------------------------------------------------------------------

alter table public.projects
  add column currency text,
  add column billing_method text not null default 'none',
  add column budget_minor bigint,
  add column hourly_rate_minor bigint,
  add column fixed_price_minor bigint,
  add column retainer_amount_minor bigint,
  add column estimated_completion_date date,
  add column actual_completion_date date;

update public.projects as project
set currency = coalesce(company.currency, organization.default_currency)
from public.organizations as organization
left join public.crm_companies as company on company.id = project.company_id
where organization.id = project.organization_id and project.currency is null;

alter table public.projects alter column currency set not null;
alter table public.projects
  add constraint projects_currency_check check (currency ~ '^[A-Z]{3}$'),
  add constraint projects_billing_method_check check (billing_method in ('none', 'hourly', 'fixed', 'retainer')),
  add constraint projects_budget_check check (budget_minor is null or budget_minor >= 0),
  add constraint projects_hourly_rate_check check (hourly_rate_minor is null or hourly_rate_minor >= 0),
  add constraint projects_fixed_price_check check (fixed_price_minor is null or fixed_price_minor >= 0),
  add constraint projects_retainer_amount_check check (retainer_amount_minor is null or retainer_amount_minor >= 0),
  add constraint projects_completion_dates_check check (
    estimated_completion_date is null or start_date is null or estimated_completion_date >= start_date
  );

alter table public.project_members add column hourly_cost_rate_minor bigint not null default 0;
alter table public.project_members
  add constraint project_members_cost_rate_check check (hourly_cost_rate_minor >= 0);

alter table public.project_time_entries
  add column hourly_cost_rate_minor bigint not null default 0,
  add column submission_status text not null default 'submitted';
alter table public.project_time_entries
  add constraint project_time_entries_cost_rate_check check (hourly_cost_rate_minor >= 0),
  add constraint project_time_entries_submission_check check (submission_status in ('draft', 'submitted'));

create or replace function private.snapshot_project_time_cost_rate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.hourly_cost_rate_minor = 0 then
    select coalesce(member.hourly_cost_rate_minor, 0)
      into new.hourly_cost_rate_minor
    from public.project_members member
    where member.project_id = new.project_id and member.membership_id = new.membership_id;
  end if;
  return new;
end;
$$;
create trigger project_time_entries_snapshot_cost_rate
  before insert on public.project_time_entries
  for each row execute function private.snapshot_project_time_cost_rate();

alter table public.project_tasks
  add column reminder_at timestamptz,
  add column reminder_sent_at timestamptz;
create index project_tasks_reminder_due_idx
  on public.project_tasks (organization_id, reminder_at)
  where reminder_at is not null and reminder_sent_at is null;

create table public.project_saved_filters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_membership_id uuid not null references public.memberships(id) on delete cascade,
  name text not null,
  filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_saved_filters_name_check check (char_length(btrim(name)) between 1 and 100),
  constraint project_saved_filters_json_check check (jsonb_typeof(filters) = 'object' and pg_column_size(filters) <= 4096),
  unique (organization_id, owner_membership_id, name)
);

create table public.project_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  blueprint jsonb not null,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_templates_name_check check (char_length(btrim(name)) between 1 and 120),
  constraint project_templates_description_check check (description is null or char_length(description) <= 1000),
  constraint project_templates_blueprint_check check (jsonb_typeof(blueprint) = 'object' and pg_column_size(blueprint) <= 262144),
  constraint project_templates_status_check check (status in ('active', 'archived')),
  unique (organization_id, name)
);

-- ---------------------------------------------------------------------------
-- Generic updated_at triggers for new mutable records.
-- ---------------------------------------------------------------------------

create trigger report_delivery_batches_set_updated_at before update on public.report_delivery_batches
for each row execute function private.set_updated_at();
create trigger report_delivery_recipients_set_updated_at before update on public.report_delivery_recipients
for each row execute function private.set_updated_at();
create trigger crm_client_billing_profiles_set_updated_at before update on public.crm_client_billing_profiles
for each row execute function private.set_updated_at();
create trigger crm_forecast_targets_set_updated_at before update on public.crm_forecast_targets
for each row execute function private.set_updated_at();
create trigger project_saved_filters_set_updated_at before update on public.project_saved_filters
for each row execute function private.set_updated_at();
create trigger project_templates_set_updated_at before update on public.project_templates
for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS. Server-side operations still reauthorize explicitly; these policies keep
-- direct authenticated access aligned with the same ownership/capability model.
-- ---------------------------------------------------------------------------

alter table public.report_saved_view_recipients enable row level security;
alter table public.report_schedule_recipients enable row level security;
alter table public.report_delivery_batches enable row level security;
alter table public.report_delivery_recipients enable row level security;
alter table public.crm_lead_stage_history enable row level security;
alter table public.crm_client_billing_profiles enable row level security;
alter table public.crm_lead_conversions enable row level security;
alter table public.crm_forecast_targets enable row level security;
alter table public.project_saved_filters enable row level security;
alter table public.project_templates enable row level security;

create policy report_saved_view_recipients_select on public.report_saved_view_recipients for select to authenticated
using (private.report_saved_view_access_allowed(saved_view_id, private.current_membership_id(organization_id)));
create policy report_saved_view_recipients_manage on public.report_saved_view_recipients for all to authenticated
using (exists (
  select 1 from public.report_saved_views view
  where view.id = saved_view_id
    and view.owner_membership_id = private.current_membership_id(organization_id)
    and private.membership_has_permission(private.current_membership_id(organization_id), 'reports.saved_view.manage')
))
with check (exists (
  select 1 from public.report_saved_views view
  where view.id = saved_view_id
    and view.owner_membership_id = private.current_membership_id(organization_id)
    and private.membership_has_permission(private.current_membership_id(organization_id), 'reports.saved_view.manage')
));

create policy report_schedule_recipients_manage on public.report_schedule_recipients for all to authenticated
using (exists (
  select 1 from public.report_schedules schedule
  where schedule.id = schedule_id
    and schedule.owner_membership_id = private.current_membership_id(organization_id)
    and private.membership_has_permission(private.current_membership_id(organization_id), 'reports.schedule.manage')
))
with check (exists (
  select 1 from public.report_schedules schedule
  where schedule.id = schedule_id
    and schedule.owner_membership_id = private.current_membership_id(organization_id)
    and private.membership_has_permission(private.current_membership_id(organization_id), 'reports.schedule.manage')
));

create policy report_delivery_batches_owner on public.report_delivery_batches for select to authenticated
using (owner_membership_id = private.current_membership_id(organization_id));
create policy report_delivery_recipients_participant on public.report_delivery_recipients for select to authenticated
using (
  recipient_membership_id = private.current_membership_id(organization_id)
  or exists (
    select 1 from public.report_delivery_batches batch
    where batch.id = batch_id and batch.owner_membership_id = private.current_membership_id(organization_id)
  )
);

create policy crm_lead_stage_history_view on public.crm_lead_stage_history for select to authenticated
using (
  private.membership_has_permission(private.current_membership_id(organization_id), 'crm.lead.view')
  and exists (
    select 1 from public.crm_leads lead
    where lead.id = lead_id
      and private.crm_scope_allows_membership(
        private.current_membership_id(organization_id),
        'organization', lead.owner_membership_id, lead.created_by_membership_id
      )
  )
);
create policy crm_client_billing_profiles_view on public.crm_client_billing_profiles for select to authenticated
using (private.membership_has_permission(private.current_membership_id(organization_id), 'crm.company.view'));
create policy crm_lead_conversions_view on public.crm_lead_conversions for select to authenticated
using (private.membership_has_permission(private.current_membership_id(organization_id), 'crm.lead.view'));
create policy crm_forecast_targets_view on public.crm_forecast_targets for select to authenticated
using (private.membership_has_permission(private.current_membership_id(organization_id), 'crm.lead.view'));
create policy crm_forecast_targets_manage on public.crm_forecast_targets for all to authenticated
using (private.membership_has_permission(private.current_membership_id(organization_id), 'crm.pipeline.manage'))
with check (private.membership_has_permission(private.current_membership_id(organization_id), 'crm.pipeline.manage'));

create policy project_saved_filters_owner on public.project_saved_filters for all to authenticated
using (owner_membership_id = private.current_membership_id(organization_id))
with check (owner_membership_id = private.current_membership_id(organization_id));
create policy project_templates_view on public.project_templates for select to authenticated
using (private.membership_has_permission(private.current_membership_id(organization_id), 'projects.project.view'));
create policy project_templates_manage on public.project_templates for all to authenticated
using (private.membership_has_permission(private.current_membership_id(organization_id), 'projects.project.create'))
with check (private.membership_has_permission(private.current_membership_id(organization_id), 'projects.project.create'));

-- Existing saved-view read policy becomes visibility-aware while mutations stay owner-only.
drop policy if exists report_saved_views_select on public.report_saved_views;
create policy report_saved_views_select on public.report_saved_views for select to authenticated
using (private.report_saved_view_access_allowed(id, private.current_membership_id(organization_id)));

-- Allow each recipient to download only the snapshot generated under their own
-- permission context; schedule owners retain access to their own copy naturally.
drop policy if exists report_snapshots_select on public.report_snapshots;
create policy report_snapshots_select on public.report_snapshots for select to authenticated
using (
  owner_membership_id = private.current_membership_id(organization_id)
  and private.membership_has_permission(private.current_membership_id(organization_id), 'reports.snapshot.download')
);

-- ---------------------------------------------------------------------------
-- Project closure checks are named so system checks can be recomputed instead
-- of relying on a user-ticked checkbox. Deliverables and project asset/access
-- returns remain explicit human confirmations because the current asset model
-- is member-based rather than project-assignment based.
-- ---------------------------------------------------------------------------

alter table public.project_closure_items add column check_key text;
update public.project_closure_items
set check_key = case position
  when 1 then 'tasks_complete'
  when 2 then 'time_submitted'
  when 3 then 'deliverables_confirmed'
  when 4 then 'followups_recorded'
  else 'legacy_' || position::text
end
where check_key is null;

insert into public.project_closure_items (project_id, label, position, is_required, check_key)
select project.id, item.label, item.position, true, item.check_key
from public.projects project
cross join (values
  ('Project expenses and reimbursements are resolved', 5, 'expenses_resolved'),
  ('Open support work is resolved or transferred', 6, 'support_resolved'),
  ('Project assets, credentials, and access are returned or reassigned', 7, 'assets_returned'),
  ('Final billing is issued and no calculated billable value remains unbilled', 8, 'final_billing_complete')
) as item(label, position, check_key)
on conflict (project_id, position) do nothing;

alter table public.project_closure_items alter column check_key set not null;
create unique index project_closure_items_key_unique on public.project_closure_items(project_id, check_key);

create or replace function private.seed_project_closure_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.project_closure_items (project_id, label, position, is_required, check_key)
  values
    (new.id, 'All required tasks are completed or cancelled', 1, true, 'tasks_complete'),
    (new.id, 'Time entries and delivery effort are submitted and reviewed', 2, true, 'time_submitted'),
    (new.id, 'Client or internal deliverables are confirmed', 3, true, 'deliverables_confirmed'),
    (new.id, 'Outstanding follow-ups are recorded', 4, true, 'followups_recorded'),
    (new.id, 'Project expenses and reimbursements are resolved', 5, true, 'expenses_resolved'),
    (new.id, 'Open support work is resolved or transferred', 6, true, 'support_resolved'),
    (new.id, 'Project assets, credentials, and access are returned or reassigned', 7, true, 'assets_returned'),
    (new.id, 'Final billing is issued and no calculated billable value remains unbilled', 8, true, 'final_billing_complete');
  return new;
end;
$$;

create or replace function private.project_unbilled_minor(p_project_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  with project_value as (
    select project.billing_method, project.hourly_rate_minor, project.fixed_price_minor,
      project.retainer_amount_minor,
      coalesce((
        select sum(entry.minutes)::bigint
        from public.project_time_entries entry
        where entry.project_id = project.id and entry.submission_status = 'submitted'
      ), 0) as submitted_minutes
    from public.projects project where project.id = p_project_id
  ), issued as (
    select coalesce(sum(
      greatest(invoice.subtotal_minor - invoice.discount_minor, 0)
      - coalesce((
        select sum(greatest(credit.subtotal_minor - credit.discount_minor, 0))
        from public.finance_credit_notes credit
        where credit.original_invoice_id = invoice.id and credit.status in ('issued','sent')
      ), 0)
    ) filter (where invoice.status in ('issued','sent','viewed','partially_paid','paid','overdue','disputed','credited')), 0)::bigint as invoiced_minor
    from public.finance_invoices invoice where invoice.project_id = p_project_id
  )
  select greatest(
    case project_value.billing_method
      when 'hourly' then round(project_value.submitted_minutes * coalesce(project_value.hourly_rate_minor, 0) / 60.0)::bigint
      when 'fixed' then coalesce(project_value.fixed_price_minor, 0)
      when 'retainer' then coalesce(project_value.retainer_amount_minor, 0)
      else 0
    end - issued.invoiced_minor,
    0
  )::bigint
  from project_value cross join issued;
$$;

create or replace function private.validate_project_closure_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_open_tasks integer;
  v_incomplete_manual integer;
  v_unsubmitted_time integer;
  v_outstanding_expenses integer;
  v_open_support integer;
  v_unbilled bigint;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' and new.closure_status <> 'closed' then
    raise exception using errcode = '23514', message = 'Complete the project closure workflow before marking the project completed';
  end if;

  if new.closure_status = 'closed' and new.status <> 'completed' then
    raise exception using errcode = '23514', message = 'A closed project must have completed status';
  end if;

  if new.closure_status = 'closed' and old.closure_status is distinct from 'closed' then
    if old.closure_status is distinct from 'requested' then
      raise exception using errcode = '23514', message = 'Project closure must be requested before final close';
    end if;
    if btrim(coalesce(new.closure_notes, '')) = '' then
      raise exception using errcode = '23514', message = 'Closure notes are required before final close';
    end if;

    select count(*)::integer into v_open_tasks
    from public.project_tasks task
    join public.project_task_statuses status on status.id = task.status_id
    where task.project_id = new.id and not status.is_terminal;

    select count(*)::integer into v_unsubmitted_time
    from public.project_time_entries entry
    where entry.project_id = new.id and entry.submission_status <> 'submitted';

    select count(*)::integer into v_outstanding_expenses
    from public.finance_expense_project_allocations allocation
    join public.finance_expenses expense on expense.id = allocation.expense_id
    where allocation.project_id = new.id
      and (expense.approval_status = 'pending' or expense.payment_status in ('unpaid','scheduled'));

    select count(*)::integer into v_open_support
    from public.support_tickets ticket
    where ticket.project_id = new.id and ticket.status not in ('resolved','closed');

    select count(*)::integer into v_incomplete_manual
    from public.project_closure_items item
    where item.project_id = new.id and item.is_required and not item.is_completed
      and item.check_key in ('deliverables_confirmed','followups_recorded','assets_returned');

    v_unbilled := private.project_unbilled_minor(new.id);

    if v_open_tasks > 0 then
      raise exception using errcode = '23514', message = 'All project tasks must be completed or cancelled before closure';
    end if;
    if v_unsubmitted_time > 0 then
      raise exception using errcode = '23514', message = 'Submit all project time entries before closure';
    end if;
    if v_outstanding_expenses > 0 then
      raise exception using errcode = '23514', message = 'Resolve outstanding project expenses before closure';
    end if;
    if v_open_support > 0 then
      raise exception using errcode = '23514', message = 'Resolve or transfer open support tickets before closure';
    end if;
    if v_incomplete_manual > 0 then
      raise exception using errcode = '23514', message = 'Complete deliverable, follow-up, and asset/access confirmations before closure';
    end if;
    if v_unbilled > 0 then
      raise exception using errcode = '23514', message = 'Issue final billing before project closure';
    end if;
  end if;

  if new.closure_status <> 'closed' and new.status = 'completed' and old.status = 'completed' then
    raise exception using errcode = '23514', message = 'A completed project cannot leave the closed state';
  end if;
  return new;
end;
$$;

revoke all on function private.project_unbilled_minor(uuid) from public, anon, authenticated;

-- Durable task-reminder claims prevent duplicate reminders when the worker is
-- retried or multiple worker processes are active.
alter table public.project_tasks
  add column reminder_claimed_at timestamptz,
  add column reminder_claim_token uuid;
create index project_tasks_reminder_claim_idx
  on public.project_tasks (organization_id, reminder_at)
  where reminder_at is not null and reminder_sent_at is null;
