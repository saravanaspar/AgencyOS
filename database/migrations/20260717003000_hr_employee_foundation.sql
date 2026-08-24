-- HR employee-record foundation: designations and core employee profiles,
-- self-service visibility, scoped manager visibility, audit-safe mutations, and RLS.

set lock_timeout = '10s';
set statement_timeout = '120s';

insert into public.permissions (module, resource, action, description, is_sensitive)
values
  ('hr', 'employee', 'view', 'View core employee records inside the effective role scope.', true),
  ('hr', 'employee', 'create', 'Create an employee profile for an existing organization membership.', true),
  ('hr', 'employee', 'update', 'Update core employee and employment details inside the effective role scope.', true),
  ('hr', 'employee', 'update_self', 'Update the current employee personal contact details through the controlled server action.', true),
  ('hr', 'designation', 'view', 'View active and inactive organization designations.', false),
  ('hr', 'designation', 'manage', 'Create, update, activate, or deactivate organization designations.', true)
on conflict (module, resource, action) do update
set description = excluded.description, is_sensitive = excluded.is_sensitive;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'organization'
from public.role_templates as role_template
cross join public.permissions as permission
where role_template.key in ('owner', 'hr_manager')
  and permission.module = 'hr'
  and permission.resource in ('workspace', 'employee', 'designation')
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'team_lead', permission.id,
  case when permission.key = 'hr.employee.view' then 'managed_employees' else 'organization' end
from public.permissions as permission
where permission.key in ('hr.workspace.view', 'hr.employee.view', 'hr.designation.view')
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'employee', permission.id,
  case when permission.key in ('hr.employee.view', 'hr.employee.update_self') then 'own' else 'organization' end
from public.permissions as permission
where permission.key in (
  'hr.workspace.view',
  'hr.employee.view',
  'hr.employee.update_self',
  'hr.designation.view'
)
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_permissions (role_id, permission_id, scope, conditions)
select role.id, template_permission.permission_id, template_permission.scope, template_permission.conditions
from public.roles as role
join public.role_template_permissions as template_permission
  on template_permission.role_template_key = role.template_key
join public.permissions as permission on permission.id = template_permission.permission_id
where permission.module = 'hr'
  and permission.resource in ('workspace', 'employee', 'designation')
on conflict (role_id, permission_id) do update
set scope = excluded.scope, conditions = excluded.conditions, updated_at = now();

create table public.hr_designations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  code text,
  description text,
  status text not null default 'active',
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_designations_name_not_blank check (btrim(name) <> ''),
  constraint hr_designations_name_length check (char_length(name) between 2 and 120),
  constraint hr_designations_code_not_blank check (code is null or btrim(code) <> ''),
  constraint hr_designations_code_length check (code is null or char_length(code) <= 24),
  constraint hr_designations_description_length check (description is null or char_length(description) <= 1000),
  constraint hr_designations_status_valid check (status in ('active', 'inactive'))
);

create unique index hr_designations_name_unique
  on public.hr_designations (organization_id, lower(name));
create unique index hr_designations_code_unique
  on public.hr_designations (organization_id, lower(code)) where code is not null;
create index hr_designations_status_idx
  on public.hr_designations (organization_id, status, lower(name));

create table public.hr_employee_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  designation_id uuid references public.hr_designations(id) on delete set null,
  legal_name text,
  preferred_name text,
  personal_email text,
  personal_phone text,
  date_of_birth date,
  gender text,
  marital_status text,
  nationality text,
  residential_address jsonb not null default '{}'::jsonb,
  emergency_contacts jsonb not null default '[]'::jsonb,
  joining_date date,
  employment_type text,
  work_location text,
  work_mode text,
  probation_start_date date,
  probation_end_date date,
  notice_period_days integer,
  contract_start_date date,
  contract_end_date date,
  lifecycle_status text not null default 'preboarding',
  weekly_hours numeric(5,2),
  weekly_work_schedule jsonb not null default '{}'::jsonb,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  updated_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_employee_profiles_legal_name_not_blank check (legal_name is null or btrim(legal_name) <> ''),
  constraint hr_employee_profiles_legal_name_length check (legal_name is null or char_length(legal_name) <= 180),
  constraint hr_employee_profiles_preferred_name_not_blank check (preferred_name is null or btrim(preferred_name) <> ''),
  constraint hr_employee_profiles_preferred_name_length check (preferred_name is null or char_length(preferred_name) <= 120),
  constraint hr_employee_profiles_personal_email_length check (personal_email is null or char_length(personal_email) <= 254),
  constraint hr_employee_profiles_personal_phone_length check (personal_phone is null or char_length(personal_phone) <= 40),
  constraint hr_employee_profiles_gender_length check (gender is null or char_length(gender) <= 60),
  constraint hr_employee_profiles_marital_status_length check (marital_status is null or char_length(marital_status) <= 60),
  constraint hr_employee_profiles_nationality_length check (nationality is null or char_length(nationality) <= 100),
  constraint hr_employee_profiles_address_object check (jsonb_typeof(residential_address) = 'object'),
  constraint hr_employee_profiles_emergency_contacts_array check (jsonb_typeof(emergency_contacts) = 'array'),
  constraint hr_employee_profiles_employment_type_valid check (
    employment_type is null or employment_type in ('full_time', 'part_time', 'contract', 'intern', 'temporary')
  ),
  constraint hr_employee_profiles_work_mode_valid check (
    work_mode is null or work_mode in ('office', 'remote', 'hybrid', 'field')
  ),
  constraint hr_employee_profiles_lifecycle_valid check (
    lifecycle_status in ('preboarding', 'active', 'probation', 'confirmed', 'notice_period', 'exited', 'archived')
  ),
  constraint hr_employee_profiles_notice_period_valid check (
    notice_period_days is null or notice_period_days between 0 and 730
  ),
  constraint hr_employee_profiles_weekly_hours_valid check (
    weekly_hours is null or weekly_hours between 0 and 168
  ),
  constraint hr_employee_profiles_probation_dates_valid check (
    probation_start_date is null or probation_end_date is null or probation_end_date >= probation_start_date
  ),
  constraint hr_employee_profiles_contract_dates_valid check (
    contract_start_date is null or contract_end_date is null or contract_end_date >= contract_start_date
  ),
  constraint hr_employee_profiles_schedule_object check (jsonb_typeof(weekly_work_schedule) = 'object'),
  unique (organization_id, membership_id)
);

create index hr_employee_profiles_designation_idx
  on public.hr_employee_profiles (organization_id, designation_id)
  where designation_id is not null;
create index hr_employee_profiles_lifecycle_idx
  on public.hr_employee_profiles (organization_id, lifecycle_status, joining_date);

create or replace function private.validate_hr_designation_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.memberships as membership
    where membership.id = new.created_by_membership_id
      and membership.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Designation creator must belong to the organization.';
  end if;
  return new;
end;
$$;

create trigger hr_designations_validate_tenant
  before insert or update on public.hr_designations
  for each row execute function private.validate_hr_designation_tenant();

create trigger hr_designations_set_updated_at
  before update on public.hr_designations
  for each row execute function private.set_updated_at();

create or replace function private.validate_hr_employee_profile_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.memberships as membership
    where membership.id = new.membership_id
      and membership.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Employee membership must belong to the organization.';
  end if;

  if new.designation_id is not null and not exists (
    select 1 from public.hr_designations as designation
    where designation.id = new.designation_id
      and designation.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Employee designation must belong to the organization.';
  end if;

  if not exists (
    select 1 from public.memberships as membership
    where membership.id in (new.created_by_membership_id, new.updated_by_membership_id)
      and membership.organization_id = new.organization_id
    group by membership.organization_id
    having count(distinct membership.id) = case
      when new.created_by_membership_id = new.updated_by_membership_id then 1 else 2 end
  ) then
    raise exception using errcode = '23514', message = 'Employee profile actors must belong to the organization.';
  end if;

  return new;
end;
$$;

create trigger hr_employee_profiles_validate_tenant
  before insert or update on public.hr_employee_profiles
  for each row execute function private.validate_hr_employee_profile_tenant();

create trigger hr_employee_profiles_set_updated_at
  before update on public.hr_employee_profiles
  for each row execute function private.set_updated_at();

alter table public.hr_designations enable row level security;
alter table public.hr_employee_profiles enable row level security;

revoke all on public.hr_designations from public, anon, authenticated;
revoke all on public.hr_employee_profiles from public, anon, authenticated;

grant select on public.hr_designations to authenticated;
grant select on public.hr_employee_profiles to authenticated;

grant all on public.hr_designations to service_role;
grant all on public.hr_employee_profiles to service_role;

create policy hr_designations_select_authorized
on public.hr_designations for select to authenticated
using (
  private.has_permission(organization_id, 'hr.workspace.view')
  and private.has_permission(organization_id, 'hr.designation.view')
);

create policy hr_designations_insert_authorized
on public.hr_designations for insert to authenticated
with check (
  private.has_permission(organization_id, 'hr.designation.manage')
  and created_by_membership_id = private.current_membership_id(organization_id)
);

create policy hr_designations_update_authorized
on public.hr_designations for update to authenticated
using (private.has_permission(organization_id, 'hr.designation.manage'))
with check (private.has_permission(organization_id, 'hr.designation.manage'));

create policy hr_employee_profiles_select_authorized
on public.hr_employee_profiles for select to authenticated
using (
  private.has_permission(organization_id, 'hr.workspace.view')
  and private.has_permission(organization_id, 'hr.employee.view')
  and private.crm_scope_allows_membership(
    private.current_membership_id(organization_id),
    private.effective_permission_scope(organization_id, 'hr.employee.view'),
    membership_id,
    membership_id
  )
);

create policy hr_employee_profiles_insert_authorized
on public.hr_employee_profiles for insert to authenticated
with check (
  private.has_permission(organization_id, 'hr.employee.create')
  and created_by_membership_id = private.current_membership_id(organization_id)
  and updated_by_membership_id = private.current_membership_id(organization_id)
  and private.crm_scope_allows_membership(
    private.current_membership_id(organization_id),
    private.effective_permission_scope(organization_id, 'hr.employee.create'),
    membership_id,
    membership_id
  )
);

create policy hr_employee_profiles_update_authorized
on public.hr_employee_profiles for update to authenticated
using (
  private.has_permission(organization_id, 'hr.employee.update')
  and private.crm_scope_allows_membership(
    private.current_membership_id(organization_id),
    private.effective_permission_scope(organization_id, 'hr.employee.update'),
    membership_id,
    membership_id
  )
)
with check (
  updated_by_membership_id = private.current_membership_id(organization_id)
  and private.has_permission(organization_id, 'hr.employee.update')
  and private.crm_scope_allows_membership(
    private.current_membership_id(organization_id),
    private.effective_permission_scope(organization_id, 'hr.employee.update'),
    membership_id,
    membership_id
  )
);
