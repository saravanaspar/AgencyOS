-- Saved report views, bounded report layouts, scheduled delivery, and immutable report snapshots.

set lock_timeout = '10s';
set statement_timeout = '120s';

insert into public.permissions (module, resource, action, description, is_sensitive)
values
  ('reports', 'saved_view', 'manage', 'Create and maintain personal saved report views.', false),
  ('reports', 'schedule', 'manage', 'Schedule permission-filtered report delivery to the current member.', true),
  ('reports', 'snapshot', 'create', 'Generate permission-filtered CSV and PDF report snapshots.', true),
  ('reports', 'snapshot', 'download', 'Download previously generated personal report snapshots.', true)
on conflict (module, resource, action) do update
set description = excluded.description,
    is_sensitive = excluded.is_sensitive;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'own'
from public.role_templates as role_template
join public.permissions as permission on permission.key = 'reports.saved_view.manage'
where exists (
  select 1
  from public.role_template_permissions as workspace_grant
  join public.permissions as workspace_permission on workspace_permission.id = workspace_grant.permission_id
  where workspace_grant.role_template_key = role_template.key
    and workspace_permission.key = 'reports.workspace.view'
)
on conflict (role_template_key, permission_id) do update
set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'own'
from public.role_templates as role_template
join public.permissions as permission on permission.key in (
  'reports.schedule.manage', 'reports.snapshot.create', 'reports.snapshot.download'
)
where role_template.key in (
  'owner', 'operations_administrator', 'finance_manager', 'accountant', 'hr_manager',
  'project_manager', 'sales_manager', 'support_manager', 'legal_manager'
)
on conflict (role_template_key, permission_id) do update
set scope = excluded.scope;

insert into public.role_permissions (role_id, permission_id, scope, conditions)
select role.id, template_permission.permission_id, template_permission.scope, '{}'::jsonb
from public.roles as role
join public.role_template_permissions as template_permission
  on template_permission.role_template_key = role.template_key
join public.permissions as permission on permission.id = template_permission.permission_id
where permission.key in (
  'reports.saved_view.manage', 'reports.schedule.manage',
  'reports.snapshot.create', 'reports.snapshot.download'
)
on conflict (role_id, permission_id) do update
set scope = excluded.scope,
    conditions = excluded.conditions,
    updated_at = now();

create table public.report_saved_views (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  owner_membership_id uuid not null references public.memberships(id) on delete restrict,
  name text not null,
  description text,
  section text not null,
  filters jsonb not null default '{}'::jsonb,
  widget_keys text[] not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint report_saved_views_name_check check (char_length(btrim(name)) between 1 and 100),
  constraint report_saved_views_description_check check (description is null or char_length(description) <= 500),
  constraint report_saved_views_section_check check (section in ('overview', 'crm', 'projects', 'finance', 'hr', 'support', 'legal')),
  constraint report_saved_views_filters_check check (jsonb_typeof(filters) = 'object' and pg_column_size(filters) <= 8192),
  constraint report_saved_views_widgets_check check (cardinality(widget_keys) between 1 and 12),
  constraint report_saved_views_status_check check (status in ('active', 'archived'))
);

create unique index report_saved_views_owner_name_unique
on public.report_saved_views (organization_id, owner_membership_id, lower(btrim(name)))
where status = 'active';

create index report_saved_views_owner_index
on public.report_saved_views (organization_id, owner_membership_id, updated_at desc)
where status = 'active';

create table public.report_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  saved_view_id uuid not null references public.report_saved_views(id) on delete restrict,
  owner_membership_id uuid not null references public.memberships(id) on delete restrict,
  cadence text not null,
  local_time time not null,
  timezone text not null,
  weekday smallint,
  month_day smallint,
  format text not null,
  status text not null default 'active',
  next_run_at timestamptz not null,
  last_run_at timestamptz,
  consecutive_failure_count integer not null default 0,
  locked_at timestamptz,
  lock_token uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint report_schedules_cadence_check check (cadence in ('daily', 'weekly', 'monthly')),
  constraint report_schedules_weekday_check check (weekday is null or weekday between 0 and 6),
  constraint report_schedules_month_day_check check (month_day is null or month_day between 1 and 28),
  constraint report_schedules_format_check check (format in ('csv', 'pdf')),
  constraint report_schedules_status_check check (status in ('active', 'paused')),
  constraint report_schedules_failure_count_check check (consecutive_failure_count between 0 and 20),
  constraint report_schedules_shape_check check (
    (cadence = 'daily' and weekday is null and month_day is null)
    or (cadence = 'weekly' and weekday is not null and month_day is null)
    or (cadence = 'monthly' and weekday is null and month_day is not null)
  ),
  unique (saved_view_id)
);

create index report_schedules_due_index
on public.report_schedules (next_run_at, created_at)
where status = 'active';

create table public.report_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  saved_view_id uuid not null references public.report_saved_views(id) on delete restrict,
  schedule_id uuid references public.report_schedules(id) on delete set null,
  scheduled_for timestamptz,
  owner_membership_id uuid not null references public.memberships(id) on delete restrict,
  private_file_id uuid not null unique references public.private_files(id) on delete restrict,
  format text not null,
  report_name text not null,
  section text not null,
  period_from date not null,
  period_to date not null,
  source_hash text not null,
  row_count integer not null default 0,
  generated_at timestamptz not null default now(),
  constraint report_snapshots_format_check check (format in ('csv', 'pdf')),
  constraint report_snapshots_name_check check (char_length(report_name) between 1 and 100),
  constraint report_snapshots_section_check check (section in ('overview', 'crm', 'projects', 'finance', 'hr', 'support', 'legal')),
  constraint report_snapshots_source_hash_check check (source_hash ~ '^[0-9a-f]{64}$'),
  constraint report_snapshots_row_count_check check (row_count between 0 and 100000),
  constraint report_snapshots_period_check check (period_from <= period_to),
  constraint report_snapshots_schedule_shape_check check (
    (schedule_id is null and scheduled_for is null)
    or (schedule_id is not null and scheduled_for is not null)
  )
);

create unique index report_snapshots_schedule_run_unique
on public.report_snapshots (schedule_id, scheduled_for)
where schedule_id is not null;

create index report_snapshots_owner_index
on public.report_snapshots (organization_id, owner_membership_id, generated_at desc);

create table public.report_schedule_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  schedule_id uuid not null references public.report_schedules(id) on delete restrict,
  saved_view_id uuid not null references public.report_saved_views(id) on delete restrict,
  owner_membership_id uuid not null references public.memberships(id) on delete restrict,
  scheduled_for timestamptz not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  outcome text not null,
  snapshot_id uuid references public.report_snapshots(id) on delete set null,
  error_code text,
  evidence jsonb not null default '{}'::jsonb,
  constraint report_schedule_runs_outcome_check check (outcome in ('running', 'delivered', 'failed', 'paused')),
  constraint report_schedule_runs_error_check check (error_code is null or char_length(error_code) <= 100),
  constraint report_schedule_runs_evidence_check check (jsonb_typeof(evidence) = 'object' and pg_column_size(evidence) <= 4096)
);

create unique index report_schedule_runs_schedule_occurrence_unique
on public.report_schedule_runs (schedule_id, scheduled_for);

create index report_schedule_runs_schedule_index
on public.report_schedule_runs (schedule_id, started_at desc);

create or replace function private.report_schedule_next_run(
  p_cadence text,
  p_local_time time,
  p_timezone text,
  p_weekday smallint,
  p_month_day smallint,
  p_after timestamptz
) returns timestamptz
language plpgsql
stable
set search_path = pg_catalog, public, private
as $$
declare
  v_local timestamp;
  v_date date;
  v_candidate timestamptz;
  v_weekday integer;
begin
  perform 1 from pg_timezone_names where name = p_timezone;
  if not found then raise exception 'invalid-report-timezone'; end if;

  v_local := timezone(p_timezone, p_after);
  v_date := v_local::date;

  if p_cadence = 'daily' then
    v_candidate := (v_date + p_local_time) at time zone p_timezone;
    if v_candidate <= p_after then
      v_candidate := ((v_date + 1) + p_local_time) at time zone p_timezone;
    end if;
    return v_candidate;
  end if;

  if p_cadence = 'weekly' then
    v_weekday := extract(dow from v_date)::integer;
    v_date := v_date + ((p_weekday::integer - v_weekday + 7) % 7);
    v_candidate := (v_date + p_local_time) at time zone p_timezone;
    if v_candidate <= p_after then
      v_candidate := ((v_date + 7) + p_local_time) at time zone p_timezone;
    end if;
    return v_candidate;
  end if;

  v_date := make_date(extract(year from v_date)::integer, extract(month from v_date)::integer, p_month_day::integer);
  v_candidate := (v_date + p_local_time) at time zone p_timezone;
  if v_candidate <= p_after then
    v_date := (date_trunc('month', v_date) + interval '1 month')::date;
    v_date := make_date(extract(year from v_date)::integer, extract(month from v_date)::integer, p_month_day::integer);
    v_candidate := (v_date + p_local_time) at time zone p_timezone;
  end if;
  return v_candidate;
end;
$$;

create or replace function private.validate_report_advanced_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'report_saved_views' then
    if not exists (
      select 1 from public.memberships
      where id = new.owner_membership_id and organization_id = new.organization_id and status = 'active'
    ) then raise exception 'report-owner-invalid'; end if;
  elsif tg_table_name = 'report_schedules' then
    if not exists (
      select 1 from public.report_saved_views
      where id = new.saved_view_id and organization_id = new.organization_id
        and owner_membership_id = new.owner_membership_id and status = 'active'
    ) then raise exception 'report-view-invalid'; end if;
    perform private.report_schedule_next_run(
      new.cadence, new.local_time, new.timezone, new.weekday, new.month_day, now()
    );
  elsif tg_table_name = 'report_snapshots' then
    if not exists (
      select 1 from public.report_saved_views
      where id = new.saved_view_id and organization_id = new.organization_id
        and owner_membership_id = new.owner_membership_id
    ) then raise exception 'report-view-invalid'; end if;
    if new.schedule_id is not null and not exists (
      select 1 from public.report_schedules
      where id = new.schedule_id and organization_id = new.organization_id
        and saved_view_id = new.saved_view_id and owner_membership_id = new.owner_membership_id
    ) then raise exception 'report-schedule-invalid'; end if;
    if not exists (
      select 1 from public.private_files
      where id = new.private_file_id and organization_id = new.organization_id
        and uploaded_by_membership_id = new.owner_membership_id
        and module_key = 'reports' and entity_type = 'report_snapshot'
        and status = 'available'
    ) then raise exception 'report-private-file-invalid'; end if;
  elsif tg_table_name = 'report_schedule_runs' then
    if not exists (
      select 1 from public.report_schedules
      where id = new.schedule_id and organization_id = new.organization_id
        and saved_view_id = new.saved_view_id and owner_membership_id = new.owner_membership_id
    ) then raise exception 'report-run-invalid'; end if;
  end if;
  return new;
end;
$$;

create trigger report_saved_views_validate
before insert or update on public.report_saved_views
for each row execute function private.validate_report_advanced_row();
create trigger report_schedules_validate
before insert or update on public.report_schedules
for each row execute function private.validate_report_advanced_row();
create trigger report_snapshots_validate
before insert or update on public.report_snapshots
for each row execute function private.validate_report_advanced_row();
create trigger report_schedule_runs_validate
before insert or update on public.report_schedule_runs
for each row execute function private.validate_report_advanced_row();

create trigger report_saved_views_updated_at
before update on public.report_saved_views
for each row execute function private.set_updated_at();
create trigger report_schedules_updated_at
before update on public.report_schedules
for each row execute function private.set_updated_at();

create or replace function private.prevent_report_schedule_run_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, private
as $$
begin
  raise exception 'report schedule runs are append-only';
end;
$$;

create trigger report_schedule_runs_append_only
before update or delete on public.report_schedule_runs
for each row execute function private.prevent_report_schedule_run_mutation();

alter table public.report_saved_views enable row level security;
alter table public.report_schedules enable row level security;
alter table public.report_snapshots enable row level security;
alter table public.report_schedule_runs enable row level security;

create policy report_saved_views_select on public.report_saved_views
for select using (
  private.has_permission(organization_id, 'reports.workspace.view')
  and owner_membership_id = private.current_membership_id(organization_id)
);
create policy report_saved_views_insert on public.report_saved_views
for insert with check (
  private.has_permission(organization_id, 'reports.saved_view.manage')
  and owner_membership_id = private.current_membership_id(organization_id)
);
create policy report_saved_views_update on public.report_saved_views
for update using (
  private.has_permission(organization_id, 'reports.saved_view.manage')
  and owner_membership_id = private.current_membership_id(organization_id)
) with check (
  private.has_permission(organization_id, 'reports.saved_view.manage')
  and owner_membership_id = private.current_membership_id(organization_id)
);

create policy report_schedules_select on public.report_schedules
for select using (
  private.has_permission(organization_id, 'reports.schedule.manage')
  and owner_membership_id = private.current_membership_id(organization_id)
);
create policy report_schedules_insert on public.report_schedules
for insert with check (
  private.has_permission(organization_id, 'reports.schedule.manage')
  and owner_membership_id = private.current_membership_id(organization_id)
);
create policy report_schedules_update on public.report_schedules
for update using (
  private.has_permission(organization_id, 'reports.schedule.manage')
  and owner_membership_id = private.current_membership_id(organization_id)
) with check (
  private.has_permission(organization_id, 'reports.schedule.manage')
  and owner_membership_id = private.current_membership_id(organization_id)
);

create policy report_snapshots_select on public.report_snapshots
for select using (
  private.has_permission(organization_id, 'reports.snapshot.download')
  and owner_membership_id = private.current_membership_id(organization_id)
);
create policy report_snapshots_insert on public.report_snapshots
for insert with check (
  private.has_permission(organization_id, 'reports.snapshot.create')
  and owner_membership_id = private.current_membership_id(organization_id)
);

create policy report_schedule_runs_select on public.report_schedule_runs
for select using (
  private.has_permission(organization_id, 'reports.schedule.manage')
  and owner_membership_id = private.current_membership_id(organization_id)
);
create policy report_schedule_runs_insert on public.report_schedule_runs
for insert with check (
  private.has_permission(organization_id, 'reports.schedule.manage')
  and owner_membership_id = private.current_membership_id(organization_id)
);

grant select, insert, update on public.report_saved_views to authenticated;
grant select, insert, update on public.report_schedules to authenticated;
grant select, insert on public.report_snapshots to authenticated;
grant select, insert on public.report_schedule_runs to authenticated;

revoke all on function private.report_schedule_next_run(text, time, text, smallint, smallint, timestamptz) from public, anon, authenticated;
revoke all on function private.validate_report_advanced_row() from public, anon, authenticated;
revoke all on function private.prevent_report_schedule_run_mutation() from public, anon, authenticated;
