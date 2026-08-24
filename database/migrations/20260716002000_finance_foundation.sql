-- Finance foundation: catalogue, estimates, invoices, payments, transactional numbering,
-- centralized line calculations, immutable issued snapshots, tenant validation, and RLS.

set lock_timeout = '10s';
set statement_timeout = '120s';

insert into public.permissions (module, resource, action, description, is_sensitive)
values
  ('finance', 'catalog', 'view', 'View finance products and services.', true),
  ('finance', 'catalog', 'manage', 'Create and update finance products and services.', true),
  ('finance', 'estimate', 'view', 'View estimates and their version history.', true),
  ('finance', 'estimate', 'create', 'Create duplicate-safe estimates.', true),
  ('finance', 'estimate', 'update', 'Update draft estimates and line items.', true),
  ('finance', 'estimate', 'approve', 'Approve or reject estimates.', true),
  ('finance', 'invoice', 'view', 'View invoices and immutable issue snapshots.', true),
  ('finance', 'invoice', 'create', 'Create duplicate-safe draft invoices.', true),
  ('finance', 'invoice', 'update', 'Update draft invoices and line items.', true),
  ('finance', 'invoice', 'approve', 'Approve or reject draft invoices.', true),
  ('finance', 'invoice', 'issue', 'Allocate an invoice number and issue an immutable invoice.', true),
  ('finance', 'invoice', 'void', 'Void an issued invoice with an auditable reason.', true),
  ('finance', 'payment', 'view', 'View payments and invoice allocations.', true),
  ('finance', 'payment', 'create', 'Record payments and allocate them to invoices.', true),
  ('finance', 'payment', 'reconcile', 'Change payment reconciliation state.', true),
  ('finance', 'report', 'view', 'View finance summaries and receivables reports.', true)
on conflict (module, resource, action) do update
set description = excluded.description, is_sensitive = excluded.is_sensitive;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'owner', permission.id, 'organization'
from public.permissions as permission
where permission.module = 'finance'
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'finance_manager', permission.id, 'organization'
from public.permissions as permission
where permission.module = 'finance'
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'accountant', permission.id, 'organization'
from public.permissions as permission
where permission.key in (
  'finance.workspace.view',
  'finance.catalog.view',
  'finance.catalog.manage',
  'finance.estimate.view',
  'finance.estimate.create',
  'finance.estimate.update',
  'finance.invoice.view',
  'finance.invoice.create',
  'finance.invoice.update',
  'finance.payment.view',
  'finance.payment.create',
  'finance.payment.reconcile',
  'finance.report.view'
)
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'auditor', permission.id, 'organization'
from public.permissions as permission
where permission.key in (
  'finance.catalog.view',
  'finance.estimate.view',
  'finance.invoice.view',
  'finance.payment.view',
  'finance.report.view'
)
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_permissions (role_id, permission_id, scope, conditions)
select role.id, template_permission.permission_id, template_permission.scope, template_permission.conditions
from public.roles as role
join public.role_template_permissions as template_permission
  on template_permission.role_template_key = role.template_key
join public.permissions as permission on permission.id = template_permission.permission_id
where permission.module = 'finance'
on conflict (role_id, permission_id) do update
set scope = excluded.scope, conditions = excluded.conditions, updated_at = now();

create table public.finance_document_sequences (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_type text not null,
  document_year integer not null,
  next_number integer not null default 1,
  primary key (organization_id, document_type, document_year),
  constraint finance_document_sequences_type_valid check (document_type in ('estimate', 'invoice', 'credit_note')),
  constraint finance_document_sequences_year_valid check (document_year between 2000 and 9999),
  constraint finance_document_sequences_number_positive check (next_number > 0)
);

create table public.finance_catalog_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  item_type text not null default 'service',
  name text not null,
  sku text,
  description text,
  unit text not null default 'each',
  standard_rate_minor bigint not null default 0,
  tax_category text not null default 'standard',
  tax_rate_bps integer not null default 0,
  currency text not null,
  is_active boolean not null default true,
  default_invoice_description text,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_catalog_items_type_valid check (item_type in ('service', 'product')),
  constraint finance_catalog_items_name_not_blank check (btrim(name) <> ''),
  constraint finance_catalog_items_sku_not_blank check (sku is null or btrim(sku) <> ''),
  constraint finance_catalog_items_unit_not_blank check (btrim(unit) <> ''),
  constraint finance_catalog_items_rate_valid check (standard_rate_minor >= 0),
  constraint finance_catalog_items_tax_rate_valid check (tax_rate_bps between 0 and 100000),
  constraint finance_catalog_items_currency_valid check (currency ~ '^[A-Z]{3}$')
);

create unique index finance_catalog_items_name_unique
  on public.finance_catalog_items (organization_id, item_type, lower(name));
create unique index finance_catalog_items_sku_unique
  on public.finance_catalog_items (organization_id, lower(sku)) where sku is not null;
create index finance_catalog_items_active_idx
  on public.finance_catalog_items (organization_id, is_active, lower(name));

create table public.finance_estimates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  estimate_number text not null,
  company_id uuid not null references public.crm_companies(id) on delete restrict,
  contact_id uuid references public.crm_contacts(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  issue_date date not null,
  expiry_date date,
  currency text not null,
  status text not null default 'draft',
  approval_status text not null default 'not_required',
  client_acceptance_status text not null default 'pending',
  notes text,
  terms text,
  internal_notes text,
  subtotal_minor bigint not null default 0,
  discount_minor bigint not null default 0,
  tax_minor bigint not null default 0,
  total_minor bigint not null default 0,
  content_hash text not null,
  version_number integer not null default 1,
  converted_invoice_id uuid,
  approved_at timestamptz,
  accepted_at timestamptz,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_estimates_number_not_blank check (btrim(estimate_number) <> ''),
  constraint finance_estimates_currency_valid check (currency ~ '^[A-Z]{3}$'),
  constraint finance_estimates_dates_valid check (expiry_date is null or expiry_date >= issue_date),
  constraint finance_estimates_status_valid check (status in ('draft', 'pending_approval', 'approved', 'sent', 'accepted', 'rejected', 'expired', 'converted', 'cancelled')),
  constraint finance_estimates_approval_valid check (approval_status in ('not_required', 'pending', 'approved', 'rejected')),
  constraint finance_estimates_acceptance_valid check (client_acceptance_status in ('pending', 'accepted', 'rejected', 'expired')),
  constraint finance_estimates_totals_valid check (
    subtotal_minor >= 0 and discount_minor >= 0 and tax_minor >= 0 and total_minor >= 0
  ),
  constraint finance_estimates_version_positive check (version_number > 0),
  constraint finance_estimates_hash_format check (content_hash ~ '^[a-f0-9]{64}$'),
  unique (organization_id, estimate_number)
);

create unique index finance_estimates_draft_content_unique
  on public.finance_estimates (organization_id, content_hash)
  where status in ('draft', 'pending_approval');
create index finance_estimates_company_status_idx
  on public.finance_estimates (organization_id, company_id, status, issue_date desc);
create index finance_estimates_project_idx
  on public.finance_estimates (project_id) where project_id is not null;

create table public.finance_estimate_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  estimate_id uuid not null references public.finance_estimates(id) on delete cascade,
  position integer not null,
  catalog_item_id uuid references public.finance_catalog_items(id) on delete set null,
  description text not null,
  quantity_milli bigint not null,
  unit_rate_minor bigint not null,
  discount_bps integer not null default 0,
  tax_bps integer not null default 0,
  subtotal_minor bigint not null default 0,
  discount_minor bigint not null default 0,
  tax_minor bigint not null default 0,
  total_minor bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_estimate_lines_position_positive check (position > 0),
  constraint finance_estimate_lines_description_not_blank check (btrim(description) <> ''),
  constraint finance_estimate_lines_quantity_valid check (quantity_milli > 0),
  constraint finance_estimate_lines_rate_valid check (unit_rate_minor >= 0),
  constraint finance_estimate_lines_discount_valid check (discount_bps between 0 and 10000),
  constraint finance_estimate_lines_tax_valid check (tax_bps between 0 and 100000),
  constraint finance_estimate_lines_totals_valid check (
    subtotal_minor >= 0 and discount_minor >= 0 and tax_minor >= 0 and total_minor >= 0
  ),
  unique (estimate_id, position)
);

create index finance_estimate_lines_estimate_idx
  on public.finance_estimate_lines (estimate_id, position);

create table public.finance_estimate_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  estimate_id uuid not null references public.finance_estimates(id) on delete cascade,
  version_number integer not null,
  snapshot jsonb not null,
  reason text not null,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint finance_estimate_versions_number_positive check (version_number > 0),
  constraint finance_estimate_versions_snapshot_object check (jsonb_typeof(snapshot) = 'object'),
  constraint finance_estimate_versions_reason_not_blank check (btrim(reason) <> ''),
  unique (estimate_id, version_number)
);

create table public.finance_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  draft_reference text not null,
  invoice_number text,
  company_id uuid not null references public.crm_companies(id) on delete restrict,
  contact_id uuid references public.crm_contacts(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  source_estimate_id uuid references public.finance_estimates(id) on delete set null,
  purchase_order_reference text,
  issue_date date,
  due_date date,
  service_period_start date,
  service_period_end date,
  currency text not null,
  status text not null default 'draft',
  approval_status text not null default 'not_required',
  notes text,
  terms text,
  bank_details text,
  internal_notes text,
  subtotal_minor bigint not null default 0,
  discount_minor bigint not null default 0,
  tax_minor bigint not null default 0,
  total_minor bigint not null default 0,
  amount_paid_minor bigint not null default 0,
  balance_minor bigint not null default 0,
  content_hash text not null,
  seller_snapshot jsonb,
  client_snapshot jsonb,
  calculation_snapshot jsonb,
  payment_snapshot jsonb,
  issued_pdf_file_id uuid references public.private_files(id) on delete restrict,
  approved_at timestamptz,
  issued_at timestamptz,
  sent_at timestamptz,
  viewed_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_invoices_draft_reference_not_blank check (btrim(draft_reference) <> ''),
  constraint finance_invoices_number_not_blank check (invoice_number is null or btrim(invoice_number) <> ''),
  constraint finance_invoices_currency_valid check (currency ~ '^[A-Z]{3}$'),
  constraint finance_invoices_dates_valid check (due_date is null or issue_date is null or due_date >= issue_date),
  constraint finance_invoices_service_dates_valid check (
    service_period_end is null or service_period_start is null or service_period_end >= service_period_start
  ),
  constraint finance_invoices_status_valid check (status in ('draft', 'pending_approval', 'approved', 'issued', 'sent', 'viewed', 'partially_paid', 'paid', 'overdue', 'disputed', 'void', 'credited')),
  constraint finance_invoices_approval_valid check (approval_status in ('not_required', 'pending', 'approved', 'rejected')),
  constraint finance_invoices_totals_valid check (
    subtotal_minor >= 0 and discount_minor >= 0 and tax_minor >= 0 and total_minor >= 0
    and amount_paid_minor >= 0 and balance_minor >= 0 and amount_paid_minor <= total_minor
  ),
  constraint finance_invoices_issue_consistent check (
    (issued_at is null and invoice_number is null)
    or (issued_at is not null and invoice_number is not null and issue_date is not null)
  ),
  constraint finance_invoices_void_reason_required check (status <> 'void' or btrim(coalesce(void_reason, '')) <> ''),
  constraint finance_invoices_snapshot_consistent check (
    issued_at is null
    or (
      jsonb_typeof(seller_snapshot) = 'object'
      and jsonb_typeof(client_snapshot) = 'object'
      and jsonb_typeof(calculation_snapshot) = 'object'
      and jsonb_typeof(payment_snapshot) = 'object'
    )
  ),
  constraint finance_invoices_hash_format check (content_hash ~ '^[a-f0-9]{64}$'),
  unique (organization_id, draft_reference),
  unique (organization_id, invoice_number)
);

alter table public.finance_estimates
  add constraint finance_estimates_converted_invoice_fk
  foreign key (converted_invoice_id) references public.finance_invoices(id) on delete set null;

create unique index finance_invoices_draft_content_unique
  on public.finance_invoices (organization_id, content_hash)
  where status in ('draft', 'pending_approval');
create index finance_invoices_company_status_idx
  on public.finance_invoices (organization_id, company_id, status, issue_date desc, created_at desc);
create index finance_invoices_due_idx
  on public.finance_invoices (organization_id, due_date, status)
  where due_date is not null and status not in ('paid', 'void', 'credited');

create table public.finance_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.finance_invoices(id) on delete cascade,
  position integer not null,
  catalog_item_id uuid references public.finance_catalog_items(id) on delete set null,
  description text not null,
  quantity_milli bigint not null,
  unit_rate_minor bigint not null,
  discount_bps integer not null default 0,
  tax_bps integer not null default 0,
  subtotal_minor bigint not null default 0,
  discount_minor bigint not null default 0,
  tax_minor bigint not null default 0,
  total_minor bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_invoice_lines_position_positive check (position > 0),
  constraint finance_invoice_lines_description_not_blank check (btrim(description) <> ''),
  constraint finance_invoice_lines_quantity_valid check (quantity_milli > 0),
  constraint finance_invoice_lines_rate_valid check (unit_rate_minor >= 0),
  constraint finance_invoice_lines_discount_valid check (discount_bps between 0 and 10000),
  constraint finance_invoice_lines_tax_valid check (tax_bps between 0 and 100000),
  constraint finance_invoice_lines_totals_valid check (
    subtotal_minor >= 0 and discount_minor >= 0 and tax_minor >= 0 and total_minor >= 0
  ),
  unique (invoice_id, position)
);

create index finance_invoice_lines_invoice_idx
  on public.finance_invoice_lines (invoice_id, position);

create table public.finance_invoice_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.finance_invoices(id) on delete cascade,
  event_type text not null,
  event_data jsonb not null default '{}'::jsonb,
  actor_membership_id uuid references public.memberships(id) on delete set null,
  occurred_at timestamptz not null default now(),
  constraint finance_invoice_events_type_valid check (event_type in ('created', 'updated', 'submitted', 'approved', 'rejected', 'issued', 'sent', 'viewed', 'payment_recorded', 'voided')),
  constraint finance_invoice_events_data_object check (jsonb_typeof(event_data) = 'object')
);

create index finance_invoice_events_invoice_idx
  on public.finance_invoice_events (invoice_id, occurred_at desc);

create table public.finance_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payment_date date not null,
  amount_minor bigint not null,
  currency text not null,
  payment_method text not null,
  transaction_reference text,
  bank_account text,
  company_id uuid not null references public.crm_companies(id) on delete restrict,
  receipt_file_id uuid references public.private_files(id) on delete restrict,
  notes text,
  reconciliation_status text not null default 'unreconciled',
  refund_state text not null default 'none',
  entered_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_payments_amount_positive check (amount_minor > 0),
  constraint finance_payments_currency_valid check (currency ~ '^[A-Z]{3}$'),
  constraint finance_payments_method_valid check (payment_method in ('bank_transfer', 'card', 'cash', 'cheque', 'wallet', 'other')),
  constraint finance_payments_reconciliation_valid check (reconciliation_status in ('unreconciled', 'matched', 'reconciled', 'exception')),
  constraint finance_payments_refund_valid check (refund_state in ('none', 'partial', 'full'))
);

create unique index finance_payments_reference_unique
  on public.finance_payments (organization_id, lower(transaction_reference))
  where transaction_reference is not null;
create index finance_payments_company_date_idx
  on public.finance_payments (organization_id, company_id, payment_date desc);

create table public.finance_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payment_id uuid not null references public.finance_payments(id) on delete cascade,
  invoice_id uuid not null references public.finance_invoices(id) on delete restrict,
  amount_minor bigint not null,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint finance_payment_allocations_amount_positive check (amount_minor > 0),
  unique (payment_id, invoice_id)
);

create index finance_payment_allocations_invoice_idx
  on public.finance_payment_allocations (invoice_id, created_at desc);

create or replace function private.next_finance_document_number(
  p_organization_id uuid,
  p_document_type text,
  p_document_year integer,
  p_prefix text
)
returns text
language plpgsql
set search_path = ''
as $function$
declare
  allocated integer;
begin
  if p_document_type not in ('estimate', 'invoice', 'credit_note') then
    raise exception 'Unsupported finance document type.' using errcode = '22023';
  end if;
  if p_document_year < 2000 or p_document_year > 9999 then
    raise exception 'Finance document year is invalid.' using errcode = '22023';
  end if;
  if p_prefix !~ '^[A-Z]{2,8}$' then
    raise exception 'Finance document prefix is invalid.' using errcode = '22023';
  end if;

  insert into public.finance_document_sequences (
    organization_id, document_type, document_year, next_number
  ) values (
    p_organization_id, p_document_type, p_document_year, 2
  )
  on conflict (organization_id, document_type, document_year)
  do update set next_number = public.finance_document_sequences.next_number + 1
  returning next_number - 1 into allocated;

  return format('%s-%s-%s', p_prefix, p_document_year, lpad(allocated::text, 6, '0'));
end;
$function$;

create or replace function private.set_finance_line_totals()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  gross numeric;
  discount_value numeric;
  taxable numeric;
begin
  gross := round((new.quantity_milli::numeric * new.unit_rate_minor::numeric) / 1000);
  discount_value := round((gross * new.discount_bps::numeric) / 10000);
  taxable := gross - discount_value;

  new.subtotal_minor := gross::bigint;
  new.discount_minor := discount_value::bigint;
  new.tax_minor := round((taxable * new.tax_bps::numeric) / 10000)::bigint;
  new.total_minor := (taxable + new.tax_minor)::bigint;
  new.updated_at := now();
  return new;
end;
$function$;

create or replace function private.refresh_finance_estimate_totals()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  target_id uuid;
begin
  target_id := coalesce(new.estimate_id, old.estimate_id);
  update public.finance_estimates as estimate
  set
    subtotal_minor = totals.subtotal_minor,
    discount_minor = totals.discount_minor,
    tax_minor = totals.tax_minor,
    total_minor = totals.total_minor,
    updated_at = now()
  from (
    select
      coalesce(sum(line.subtotal_minor), 0)::bigint as subtotal_minor,
      coalesce(sum(line.discount_minor), 0)::bigint as discount_minor,
      coalesce(sum(line.tax_minor), 0)::bigint as tax_minor,
      coalesce(sum(line.total_minor), 0)::bigint as total_minor
    from public.finance_estimate_lines as line
    where line.estimate_id = target_id
  ) as totals
  where estimate.id = target_id;
  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$function$;

create or replace function private.refresh_finance_invoice_totals()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  target_id uuid;
begin
  target_id := coalesce(new.invoice_id, old.invoice_id);
  update public.finance_invoices as invoice
  set
    subtotal_minor = totals.subtotal_minor,
    discount_minor = totals.discount_minor,
    tax_minor = totals.tax_minor,
    total_minor = totals.total_minor,
    balance_minor = greatest(totals.total_minor - invoice.amount_paid_minor, 0),
    updated_at = now()
  from (
    select
      coalesce(sum(line.subtotal_minor), 0)::bigint as subtotal_minor,
      coalesce(sum(line.discount_minor), 0)::bigint as discount_minor,
      coalesce(sum(line.tax_minor), 0)::bigint as tax_minor,
      coalesce(sum(line.total_minor), 0)::bigint as total_minor
    from public.finance_invoice_lines as line
    where line.invoice_id = target_id
  ) as totals
  where invoice.id = target_id;
  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$function$;

create or replace function private.validate_finance_document_tenant()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  company_org uuid;
  contact_org uuid;
  contact_company uuid;
  project_org uuid;
  project_company uuid;
begin
  select organization_id into company_org
  from public.crm_companies
  where id = new.company_id;
  if company_org is distinct from new.organization_id then
    raise exception 'Finance company must belong to the same organization.' using errcode = '23514';
  end if;

  if new.contact_id is not null then
    select organization_id, company_id into contact_org, contact_company
    from public.crm_contacts
    where id = new.contact_id;
    if contact_org is distinct from new.organization_id
      or contact_company is distinct from new.company_id then
      raise exception 'Finance contact must belong to the selected company.' using errcode = '23514';
    end if;
  end if;

  if new.project_id is not null then
    select organization_id, company_id into project_org, project_company
    from public.projects
    where id = new.project_id;
    if project_org is distinct from new.organization_id
      or (project_company is not null and project_company is distinct from new.company_id) then
      raise exception 'Finance project must belong to the same organization and client.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function private.validate_finance_line_tenant()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  parent_org uuid;
  item_org uuid;
begin
  if tg_table_name = 'finance_estimate_lines' then
    select organization_id into parent_org
    from public.finance_estimates where id = new.estimate_id;
  else
    select organization_id into parent_org
    from public.finance_invoices where id = new.invoice_id;
  end if;

  if parent_org is distinct from new.organization_id then
    raise exception 'Finance line must belong to the parent organization.' using errcode = '23514';
  end if;

  if new.catalog_item_id is not null then
    select organization_id into item_org
    from public.finance_catalog_items where id = new.catalog_item_id;
    if item_org is distinct from new.organization_id then
      raise exception 'Finance catalogue item must belong to the same organization.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function private.prevent_issued_invoice_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' and old.issued_at is not null then
    raise exception 'Issued invoices cannot be deleted.' using errcode = '55000';
  end if;

  if tg_op = 'UPDATE' and old.issued_at is not null and (
    new.organization_id is distinct from old.organization_id
    or new.draft_reference is distinct from old.draft_reference
    or new.invoice_number is distinct from old.invoice_number
    or new.company_id is distinct from old.company_id
    or new.contact_id is distinct from old.contact_id
    or new.project_id is distinct from old.project_id
    or new.source_estimate_id is distinct from old.source_estimate_id
    or new.purchase_order_reference is distinct from old.purchase_order_reference
    or new.issue_date is distinct from old.issue_date
    or new.due_date is distinct from old.due_date
    or new.service_period_start is distinct from old.service_period_start
    or new.service_period_end is distinct from old.service_period_end
    or new.currency is distinct from old.currency
    or new.notes is distinct from old.notes
    or new.terms is distinct from old.terms
    or new.bank_details is distinct from old.bank_details
    or new.subtotal_minor is distinct from old.subtotal_minor
    or new.discount_minor is distinct from old.discount_minor
    or new.tax_minor is distinct from old.tax_minor
    or new.total_minor is distinct from old.total_minor
    or new.content_hash is distinct from old.content_hash
    or new.seller_snapshot is distinct from old.seller_snapshot
    or new.client_snapshot is distinct from old.client_snapshot
    or new.calculation_snapshot is distinct from old.calculation_snapshot
    or new.payment_snapshot is distinct from old.payment_snapshot
    or new.issued_at is distinct from old.issued_at
  ) then
    raise exception 'Issued invoice financial and snapshot fields are immutable.' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$function$;

create or replace function private.prevent_issued_invoice_line_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  target_invoice uuid;
  issue_time timestamptz;
begin
  target_invoice := coalesce(new.invoice_id, old.invoice_id);
  select issued_at into issue_time from public.finance_invoices where id = target_invoice;
  if issue_time is not null then
    raise exception 'Issued invoice lines are immutable.' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$function$;

create or replace function private.prevent_finance_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception 'Finance event history is append-only.' using errcode = '55000';
end;
$function$;

create or replace function private.validate_payment_allocation_tenant()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  payment_org uuid;
  payment_currency text;
  payment_company uuid;
  invoice_org uuid;
  invoice_currency text;
  invoice_company uuid;
begin
  select organization_id, currency, company_id
  into payment_org, payment_currency, payment_company
  from public.finance_payments where id = new.payment_id;

  select organization_id, currency, company_id
  into invoice_org, invoice_currency, invoice_company
  from public.finance_invoices where id = new.invoice_id;

  if payment_org is distinct from new.organization_id
    or invoice_org is distinct from new.organization_id
    or payment_currency is distinct from invoice_currency
    or payment_company is distinct from invoice_company then
    raise exception 'Payment allocation must use the same organization, client, and currency.' using errcode = '23514';
  end if;
  return new;
end;
$function$;

create trigger finance_catalog_items_set_updated_at
before update on public.finance_catalog_items
for each row execute function private.set_updated_at();

create trigger finance_estimates_validate_tenant
before insert or update on public.finance_estimates
for each row execute function private.validate_finance_document_tenant();
create trigger finance_estimates_set_updated_at
before update on public.finance_estimates
for each row execute function private.set_updated_at();

create trigger finance_estimate_lines_validate_tenant
before insert or update on public.finance_estimate_lines
for each row execute function private.validate_finance_line_tenant();
create trigger finance_estimate_lines_calculate
before insert or update on public.finance_estimate_lines
for each row execute function private.set_finance_line_totals();
create trigger finance_estimate_lines_refresh_parent
  after insert or update or delete on public.finance_estimate_lines
  for each row execute function private.refresh_finance_estimate_totals();

create trigger finance_invoices_validate_tenant
before insert or update on public.finance_invoices
for each row execute function private.validate_finance_document_tenant();
create trigger finance_invoices_prevent_issued_mutation
before update or delete on public.finance_invoices
for each row execute function private.prevent_issued_invoice_mutation();
create trigger finance_invoices_set_updated_at
before update on public.finance_invoices
for each row execute function private.set_updated_at();

create trigger finance_invoice_lines_prevent_issued_mutation
before insert or update or delete on public.finance_invoice_lines
for each row execute function private.prevent_issued_invoice_line_mutation();
create trigger finance_invoice_lines_validate_tenant
before insert or update on public.finance_invoice_lines
for each row execute function private.validate_finance_line_tenant();
create trigger finance_invoice_lines_calculate
before insert or update on public.finance_invoice_lines
for each row execute function private.set_finance_line_totals();
create trigger finance_invoice_lines_refresh_parent
  after insert or update or delete on public.finance_invoice_lines
  for each row execute function private.refresh_finance_invoice_totals();

create trigger finance_invoice_events_prevent_update
before update on public.finance_invoice_events
for each row execute function private.prevent_finance_event_mutation();
create trigger finance_invoice_events_prevent_delete
before delete on public.finance_invoice_events
for each row execute function private.prevent_finance_event_mutation();

create trigger finance_payments_set_updated_at
before update on public.finance_payments
for each row execute function private.set_updated_at();
create trigger finance_payment_allocations_validate_tenant
before insert or update on public.finance_payment_allocations
for each row execute function private.validate_payment_allocation_tenant();

alter table public.finance_document_sequences enable row level security;
alter table public.finance_catalog_items enable row level security;
alter table public.finance_estimates enable row level security;
alter table public.finance_estimate_lines enable row level security;
alter table public.finance_estimate_versions enable row level security;
alter table public.finance_invoices enable row level security;
alter table public.finance_invoice_lines enable row level security;
alter table public.finance_invoice_events enable row level security;
alter table public.finance_payments enable row level security;
alter table public.finance_payment_allocations enable row level security;

revoke all on public.finance_document_sequences from public, anon, authenticated;
revoke all on public.finance_catalog_items from public, anon;
revoke all on public.finance_estimates from public, anon;
revoke all on public.finance_estimate_lines from public, anon;
revoke all on public.finance_estimate_versions from public, anon;
revoke all on public.finance_invoices from public, anon;
revoke all on public.finance_invoice_lines from public, anon;
revoke all on public.finance_invoice_events from public, anon;
revoke all on public.finance_payments from public, anon;
revoke all on public.finance_payment_allocations from public, anon;

grant select, insert, update on public.finance_catalog_items to authenticated;
grant select, insert, update on public.finance_estimates to authenticated;
grant select, insert, update, delete on public.finance_estimate_lines to authenticated;
grant select, insert on public.finance_estimate_versions to authenticated;
grant select, insert, update on public.finance_invoices to authenticated;
grant select, insert, update, delete on public.finance_invoice_lines to authenticated;
grant select, insert on public.finance_invoice_events to authenticated;
grant select, insert, update on public.finance_payments to authenticated;
grant select, insert, update, delete on public.finance_payment_allocations to authenticated;

grant all on public.finance_document_sequences to service_role;
grant all on public.finance_catalog_items to service_role;
grant all on public.finance_estimates to service_role;
grant all on public.finance_estimate_lines to service_role;
grant all on public.finance_estimate_versions to service_role;
grant all on public.finance_invoices to service_role;
grant all on public.finance_invoice_lines to service_role;
grant all on public.finance_invoice_events to service_role;
grant all on public.finance_payments to service_role;
grant all on public.finance_payment_allocations to service_role;

create policy finance_catalog_items_select_authorized
on public.finance_catalog_items for select to authenticated
using (private.has_permission(organization_id, 'finance.catalog.view'));
create policy finance_catalog_items_insert_authorized
on public.finance_catalog_items for insert to authenticated
with check (
  private.has_permission(organization_id, 'finance.catalog.manage')
  and created_by_membership_id = private.current_membership_id(organization_id)
);
create policy finance_catalog_items_update_authorized
on public.finance_catalog_items for update to authenticated
using (private.has_permission(organization_id, 'finance.catalog.manage'))
with check (private.has_permission(organization_id, 'finance.catalog.manage'));

create policy finance_estimates_select_authorized
on public.finance_estimates for select to authenticated
using (private.has_permission(organization_id, 'finance.estimate.view'));
create policy finance_estimates_insert_authorized
on public.finance_estimates for insert to authenticated
with check (
  private.has_permission(organization_id, 'finance.estimate.create')
  and created_by_membership_id = private.current_membership_id(organization_id)
);
create policy finance_estimates_update_authorized
on public.finance_estimates for update to authenticated
using (
  private.has_permission(organization_id, 'finance.estimate.update')
  or private.has_permission(organization_id, 'finance.estimate.approve')
)
with check (
  private.has_permission(organization_id, 'finance.estimate.update')
  or private.has_permission(organization_id, 'finance.estimate.approve')
);

create policy finance_estimate_lines_select_authorized
on public.finance_estimate_lines for select to authenticated
using (private.has_permission(organization_id, 'finance.estimate.view'));
create policy finance_estimate_lines_insert_authorized
on public.finance_estimate_lines for insert to authenticated
with check (private.has_permission(organization_id, 'finance.estimate.update'));
create policy finance_estimate_lines_update_authorized
on public.finance_estimate_lines for update to authenticated
using (private.has_permission(organization_id, 'finance.estimate.update'))
with check (private.has_permission(organization_id, 'finance.estimate.update'));
create policy finance_estimate_lines_delete_authorized
on public.finance_estimate_lines for delete to authenticated
using (private.has_permission(organization_id, 'finance.estimate.update'));

create policy finance_estimate_versions_select_authorized
on public.finance_estimate_versions for select to authenticated
using (private.has_permission(organization_id, 'finance.estimate.view'));
create policy finance_estimate_versions_insert_authorized
on public.finance_estimate_versions for insert to authenticated
with check (private.has_permission(organization_id, 'finance.estimate.update'));

create policy finance_invoices_select_authorized
on public.finance_invoices for select to authenticated
using (private.has_permission(organization_id, 'finance.invoice.view'));
create policy finance_invoices_insert_authorized
on public.finance_invoices for insert to authenticated
with check (
  private.has_permission(organization_id, 'finance.invoice.create')
  and created_by_membership_id = private.current_membership_id(organization_id)
);
create policy finance_invoices_update_authorized
on public.finance_invoices for update to authenticated
using (
  private.has_permission(organization_id, 'finance.invoice.update')
  or private.has_permission(organization_id, 'finance.invoice.approve')
  or private.has_permission(organization_id, 'finance.invoice.issue')
  or private.has_permission(organization_id, 'finance.invoice.void')
)
with check (
  private.has_permission(organization_id, 'finance.invoice.update')
  or private.has_permission(organization_id, 'finance.invoice.approve')
  or private.has_permission(organization_id, 'finance.invoice.issue')
  or private.has_permission(organization_id, 'finance.invoice.void')
);

create policy finance_invoice_lines_select_authorized
on public.finance_invoice_lines for select to authenticated
using (private.has_permission(organization_id, 'finance.invoice.view'));
create policy finance_invoice_lines_insert_authorized
on public.finance_invoice_lines for insert to authenticated
with check (private.has_permission(organization_id, 'finance.invoice.update'));
create policy finance_invoice_lines_update_authorized
on public.finance_invoice_lines for update to authenticated
using (private.has_permission(organization_id, 'finance.invoice.update'))
with check (private.has_permission(organization_id, 'finance.invoice.update'));
create policy finance_invoice_lines_delete_authorized
on public.finance_invoice_lines for delete to authenticated
using (private.has_permission(organization_id, 'finance.invoice.update'));

create policy finance_invoice_events_select_authorized
on public.finance_invoice_events for select to authenticated
using (private.has_permission(organization_id, 'finance.invoice.view'));
create policy finance_invoice_events_insert_authorized
on public.finance_invoice_events for insert to authenticated
with check (
  actor_membership_id = private.current_membership_id(organization_id)
  and (
    private.has_permission(organization_id, 'finance.invoice.create')
    or private.has_permission(organization_id, 'finance.invoice.update')
    or private.has_permission(organization_id, 'finance.invoice.approve')
    or private.has_permission(organization_id, 'finance.invoice.issue')
    or private.has_permission(organization_id, 'finance.invoice.void')
    or private.has_permission(organization_id, 'finance.payment.create')
  )
);

create policy finance_payments_select_authorized
on public.finance_payments for select to authenticated
using (private.has_permission(organization_id, 'finance.payment.view'));
create policy finance_payments_insert_authorized
on public.finance_payments for insert to authenticated
with check (
  private.has_permission(organization_id, 'finance.payment.create')
  and entered_by_membership_id = private.current_membership_id(organization_id)
);
create policy finance_payments_update_authorized
on public.finance_payments for update to authenticated
using (private.has_permission(organization_id, 'finance.payment.reconcile'))
with check (private.has_permission(organization_id, 'finance.payment.reconcile'));

create policy finance_payment_allocations_select_authorized
on public.finance_payment_allocations for select to authenticated
using (private.has_permission(organization_id, 'finance.payment.view'));
create policy finance_payment_allocations_insert_authorized
on public.finance_payment_allocations for insert to authenticated
with check (
  private.has_permission(organization_id, 'finance.payment.create')
  and created_by_membership_id = private.current_membership_id(organization_id)
);
create policy finance_payment_allocations_update_authorized
on public.finance_payment_allocations for update to authenticated
using (private.has_permission(organization_id, 'finance.payment.reconcile'))
with check (private.has_permission(organization_id, 'finance.payment.reconcile'));
create policy finance_payment_allocations_delete_authorized
on public.finance_payment_allocations for delete to authenticated
using (private.has_permission(organization_id, 'finance.payment.reconcile'));

revoke all on function private.next_finance_document_number(uuid, text, integer, text) from public, anon, authenticated;
revoke all on function private.set_finance_line_totals() from public, anon;
revoke all on function private.refresh_finance_estimate_totals() from public, anon;
revoke all on function private.refresh_finance_invoice_totals() from public, anon;
revoke all on function private.validate_finance_document_tenant() from public, anon;
revoke all on function private.validate_finance_line_tenant() from public, anon;
revoke all on function private.prevent_issued_invoice_mutation() from public, anon;
revoke all on function private.prevent_issued_invoice_line_mutation() from public, anon;
revoke all on function private.prevent_finance_event_mutation() from public, anon;
revoke all on function private.validate_payment_allocation_tenant() from public, anon;
grant execute on function private.next_finance_document_number(uuid, text, integer, text) to service_role;
