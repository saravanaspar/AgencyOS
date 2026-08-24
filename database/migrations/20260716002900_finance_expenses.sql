-- Finance expenses: employee, project, and vendor expenses with categories,
-- tax, project allocations, private receipts, approvals, and payment state.

set lock_timeout = '10s';
set statement_timeout = '120s';

insert into public.permissions (module, resource, action, description, is_sensitive)
values
  ('finance', 'expense', 'view', 'View expenses inside the effective role scope.', true),
  ('finance', 'expense', 'create', 'Create employee, project, and vendor expenses.', true),
  ('finance', 'expense', 'manage', 'Update expense records and project allocations.', true),
  ('finance', 'expense', 'approve', 'Approve or reject submitted expenses.', true),
  ('finance', 'expense', 'pay', 'Schedule, pay, reimburse, or waive expenses.', true),
  ('finance', 'expense_category', 'manage', 'Create and maintain expense categories.', true),
  ('finance', 'expense_receipt', 'manage', 'Upload and remove private expense receipts.', true)
on conflict (module, resource, action) do update
set description = excluded.description, is_sensitive = excluded.is_sensitive;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'organization'
from public.role_templates as role_template
cross join public.permissions as permission
where role_template.key in ('owner', 'finance_manager')
  and permission.module = 'finance'
  and permission.resource in ('expense', 'expense_category', 'expense_receipt')
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'accountant', permission.id, 'organization'
from public.permissions as permission
where permission.key in (
  'finance.expense.view',
  'finance.expense.create',
  'finance.expense.manage',
  'finance.expense.pay',
  'finance.expense_category.manage',
  'finance.expense_receipt.manage'
)
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'auditor', permission.id, 'organization'
from public.permissions as permission
where permission.key = 'finance.expense.view'
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'employee', permission.id,
  case when permission.key = 'finance.workspace.view' then 'organization' else 'own' end
from public.permissions as permission
where permission.key in (
  'finance.workspace.view',
  'finance.expense.view',
  'finance.expense.create',
  'finance.expense_receipt.manage'
)
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_permissions (role_id, permission_id, scope, conditions)
select role.id, template_permission.permission_id, template_permission.scope, template_permission.conditions
from public.roles as role
join public.role_template_permissions as template_permission
  on template_permission.role_template_key = role.template_key
join public.permissions as permission on permission.id = template_permission.permission_id
where permission.module = 'finance'
  and permission.resource in ('workspace', 'expense', 'expense_category', 'expense_receipt')
on conflict (role_id, permission_id) do update
set scope = excluded.scope, conditions = excluded.conditions, updated_at = now();

create table public.finance_expense_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  code text,
  description text,
  default_tax_bps integer not null default 0,
  is_active boolean not null default true,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_expense_categories_name_not_blank check (btrim(name) <> ''),
  constraint finance_expense_categories_code_not_blank check (code is null or btrim(code) <> ''),
  constraint finance_expense_categories_tax_valid check (default_tax_bps between 0 and 100000)
);

create unique index finance_expense_categories_name_unique
  on public.finance_expense_categories (organization_id, lower(name));
create unique index finance_expense_categories_code_unique
  on public.finance_expense_categories (organization_id, lower(code)) where code is not null;
create index finance_expense_categories_active_idx
  on public.finance_expense_categories (organization_id, is_active, lower(name));

create table public.finance_expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  expense_type text not null,
  category_id uuid not null references public.finance_expense_categories(id) on delete restrict,
  employee_membership_id uuid references public.memberships(id) on delete restrict,
  vendor_name text,
  vendor_reference text,
  expense_date date not null,
  currency text not null,
  amount_minor bigint not null,
  tax_minor bigint not null default 0,
  total_minor bigint generated always as (amount_minor + tax_minor) stored,
  is_billable boolean not null default false,
  is_reimbursable boolean not null default false,
  approval_status text not null default 'not_required',
  payment_status text not null default 'unpaid',
  payment_reference text,
  paid_at timestamptz,
  notes text,
  approved_by_membership_id uuid references public.memberships(id) on delete set null,
  approved_at timestamptz,
  rejection_reason text,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_expenses_type_valid check (expense_type in ('employee', 'project', 'vendor')),
  constraint finance_expenses_employee_required check (
    expense_type <> 'employee' or employee_membership_id is not null
  ),
  constraint finance_expenses_vendor_required check (
    expense_type <> 'vendor' or (vendor_name is not null and btrim(vendor_name) <> '')
  ),
  constraint finance_expenses_vendor_name_not_blank check (
    vendor_name is null or btrim(vendor_name) <> ''
  ),
  constraint finance_expenses_vendor_reference_not_blank check (
    vendor_reference is null or btrim(vendor_reference) <> ''
  ),
  constraint finance_expenses_currency_valid check (currency ~ '^[A-Z]{3}$'),
  constraint finance_expenses_amount_positive check (amount_minor > 0),
  constraint finance_expenses_tax_nonnegative check (tax_minor >= 0),
  constraint finance_expenses_approval_valid check (
    approval_status in ('not_required', 'pending', 'approved', 'rejected')
  ),
  constraint finance_expenses_payment_valid check (
    payment_status in ('unpaid', 'scheduled', 'paid', 'reimbursed', 'waived')
  ),
  constraint finance_expenses_payment_evidence_consistent check (
    (payment_status in ('paid', 'reimbursed', 'waived') and paid_at is not null)
    or (payment_status in ('unpaid', 'scheduled') and paid_at is null)
  )
);

create index finance_expenses_date_idx
  on public.finance_expenses (organization_id, expense_date desc, created_at desc);
create index finance_expenses_status_idx
  on public.finance_expenses (organization_id, approval_status, payment_status, expense_date desc);
create index finance_expenses_employee_idx
  on public.finance_expenses (organization_id, employee_membership_id, expense_date desc)
  where employee_membership_id is not null;
create index finance_expenses_category_idx
  on public.finance_expenses (organization_id, category_id, expense_date desc);

create table public.finance_expense_project_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  expense_id uuid not null references public.finance_expenses(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete restrict,
  amount_minor bigint not null,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint finance_expense_project_allocations_amount_positive check (amount_minor > 0),
  unique (expense_id, project_id)
);

create index finance_expense_project_allocations_project_idx
  on public.finance_expense_project_allocations (organization_id, project_id, expense_id);

create table public.finance_expense_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  expense_id uuid not null references public.finance_expenses(id) on delete cascade,
  private_file_id uuid not null references public.private_files(id) on delete restrict,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  sha256 text not null,
  uploaded_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint finance_expense_receipts_file_name_not_blank check (btrim(file_name) <> ''),
  constraint finance_expense_receipts_mime_not_blank check (btrim(mime_type) <> ''),
  constraint finance_expense_receipts_size_positive check (size_bytes > 0),
  constraint finance_expense_receipts_hash_valid check (sha256 ~ '^[a-f0-9]{64}$'),
  unique (private_file_id)
);

create index finance_expense_receipts_expense_idx
  on public.finance_expense_receipts (organization_id, expense_id, created_at desc);

create table public.finance_expense_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  expense_id uuid not null references public.finance_expenses(id) on delete cascade,
  event_type text not null,
  event_data jsonb not null default '{}'::jsonb,
  actor_membership_id uuid references public.memberships(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint finance_expense_events_type_not_blank check (btrim(event_type) <> ''),
  constraint finance_expense_events_data_object check (jsonb_typeof(event_data) = 'object')
);

create index finance_expense_events_expense_idx
  on public.finance_expense_events (organization_id, expense_id, created_at desc);

create or replace function private.finance_expense_scope_allows(
  p_organization_id uuid,
  p_employee_membership_id uuid,
  p_created_by_membership_id uuid,
  p_permission_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_permission(p_organization_id, p_permission_key)
    and private.crm_scope_allows_membership(
      private.current_membership_id(p_organization_id),
      private.effective_permission_scope(p_organization_id, p_permission_key),
      p_employee_membership_id,
      p_created_by_membership_id
    );
$$;

create or replace function private.validate_finance_expense_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.finance_expense_categories as category
    where category.id = new.category_id
      and category.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Expense category must belong to the expense organization.';
  end if;

  if new.employee_membership_id is not null and not exists (
    select 1 from public.memberships as membership
    where membership.id = new.employee_membership_id
      and membership.organization_id = new.organization_id
      and membership.status = 'active'
  ) then
    raise exception using errcode = '23514', message = 'Expense employee must be active in the expense organization.';
  end if;

  if not exists (
    select 1 from public.memberships as membership
    where membership.id = new.created_by_membership_id
      and membership.organization_id = new.organization_id
      and membership.status = 'active'
  ) then
    raise exception using errcode = '23514', message = 'Expense creator must be active in the expense organization.';
  end if;

  return new;
end;
$$;

create or replace function private.validate_finance_expense_allocation_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.finance_expenses as expense
    join public.projects as project on project.id = new.project_id
    where expense.id = new.expense_id
      and expense.organization_id = new.organization_id
      and project.organization_id = new.organization_id
      and project.archived_at is null
      and project.closure_status <> 'closed'
  ) then
    raise exception using errcode = '23514', message = 'Expense allocation must use an active project in the same organization.';
  end if;

  if not exists (
    select 1 from public.memberships as membership
    where membership.id = new.created_by_membership_id
      and membership.organization_id = new.organization_id
      and membership.status = 'active'
  ) then
    raise exception using errcode = '23514', message = 'Expense allocation creator must be active in the organization.';
  end if;

  return new;
end;
$$;

create or replace function private.validate_finance_expense_receipt_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.finance_expenses as expense
    join public.private_files as private_file on private_file.id = new.private_file_id
    where expense.id = new.expense_id
      and expense.organization_id = new.organization_id
      and private_file.organization_id = new.organization_id
      and private_file.status <> 'deleted'
  ) then
    raise exception using errcode = '23514', message = 'Expense receipt must use an active private file in the same organization.';
  end if;

  return new;
end;
$$;

create or replace function private.validate_finance_expense_allocation_totals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expense_id uuid;
  v_expense_type text;
  v_total_minor bigint;
  v_allocated_minor bigint;
begin
  v_expense_id := coalesce(
    nullif(to_jsonb(new) ->> 'expense_id', '')::uuid,
    nullif(to_jsonb(old) ->> 'expense_id', '')::uuid,
    nullif(to_jsonb(new) ->> 'id', '')::uuid,
    nullif(to_jsonb(old) ->> 'id', '')::uuid
  );

  select expense_type, total_minor
  into v_expense_type, v_total_minor
  from public.finance_expenses
  where id = v_expense_id;

  if v_expense_type is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  select coalesce(sum(amount_minor), 0)::bigint
  into v_allocated_minor
  from public.finance_expense_project_allocations
  where expense_id = v_expense_id;

  if v_allocated_minor > v_total_minor then
    raise exception using errcode = '23514', message = 'Expense project allocations cannot exceed the expense total.';
  end if;

  if v_expense_type = 'project' and v_allocated_minor <> v_total_minor then
    raise exception using errcode = '23514', message = 'Project expenses must be fully allocated to active projects.';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function private.prevent_finance_expense_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'Finance expense event history is immutable.';
end;
$$;

create trigger finance_expense_categories_set_updated_at
before update on public.finance_expense_categories
for each row execute function private.set_updated_at();

create trigger finance_expenses_set_updated_at
before update on public.finance_expenses
for each row execute function private.set_updated_at();

create trigger finance_expenses_validate_references
before insert or update on public.finance_expenses
for each row execute function private.validate_finance_expense_references();

create trigger finance_expense_allocations_validate_tenant
before insert or update on public.finance_expense_project_allocations
for each row execute function private.validate_finance_expense_allocation_tenant();

create trigger finance_expense_receipts_validate_tenant
before insert or update on public.finance_expense_receipts
for each row execute function private.validate_finance_expense_receipt_tenant();

create constraint trigger finance_expenses_validate_allocation_totals
after insert or update on public.finance_expenses
deferrable initially deferred
for each row execute function private.validate_finance_expense_allocation_totals();

create constraint trigger finance_expense_allocations_validate_totals
after insert or update or delete on public.finance_expense_project_allocations
deferrable initially deferred
for each row execute function private.validate_finance_expense_allocation_totals();

create trigger finance_expense_events_prevent_update
before update on public.finance_expense_events
for each row execute function private.prevent_finance_expense_event_mutation();
create trigger finance_expense_events_prevent_delete
before delete on public.finance_expense_events
for each row execute function private.prevent_finance_expense_event_mutation();

alter table public.finance_expense_categories enable row level security;
alter table public.finance_expenses enable row level security;
alter table public.finance_expense_project_allocations enable row level security;
alter table public.finance_expense_receipts enable row level security;
alter table public.finance_expense_events enable row level security;

revoke all on public.finance_expense_categories from public, anon, authenticated;
revoke all on public.finance_expenses from public, anon, authenticated;
revoke all on public.finance_expense_project_allocations from public, anon, authenticated;
revoke all on public.finance_expense_receipts from public, anon, authenticated;
revoke all on public.finance_expense_events from public, anon, authenticated;

grant select, insert, update on public.finance_expense_categories to authenticated;
grant select, insert, update on public.finance_expenses to authenticated;
grant select, insert, update, delete on public.finance_expense_project_allocations to authenticated;
grant select, insert, delete on public.finance_expense_receipts to authenticated;
grant select on public.finance_expense_events to authenticated;

grant all on public.finance_expense_categories to service_role;
grant all on public.finance_expenses to service_role;
grant all on public.finance_expense_project_allocations to service_role;
grant all on public.finance_expense_receipts to service_role;
grant all on public.finance_expense_events to service_role;

create policy finance_expense_categories_select_authorized
on public.finance_expense_categories for select to authenticated
using (
  private.has_permission(organization_id, 'finance.expense.view')
  or private.has_permission(organization_id, 'finance.expense_category.manage')
);
create policy finance_expense_categories_insert_authorized
on public.finance_expense_categories for insert to authenticated
with check (
  private.has_permission(organization_id, 'finance.expense_category.manage')
  and created_by_membership_id = private.current_membership_id(organization_id)
);
create policy finance_expense_categories_update_authorized
on public.finance_expense_categories for update to authenticated
using (private.has_permission(organization_id, 'finance.expense_category.manage'))
with check (private.has_permission(organization_id, 'finance.expense_category.manage'));

create policy finance_expenses_select_authorized
on public.finance_expenses for select to authenticated
using (
  private.finance_expense_scope_allows(
    organization_id, employee_membership_id, created_by_membership_id, 'finance.expense.view'
  )
);
create policy finance_expenses_insert_authorized
on public.finance_expenses for insert to authenticated
with check (
  created_by_membership_id = private.current_membership_id(organization_id)
  and private.finance_expense_scope_allows(
    organization_id, employee_membership_id, created_by_membership_id, 'finance.expense.create'
  )
);
create policy finance_expenses_update_authorized
on public.finance_expenses for update to authenticated
using (
  private.finance_expense_scope_allows(
    organization_id, employee_membership_id, created_by_membership_id, 'finance.expense.manage'
  )
  or private.finance_expense_scope_allows(
    organization_id, employee_membership_id, created_by_membership_id, 'finance.expense.approve'
  )
  or private.finance_expense_scope_allows(
    organization_id, employee_membership_id, created_by_membership_id, 'finance.expense.pay'
  )
)
with check (
  private.finance_expense_scope_allows(
    organization_id, employee_membership_id, created_by_membership_id, 'finance.expense.manage'
  )
  or private.finance_expense_scope_allows(
    organization_id, employee_membership_id, created_by_membership_id, 'finance.expense.approve'
  )
  or private.finance_expense_scope_allows(
    organization_id, employee_membership_id, created_by_membership_id, 'finance.expense.pay'
  )
);

create policy finance_expense_allocations_select_authorized
on public.finance_expense_project_allocations for select to authenticated
using (exists (
  select 1 from public.finance_expenses as expense
  where expense.id = finance_expense_project_allocations.expense_id
    and private.finance_expense_scope_allows(
      expense.organization_id, expense.employee_membership_id,
      expense.created_by_membership_id, 'finance.expense.view'
    )
));
create policy finance_expense_allocations_insert_authorized
on public.finance_expense_project_allocations for insert to authenticated
with check (exists (
  select 1 from public.finance_expenses as expense
  where expense.id = finance_expense_project_allocations.expense_id
    and private.finance_expense_scope_allows(
      expense.organization_id, expense.employee_membership_id,
      expense.created_by_membership_id, 'finance.expense.manage'
    )
));
create policy finance_expense_allocations_update_authorized
on public.finance_expense_project_allocations for update to authenticated
using (exists (
  select 1 from public.finance_expenses as expense
  where expense.id = finance_expense_project_allocations.expense_id
    and private.finance_expense_scope_allows(
      expense.organization_id, expense.employee_membership_id,
      expense.created_by_membership_id, 'finance.expense.manage'
    )
))
with check (exists (
  select 1 from public.finance_expenses as expense
  where expense.id = finance_expense_project_allocations.expense_id
    and private.finance_expense_scope_allows(
      expense.organization_id, expense.employee_membership_id,
      expense.created_by_membership_id, 'finance.expense.manage'
    )
));
create policy finance_expense_allocations_delete_authorized
on public.finance_expense_project_allocations for delete to authenticated
using (exists (
  select 1 from public.finance_expenses as expense
  where expense.id = finance_expense_project_allocations.expense_id
    and private.finance_expense_scope_allows(
      expense.organization_id, expense.employee_membership_id,
      expense.created_by_membership_id, 'finance.expense.manage'
    )
));

create policy finance_expense_receipts_select_authorized
on public.finance_expense_receipts for select to authenticated
using (exists (
  select 1 from public.finance_expenses as expense
  where expense.id = finance_expense_receipts.expense_id
    and private.finance_expense_scope_allows(
      expense.organization_id, expense.employee_membership_id,
      expense.created_by_membership_id, 'finance.expense.view'
    )
));
create policy finance_expense_receipts_insert_authorized
on public.finance_expense_receipts for insert to authenticated
with check (
  uploaded_by_membership_id = private.current_membership_id(organization_id)
  and exists (
    select 1 from public.finance_expenses as expense
    where expense.id = finance_expense_receipts.expense_id
      and private.finance_expense_scope_allows(
        expense.organization_id, expense.employee_membership_id,
        expense.created_by_membership_id, 'finance.expense_receipt.manage'
      )
  )
);
create policy finance_expense_receipts_delete_authorized
on public.finance_expense_receipts for delete to authenticated
using (exists (
  select 1 from public.finance_expenses as expense
  where expense.id = finance_expense_receipts.expense_id
    and private.finance_expense_scope_allows(
      expense.organization_id, expense.employee_membership_id,
      expense.created_by_membership_id, 'finance.expense_receipt.manage'
    )
));

create policy finance_expense_events_select_authorized
on public.finance_expense_events for select to authenticated
using (exists (
  select 1 from public.finance_expenses as expense
  where expense.id = finance_expense_events.expense_id
    and private.finance_expense_scope_allows(
      expense.organization_id, expense.employee_membership_id,
      expense.created_by_membership_id, 'finance.expense.view'
    )
));

revoke all on function private.finance_expense_scope_allows(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function private.validate_finance_expense_references()
  from public, anon, authenticated;
revoke all on function private.validate_finance_expense_allocation_tenant()
  from public, anon, authenticated;
revoke all on function private.validate_finance_expense_receipt_tenant()
  from public, anon, authenticated;
revoke all on function private.validate_finance_expense_allocation_totals()
  from public, anon, authenticated;
revoke all on function private.prevent_finance_expense_event_mutation()
  from public, anon, authenticated;

grant execute on function private.finance_expense_scope_allows(uuid, uuid, uuid, text)
  to authenticated, service_role;
