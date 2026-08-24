-- Employee offboarding plans and clearance checklist. Existing memberships, employee profiles,
-- projects/tasks, expenses, private HR documents, notifications, and audit events remain sources of truth.

set lock_timeout = '10s';
set statement_timeout = '120s';

insert into public.permissions (module, resource, action, description, is_sensitive)
values
  ('hr', 'offboarding', 'view', 'View employee offboarding plans inside the effective employee scope.', true),
  ('hr', 'offboarding', 'manage', 'Create, coordinate, suspend access, clear, and complete employee offboarding plans.', true),
  ('hr', 'offboarding', 'create_own', 'Submit a resignation and view the resulting own-scope offboarding plan.', true)
on conflict (module, resource, action) do update
set description = excluded.description, is_sensitive = excluded.is_sensitive;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'organization'
from public.role_templates as role_template
cross join public.permissions as permission
where role_template.key in ('owner', 'hr_manager')
  and permission.module = 'hr'
  and permission.resource = 'offboarding'
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'team_lead', permission.id, 'managed_employees'
from public.permissions as permission
where permission.key = 'hr.offboarding.view'
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'employee', permission.id, 'own'
from public.permissions as permission
where permission.key in ('hr.offboarding.view', 'hr.offboarding.create_own')
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_permissions (role_id, permission_id, scope, conditions)
select role.id, template_permission.permission_id, template_permission.scope,
  template_permission.conditions
from public.roles as role
join public.role_template_permissions as template_permission
  on template_permission.role_template_key = role.template_key
join public.permissions as permission on permission.id = template_permission.permission_id
where permission.module = 'hr'
  and permission.resource = 'offboarding'
on conflict (role_id, permission_id) do update
set scope = excluded.scope, conditions = excluded.conditions, updated_at = now();

create table public.hr_offboarding_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  cycle_number integer not null,
  separation_type text not null,
  prior_lifecycle_status text not null,
  status text not null default 'draft',
  notice_date date not null,
  last_working_date date not null,
  reason text,
  replacement_membership_id uuid references public.memberships(id) on delete set null,
  exit_interview_at timestamptz,
  exit_interview_details text,
  notes text,
  account_suspended_at timestamptz,
  final_clearance_at timestamptz,
  archived_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  updated_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_offboarding_plans_cycle_valid check (cycle_number > 0),
  constraint hr_offboarding_plans_type_valid check (
    separation_type in ('resignation', 'termination', 'contract_end', 'retirement', 'redundancy', 'other')
  ),
  constraint hr_offboarding_plans_status_valid check (
    status in ('draft', 'in_progress', 'ready', 'completed', 'cancelled')
  ),
  constraint hr_offboarding_plans_prior_lifecycle_valid check (
    prior_lifecycle_status in ('preboarding', 'active', 'probation', 'confirmed', 'notice_period', 'exited', 'archived')
  ),
  constraint hr_offboarding_plans_dates_valid check (last_working_date >= notice_date),
  constraint hr_offboarding_plans_reason_valid check (
    reason is null or char_length(btrim(reason)) between 1 and 2000
  ),
  constraint hr_offboarding_plans_exit_details_valid check (
    exit_interview_details is null or char_length(btrim(exit_interview_details)) between 1 and 1000
  ),
  constraint hr_offboarding_plans_notes_valid check (
    notes is null or char_length(btrim(notes)) between 1 and 2000
  ),
  constraint hr_offboarding_plans_status_timestamps_valid check (
    (status <> 'completed' or completed_at is not null)
    and (status <> 'cancelled' or cancelled_at is not null)
  ),
  unique (organization_id, membership_id, cycle_number)
);

create unique index hr_offboarding_plans_active_unique
  on public.hr_offboarding_plans (organization_id, membership_id)
  where status not in ('completed', 'cancelled');
create index hr_offboarding_plans_status_idx
  on public.hr_offboarding_plans (organization_id, status, last_working_date);
create index hr_offboarding_plans_member_idx
  on public.hr_offboarding_plans (organization_id, membership_id, cycle_number desc);

create table public.hr_offboarding_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  offboarding_plan_id uuid not null references public.hr_offboarding_plans(id) on delete cascade,
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
  constraint hr_offboarding_items_key_valid check (
    item_key in (
      'separation_record', 'last_working_date', 'knowledge_transfer', 'project_reassignment',
      'open_task_review', 'asset_return', 'expense_settlement', 'account_suspension',
      'vault_access_removal', 'document_generation', 'exit_interview', 'final_clearance',
      'employee_archive'
    )
  ),
  constraint hr_offboarding_items_label_valid check (char_length(btrim(label)) between 2 and 120),
  constraint hr_offboarding_items_position_valid check (position between 1 and 200),
  constraint hr_offboarding_items_status_valid check (
    status in ('pending', 'in_progress', 'complete', 'blocked', 'not_applicable')
  ),
  constraint hr_offboarding_items_notes_valid check (
    notes is null or char_length(btrim(notes)) between 1 and 1000
  ),
  constraint hr_offboarding_items_source_valid check (
    completion_source is null or completion_source in ('manual', 'derived', 'system')
  ),
  constraint hr_offboarding_items_completion_valid check (
    (status in ('complete', 'not_applicable') and completed_at is not null)
    or (status not in ('complete', 'not_applicable') and completed_at is null)
  ),
  unique (offboarding_plan_id, item_key),
  unique (offboarding_plan_id, position)
);

create index hr_offboarding_items_plan_idx
  on public.hr_offboarding_items (offboarding_plan_id, position);
create index hr_offboarding_items_assignee_idx
  on public.hr_offboarding_items (organization_id, assigned_membership_id, due_date)
  where assigned_membership_id is not null and status not in ('complete', 'not_applicable');

create or replace function private.validate_hr_offboarding_plan_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (
    new.organization_id is distinct from old.organization_id
    or new.membership_id is distinct from old.membership_id
    or new.cycle_number is distinct from old.cycle_number
    or new.prior_lifecycle_status is distinct from old.prior_lifecycle_status
    or new.created_by_membership_id is distinct from old.created_by_membership_id
  ) then
    raise exception using errcode = '23514', message = 'Offboarding plan identity fields are immutable.';
  end if;

  if not exists (
    select 1 from public.memberships as membership
    where membership.id = new.membership_id and membership.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Offboarding employee must belong to the organization.';
  end if;

  if new.replacement_membership_id is not null and (
    new.replacement_membership_id = new.membership_id
    or not exists (
      select 1 from public.memberships as replacement
      where replacement.id = new.replacement_membership_id
        and replacement.organization_id = new.organization_id
        and replacement.status = 'active'
    )
  ) then
    raise exception using errcode = '23514', message = 'Replacement must be another active organization member.';
  end if;

  if not exists (
    select 1 from public.memberships as actor
    where actor.id in (new.created_by_membership_id, new.updated_by_membership_id)
      and actor.organization_id = new.organization_id
    group by actor.organization_id
    having count(distinct actor.id) = case
      when new.created_by_membership_id = new.updated_by_membership_id then 1 else 2 end
  ) then
    raise exception using errcode = '23514', message = 'Offboarding actors must belong to the organization.';
  end if;
  return new;
end;
$$;

create or replace function private.validate_hr_offboarding_item_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (
    new.organization_id is distinct from old.organization_id
    or new.offboarding_plan_id is distinct from old.offboarding_plan_id
    or new.item_key is distinct from old.item_key
    or new.label is distinct from old.label
    or new.position is distinct from old.position
  ) then
    raise exception using errcode = '23514', message = 'Offboarding checklist identity fields are immutable.';
  end if;

  if not exists (
    select 1 from public.hr_offboarding_plans as plan
    where plan.id = new.offboarding_plan_id and plan.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Offboarding item must belong to the plan organization.';
  end if;

  if new.assigned_membership_id is not null and not exists (
    select 1 from public.memberships as membership
    where membership.id = new.assigned_membership_id
      and membership.organization_id = new.organization_id
      and membership.status in ('active', 'invited')
  ) then
    raise exception using errcode = '23514', message = 'Offboarding assignee must belong to the organization.';
  end if;

  if not exists (
    select 1 from public.memberships as membership
    where membership.id = new.updated_by_membership_id
      and membership.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Offboarding item actor must belong to the organization.';
  end if;
  return new;
end;
$$;

create or replace function private.enforce_hr_offboarding_item_client_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and new.item_key in (
    'separation_record', 'last_working_date', 'project_reassignment', 'open_task_review',
    'expense_settlement', 'account_suspension', 'document_generation', 'employee_archive'
  ) then
    raise exception using errcode = '42501', message = 'Derived offboarding items can only be synchronized by AgencyOS.';
  end if;
  return new;
end;
$$;

create or replace function private.seed_hr_offboarding_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.hr_offboarding_items (
    organization_id, offboarding_plan_id, item_key, label, position, updated_by_membership_id
  ) values
    (new.organization_id, new.id, 'separation_record', 'Resignation or termination record', 10, new.updated_by_membership_id),
    (new.organization_id, new.id, 'last_working_date', 'Last working date confirmed', 20, new.updated_by_membership_id),
    (new.organization_id, new.id, 'knowledge_transfer', 'Knowledge transfer', 30, new.updated_by_membership_id),
    (new.organization_id, new.id, 'project_reassignment', 'Project reassignment', 40, new.updated_by_membership_id),
    (new.organization_id, new.id, 'open_task_review', 'Open-task review', 50, new.updated_by_membership_id),
    (new.organization_id, new.id, 'asset_return', 'Asset return', 60, new.updated_by_membership_id),
    (new.organization_id, new.id, 'expense_settlement', 'Expense settlement', 70, new.updated_by_membership_id),
    (new.organization_id, new.id, 'account_suspension', 'Account suspension', 80, new.updated_by_membership_id),
    (new.organization_id, new.id, 'vault_access_removal', 'Vault access removal', 90, new.updated_by_membership_id),
    (new.organization_id, new.id, 'document_generation', 'Experience and relieving letters', 100, new.updated_by_membership_id),
    (new.organization_id, new.id, 'exit_interview', 'Exit interview', 110, new.updated_by_membership_id),
    (new.organization_id, new.id, 'final_clearance', 'Final clearance', 120, new.updated_by_membership_id),
    (new.organization_id, new.id, 'employee_archive', 'Employee archive', 130, new.updated_by_membership_id);
  return new;
end;
$$;

create or replace function private.refresh_hr_offboarding_plan_status(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer;
  v_finished integer;
  v_clearance_total integer;
  v_clearance_finished integer;
  v_existing_status text;
begin
  select status into v_existing_status from public.hr_offboarding_plans where id = p_plan_id;
  if v_existing_status is null or v_existing_status in ('completed', 'cancelled') then return; end if;

  select count(*)::integer,
    count(*) filter (where status in ('complete', 'not_applicable'))::integer,
    count(*) filter (where item_key not in ('final_clearance', 'employee_archive'))::integer,
    count(*) filter (
      where item_key not in ('final_clearance', 'employee_archive')
        and status in ('complete', 'not_applicable')
    )::integer
  into v_total, v_finished, v_clearance_total, v_clearance_finished
  from public.hr_offboarding_items where offboarding_plan_id = p_plan_id;

  update public.hr_offboarding_plans
  set status = case
      when v_total > 0 and v_finished = v_total then 'completed'
      when v_clearance_total > 0 and v_clearance_finished = v_clearance_total then 'ready'
      when exists (
        select 1 from public.hr_offboarding_items
        where offboarding_plan_id = p_plan_id and status <> 'pending'
      ) then 'in_progress'
      else 'draft'
    end,
    started_at = case when started_at is null and exists (
      select 1 from public.hr_offboarding_items
      where offboarding_plan_id = p_plan_id and status <> 'pending'
    ) then now() else started_at end,
    completed_at = case when v_total > 0 and v_finished = v_total then coalesce(completed_at, now()) else null end,
    updated_at = now()
  where id = p_plan_id;
end;
$$;

create or replace function private.hr_offboarding_item_refresh_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.refresh_hr_offboarding_plan_status(new.offboarding_plan_id);
  return new;
end;
$$;

create trigger hr_offboarding_plans_validate_tenant
  before insert or update on public.hr_offboarding_plans
  for each row execute function private.validate_hr_offboarding_plan_tenant();
create trigger hr_offboarding_plans_set_updated_at
  before update on public.hr_offboarding_plans
  for each row execute function private.set_updated_at();
create trigger hr_offboarding_plans_seed_items
  after insert on public.hr_offboarding_plans
  for each row execute function private.seed_hr_offboarding_items();

create trigger hr_offboarding_items_validate_tenant
  before insert or update on public.hr_offboarding_items
  for each row execute function private.validate_hr_offboarding_item_tenant();
create trigger hr_offboarding_items_enforce_client_update
  before update on public.hr_offboarding_items
  for each row execute function private.enforce_hr_offboarding_item_client_update();
create trigger hr_offboarding_items_set_updated_at
  before update on public.hr_offboarding_items
  for each row execute function private.set_updated_at();
create trigger hr_offboarding_items_refresh_plan
  after insert or update on public.hr_offboarding_items
  for each row execute function private.hr_offboarding_item_refresh_plan();

alter table public.hr_offboarding_plans enable row level security;
alter table public.hr_offboarding_items enable row level security;

revoke all on public.hr_offboarding_plans from anon;
revoke all on public.hr_offboarding_items from anon;
grant select on public.hr_offboarding_plans to authenticated;
grant select on public.hr_offboarding_items to authenticated;
grant all on public.hr_offboarding_plans to service_role;
grant all on public.hr_offboarding_items to service_role;

create policy hr_offboarding_plans_select_authorized
on public.hr_offboarding_plans for select to authenticated
using (
  private.has_permission(organization_id, 'hr.offboarding.view')
  and private.crm_scope_allows_membership(
    private.current_membership_id(organization_id),
    private.effective_permission_scope(organization_id, 'hr.offboarding.view'),
    membership_id, membership_id
  )
);

create policy hr_offboarding_plans_insert_authorized
on public.hr_offboarding_plans for insert to authenticated
with check (
  (
    (
      private.has_permission(organization_id, 'hr.offboarding.manage')
      and private.crm_scope_allows_membership(
        private.current_membership_id(organization_id),
        private.effective_permission_scope(organization_id, 'hr.offboarding.manage'),
        membership_id, membership_id
      )
    )
    or (
      private.has_permission(organization_id, 'hr.offboarding.create_own')
      and membership_id = private.current_membership_id(organization_id)
      and separation_type = 'resignation'
    )
  )
  and created_by_membership_id = private.current_membership_id(organization_id)
  and updated_by_membership_id = private.current_membership_id(organization_id)
);

create policy hr_offboarding_plans_update_authorized
on public.hr_offboarding_plans for update to authenticated
using (
  private.has_permission(organization_id, 'hr.offboarding.manage')
  and private.crm_scope_allows_membership(
    private.current_membership_id(organization_id),
    private.effective_permission_scope(organization_id, 'hr.offboarding.manage'),
    membership_id, membership_id
  )
)
with check (
  private.has_permission(organization_id, 'hr.offboarding.manage')
  and updated_by_membership_id = private.current_membership_id(organization_id)
);

create policy hr_offboarding_items_select_authorized
on public.hr_offboarding_items for select to authenticated
using (
  exists (
    select 1 from public.hr_offboarding_plans as plan
    where plan.id = hr_offboarding_items.offboarding_plan_id
      and private.has_permission(plan.organization_id, 'hr.offboarding.view')
      and private.crm_scope_allows_membership(
        private.current_membership_id(plan.organization_id),
        private.effective_permission_scope(plan.organization_id, 'hr.offboarding.view'),
        plan.membership_id, plan.membership_id
      )
  )
);

create policy hr_offboarding_items_update_authorized
on public.hr_offboarding_items for update to authenticated
using (
  exists (
    select 1 from public.hr_offboarding_plans as plan
    where plan.id = hr_offboarding_items.offboarding_plan_id
      and private.has_permission(plan.organization_id, 'hr.offboarding.manage')
      and private.crm_scope_allows_membership(
        private.current_membership_id(plan.organization_id),
        private.effective_permission_scope(plan.organization_id, 'hr.offboarding.manage'),
        plan.membership_id, plan.membership_id
      )
  )
)
with check (
  updated_by_membership_id = private.current_membership_id(organization_id)
  and private.has_permission(organization_id, 'hr.offboarding.manage')
);
