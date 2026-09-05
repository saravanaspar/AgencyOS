-- Founder next-phase depth: forward cash planning, collections state, universal founder work,
-- salary approvals, monthly founder packs, and secure external report destinations.
-- Reuses the existing Approval, Reports, Notifications, Finance, CRM, HR, and worker systems.

set lock_timeout = '10s';
set statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- Permissions. These are deliberately narrow additions to existing modules.
-- ---------------------------------------------------------------------------
insert into public.permissions (module, resource, action, description, is_sensitive)
values
  ('finance', 'cash_forecast', 'manage', 'Manage cash-forecast assumptions and recurring obligations.', true),
  ('finance', 'collection', 'manage', 'Manage collection stages, promises, disputes, notes, and next actions.', true),
  ('reports', 'delivery_destination', 'manage', 'Manage encrypted external report delivery destinations.', true)
on conflict (module, resource, action) do update
set description = excluded.description, is_sensitive = excluded.is_sensitive;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'organization'
from public.role_templates role_template
join public.permissions permission on permission.key in (
  'finance.cash_forecast.manage', 'finance.collection.manage'
)
where role_template.key in ('owner', 'finance_manager')
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'organization'
from public.role_templates role_template
join public.permissions permission on permission.key = 'reports.delivery_destination.manage'
where role_template.key in ('owner', 'operations_administrator', 'finance_manager', 'hr_manager')
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_permissions (role_id, permission_id, scope, conditions)
select role.id, template_permission.permission_id, template_permission.scope, template_permission.conditions
from public.roles role
join public.role_template_permissions template_permission on template_permission.role_template_key = role.template_key
join public.permissions permission on permission.id = template_permission.permission_id
where permission.key in (
  'finance.cash_forecast.manage', 'finance.collection.manage', 'reports.delivery_destination.manage'
)
on conflict (role_id, permission_id) do update
set scope = excluded.scope, conditions = excluded.conditions, updated_at = now();

-- ---------------------------------------------------------------------------
-- 30/60/90 cash forecast configuration. Results remain computed, not persisted.
-- ---------------------------------------------------------------------------
create table public.finance_cash_forecast_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  payroll_day smallint not null default 25,
  pipeline_enabled boolean not null default false,
  historical_collection_enabled boolean not null default true,
  base_collection_delay_days smallint not null default 0,
  conservative_collection_delay_days smallint not null default 14,
  optimistic_collection_delay_days smallint not null default 0,
  base_pipeline_multiplier_bps integer not null default 10000,
  conservative_pipeline_multiplier_bps integer not null default 5000,
  optimistic_pipeline_multiplier_bps integer not null default 12500,
  updated_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_cash_forecast_payroll_day_check check (payroll_day between 1 and 28),
  constraint finance_cash_forecast_delay_check check (
    base_collection_delay_days between 0 and 120
    and conservative_collection_delay_days between 0 and 120
    and optimistic_collection_delay_days between 0 and 120
  ),
  constraint finance_cash_forecast_multiplier_check check (
    base_pipeline_multiplier_bps between 0 and 20000
    and conservative_pipeline_multiplier_bps between 0 and 20000
    and optimistic_pipeline_multiplier_bps between 0 and 20000
  )
);

create table public.finance_cash_recurring_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  label text not null,
  direction text not null,
  item_kind text not null,
  amount_minor bigint not null,
  currency text not null,
  cadence text not null,
  next_due_on date not null,
  end_on date,
  probability_bps integer not null default 10000,
  project_id uuid references public.projects(id) on delete set null,
  active boolean not null default true,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  updated_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_cash_recurring_label_check check (char_length(btrim(label)) between 1 and 160),
  constraint finance_cash_recurring_direction_check check (direction in ('inflow', 'outflow')),
  constraint finance_cash_recurring_kind_check check (
    item_kind in ('retainer_income', 'recurring_income', 'operating_obligation', 'tax_obligation', 'other')
  ),
  constraint finance_cash_recurring_amount_check check (amount_minor between 0 and 9000000000000),
  constraint finance_cash_recurring_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint finance_cash_recurring_cadence_check check (cadence in ('weekly', 'monthly', 'quarterly', 'annual')),
  constraint finance_cash_recurring_dates_check check (end_on is null or end_on >= next_due_on),
  constraint finance_cash_recurring_probability_check check (probability_bps between 0 and 10000)
);
create index finance_cash_recurring_due_idx
  on public.finance_cash_recurring_items (organization_id, active, next_due_on, currency);

create trigger finance_cash_forecast_settings_set_updated_at before update on public.finance_cash_forecast_settings
for each row execute function private.set_updated_at();
create trigger finance_cash_recurring_items_set_updated_at before update on public.finance_cash_recurring_items
for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Collections: one durable case per invoice plus append-only evidence.
-- ---------------------------------------------------------------------------
create table public.finance_collection_policies (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  pre_due_days smallint not null default 3,
  overdue_stage_days smallint[] not null default array[0,7,14,30]::smallint[],
  founder_escalation_days smallint not null default 30,
  reminder_channels text[] not null default array['email']::text[],
  reminder_subject_template text not null default 'Invoice {{invoice}}: {{stage}}',
  reminder_body_template text not null default 'Invoice {{invoice}} for {{company}} is {{stage}}. Due date: {{due_date}}. Please contact your account owner if payment is already arranged or the invoice is disputed.',
  updated_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_collection_pre_due_check check (pre_due_days between 0 and 30),
  constraint finance_collection_escalation_check check (founder_escalation_days between 1 and 365),
  constraint finance_collection_stage_days_check check (
    cardinality(overdue_stage_days) between 1 and 8 and overdue_stage_days <@ array[0,7,14,30,45,60,90]::smallint[]
  ),
  constraint finance_collection_channels_check check (
    cardinality(reminder_channels) between 1 and 2 and reminder_channels <@ array['email','in_app']::text[]
  ),
  constraint finance_collection_templates_check check (
    char_length(reminder_subject_template) between 1 and 200 and char_length(reminder_body_template) between 1 and 4000
  )
);

create table public.finance_collection_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.finance_invoices(id) on delete cascade,
  owner_membership_id uuid references public.memberships(id) on delete set null,
  stage text not null default 'open',
  status text not null default 'open',
  promise_to_pay_on date,
  dispute_suppressed boolean not null default false,
  next_action_at timestamptz,
  last_reminder_at timestamptz,
  last_reminder_stage text,
  delivery_attempt_count smallint not null default 0,
  next_delivery_attempt_at timestamptz,
  last_delivery_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_collection_stage_check check (
    stage in ('pre_due','due_today','overdue_7','overdue_14','overdue_30','overdue_45','overdue_60','overdue_90','open')
  ),
  constraint finance_collection_status_check check (status in ('open','promise_to_pay','disputed','resolved','suppressed')),
  constraint finance_collection_last_stage_check check (
    last_reminder_stage is null or last_reminder_stage in ('pre_due','due_today','overdue_7','overdue_14','overdue_30','overdue_45','overdue_60','overdue_90')
  ),
  constraint finance_collection_delivery_attempt_check check (delivery_attempt_count between 0 and 100),
  constraint finance_collection_delivery_error_check check (last_delivery_error is null or char_length(last_delivery_error) <= 200),
  unique (organization_id, invoice_id)
);
create index finance_collection_cases_action_idx
  on public.finance_collection_cases (organization_id, status, next_action_at, updated_at);
create index finance_collection_cases_delivery_retry_idx
  on public.finance_collection_cases (next_delivery_attempt_at)
  where next_delivery_attempt_at is not null and status in ('open','disputed');

create table public.finance_collection_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null references public.finance_collection_cases(id) on delete cascade,
  invoice_id uuid not null references public.finance_invoices(id) on delete cascade,
  actor_membership_id uuid references public.memberships(id) on delete set null,
  event_type text not null,
  stage text,
  note text,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint finance_collection_event_type_check check (
    event_type in ('opened','stage_changed','reminder_sent','promise_set','promise_cleared','dispute_suppressed','dispute_resumed','note_added','next_action_set','resolved','delivery_failed')
  ),
  constraint finance_collection_event_stage_check check (stage is null or char_length(stage) <= 40),
  constraint finance_collection_event_note_check check (note is null or char_length(note) <= 2000),
  constraint finance_collection_event_evidence_check check (jsonb_typeof(evidence) = 'object' and octet_length(evidence::text) <= 16384)
);
create index finance_collection_events_case_idx
  on public.finance_collection_events (organization_id, case_id, created_at desc);
create unique index finance_collection_events_stage_unique
  on public.finance_collection_events (case_id, stage)
  where event_type = 'stage_changed';
create unique index finance_collection_events_reminder_channel_unique
  on public.finance_collection_events (case_id, stage, (evidence ->> 'channel'))
  where event_type = 'reminder_sent';

create trigger finance_collection_policies_set_updated_at before update on public.finance_collection_policies
for each row execute function private.set_updated_at();
create trigger finance_collection_cases_set_updated_at before update on public.finance_collection_cases
for each row execute function private.set_updated_at();

create or replace function private.prevent_collection_event_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '55000', message = 'Collection evidence is append-only';
end;
$$;
create trigger finance_collection_events_append_only
before update or delete on public.finance_collection_events
for each row execute function private.prevent_collection_event_mutation();

-- ---------------------------------------------------------------------------
-- Universal founder work: persistent state overlays the existing attention queue.
-- ---------------------------------------------------------------------------
create table public.founder_work_item_states (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_membership_id uuid not null references public.memberships(id) on delete cascade,
  item_key text not null,
  item_title text not null,
  source_href text not null,
  source_reason text not null,
  source_meta text not null,
  source_bucket text not null,
  source_tone text not null,
  source_due_at timestamptz,
  source_amount_minor bigint,
  source_currency text,
  state text not null default 'active',
  snoozed_until timestamptz,
  delegated_to_membership_id uuid references public.memberships(id) on delete set null,
  handled_at timestamptz,
  note text,
  updated_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint founder_work_item_key_check check (char_length(item_key) between 3 and 220 and item_key !~ '[[:cntrl:]]'),
  constraint founder_work_item_title_check check (char_length(btrim(item_title)) between 1 and 240),
  constraint founder_work_item_href_check check (char_length(source_href) between 1 and 500 and source_href like '/%' and source_href not like '//%'),
  constraint founder_work_item_reason_check check (char_length(source_reason) between 1 and 1000),
  constraint founder_work_item_meta_check check (char_length(source_meta) between 0 and 1000),
  constraint founder_work_item_bucket_check check (source_bucket in ('critical','today','this_week')),
  constraint founder_work_item_tone_check check (source_tone in ('neutral','success','warning','danger')),
  constraint founder_work_item_money_check check (
    (source_amount_minor is null and source_currency is null)
    or (source_amount_minor is not null and source_currency ~ '^[A-Z]{3}$')
  ),
  constraint founder_work_item_state_check check (state in ('active','snoozed','delegated','handled')),
  constraint founder_work_item_state_shape_check check (
    (state = 'snoozed' and snoozed_until is not null and delegated_to_membership_id is null and handled_at is null)
    or (state = 'delegated' and delegated_to_membership_id is not null and snoozed_until is null and handled_at is null)
    or (state = 'handled' and handled_at is not null and snoozed_until is null)
    or (state = 'active' and snoozed_until is null and delegated_to_membership_id is null and handled_at is null)
  ),
  constraint founder_work_item_note_check check (note is null or char_length(note) <= 1000),
  unique (organization_id, owner_membership_id, item_key)
);
create index founder_work_item_states_delegate_idx
  on public.founder_work_item_states (organization_id, delegated_to_membership_id, state)
  where delegated_to_membership_id is not null;
create trigger founder_work_item_states_set_updated_at before update on public.founder_work_item_states
for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Salary changes now complete through the shared Approval engine.
-- The approval snapshot is the proposal; there is no duplicate staging table.
-- ---------------------------------------------------------------------------
alter table public.hr_salary_structures
  add column approval_request_id uuid references public.approval_requests(id) on delete restrict;
create unique index hr_salary_structures_approval_request_unique
  on public.hr_salary_structures (approval_request_id) where approval_request_id is not null;

create or replace function private.validate_hr_salary_approval_link()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.approval_request_id is null or not exists (
    select 1
    from public.approval_requests request
    join public.approval_definitions definition on definition.id = request.definition_id
    where request.id = new.approval_request_id
      and request.organization_id = new.organization_id
      and request.source_module = 'hr'
      and request.entity_type = 'salary_revision'
      and request.entity_id = new.id::text
      and request.status = 'approved'
      and definition.allow_self_approval = false
  ) then
    raise exception using errcode = '23514', message = 'Salary revisions require an approved shared approval request';
  end if;
  return new;
end;
$$;
create trigger hr_salary_structures_validate_shared_approval
before insert or update of approval_request_id on public.hr_salary_structures
for each row execute function private.validate_hr_salary_approval_link();

create or replace function private.apply_hr_salary_approval_result()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_structure_id uuid;
  v_membership_id uuid;
  v_currency text;
  v_base_salary_minor bigint;
  v_effective_from date;
  v_notes text;
  v_component jsonb;
  v_sort integer := 0;
begin
  if new.source_module <> 'hr' or new.entity_type <> 'salary_revision'
    or new.entity_id is null or old.status = new.status or new.status <> 'approved' then
    return new;
  end if;

  v_structure_id := new.entity_id::uuid;
  v_membership_id := (new.snapshot ->> 'membershipId')::uuid;
  v_currency := new.snapshot ->> 'currency';
  v_base_salary_minor := (new.snapshot ->> 'baseSalaryMinor')::bigint;
  v_effective_from := (new.snapshot ->> 'effectiveFrom')::date;
  v_notes := nullif(new.snapshot ->> 'notes', '');

  if not exists (
    select 1 from public.memberships membership
    where membership.id = v_membership_id and membership.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Salary approval target is outside the organization';
  end if;

  insert into public.hr_salary_structures (
    id, organization_id, membership_id, revision_number, currency, base_salary_minor,
    effective_from, notes, created_by_membership_id, approval_request_id
  ) values (
    v_structure_id, new.organization_id, v_membership_id, 1, v_currency, v_base_salary_minor,
    v_effective_from, v_notes, new.requester_membership_id, new.id
  ) on conflict (id) do nothing;

  for v_component in
    select value from jsonb_array_elements(coalesce(new.snapshot -> 'allowances', '[]'::jsonb))
  loop
    v_sort := v_sort + 1;
    insert into public.hr_salary_structure_components (
      organization_id, salary_structure_id, component_type, name, amount_minor, taxable, sort_order
    ) values (
      new.organization_id, v_structure_id, 'allowance', v_component ->> 'name',
      (v_component ->> 'amountMinor')::bigint, coalesce((v_component ->> 'taxable')::boolean, true), v_sort
    );
  end loop;

  for v_component in
    select value from jsonb_array_elements(coalesce(new.snapshot -> 'deductions', '[]'::jsonb))
  loop
    v_sort := v_sort + 1;
    insert into public.hr_salary_structure_components (
      organization_id, salary_structure_id, component_type, name, amount_minor, taxable, sort_order
    ) values (
      new.organization_id, v_structure_id, 'deduction', v_component ->> 'name',
      (v_component ->> 'amountMinor')::bigint, coalesce((v_component ->> 'taxable')::boolean, true), v_sort
    );
  end loop;

  return new;
end;
$$;
create trigger approval_requests_apply_hr_salary_result
after update of status on public.approval_requests
for each row execute function private.apply_hr_salary_approval_result();

-- ---------------------------------------------------------------------------
-- Monthly founder packs + external report channels.
-- ---------------------------------------------------------------------------
alter table public.report_saved_views drop constraint report_saved_views_section_check;
alter table public.report_saved_views add constraint report_saved_views_section_check check (
  section in ('overview','crm','projects','finance','hr','support','legal','founder_daily','founder_weekly','founder_monthly')
);
alter table public.report_snapshots drop constraint report_snapshots_section_check;
alter table public.report_snapshots add constraint report_snapshots_section_check check (
  section in ('overview','crm','projects','finance','hr','support','legal','founder_daily','founder_weekly','founder_monthly')
);

create or replace function private.report_section_permission(p_section text)
returns text language sql immutable set search_path = '' as $$
  select case p_section
    when 'crm' then 'crm.workspace.view'
    when 'projects' then 'projects.workspace.view'
    when 'finance' then 'finance.report.view'
    when 'hr' then 'hr.workspace.view'
    when 'support' then 'support.workspace.view'
    when 'legal' then 'legal.workspace.view'
    when 'founder_daily' then 'reports.founder_pack.view'
    when 'founder_weekly' then 'reports.founder_pack.view'
    when 'founder_monthly' then 'reports.founder_pack.view'
    else 'reports.workspace.view'
  end;
$$;

alter table public.report_schedules drop constraint report_schedules_delivery_channels_check;
alter table public.report_schedules add constraint report_schedules_delivery_channels_check check (
  cardinality(delivery_channels) between 1 and 5
  and delivery_channels <@ array['in_app','email','slack','telegram','webhook']::text[]
);
alter table public.report_delivery_recipients drop constraint report_delivery_recipients_channel_check;
alter table public.report_delivery_recipients add constraint report_delivery_recipients_channel_check check (
  channel in ('in_app','email','slack','telegram','webhook')
);

create table public.report_delivery_destinations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  channel text not null,
  name text not null,
  encrypted_config text not null,
  status text not null default 'active',
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  updated_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint report_delivery_destinations_channel_check check (channel in ('slack','telegram','webhook')),
  constraint report_delivery_destinations_name_check check (char_length(btrim(name)) between 1 and 100),
  constraint report_delivery_destinations_config_check check (char_length(encrypted_config) between 30 and 8192),
  constraint report_delivery_destinations_status_check check (status in ('active','disabled')),
  unique (organization_id, membership_id, channel, name)
);
create index report_delivery_destinations_active_idx
  on public.report_delivery_destinations (organization_id, membership_id, channel, status, updated_at desc);
create unique index report_delivery_destinations_one_active_channel
  on public.report_delivery_destinations (organization_id, membership_id, channel) where status = 'active';
create trigger report_delivery_destinations_set_updated_at before update on public.report_delivery_destinations
for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Tenant integrity helpers for newly persistent founder state.
-- ---------------------------------------------------------------------------
create or replace function private.validate_founder_next_phase_tenant()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if to_jsonb(new) ? 'updated_by_membership_id' and (to_jsonb(new) ->> 'updated_by_membership_id') is not null
    and not exists (
      select 1 from public.memberships membership
      where membership.id = (to_jsonb(new) ->> 'updated_by_membership_id')::uuid
        and membership.organization_id = new.organization_id
    ) then raise exception using errcode = '23514', message = 'Updater must belong to the organization'; end if;
  if to_jsonb(new) ? 'created_by_membership_id' and (to_jsonb(new) ->> 'created_by_membership_id') is not null
    and not exists (
      select 1 from public.memberships membership
      where membership.id = (to_jsonb(new) ->> 'created_by_membership_id')::uuid
        and membership.organization_id = new.organization_id
    ) then raise exception using errcode = '23514', message = 'Creator must belong to the organization'; end if;
  if to_jsonb(new) ? 'owner_membership_id' and (to_jsonb(new) ->> 'owner_membership_id') is not null
    and not exists (
      select 1 from public.memberships membership
      where membership.id = (to_jsonb(new) ->> 'owner_membership_id')::uuid
        and membership.organization_id = new.organization_id
    ) then raise exception using errcode = '23514', message = 'Owner must belong to the organization'; end if;
  if to_jsonb(new) ? 'membership_id' and (to_jsonb(new) ->> 'membership_id') is not null
    and not exists (
      select 1 from public.memberships membership
      where membership.id = (to_jsonb(new) ->> 'membership_id')::uuid
        and membership.organization_id = new.organization_id
    ) then raise exception using errcode = '23514', message = 'Member must belong to the organization'; end if;
  if to_jsonb(new) ? 'delegated_to_membership_id' and (to_jsonb(new) ->> 'delegated_to_membership_id') is not null
    and not exists (
      select 1 from public.memberships membership
      where membership.id = (to_jsonb(new) ->> 'delegated_to_membership_id')::uuid
        and membership.organization_id = new.organization_id and membership.status = 'active'
    ) then raise exception using errcode = '23514', message = 'Delegate must be an active member of the organization'; end if;
  if to_jsonb(new) ? 'project_id' and (to_jsonb(new) ->> 'project_id') is not null
    and not exists (
      select 1 from public.projects project
      where project.id = (to_jsonb(new) ->> 'project_id')::uuid and project.organization_id = new.organization_id
    ) then raise exception using errcode = '23514', message = 'Project must belong to the organization'; end if;
  if to_jsonb(new) ? 'invoice_id' and (to_jsonb(new) ->> 'invoice_id') is not null
    and not exists (
      select 1 from public.finance_invoices invoice
      where invoice.id = (to_jsonb(new) ->> 'invoice_id')::uuid and invoice.organization_id = new.organization_id
    ) then raise exception using errcode = '23514', message = 'Invoice must belong to the organization'; end if;
  if to_jsonb(new) ? 'case_id' and (to_jsonb(new) ->> 'case_id') is not null
    and not exists (
      select 1 from public.finance_collection_cases collection_case
      where collection_case.id = (to_jsonb(new) ->> 'case_id')::uuid and collection_case.organization_id = new.organization_id
    ) then raise exception using errcode = '23514', message = 'Collection case must belong to the organization'; end if;
  return new;
end;
$$;

create trigger finance_cash_forecast_settings_validate_tenant before insert or update on public.finance_cash_forecast_settings
for each row execute function private.validate_founder_next_phase_tenant();
create trigger finance_cash_recurring_items_validate_tenant before insert or update on public.finance_cash_recurring_items
for each row execute function private.validate_founder_next_phase_tenant();
create trigger finance_collection_policies_validate_tenant before insert or update on public.finance_collection_policies
for each row execute function private.validate_founder_next_phase_tenant();
create trigger finance_collection_cases_validate_tenant before insert or update on public.finance_collection_cases
for each row execute function private.validate_founder_next_phase_tenant();
create trigger finance_collection_events_validate_tenant before insert or update on public.finance_collection_events
for each row execute function private.validate_founder_next_phase_tenant();
create trigger founder_work_item_states_validate_tenant before insert or update on public.founder_work_item_states
for each row execute function private.validate_founder_next_phase_tenant();
create trigger report_delivery_destinations_validate_tenant before insert or update on public.report_delivery_destinations
for each row execute function private.validate_founder_next_phase_tenant();

-- ---------------------------------------------------------------------------
-- RLS + grants. Server actions reauthorize; database policies remain a second boundary.
-- ---------------------------------------------------------------------------
alter table public.finance_cash_forecast_settings enable row level security;
alter table public.finance_cash_recurring_items enable row level security;
alter table public.finance_collection_policies enable row level security;
alter table public.finance_collection_cases enable row level security;
alter table public.finance_collection_events enable row level security;
alter table public.founder_work_item_states enable row level security;
alter table public.report_delivery_destinations enable row level security;

revoke all on public.finance_cash_forecast_settings from public, anon, authenticated;
revoke all on public.finance_cash_recurring_items from public, anon, authenticated;
revoke all on public.finance_collection_policies from public, anon, authenticated;
revoke all on public.finance_collection_cases from public, anon, authenticated;
revoke all on public.finance_collection_events from public, anon, authenticated;
revoke all on public.founder_work_item_states from public, anon, authenticated;
revoke all on public.report_delivery_destinations from public, anon, authenticated;

grant select on public.finance_cash_forecast_settings, public.finance_cash_recurring_items,
  public.finance_collection_policies, public.finance_collection_cases, public.finance_collection_events,
  public.founder_work_item_states, public.report_delivery_destinations to authenticated;
grant all on public.finance_cash_forecast_settings, public.finance_cash_recurring_items,
  public.finance_collection_policies, public.finance_collection_cases, public.finance_collection_events,
  public.founder_work_item_states, public.report_delivery_destinations to service_role;

create policy finance_cash_forecast_settings_view on public.finance_cash_forecast_settings for select to authenticated
using (private.has_permission(organization_id, 'finance.report.view'));
create policy finance_cash_recurring_items_view on public.finance_cash_recurring_items for select to authenticated
using (private.has_permission(organization_id, 'finance.report.view'));
create policy finance_collection_policies_view on public.finance_collection_policies for select to authenticated
using (private.has_permission(organization_id, 'finance.report.view'));
create policy finance_collection_cases_view on public.finance_collection_cases for select to authenticated
using (private.has_permission(organization_id, 'finance.report.view'));
create policy finance_collection_events_view on public.finance_collection_events for select to authenticated
using (private.has_permission(organization_id, 'finance.report.view'));
create policy founder_work_item_states_owner_or_delegate on public.founder_work_item_states for select to authenticated
using (
  (owner_membership_id = private.current_membership_id(organization_id)
    and private.membership_has_permission(owner_membership_id, 'reports.founder_pack.view'))
  or (state = 'delegated' and delegated_to_membership_id = private.current_membership_id(organization_id))
);
create policy report_delivery_destinations_owner on public.report_delivery_destinations for select to authenticated
using (
  membership_id = private.current_membership_id(organization_id)
  and private.membership_has_permission(membership_id, 'reports.delivery_destination.manage')
);

revoke all on function private.prevent_collection_event_mutation() from public, anon;
revoke all on function private.validate_hr_salary_approval_link() from public, anon;
revoke all on function private.apply_hr_salary_approval_result() from public, anon;
revoke all on function private.validate_founder_next_phase_tenant() from public, anon;
