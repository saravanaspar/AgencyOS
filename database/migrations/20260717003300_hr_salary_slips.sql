-- HR salary structures, immutable effective-dated revisions, private salary slips,
-- employee acknowledgements, audited downloads, and tightly restricted RLS.

set lock_timeout = '10s';
set statement_timeout = '120s';

insert into public.permissions (module, resource, action, description, is_sensitive)
values
  ('hr', 'salary', 'view', 'View salary structures inside the effective employee scope.', true),
  ('hr', 'salary', 'manage', 'Create immutable effective-dated salary revisions.', true),
  ('hr', 'salary_slip', 'view', 'View private salary slips inside the effective employee scope.', true),
  ('hr', 'salary_slip', 'manage', 'Generate or upload private salary slips.', true),
  ('hr', 'salary_slip', 'acknowledge', 'Acknowledge the current employee salary slips.', true)
on conflict (module, resource, action) do update
set description = excluded.description, is_sensitive = excluded.is_sensitive;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'organization'
from public.role_templates as role_template
cross join public.permissions as permission
where role_template.key in ('owner', 'hr_manager')
  and permission.module = 'hr'
  and permission.resource in ('salary', 'salary_slip')
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'employee', permission.id, 'own'
from public.permissions as permission
where permission.key in ('hr.salary.view', 'hr.salary_slip.view', 'hr.salary_slip.acknowledge')
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'auditor', permission.id, 'organization'
from public.permissions as permission
where permission.key in (
  'hr.workspace.view', 'hr.employee.view', 'hr.salary.view', 'hr.salary_slip.view'
)
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_permissions (role_id, permission_id, scope, conditions)
select role.id, template_permission.permission_id, template_permission.scope,
  template_permission.conditions
from public.roles as role
join public.role_template_permissions as template_permission
  on template_permission.role_template_key = role.template_key
join public.permissions as permission on permission.id = template_permission.permission_id
where permission.module = 'hr'
  and permission.resource in ('workspace', 'employee', 'salary', 'salary_slip')
on conflict (role_id, permission_id) do update
set scope = excluded.scope, conditions = excluded.conditions, updated_at = now();

create table public.hr_salary_structures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  revision_number integer not null,
  currency text not null,
  base_salary_minor bigint not null,
  effective_from date not null,
  effective_to date,
  notes text,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint hr_salary_structures_revision_valid check (revision_number > 0),
  constraint hr_salary_structures_currency_valid check (currency ~ '^[A-Z]{3}$'),
  constraint hr_salary_structures_base_valid check (base_salary_minor between 0 and 9000000000000),
  constraint hr_salary_structures_dates_valid check (effective_to is null or effective_to >= effective_from),
  constraint hr_salary_structures_notes_valid check (notes is null or char_length(notes) <= 2000),
  unique (organization_id, membership_id, revision_number),
  unique (organization_id, membership_id, effective_from)
);

create index hr_salary_structures_member_effective_idx
  on public.hr_salary_structures (organization_id, membership_id, effective_from desc);

create table public.hr_salary_structure_components (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salary_structure_id uuid not null references public.hr_salary_structures(id) on delete cascade,
  component_type text not null,
  name text not null,
  amount_minor bigint not null,
  taxable boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint hr_salary_components_type_valid check (component_type in ('allowance', 'deduction')),
  constraint hr_salary_components_name_valid check (char_length(btrim(name)) between 1 and 120),
  constraint hr_salary_components_amount_valid check (amount_minor between 0 and 9000000000000),
  constraint hr_salary_components_sort_valid check (sort_order between 0 and 1000)
);

create unique index hr_salary_components_name_unique
  on public.hr_salary_structure_components (salary_structure_id, component_type, lower(name));
create index hr_salary_components_structure_idx
  on public.hr_salary_structure_components (organization_id, salary_structure_id, component_type, sort_order);

create table public.hr_salary_slips (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  salary_structure_id uuid references public.hr_salary_structures(id) on delete restrict,
  version integer not null,
  period_start date not null,
  period_end date not null,
  currency text not null,
  base_salary_minor bigint not null default 0,
  allowances_minor bigint not null default 0,
  deductions_minor bigint not null default 0,
  bonus_minor bigint not null default 0,
  reimbursement_minor bigint not null default 0,
  gross_minor bigint not null default 0,
  net_minor bigint not null default 0,
  structure_snapshot jsonb not null default '{}'::jsonb,
  notes text,
  source text not null,
  private_file_id uuid unique references public.private_files(id) on delete restrict,
  original_file_name text,
  acknowledged_at timestamptz,
  acknowledged_by_membership_id uuid references public.memberships(id) on delete set null,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint hr_salary_slips_version_valid check (version > 0),
  constraint hr_salary_slips_period_valid check (period_end >= period_start),
  constraint hr_salary_slips_currency_valid check (currency ~ '^[A-Z]{3}$'),
  constraint hr_salary_slips_source_valid check (source in ('generated', 'uploaded')),
  constraint hr_salary_slips_amounts_valid check (
    base_salary_minor between 0 and 9000000000000
    and allowances_minor between 0 and 9000000000000
    and deductions_minor between 0 and 9000000000000
    and bonus_minor between 0 and 9000000000000
    and reimbursement_minor between 0 and 9000000000000
    and gross_minor = base_salary_minor + allowances_minor + bonus_minor + reimbursement_minor
    and net_minor = gross_minor - deductions_minor
    and deductions_minor <= gross_minor
  ),
  constraint hr_salary_slips_notes_valid check (notes is null or char_length(notes) <= 1000),
  constraint hr_salary_slips_ack_pair check (
    (acknowledged_at is null and acknowledged_by_membership_id is null)
    or (acknowledged_at is not null and acknowledged_by_membership_id is not null)
  ),
  unique (organization_id, membership_id, period_start, period_end, version)
);

create index hr_salary_slips_member_period_idx
  on public.hr_salary_slips (organization_id, membership_id, period_end desc, version desc);

create or replace function private.prepare_hr_salary_structure_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next_date date;
  v_prior_id uuid;
begin
  if not exists (
    select 1 from public.memberships as membership
    where membership.id = new.membership_id
      and membership.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'salary-membership-organization-mismatch';
  end if;
  if not exists (
    select 1 from public.memberships as creator
    where creator.id = new.created_by_membership_id
      and creator.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'salary-creator-organization-mismatch';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text || ':' || new.membership_id::text, 0));
  new.revision_number := coalesce((
    select max(structure.revision_number) + 1
    from public.hr_salary_structures as structure
    where structure.organization_id = new.organization_id
      and structure.membership_id = new.membership_id
  ), 1);

  select min(structure.effective_from) into v_next_date
  from public.hr_salary_structures as structure
  where structure.organization_id = new.organization_id
    and structure.membership_id = new.membership_id
    and structure.effective_from > new.effective_from;
  new.effective_to := case when v_next_date is null then null else v_next_date - 1 end;

  select structure.id into v_prior_id
  from public.hr_salary_structures as structure
  where structure.organization_id = new.organization_id
    and structure.membership_id = new.membership_id
    and structure.effective_from < new.effective_from
  order by structure.effective_from desc
  limit 1;

  if v_prior_id is not null then
    update public.hr_salary_structures
    set effective_to = new.effective_from - 1
    where id = v_prior_id;
  end if;
  return new;
end;
$$;

create trigger hr_salary_structure_prepare_revision
before insert on public.hr_salary_structures
for each row execute function private.prepare_hr_salary_structure_revision();

create or replace function private.validate_hr_salary_component()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.hr_salary_structures as structure
    where structure.id = new.salary_structure_id
      and structure.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'salary-component-organization-mismatch';
  end if;
  return new;
end;
$$;

create trigger hr_salary_component_validate
before insert or update on public.hr_salary_structure_components
for each row execute function private.validate_hr_salary_component();

create or replace function private.validate_hr_salary_slip()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.memberships as membership
    where membership.id = new.membership_id
      and membership.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'salary-slip-membership-organization-mismatch';
  end if;
  if new.salary_structure_id is not null and not exists (
    select 1 from public.hr_salary_structures as structure
    where structure.id = new.salary_structure_id
      and structure.organization_id = new.organization_id
      and structure.membership_id = new.membership_id
  ) then
    raise exception using errcode = '23514', message = 'salary-slip-structure-mismatch';
  end if;
  if new.private_file_id is not null and not exists (
    select 1 from public.private_files as file
    where file.id = new.private_file_id
      and file.organization_id = new.organization_id
      and file.module_key = 'hr'
      and file.entity_type = 'hr_salary_slip'
      and file.entity_id = new.id
  ) then
    raise exception using errcode = '23514', message = 'salary-slip-private-file-mismatch';
  end if;
  return new;
end;
$$;

create trigger hr_salary_slip_validate
before insert or update on public.hr_salary_slips
for each row execute function private.validate_hr_salary_slip();

alter table public.hr_salary_structures enable row level security;
alter table public.hr_salary_structure_components enable row level security;
alter table public.hr_salary_slips enable row level security;

revoke all on public.hr_salary_structures from public, anon, authenticated;
revoke all on public.hr_salary_structure_components from public, anon, authenticated;
revoke all on public.hr_salary_slips from public, anon, authenticated;
grant select on public.hr_salary_structures to authenticated;
grant select on public.hr_salary_structure_components to authenticated;
grant select on public.hr_salary_slips to authenticated;
grant all on public.hr_salary_structures to service_role;
grant all on public.hr_salary_structure_components to service_role;
grant all on public.hr_salary_slips to service_role;

create policy hr_salary_structures_select_authorized
on public.hr_salary_structures for select to authenticated
using (
  private.has_permission(organization_id, 'hr.salary.view')
  and private.crm_scope_allows_membership(
    private.current_membership_id(organization_id),
    private.effective_permission_scope(organization_id, 'hr.salary.view'),
    membership_id,
    membership_id
  )
);

create policy hr_salary_structures_insert_authorized
on public.hr_salary_structures for insert to authenticated
with check (
  private.has_permission(organization_id, 'hr.salary.manage')
  and private.crm_scope_allows_membership(
    private.current_membership_id(organization_id),
    private.effective_permission_scope(organization_id, 'hr.salary.manage'),
    membership_id,
    membership_id
  )
);

create policy hr_salary_components_select_authorized
on public.hr_salary_structure_components for select to authenticated
using (
  exists (
    select 1 from public.hr_salary_structures as structure
    where structure.id = salary_structure_id
      and structure.organization_id = organization_id
      and private.has_permission(organization_id, 'hr.salary.view')
      and private.crm_scope_allows_membership(
        private.current_membership_id(organization_id),
        private.effective_permission_scope(organization_id, 'hr.salary.view'),
        structure.membership_id,
        structure.membership_id
      )
  )
);

create policy hr_salary_components_insert_authorized
on public.hr_salary_structure_components for insert to authenticated
with check (
  exists (
    select 1 from public.hr_salary_structures as structure
    where structure.id = salary_structure_id
      and structure.organization_id = organization_id
      and private.has_permission(organization_id, 'hr.salary.manage')
      and private.crm_scope_allows_membership(
        private.current_membership_id(organization_id),
        private.effective_permission_scope(organization_id, 'hr.salary.manage'),
        structure.membership_id,
        structure.membership_id
      )
  )
);

create policy hr_salary_slips_select_authorized
on public.hr_salary_slips for select to authenticated
using (
  private.has_permission(organization_id, 'hr.salary_slip.view')
  and private.crm_scope_allows_membership(
    private.current_membership_id(organization_id),
    private.effective_permission_scope(organization_id, 'hr.salary_slip.view'),
    membership_id,
    membership_id
  )
);

comment on table public.hr_salary_structures is
  'Effective-dated immutable salary revisions. Sensitive values are protected by explicit salary permissions and RLS.';
comment on table public.hr_salary_slips is
  'Private immutable salary-slip metadata linked to malware-scanned private files. Every download is audited by the application.';
