-- Finance invoice and payment operations: attachments, status lifecycle, exchange-rate evidence,
-- payment receipts, and immutable refunds.

set lock_timeout = '10s';
set statement_timeout = '120s';

insert into public.permissions (module, resource, action, description, is_sensitive)
values
  ('finance', 'invoice_attachment', 'manage', 'Upload and remove private invoice attachments.', true),
  ('finance', 'invoice_status', 'manage', 'Record viewed, overdue, disputed, and resolved invoice states.', true),
  ('finance', 'payment', 'refund', 'Record immutable payment refunds.', true)
on conflict (module, resource, action) do update
set description = excluded.description,
    is_sensitive = excluded.is_sensitive;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'organization'
from public.role_templates as role_template
cross join public.permissions as permission
where role_template.key in ('owner', 'finance_manager')
  and permission.key in (
    'finance.invoice_attachment.manage',
    'finance.invoice_status.manage',
    'finance.payment.refund'
  )
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'accountant', permission.id, 'organization'
from public.permissions as permission
where permission.key in (
  'finance.invoice_attachment.manage',
  'finance.invoice_status.manage',
  'finance.payment.refund'
)
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_permissions (role_id, permission_id, scope, conditions)
select role.id, template_permission.permission_id, template_permission.scope, template_permission.conditions
from public.roles as role
join public.role_template_permissions as template_permission
  on template_permission.role_template_key = role.template_key
join public.permissions as permission on permission.id = template_permission.permission_id
where permission.key in (
  'finance.invoice_attachment.manage',
  'finance.invoice_status.manage',
  'finance.payment.refund'
)
on conflict (role_id, permission_id) do update
set scope = excluded.scope,
    conditions = excluded.conditions,
    updated_at = now();

alter table public.finance_invoices
  add column exchange_rate numeric(20, 8),
  add column dispute_reason text,
  add column disputed_at timestamptz,
  add column dispute_resolved_at timestamptz,
  add column dispute_resolution_note text,
  add constraint finance_invoices_exchange_rate_positive check (
    exchange_rate is null or exchange_rate > 0
  ),
  add constraint finance_invoices_dispute_reason_bounded check (
    dispute_reason is null or (btrim(dispute_reason) <> '' and length(dispute_reason) <= 2000)
  ),
  add constraint finance_invoices_dispute_resolution_bounded check (
    dispute_resolution_note is null
    or (btrim(dispute_resolution_note) <> '' and length(dispute_resolution_note) <= 2000)
  ),
  add constraint finance_invoices_dispute_shape check (
    (status <> 'disputed' or (disputed_at is not null and dispute_reason is not null))
    and (dispute_resolved_at is null or disputed_at is not null)
  );

alter table public.finance_invoice_events
  drop constraint finance_invoice_events_type_valid,
  add constraint finance_invoice_events_type_valid check (
    event_type in (
      'created', 'updated', 'submitted', 'approved', 'rejected', 'issued', 'sent', 'viewed',
      'overdue', 'disputed', 'dispute_resolved', 'payment_recorded', 'credited',
      'attachment_added', 'attachment_removed', 'revision_created',
      'credit_note_issued', 'credit_note_voided', 'voided'
    )
  );

create table public.finance_invoice_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.finance_invoices(id) on delete restrict,
  private_file_id uuid not null references public.private_files(id) on delete restrict,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  sha256 text not null,
  uploaded_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint finance_invoice_attachments_file_name_not_blank check (
    btrim(file_name) <> '' and length(file_name) <= 255
  ),
  constraint finance_invoice_attachments_mime_not_blank check (
    btrim(mime_type) <> '' and length(mime_type) <= 160
  ),
  constraint finance_invoice_attachments_size_positive check (size_bytes > 0),
  constraint finance_invoice_attachments_sha_shape check (sha256 ~ '^[a-f0-9]{64}$'),
  unique (private_file_id)
);

create index finance_invoice_attachments_invoice_idx
  on public.finance_invoice_attachments (organization_id, invoice_id, created_at desc);

create or replace function private.validate_finance_invoice_attachment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.finance_invoices%rowtype;
  v_file public.private_files%rowtype;
  v_uploader_organization_id uuid;
begin
  select * into v_invoice from public.finance_invoices where id = new.invoice_id;
  select * into v_file from public.private_files where id = new.private_file_id;
  select organization_id into v_uploader_organization_id
  from public.memberships where id = new.uploaded_by_membership_id;

  if v_invoice.id is null
     or v_invoice.organization_id <> new.organization_id
     or v_file.id is null
     or v_file.organization_id <> new.organization_id
     or v_file.module_key <> 'finance'
     or v_file.entity_type <> 'finance_invoice'
     or v_file.entity_id <> new.invoice_id
     or v_file.original_file_name <> new.file_name
     or v_file.mime_type <> new.mime_type
     or v_file.size_bytes <> new.size_bytes
     or v_file.sha256 <> new.sha256
     or v_uploader_organization_id is null
     or v_uploader_organization_id <> new.organization_id then
    raise exception using
      errcode = '23514',
      message = 'Finance invoice attachment must match its tenant, invoice, file, and uploader';
  end if;

  return new;
end;
$$;

create or replace function private.prevent_issued_invoice_attachment_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_issued_at timestamptz;
begin
  select issued_at into v_issued_at from public.finance_invoices where id = old.invoice_id;
  if v_issued_at is not null then
    raise exception using
      errcode = '55000',
      message = 'Attachments on an issued invoice are immutable';
  end if;
  return old;
end;
$$;

create trigger finance_invoice_attachments_validate
before insert or update on public.finance_invoice_attachments
for each row execute function private.validate_finance_invoice_attachment();

create trigger finance_invoice_attachments_prevent_issued_delete
before delete on public.finance_invoice_attachments
for each row execute function private.prevent_issued_invoice_attachment_delete();

create or replace function private.prevent_issued_invoice_exchange_rate_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.issued_at is not null and new.exchange_rate is distinct from old.exchange_rate then
    raise exception using
      errcode = '55000',
      message = 'Issued invoice exchange rate is immutable';
  end if;
  return new;
end;
$$;

create trigger finance_invoices_prevent_issued_exchange_rate_mutation
before update of exchange_rate on public.finance_invoices
for each row execute function private.prevent_issued_invoice_exchange_rate_mutation();

alter table public.finance_payments
  add column refunded_minor bigint not null default 0,
  drop constraint finance_payments_refund_valid,
  add constraint finance_payments_refund_valid check (refund_state in ('none', 'partial', 'full')),
  add constraint finance_payments_refunded_valid check (
    refunded_minor >= 0 and refunded_minor <= amount_minor
  );

create table public.finance_payment_refunds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payment_id uuid not null references public.finance_payments(id) on delete restrict,
  refund_date date not null,
  amount_minor bigint not null,
  refund_method text not null,
  transaction_reference text,
  reason text not null,
  recorded_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint finance_payment_refunds_amount_positive check (amount_minor > 0),
  constraint finance_payment_refunds_method_valid check (
    refund_method in ('bank_transfer', 'card', 'cash', 'cheque', 'wallet', 'other')
  ),
  constraint finance_payment_refunds_reason_not_blank check (
    btrim(reason) <> '' and length(reason) <= 2000
  ),
  constraint finance_payment_refunds_reference_bounded check (
    transaction_reference is null or length(transaction_reference) <= 160
  )
);

create unique index finance_payment_refunds_reference_unique
  on public.finance_payment_refunds (organization_id, lower(transaction_reference))
  where transaction_reference is not null;
create index finance_payment_refunds_payment_idx
  on public.finance_payment_refunds (organization_id, payment_id, refund_date desc, created_at desc);

create or replace function private.validate_finance_payment_refund()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.finance_payments%rowtype;
  v_recorded_organization_id uuid;
  v_existing_refunds bigint;
begin
  select * into v_payment
  from public.finance_payments
  where id = new.payment_id
  for update;

  select organization_id into v_recorded_organization_id
  from public.memberships where id = new.recorded_by_membership_id;

  select coalesce(sum(amount_minor), 0)::bigint into v_existing_refunds
  from public.finance_payment_refunds
  where payment_id = new.payment_id;

  if v_payment.id is null
     or v_payment.organization_id <> new.organization_id
     or v_recorded_organization_id is null
     or v_recorded_organization_id <> new.organization_id then
    raise exception using errcode = '23514', message = 'Payment refund tenant mismatch';
  end if;

  if v_existing_refunds + new.amount_minor > v_payment.amount_minor then
    raise exception using errcode = '23514', message = 'Refund exceeds the original payment amount';
  end if;

  return new;
end;
$$;

create or replace function private.refresh_finance_payment_refund_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment_id uuid;
  v_refunded bigint;
  v_amount bigint;
begin
  v_payment_id := coalesce(new.payment_id, old.payment_id);
  select coalesce(sum(amount_minor), 0)::bigint into v_refunded
  from public.finance_payment_refunds where payment_id = v_payment_id;
  select amount_minor into v_amount from public.finance_payments where id = v_payment_id;

  update public.finance_payments
  set refunded_minor = v_refunded,
      refund_state = case
        when v_refunded = 0 then 'none'
        when v_refunded >= v_amount then 'full'
        else 'partial'
      end,
      updated_at = now()
  where id = v_payment_id;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function private.prevent_finance_payment_refund_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'Payment refunds are immutable';
end;
$$;

create trigger finance_payment_refunds_validate
before insert on public.finance_payment_refunds
for each row execute function private.validate_finance_payment_refund();

create trigger finance_payment_refunds_refresh_payment
after insert on public.finance_payment_refunds
for each row execute function private.refresh_finance_payment_refund_state();

create trigger finance_payment_refunds_prevent_update
before update on public.finance_payment_refunds
for each row execute function private.prevent_finance_payment_refund_mutation();

create trigger finance_payment_refunds_prevent_delete
before delete on public.finance_payment_refunds
for each row execute function private.prevent_finance_payment_refund_mutation();

alter table public.finance_document_snapshots
  drop constraint finance_document_snapshots_entity_valid,
  add constraint finance_document_snapshots_entity_valid check (
    entity_type in ('estimate', 'invoice', 'credit_note', 'payment_receipt')
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
    from public.finance_estimates where id = new.entity_id;
  elsif new.entity_type = 'invoice' then
    select organization_id, invoice_number, 1
    into v_source_organization_id, v_source_number, v_source_version
    from public.finance_invoices where id = new.entity_id and issued_at is not null;
  elsif new.entity_type = 'credit_note' then
    select organization_id, credit_note_number, 1
    into v_source_organization_id, v_source_number, v_source_version
    from public.finance_credit_notes where id = new.entity_id and issued_at is not null;
  else
    select organization_id,
      coalesce(nullif(transaction_reference, ''), 'PAY-' || upper(substr(replace(id::text, '-', ''), 1, 12))),
      1
    into v_source_organization_id, v_source_number, v_source_version
    from public.finance_payments where id = new.entity_id;
  end if;

  select * into v_file from public.private_files where id = new.private_file_id;

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

alter table public.finance_invoice_attachments enable row level security;
alter table public.finance_payment_refunds enable row level security;

revoke all on public.finance_invoice_attachments from public, anon;
revoke all on public.finance_payment_refunds from public, anon;
grant select, insert, delete on public.finance_invoice_attachments to authenticated;
grant select, insert on public.finance_payment_refunds to authenticated;
grant all on public.finance_invoice_attachments to service_role;
grant all on public.finance_payment_refunds to service_role;

create policy finance_invoice_attachments_select_authorized
on public.finance_invoice_attachments for select to authenticated
using (private.has_permission(organization_id, 'finance.invoice.view'));

create policy finance_invoice_attachments_insert_authorized
on public.finance_invoice_attachments for insert to authenticated
with check (private.has_permission(organization_id, 'finance.invoice_attachment.manage'));

create policy finance_invoice_attachments_delete_authorized
on public.finance_invoice_attachments for delete to authenticated
using (private.has_permission(organization_id, 'finance.invoice_attachment.manage'));

create policy finance_payment_refunds_select_authorized
on public.finance_payment_refunds for select to authenticated
using (private.has_permission(organization_id, 'finance.payment.view'));

create policy finance_payment_refunds_insert_authorized
on public.finance_payment_refunds for insert to authenticated
with check (private.has_permission(organization_id, 'finance.payment.refund'));

drop policy finance_document_snapshots_select_authorized on public.finance_document_snapshots;
create policy finance_document_snapshots_select_authorized
on public.finance_document_snapshots for select to authenticated
using (
  private.has_permission(organization_id, 'finance.document.download')
  and (
    (entity_type = 'estimate' and private.has_permission(organization_id, 'finance.estimate.view'))
    or (entity_type = 'invoice' and private.has_permission(organization_id, 'finance.invoice.view'))
    or (entity_type = 'credit_note' and private.has_permission(organization_id, 'finance.credit_note.view'))
    or (entity_type = 'payment_receipt' and private.has_permission(organization_id, 'finance.payment.view'))
  )
);

revoke all on function private.validate_finance_invoice_attachment() from public, anon, authenticated;
revoke all on function private.prevent_issued_invoice_attachment_delete() from public, anon, authenticated;
revoke all on function private.prevent_issued_invoice_exchange_rate_mutation() from public, anon, authenticated;
revoke all on function private.validate_finance_payment_refund() from public, anon, authenticated;
revoke all on function private.refresh_finance_payment_refund_state() from public, anon, authenticated;
revoke all on function private.prevent_finance_payment_refund_mutation() from public, anon, authenticated;
revoke all on function private.validate_finance_document_snapshot() from public, anon, authenticated;
