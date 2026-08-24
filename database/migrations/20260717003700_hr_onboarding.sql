-- Employee onboarding plans and checklist workflow. Existing memberships, employee profiles,
-- private HR documents, notifications, and organization structure remain the source of truth.

set lock_timeout = '10s';
set statement_timeout = '120s';

insert into public.permissions (module, resource, action, description, is_sensitive)
values
  ('hr', 'onboarding', 'view', 'View employee onboarding plans inside the effective employee scope.', true),
  ('hr', 'onboarding', 'manage', 'Create, schedule, assign, update, cancel, and complete employee onboarding plans.', true),
  ('hr', 'onboarding', 'update_own', 'Complete employee-owned onboarding acknowledgements on the current employee plan.', true)
on conflict (module, resource, action) do update
set description = excluded.description, is_sensitive = excluded.is_sensitive;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'organization'
from public.role_templates as role_template
cross join public.permissions as permission
where role_template.key in ('owner', 'hr_manager')
  and permission.module = 'hr'
  and permission.resource = 'onboarding'
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'team_lead', permission.id, 'managed_employees'
from public.permissions as permission
where permission.key = 'hr.onboarding.view'
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'employee', permission.id, 'own'
from public.permissions as permission
where permission.key in ('hr.onboarding.view', 'hr.onboarding.update_own')
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_permissions (role_id, permission_id, scope, conditions)
select role.id, template_permission.permission_id, template_permission.scope,
  template_permission.conditions
from public.roles as role
join public.role_template_permissions as template_permission
  on template_permission.role_template_key = role.template_key
join public.permissions as permission on permission.id = template_permission.permission_id
where permission.module = 'hr'
  and permission.resource = 'onboarding'
on conflict (role_id, permission_id) do update
set scope = excluded.scope, conditions = excluded.conditions, updated_at = now();

create table public.hr_onboarding_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  cycle_number integer not null,
  status text not null default 'draft',
  target_start_date date not null,
  first_day_meeting_at timestamptz,
  first_day_meeting_details text,
  probation_review_date date,
  notes text,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  updated_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_onboarding_plans_cycle_valid check (cycle_number > 0),
  constraint hr_onboarding_plans_status_valid check (
    status in ('draft', 'in_progress', 'ready', 'completed', 'cancelled')
  ),
  constraint hr_onboarding_plans_meeting_details_valid check (
    first_day_meeting_details is null or char_length(btrim(first_day_meeting_details)) between 1 and 500
  ),
  constraint hr_onboarding_plans_notes_valid check (
    notes is null or char_length(btrim(notes)) between 1 and 2000
  ),
  constraint hr_onboarding_plans_probation_date_valid check (
    probation_review_date is null or probation_review_date >= target_start_date
  ),
  constraint hr_onboarding_plans_status_timestamps_valid check (
    (status <> 'completed' or completed_at is not null)
    and (status <> 'cancelled' or cancelled_at is not null)
  ),
  unique (organization_id, membership_id, cycle_number)
);

create index hr_onboarding_plans_status_idx
  on public.hr_onboarding_plans (organization_id, status, target_start_date);
create unique index hr_onboarding_plans_active_unique
  on public.hr_onboarding_plans (organization_id, membership_id)
  where status not in ('completed', 'cancelled');
create index hr_onboarding_plans_member_idx
  on public.hr_onboarding_plans (organization_id, membership_id);

create table public.hr_onboarding_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  onboarding_plan_id uuid not null references public.hr_onboarding_plans(id) on delete cascade,
  item_key text not null,
  label text not null,
  position integer not null,
  status text not null default 'pending',
  assigned_membership_id uuid references public.memberships(id) on delete set null,
  due_date date,
  notes text,
  completion_source text,
  completed_at timestamptz,
  completed_by_membership_id uuid references public.memberships(id) on delete set null,
  updated_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_onboarding_items_key_valid check (
    item_key in (
      'offer_accepted', 'employment_documents_collected', 'account_created',
      'department_assigned', 'manager_assigned', 'equipment_requested', 'email_created',
      'policies_acknowledged', 'nda_signed', 'mandatory_training_assigned',
      'first_day_meeting_scheduled', 'probation_review_scheduled'
    )
  ),
  constraint hr_onboarding_items_label_valid check (char_length(btrim(label)) between 2 and 120),
  constraint hr_onboarding_items_position_valid check (position between 1 and 200),
  constraint hr_onboarding_items_status_valid check (
    status in ('pending', 'in_progress', 'complete', 'blocked', 'not_applicable')
  ),
  constraint hr_onboarding_items_notes_valid check (
    notes is null or char_length(btrim(notes)) between 1 and 1000
  ),
  constraint hr_onboarding_items_source_valid check (
    completion_source is null or completion_source in ('manual', 'employee', 'derived')
  ),
  constraint hr_onboarding_items_completion_valid check (
    (status in ('complete', 'not_applicable') and completed_at is not null)
    or (status not in ('complete', 'not_applicable') and completed_at is null)
  ),
  unique (onboarding_plan_id, item_key),
  unique (onboarding_plan_id, position)
);

create index hr_onboarding_items_plan_idx
  on public.hr_onboarding_items (onboarding_plan_id, position);
create index hr_onboarding_items_assignee_idx
  on public.hr_onboarding_items (organization_id, assigned_membership_id, due_date)
  where assigned_membership_id is not null and status not in ('complete', 'not_applicable');

create or replace function private.validate_hr_onboarding_plan_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id
      or new.membership_id is distinct from old.membership_id
      or new.cycle_number is distinct from old.cycle_number
      or new.created_by_membership_id is distinct from old.created_by_membership_id
    then
      raise exception using errcode = '23514', message = 'Onboarding plan identity fields are immutable.';
    end if;
  end if;

  if not exists (
    select 1 from public.memberships as membership
    where membership.id = new.membership_id
      and membership.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Onboarding employee must belong to the organization.';
  end if;

  if not exists (
    select 1 from public.memberships as membership
    where membership.id in (new.created_by_membership_id, new.updated_by_membership_id)
      and membership.organization_id = new.organization_id
    group by membership.organization_id
    having count(distinct membership.id) = case
      when new.created_by_membership_id = new.updated_by_membership_id then 1 else 2 end
  ) then
    raise exception using errcode = '23514', message = 'Onboarding actors must belong to the organization.';
  end if;
  return new;
end;
$$;

create or replace function private.validate_hr_onboarding_item_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_validate_assignee boolean := false;
begin
  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id
      or new.onboarding_plan_id is distinct from old.onboarding_plan_id
      or new.item_key is distinct from old.item_key
      or new.label is distinct from old.label
      or new.position is distinct from old.position
    then
      raise exception using errcode = '23514', message = 'Onboarding checklist identity fields are immutable.';
    end if;
  end if;

  if not exists (
    select 1 from public.hr_onboarding_plans as plan
    where plan.id = new.onboarding_plan_id
      and plan.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Onboarding item must belong to the plan organization.';
  end if;

  if tg_op = 'INSERT' then
    v_validate_assignee := new.assigned_membership_id is not null;
  elsif tg_op = 'UPDATE' then
    v_validate_assignee := new.assigned_membership_id is not null
      and new.assigned_membership_id is distinct from old.assigned_membership_id;
  end if;

  if v_validate_assignee and not exists (
    select 1 from public.memberships as membership
    where membership.id = new.assigned_membership_id
      and membership.organization_id = new.organization_id
      and membership.status in ('active', 'invited')
  ) then
    raise exception using errcode = '23514', message = 'Onboarding assignee must belong to the organization.';
  end if;

  if not exists (
    select 1 from public.memberships as membership
    where membership.id = new.updated_by_membership_id
      and membership.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Onboarding item actor must belong to the organization.';
  end if;
  return new;
end;
$$;

create or replace function private.enforce_hr_onboarding_item_employee_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_current_membership_id uuid;
  v_target_membership_id uuid;
begin
  if (select auth.uid()) is null or private.has_permission(new.organization_id, 'hr.onboarding.manage') then
    return new;
  end if;

  v_current_membership_id := private.current_membership_id(new.organization_id);
  select plan.membership_id into v_target_membership_id
  from public.hr_onboarding_plans as plan
  where plan.id = new.onboarding_plan_id;

  if new.item_key not in ('offer_accepted', 'policies_acknowledged')
    or v_target_membership_id is distinct from v_current_membership_id
    or old.item_key is distinct from new.item_key
    or old.organization_id is distinct from new.organization_id
    or old.onboarding_plan_id is distinct from new.onboarding_plan_id
    or old.label is distinct from new.label
    or old.position is distinct from new.position
    or old.assigned_membership_id is distinct from new.assigned_membership_id
    or old.due_date is distinct from new.due_date
    or old.notes is distinct from new.notes
    or new.status <> 'complete'
    or new.completion_source <> 'employee'
    or new.completed_at is null
    or new.completed_by_membership_id is distinct from v_current_membership_id
    or new.updated_by_membership_id is distinct from v_current_membership_id
  then
    raise exception using errcode = '42501', message = 'Employees may only accept their own offer or acknowledge their own onboarding policies.';
  end if;
  return new;
end;
$$;

create or replace function private.seed_hr_onboarding_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.hr_onboarding_items (
    organization_id, onboarding_plan_id, item_key, label, position, updated_by_membership_id
  ) values
    (new.organization_id, new.id, 'offer_accepted', 'Offer accepted', 10, new.updated_by_membership_id),
    (new.organization_id, new.id, 'employment_documents_collected', 'Employment documents collected', 20, new.updated_by_membership_id),
    (new.organization_id, new.id, 'account_created', 'Account created', 30, new.updated_by_membership_id),
    (new.organization_id, new.id, 'department_assigned', 'Department assigned', 40, new.updated_by_membership_id),
    (new.organization_id, new.id, 'manager_assigned', 'Manager assigned', 50, new.updated_by_membership_id),
    (new.organization_id, new.id, 'equipment_requested', 'Equipment requested', 60, new.updated_by_membership_id),
    (new.organization_id, new.id, 'email_created', 'Email created', 70, new.updated_by_membership_id),
    (new.organization_id, new.id, 'policies_acknowledged', 'Policies acknowledged', 80, new.updated_by_membership_id),
    (new.organization_id, new.id, 'nda_signed', 'NDA signed', 90, new.updated_by_membership_id),
    (new.organization_id, new.id, 'mandatory_training_assigned', 'Mandatory training assigned', 100, new.updated_by_membership_id),
    (new.organization_id, new.id, 'first_day_meeting_scheduled', 'First-day meeting scheduled', 110, new.updated_by_membership_id),
    (new.organization_id, new.id, 'probation_review_scheduled', 'Probation review scheduled', 120, new.updated_by_membership_id);
  return new;
end;
$$;

create or replace function private.refresh_hr_onboarding_plan_status(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer;
  v_finished integer;
  v_prestart_total integer;
  v_prestart_finished integer;
  v_existing_status text;
begin
  select status into v_existing_status
  from public.hr_onboarding_plans where id = p_plan_id;
  if v_existing_status is null or v_existing_status = 'cancelled' then return; end if;

  select count(*)::integer,
    count(*) filter (where status in ('complete', 'not_applicable'))::integer,
    count(*) filter (where item_key not in ('first_day_meeting_scheduled', 'probation_review_scheduled'))::integer,
    count(*) filter (
      where item_key not in ('first_day_meeting_scheduled', 'probation_review_scheduled')
        and status in ('complete', 'not_applicable')
    )::integer
  into v_total, v_finished, v_prestart_total, v_prestart_finished
  from public.hr_onboarding_items
  where onboarding_plan_id = p_plan_id;

  update public.hr_onboarding_plans
  set status = case
      when v_total > 0 and v_finished = v_total then 'completed'
      when v_prestart_total > 0 and v_prestart_finished = v_prestart_total then 'ready'
      when v_finished > 0 or exists (
        select 1 from public.hr_onboarding_items
        where onboarding_plan_id = p_plan_id and status in ('in_progress', 'blocked')
      ) then 'in_progress'
      else 'draft'
    end,
    started_at = case
      when started_at is null and (v_finished > 0 or exists (
        select 1 from public.hr_onboarding_items
        where onboarding_plan_id = p_plan_id and status in ('in_progress', 'blocked')
      )) then now() else started_at end,
    completed_at = case when v_total > 0 and v_finished = v_total then coalesce(completed_at, now()) else null end,
    updated_at = now()
  where id = p_plan_id;
end;
$$;

create or replace function private.hr_onboarding_item_refresh_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.refresh_hr_onboarding_plan_status(new.onboarding_plan_id);
  return new;
end;
$$;

create trigger hr_onboarding_plans_validate_tenant
  before insert or update on public.hr_onboarding_plans
  for each row execute function private.validate_hr_onboarding_plan_tenant();
create trigger hr_onboarding_plans_set_updated_at
  before update on public.hr_onboarding_plans
  for each row execute function private.set_updated_at();
create trigger hr_onboarding_plans_seed_items
  after insert on public.hr_onboarding_plans
  for each row execute function private.seed_hr_onboarding_items();

create trigger hr_onboarding_items_validate_tenant
  before insert or update on public.hr_onboarding_items
  for each row execute function private.validate_hr_onboarding_item_tenant();
create trigger hr_onboarding_items_enforce_employee_update
  before update on public.hr_onboarding_items
  for each row execute function private.enforce_hr_onboarding_item_employee_update();
create trigger hr_onboarding_items_set_updated_at
  before update on public.hr_onboarding_items
  for each row execute function private.set_updated_at();
create trigger hr_onboarding_items_refresh_plan
  after insert or update on public.hr_onboarding_items
  for each row execute function private.hr_onboarding_item_refresh_plan();

alter table public.hr_onboarding_plans enable row level security;
alter table public.hr_onboarding_items enable row level security;

revoke all on public.hr_onboarding_plans from anon;
revoke all on public.hr_onboarding_items from anon;
grant select on public.hr_onboarding_plans to authenticated;
grant select on public.hr_onboarding_items to authenticated;
grant all on public.hr_onboarding_plans to service_role;
grant all on public.hr_onboarding_items to service_role;

create policy hr_onboarding_plans_select_authorized
on public.hr_onboarding_plans for select to authenticated
using (
  private.has_permission(organization_id, 'hr.onboarding.view')
  and private.crm_scope_allows_membership(
    private.current_membership_id(organization_id),
    private.effective_permission_scope(organization_id, 'hr.onboarding.view'),
    membership_id,
    membership_id
  )
);

create policy hr_onboarding_plans_insert_authorized
on public.hr_onboarding_plans for insert to authenticated
with check (
  private.has_permission(organization_id, 'hr.onboarding.manage')
  and created_by_membership_id = private.current_membership_id(organization_id)
  and updated_by_membership_id = private.current_membership_id(organization_id)
  and private.crm_scope_allows_membership(
    private.current_membership_id(organization_id),
    private.effective_permission_scope(organization_id, 'hr.onboarding.manage'),
    membership_id,
    membership_id
  )
);

create policy hr_onboarding_plans_update_authorized
on public.hr_onboarding_plans for update to authenticated
using (
  private.has_permission(organization_id, 'hr.onboarding.manage')
  and private.crm_scope_allows_membership(
    private.current_membership_id(organization_id),
    private.effective_permission_scope(organization_id, 'hr.onboarding.manage'),
    membership_id,
    membership_id
  )
)
with check (
  private.has_permission(organization_id, 'hr.onboarding.manage')
  and updated_by_membership_id = private.current_membership_id(organization_id)
);

create policy hr_onboarding_items_select_authorized
on public.hr_onboarding_items for select to authenticated
using (
  exists (
    select 1 from public.hr_onboarding_plans as plan
    where plan.id = hr_onboarding_items.onboarding_plan_id
      and private.has_permission(plan.organization_id, 'hr.onboarding.view')
      and private.crm_scope_allows_membership(
        private.current_membership_id(plan.organization_id),
        private.effective_permission_scope(plan.organization_id, 'hr.onboarding.view'),
        plan.membership_id,
        plan.membership_id
      )
  )
);

create policy hr_onboarding_items_update_authorized
on public.hr_onboarding_items for update to authenticated
using (
  exists (
    select 1 from public.hr_onboarding_plans as plan
    where plan.id = hr_onboarding_items.onboarding_plan_id
      and (
        (
          private.has_permission(plan.organization_id, 'hr.onboarding.manage')
          and private.crm_scope_allows_membership(
            private.current_membership_id(plan.organization_id),
            private.effective_permission_scope(plan.organization_id, 'hr.onboarding.manage'),
            plan.membership_id,
            plan.membership_id
          )
        )
        or (
          item_key in ('offer_accepted', 'policies_acknowledged')
          and plan.membership_id = private.current_membership_id(plan.organization_id)
          and private.has_permission(plan.organization_id, 'hr.onboarding.update_own')
        )
      )
  )
)
with check (
  updated_by_membership_id = private.current_membership_id(organization_id)
  and exists (
    select 1 from public.hr_onboarding_plans as plan
    where plan.id = hr_onboarding_items.onboarding_plan_id
      and (
        private.has_permission(plan.organization_id, 'hr.onboarding.manage')
        or (
          item_key in ('offer_accepted', 'policies_acknowledged')
          and plan.membership_id = private.current_membership_id(plan.organization_id)
          and private.has_permission(plan.organization_id, 'hr.onboarding.update_own')
        )
      )
  )
);
