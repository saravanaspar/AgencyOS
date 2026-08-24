-- Finance credit notes and correction lineage: every correction references an issued invoice,
-- credit notes are immutable after issue, and invoice balances are recalculated transactionally.

set lock_timeout = '10s';
set statement_timeout = '120s';

insert into public.permissions (module, resource, action, description, is_sensitive)
values
  ('finance', 'invoice', 'correct', 'Create a revised invoice draft linked to an issued invoice.', true),
  ('finance', 'credit_note', 'view', 'View credit notes and their immutable history.', true),
  ('finance', 'credit_note', 'create', 'Create a credit note draft against an issued invoice.', true),
  ('finance', 'credit_note', 'approve', 'Approve or reject credit notes.', true),
  ('finance', 'credit_note', 'issue', 'Allocate a credit-note number and apply the credit to its invoice.', true),
  ('finance', 'credit_note', 'void', 'Void an issued credit note and reverse its invoice effect.', true)
on conflict (module, resource, action) do update
set description = excluded.description,
    is_sensitive = excluded.is_sensitive;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'organization'
from public.role_templates as role_template
cross join public.permissions as permission
where role_template.key in ('owner', 'finance_manager')
  and permission.key in (
    'finance.invoice.correct',
    'finance.credit_note.view',
    'finance.credit_note.create',
    'finance.credit_note.approve',
    'finance.credit_note.issue',
    'finance.credit_note.void'
  )
on conflict (role_template_key, permission_id) do update
set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'accountant', permission.id, 'organization'
from public.permissions as permission
where permission.key in (
  'finance.invoice.correct',
  'finance.credit_note.view',
  'finance.credit_note.create'
)
on conflict (role_template_key, permission_id) do update
set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'auditor', permission.id, 'organization'
from public.permissions as permission
where permission.key = 'finance.credit_note.view'
on conflict (role_template_key, permission_id) do update
set scope = excluded.scope;

insert into public.role_permissions (role_id, permission_id, scope, conditions)
select role.id, template_permission.permission_id, template_permission.scope, template_permission.conditions
from public.roles as role
join public.role_template_permissions as template_permission
  on template_permission.role_template_key = role.template_key
join public.permissions as permission on permission.id = template_permission.permission_id
where permission.key in (
  'finance.invoice.correct',
  'finance.credit_note.view',
  'finance.credit_note.create',
  'finance.credit_note.approve',
  'finance.credit_note.issue',
  'finance.credit_note.void'
)
on conflict (role_id, permission_id) do update
set scope = excluded.scope,
    conditions = excluded.conditions,
    updated_at = now();

alter table public.finance_invoices
  add column correction_of_invoice_id uuid references public.finance_invoices(id) on delete restrict,
  add column correction_reason text,
  add column credited_minor bigint not null default 0,
  add column credit_due_minor bigint not null default 0,
  add column status_before_credit text,
  drop constraint finance_invoices_totals_valid,
  add constraint finance_invoices_correction_reason_required check (
    correction_of_invoice_id is null
    or (
      correction_of_invoice_id <> id
      and btrim(coalesce(correction_reason, '')) <> ''
      and length(correction_reason) <= 1000
    )
  ),
  add constraint finance_invoices_status_before_credit_valid check (
    status_before_credit is null
    or status_before_credit in ('issued', 'sent', 'viewed', 'partially_paid', 'paid', 'overdue', 'disputed')
  ),
  add constraint finance_invoices_totals_valid check (
    subtotal_minor >= 0 and discount_minor >= 0 and tax_minor >= 0 and total_minor >= 0
    and amount_paid_minor >= 0 and amount_paid_minor <= total_minor
    and credited_minor >= 0 and credited_minor <= total_minor
    and balance_minor = greatest(total_minor - amount_paid_minor - credited_minor, 0)
    and credit_due_minor = greatest(amount_paid_minor + credited_minor - total_minor, 0)
  );

create index finance_invoices_correction_source_idx
  on public.finance_invoices (organization_id, correction_of_invoice_id, created_at desc)
  where correction_of_invoice_id is not null;

alter table public.finance_invoice_events
  drop constraint finance_invoice_events_type_valid,
  add constraint finance_invoice_events_type_valid check (
    event_type in (
      'created', 'updated', 'submitted', 'approved', 'rejected', 'issued', 'sent', 'viewed',
      'payment_recorded', 'voided', 'revision_created', 'credit_note_issued', 'credit_note_voided'
    )
  );

create table public.finance_credit_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  original_invoice_id uuid not null references public.finance_invoices(id) on delete restrict,
  credit_note_number text,
  issue_date date,
  currency text not null,
  status text not null default 'draft',
  approval_status text not null default 'not_required',
  reason text not null,
  internal_notes text,
  subtotal_minor bigint not null default 0,
  discount_minor bigint not null default 0,
  tax_minor bigint not null default 0,
  total_minor bigint not null default 0,
  content_hash text not null,
  seller_snapshot jsonb,
  client_snapshot jsonb,
  calculation_snapshot jsonb,
  original_invoice_snapshot jsonb,
  issued_pdf_file_id uuid references public.private_files(id) on delete restrict,
  approved_at timestamptz,
  issued_at timestamptz,
  sent_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_credit_notes_number_not_blank check (
    credit_note_number is null or (btrim(credit_note_number) <> '' and length(credit_note_number) <= 80)
  ),
  constraint finance_credit_notes_currency_valid check (currency ~ '^[A-Z]{3}$'),
  constraint finance_credit_notes_status_valid check (
    status in ('draft', 'pending_approval', 'approved', 'issued', 'sent', 'void')
  ),
  constraint finance_credit_notes_approval_valid check (
    approval_status in ('not_required', 'pending', 'approved', 'rejected')
  ),
  constraint finance_credit_notes_reason_required check (
    btrim(reason) <> '' and length(reason) <= 2000
  ),
  constraint finance_credit_notes_totals_valid check (
    subtotal_minor >= 0 and discount_minor >= 0 and tax_minor >= 0 and total_minor >= 0
  ),
  constraint finance_credit_notes_issue_consistent check (
    (issued_at is null and credit_note_number is null)
    or (issued_at is not null and credit_note_number is not null and issue_date is not null)
  ),
  constraint finance_credit_notes_snapshot_consistent check (
    issued_at is null
    or (
      jsonb_typeof(seller_snapshot) = 'object'
      and jsonb_typeof(client_snapshot) = 'object'
      and jsonb_typeof(calculation_snapshot) = 'object'
      and jsonb_typeof(original_invoice_snapshot) = 'object'
    )
  ),
  constraint finance_credit_notes_void_reason_required check (
    status <> 'void' or btrim(coalesce(void_reason, '')) <> ''
  ),
  constraint finance_credit_notes_hash_format check (content_hash ~ '^[a-f0-9]{64}$'),
  unique (organization_id, credit_note_number)
);

create unique index finance_credit_notes_draft_content_unique
  on public.finance_credit_notes (organization_id, original_invoice_id, content_hash)
  where status in ('draft', 'pending_approval');
create index finance_credit_notes_invoice_idx
  on public.finance_credit_notes (organization_id, original_invoice_id, created_at desc);

create table public.finance_credit_note_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  credit_note_id uuid not null references public.finance_credit_notes(id) on delete cascade,
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
  constraint finance_credit_note_lines_position_positive check (position > 0),
  constraint finance_credit_note_lines_description_not_blank check (btrim(description) <> ''),
  constraint finance_credit_note_lines_quantity_valid check (quantity_milli > 0),
  constraint finance_credit_note_lines_rate_valid check (unit_rate_minor >= 0),
  constraint finance_credit_note_lines_discount_valid check (discount_bps between 0 and 10000),
  constraint finance_credit_note_lines_tax_valid check (tax_bps between 0 and 100000),
  constraint finance_credit_note_lines_totals_valid check (
    subtotal_minor >= 0 and discount_minor >= 0 and tax_minor >= 0 and total_minor >= 0
  ),
  unique (credit_note_id, position)
);

create index finance_credit_note_lines_parent_idx
  on public.finance_credit_note_lines (credit_note_id, position);

create table public.finance_credit_note_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  credit_note_id uuid not null references public.finance_credit_notes(id) on delete cascade,
  event_type text not null,
  event_data jsonb not null default '{}'::jsonb,
  actor_membership_id uuid references public.memberships(id) on delete set null,
  occurred_at timestamptz not null default now(),
  constraint finance_credit_note_events_type_valid check (
    event_type in ('created', 'submitted', 'approved', 'rejected', 'issued', 'sent', 'voided')
  ),
  constraint finance_credit_note_events_data_object check (jsonb_typeof(event_data) = 'object')
);

create index finance_credit_note_events_parent_idx
  on public.finance_credit_note_events (credit_note_id, occurred_at desc);

create or replace function private.validate_invoice_correction_tenant()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  source_org uuid;
  source_company uuid;
  source_currency text;
  source_issued_at timestamptz;
begin
  if new.correction_of_invoice_id is null then
    return new;
  end if;

  select organization_id, company_id, currency, issued_at
  into source_org, source_company, source_currency, source_issued_at
  from public.finance_invoices
  where id = new.correction_of_invoice_id;

  if source_org is distinct from new.organization_id
     or source_company is distinct from new.company_id
     or source_currency is distinct from new.currency
     or source_issued_at is null then
    raise exception 'A revised invoice must reference an issued invoice for the same tenant, client, and currency.'
      using errcode = '23514';
  end if;
  return new;
end;
$function$;

create or replace function private.validate_credit_note_tenant()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  invoice_org uuid;
  invoice_currency text;
  invoice_issued_at timestamptz;
  creator_org uuid;
begin
  select organization_id, currency, issued_at
  into invoice_org, invoice_currency, invoice_issued_at
  from public.finance_invoices
  where id = new.original_invoice_id;

  select organization_id into creator_org
  from public.memberships
  where id = new.created_by_membership_id;

  if invoice_org is distinct from new.organization_id
     or invoice_currency is distinct from new.currency
     or invoice_issued_at is null
     or creator_org is distinct from new.organization_id then
    raise exception 'Credit note tenant, currency, invoice, and creator must match.'
      using errcode = '23514';
  end if;
  return new;
end;
$function$;

create or replace function private.validate_credit_note_line_tenant()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  note_org uuid;
  item_org uuid;
begin
  select organization_id into note_org
  from public.finance_credit_notes
  where id = new.credit_note_id;

  if note_org is distinct from new.organization_id then
    raise exception 'Credit note line must belong to the same organization.' using errcode = '23514';
  end if;

  if new.catalog_item_id is not null then
    select organization_id into item_org
    from public.finance_catalog_items
    where id = new.catalog_item_id;
    if item_org is distinct from new.organization_id then
      raise exception 'Credit note catalogue item must belong to the same organization.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function private.refresh_finance_credit_note_totals()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  target_id uuid;
begin
  target_id := coalesce(new.credit_note_id, old.credit_note_id);
  update public.finance_credit_notes as credit_note
  set subtotal_minor = totals.subtotal_minor,
      discount_minor = totals.discount_minor,
      tax_minor = totals.tax_minor,
      total_minor = totals.total_minor,
      updated_at = now()
  from (
    select coalesce(sum(subtotal_minor), 0)::bigint as subtotal_minor,
      coalesce(sum(discount_minor), 0)::bigint as discount_minor,
      coalesce(sum(tax_minor), 0)::bigint as tax_minor,
      coalesce(sum(total_minor), 0)::bigint as total_minor
    from public.finance_credit_note_lines
    where credit_note_id = target_id
  ) as totals
  where credit_note.id = target_id;
  return coalesce(new, old);
end;
$function$;

create or replace function private.prevent_issued_credit_note_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' and old.issued_at is not null then
    raise exception 'Issued credit notes cannot be deleted.' using errcode = '55000';
  end if;

  if tg_op = 'UPDATE' and old.issued_at is not null and (
    new.organization_id is distinct from old.organization_id
    or new.original_invoice_id is distinct from old.original_invoice_id
    or new.credit_note_number is distinct from old.credit_note_number
    or new.issue_date is distinct from old.issue_date
    or new.currency is distinct from old.currency
    or new.reason is distinct from old.reason
    or new.subtotal_minor is distinct from old.subtotal_minor
    or new.discount_minor is distinct from old.discount_minor
    or new.tax_minor is distinct from old.tax_minor
    or new.total_minor is distinct from old.total_minor
    or new.content_hash is distinct from old.content_hash
    or new.seller_snapshot is distinct from old.seller_snapshot
    or new.client_snapshot is distinct from old.client_snapshot
    or new.calculation_snapshot is distinct from old.calculation_snapshot
    or new.original_invoice_snapshot is distinct from old.original_invoice_snapshot
    or new.issued_at is distinct from old.issued_at
  ) then
    raise exception 'Issued credit-note financial and snapshot fields are immutable.' using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

create or replace function private.prevent_issued_credit_note_line_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  target_note uuid;
  issue_time timestamptz;
begin
  target_note := coalesce(new.credit_note_id, old.credit_note_id);
  select issued_at into issue_time
  from public.finance_credit_notes
  where id = target_note;
  if issue_time is not null then
    raise exception 'Issued credit note lines are immutable.' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

create or replace function private.refresh_invoice_credit_totals()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  target_invoice uuid;
  total_credit bigint;
  invoice_row public.finance_invoices%rowtype;
  restored_status text;
begin
  target_invoice := coalesce(new.original_invoice_id, old.original_invoice_id);
  select * into invoice_row
  from public.finance_invoices
  where id = target_invoice
  for update;

  if invoice_row.id is null then
    return coalesce(new, old);
  end if;

  select coalesce(sum(total_minor), 0)::bigint into total_credit
  from public.finance_credit_notes
  where original_invoice_id = target_invoice
    and status in ('issued', 'sent');

  if total_credit > invoice_row.total_minor then
    raise exception 'Issued credit notes cannot exceed the original invoice total.' using errcode = '23514';
  end if;

  restored_status := case
    when invoice_row.amount_paid_minor >= invoice_row.total_minor - total_credit then 'paid'
    when invoice_row.amount_paid_minor > 0 then 'partially_paid'
    else coalesce(invoice_row.status_before_credit, 'issued')
  end;

  update public.finance_invoices
  set credited_minor = total_credit,
      balance_minor = greatest(total_minor - amount_paid_minor - total_credit, 0),
      credit_due_minor = greatest(amount_paid_minor + total_credit - total_minor, 0),
      status_before_credit = case
        when total_credit = total_minor and status <> 'credited' then status
        else status_before_credit
      end,
      status = case
        when total_credit = total_minor then 'credited'
        when status = 'credited' then restored_status
        else status
      end,
      updated_at = now()
  where id = target_invoice;

  return coalesce(new, old);
end;
$function$;

create trigger finance_invoices_validate_correction
before insert or update of correction_of_invoice_id, organization_id, company_id, currency
on public.finance_invoices
for each row execute function private.validate_invoice_correction_tenant();

create trigger finance_credit_notes_validate_tenant
before insert or update on public.finance_credit_notes
for each row execute function private.validate_credit_note_tenant();

create trigger finance_credit_notes_prevent_issued_mutation
before update or delete on public.finance_credit_notes
for each row execute function private.prevent_issued_credit_note_mutation();

create trigger finance_credit_notes_set_updated_at
before update on public.finance_credit_notes
for each row execute function private.set_updated_at();

create trigger finance_credit_note_lines_prevent_issued_mutation
before insert or update or delete on public.finance_credit_note_lines
for each row execute function private.prevent_issued_credit_note_line_mutation();

create trigger finance_credit_note_lines_validate_tenant
before insert or update on public.finance_credit_note_lines
for each row execute function private.validate_credit_note_line_tenant();

create trigger finance_credit_note_lines_calculate
before insert or update on public.finance_credit_note_lines
for each row execute function private.set_finance_line_totals();

create trigger finance_credit_note_lines_refresh_parent
after insert or update or delete on public.finance_credit_note_lines
for each row execute function private.refresh_finance_credit_note_totals();

create trigger finance_credit_notes_refresh_invoice
after insert or delete or update of status, total_minor on public.finance_credit_notes
for each row execute function private.refresh_invoice_credit_totals();

create trigger finance_credit_note_events_prevent_update
before update on public.finance_credit_note_events
for each row execute function private.prevent_finance_event_mutation();

create trigger finance_credit_note_events_prevent_delete
before delete on public.finance_credit_note_events
for each row execute function private.prevent_finance_event_mutation();

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
    or new.correction_of_invoice_id is distinct from old.correction_of_invoice_id
    or new.correction_reason is distinct from old.correction_reason
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

alter table public.finance_document_snapshots
  drop constraint finance_document_snapshots_entity_valid,
  add constraint finance_document_snapshots_entity_valid check (
    entity_type in ('estimate', 'invoice', 'credit_note')
  );

alter table public.finance_email_deliveries
  drop constraint finance_email_deliveries_entity_valid,
  add constraint finance_email_deliveries_entity_valid check (
    entity_type in ('estimate', 'invoice', 'credit_note')
  );

create or replace function private.validate_finance_document_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_organization_id uuid;
  v_source_number text;
  v_source_version integer;
  v_file public.private_files%rowtype;
begin
  if new.entity_type = 'estimate' then
    select organization_id, estimate_number, version_number
    into v_source_organization_id, v_source_number, v_source_version
    from public.finance_estimates
    where id = new.entity_id;
  elsif new.entity_type = 'invoice' then
    select organization_id, invoice_number, 1
    into v_source_organization_id, v_source_number, v_source_version
    from public.finance_invoices
    where id = new.entity_id and issued_at is not null;
  else
    select organization_id, credit_note_number, 1
    into v_source_organization_id, v_source_number, v_source_version
    from public.finance_credit_notes
    where id = new.entity_id and issued_at is not null;
  end if;

  select * into v_file
  from public.private_files
  where id = new.private_file_id;

  if v_source_organization_id is null
     or v_source_organization_id <> new.organization_id
     or v_source_number is null
     or v_source_number <> new.document_number
     or v_source_version <> new.version_number
     or v_file.id is null
     or v_file.organization_id <> new.organization_id
     or v_file.module_key <> 'finance'
     or v_file.entity_type <> 'finance_document'
     or v_file.entity_id <> new.id
     or v_file.mime_type <> 'application/pdf'
     or v_file.status <> 'available' then
    raise exception using
      errcode = '23514',
      message = 'Finance document snapshot must match its tenant, source record, and generated PDF';
  end if;

  return new;
end;
$$;

alter table public.finance_credit_notes enable row level security;
alter table public.finance_credit_note_lines enable row level security;
alter table public.finance_credit_note_events enable row level security;

revoke all on public.finance_credit_notes from public, anon;
revoke all on public.finance_credit_note_lines from public, anon;
revoke all on public.finance_credit_note_events from public, anon;

grant select, insert, update on public.finance_credit_notes to authenticated;
grant select, insert, update, delete on public.finance_credit_note_lines to authenticated;
grant select on public.finance_credit_note_events to authenticated;
grant all on public.finance_credit_notes to service_role;
grant all on public.finance_credit_note_lines to service_role;
grant all on public.finance_credit_note_events to service_role;

create policy finance_credit_notes_select_authorized
on public.finance_credit_notes for select to authenticated
using (private.has_permission(organization_id, 'finance.credit_note.view'));

create policy finance_credit_notes_insert_authorized
on public.finance_credit_notes for insert to authenticated
with check (private.has_permission(organization_id, 'finance.credit_note.create'));

create policy finance_credit_notes_update_authorized
on public.finance_credit_notes for update to authenticated
using (
  private.has_permission(organization_id, 'finance.credit_note.create')
  or private.has_permission(organization_id, 'finance.credit_note.approve')
  or private.has_permission(organization_id, 'finance.credit_note.issue')
  or private.has_permission(organization_id, 'finance.credit_note.void')
)
with check (
  private.has_permission(organization_id, 'finance.credit_note.create')
  or private.has_permission(organization_id, 'finance.credit_note.approve')
  or private.has_permission(organization_id, 'finance.credit_note.issue')
  or private.has_permission(organization_id, 'finance.credit_note.void')
);

create policy finance_credit_note_lines_select_authorized
on public.finance_credit_note_lines for select to authenticated
using (private.has_permission(organization_id, 'finance.credit_note.view'));

create policy finance_credit_note_lines_insert_authorized
on public.finance_credit_note_lines for insert to authenticated
with check (private.has_permission(organization_id, 'finance.credit_note.create'));

create policy finance_credit_note_lines_update_authorized
on public.finance_credit_note_lines for update to authenticated
using (private.has_permission(organization_id, 'finance.credit_note.create'))
with check (private.has_permission(organization_id, 'finance.credit_note.create'));

create policy finance_credit_note_lines_delete_authorized
on public.finance_credit_note_lines for delete to authenticated
using (private.has_permission(organization_id, 'finance.credit_note.create'));

create policy finance_credit_note_events_select_authorized
on public.finance_credit_note_events for select to authenticated
using (private.has_permission(organization_id, 'finance.credit_note.view'));

drop policy finance_document_snapshots_select_authorized on public.finance_document_snapshots;
create policy finance_document_snapshots_select_authorized
on public.finance_document_snapshots for select to authenticated
using (
  private.has_permission(organization_id, 'finance.document.download')
  and (
    (entity_type = 'estimate' and private.has_permission(organization_id, 'finance.estimate.view'))
    or (entity_type = 'invoice' and private.has_permission(organization_id, 'finance.invoice.view'))
    or (entity_type = 'credit_note' and private.has_permission(organization_id, 'finance.credit_note.view'))
  )
);

drop policy finance_email_deliveries_select_authorized on public.finance_email_deliveries;
create policy finance_email_deliveries_select_authorized
on public.finance_email_deliveries for select to authenticated
using (
  private.has_permission(organization_id, 'finance.document.send')
  and (
    (entity_type = 'estimate' and private.has_permission(organization_id, 'finance.estimate.view'))
    or (entity_type = 'invoice' and private.has_permission(organization_id, 'finance.invoice.view'))
    or (entity_type = 'credit_note' and private.has_permission(organization_id, 'finance.credit_note.view'))
  )
);

revoke all on function private.validate_invoice_correction_tenant() from public, anon, authenticated;
revoke all on function private.validate_credit_note_tenant() from public, anon, authenticated;
revoke all on function private.validate_credit_note_line_tenant() from public, anon, authenticated;
revoke all on function private.refresh_finance_credit_note_totals() from public, anon, authenticated;
revoke all on function private.prevent_issued_credit_note_mutation() from public, anon, authenticated;
revoke all on function private.prevent_issued_credit_note_line_mutation() from public, anon, authenticated;
revoke all on function private.refresh_invoice_credit_totals() from public, anon, authenticated;
