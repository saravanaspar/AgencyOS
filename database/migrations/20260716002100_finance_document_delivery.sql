-- Finance document delivery: estimate acceptance and conversion, immutable PDF snapshots,
-- delivery history, and server-generated private files.

set lock_timeout = '10s';
set statement_timeout = '120s';

insert into public.permissions (module, resource, action, description, is_sensitive)
values
  ('finance', 'estimate', 'accept', 'Record a client estimate acceptance or rejection.', true),
  ('finance', 'estimate', 'convert', 'Convert an accepted estimate into one invoice draft.', true),
  ('finance', 'document', 'download', 'Download immutable finance PDF snapshots.', true),
  ('finance', 'document', 'send', 'Email approved finance documents to external recipients.', true)
on conflict (module, resource, action) do update
set description = excluded.description,
    is_sensitive = excluded.is_sensitive;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'organization'
from public.role_templates as role_template
cross join public.permissions as permission
where role_template.key in ('owner', 'finance_manager')
  and permission.key in (
    'finance.estimate.accept',
    'finance.estimate.convert',
    'finance.document.download',
    'finance.document.send'
  )
on conflict (role_template_key, permission_id) do update
set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'accountant', permission.id, 'organization'
from public.permissions as permission
where permission.key in (
  'finance.estimate.convert',
  'finance.document.download',
  'finance.document.send'
)
on conflict (role_template_key, permission_id) do update
set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'auditor', permission.id, 'organization'
from public.permissions as permission
where permission.key = 'finance.document.download'
on conflict (role_template_key, permission_id) do update
set scope = excluded.scope;

insert into public.role_permissions (role_id, permission_id, scope, conditions)
select role.id, template_permission.permission_id, template_permission.scope, template_permission.conditions
from public.roles as role
join public.role_template_permissions as template_permission
  on template_permission.role_template_key = role.template_key
join public.permissions as permission on permission.id = template_permission.permission_id
where permission.key in (
  'finance.estimate.accept',
  'finance.estimate.convert',
  'finance.document.download',
  'finance.document.send'
)
on conflict (role_id, permission_id) do update
set scope = excluded.scope,
    conditions = excluded.conditions,
    updated_at = now();

alter table public.finance_estimates
  add column client_decision_note text,
  add column client_decision_recorded_at timestamptz,
  add column client_decision_recorded_by_membership_id uuid references public.memberships(id) on delete set null,
  add constraint finance_estimates_client_decision_note_bounded check (
    client_decision_note is null or length(client_decision_note) <= 2000
  ),
  add constraint finance_estimates_client_decision_shape check (
    client_acceptance_status not in ('accepted', 'rejected')
    or (
      client_decision_recorded_at is not null
      and client_decision_recorded_by_membership_id is not null
    )
  );

create unique index finance_invoices_source_estimate_unique
  on public.finance_invoices (organization_id, source_estimate_id)
  where source_estimate_id is not null;

create table public.finance_document_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  version_number integer not null,
  document_number text not null,
  private_file_id uuid not null references public.private_files(id) on delete restrict,
  source_hash text not null,
  template_version integer not null default 1,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint finance_document_snapshots_entity_valid check (entity_type in ('estimate', 'invoice')),
  constraint finance_document_snapshots_version_positive check (version_number > 0),
  constraint finance_document_snapshots_number_not_blank check (
    btrim(document_number) <> '' and length(document_number) <= 80
  ),
  constraint finance_document_snapshots_hash_shape check (source_hash ~ '^[a-f0-9]{64}$'),
  constraint finance_document_snapshots_template_positive check (template_version > 0),
  unique (organization_id, entity_type, entity_id, version_number),
  unique (private_file_id)
);

create index finance_document_snapshots_entity_idx
  on public.finance_document_snapshots (organization_id, entity_type, entity_id, version_number desc);

create table public.finance_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  snapshot_id uuid not null references public.finance_document_snapshots(id) on delete restrict,
  request_token uuid not null,
  entity_type text not null,
  entity_id uuid not null,
  recipient_email text not null,
  subject text not null,
  status text not null default 'pending',
  provider_reference text,
  error_code text,
  sent_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_email_deliveries_entity_valid check (entity_type in ('estimate', 'invoice')),
  constraint finance_email_deliveries_recipient_valid check (
    recipient_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and length(recipient_email) <= 320
  ),
  constraint finance_email_deliveries_subject_not_blank check (
    btrim(subject) <> '' and length(subject) <= 240
  ),
  constraint finance_email_deliveries_status_valid check (status in ('pending', 'delivered', 'failed')),
  constraint finance_email_deliveries_result_shape check (
    (status = 'pending' and sent_at is null and error_code is null)
    or (status = 'delivered' and sent_at is not null and error_code is null)
    or (status = 'failed' and sent_at is null and error_code is not null)
  ),
  unique (organization_id, request_token)
);

create index finance_email_deliveries_entity_idx
  on public.finance_email_deliveries (organization_id, entity_type, entity_id, created_at desc);

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
  else
    select organization_id, invoice_number, 1
    into v_source_organization_id, v_source_number, v_source_version
    from public.finance_invoices
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

create or replace function private.prevent_finance_document_snapshot_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'Finance document snapshots are append-only';
end;
$$;

create or replace function private.validate_finance_email_delivery()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_snapshot public.finance_document_snapshots%rowtype;
  v_sender_organization_id uuid;
begin
  select * into v_snapshot
  from public.finance_document_snapshots
  where id = new.snapshot_id;

  select organization_id into v_sender_organization_id
  from public.memberships
  where id = new.sent_by_membership_id;

  if v_snapshot.id is null
     or v_snapshot.organization_id <> new.organization_id
     or v_snapshot.entity_type <> new.entity_type
     or v_snapshot.entity_id <> new.entity_id
     or v_sender_organization_id is null
     or v_sender_organization_id <> new.organization_id then
    raise exception using
      errcode = '23514',
      message = 'Finance email delivery must match its snapshot, tenant, and sender';
  end if;

  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id
       or new.snapshot_id is distinct from old.snapshot_id
       or new.request_token is distinct from old.request_token
       or new.entity_type is distinct from old.entity_type
       or new.entity_id is distinct from old.entity_id
       or new.recipient_email is distinct from old.recipient_email
       or new.subject is distinct from old.subject
       or new.sent_by_membership_id is distinct from old.sent_by_membership_id
       or new.created_at is distinct from old.created_at
       or old.status <> 'pending'
       or new.status = 'pending' then
      raise exception using
        errcode = '55000',
        message = 'Finance email delivery history is immutable after its final result';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger finance_document_snapshots_validate
before insert on public.finance_document_snapshots
for each row execute function private.validate_finance_document_snapshot();

create trigger finance_document_snapshots_prevent_update
before update on public.finance_document_snapshots
for each row execute function private.prevent_finance_document_snapshot_mutation();

create trigger finance_document_snapshots_prevent_delete
before delete on public.finance_document_snapshots
for each row execute function private.prevent_finance_document_snapshot_mutation();

create trigger finance_email_deliveries_validate
before insert or update on public.finance_email_deliveries
for each row execute function private.validate_finance_email_delivery();

alter table public.finance_document_snapshots enable row level security;
alter table public.finance_email_deliveries enable row level security;

revoke all on public.finance_document_snapshots from public, anon;
revoke all on public.finance_email_deliveries from public, anon;

grant select on public.finance_document_snapshots to authenticated;
grant select on public.finance_email_deliveries to authenticated;
grant all on public.finance_document_snapshots to service_role;
grant all on public.finance_email_deliveries to service_role;

create policy finance_document_snapshots_select_authorized
on public.finance_document_snapshots for select to authenticated
using (
  private.has_permission(organization_id, 'finance.document.download')
  and (
    (entity_type = 'estimate' and private.has_permission(organization_id, 'finance.estimate.view'))
    or (entity_type = 'invoice' and private.has_permission(organization_id, 'finance.invoice.view'))
  )
);

create policy finance_email_deliveries_select_authorized
on public.finance_email_deliveries for select to authenticated
using (
  private.has_permission(organization_id, 'finance.document.send')
  and (
    (entity_type = 'estimate' and private.has_permission(organization_id, 'finance.estimate.view'))
    or (entity_type = 'invoice' and private.has_permission(organization_id, 'finance.invoice.view'))
  )
);

revoke all on function private.validate_finance_document_snapshot() from public, anon, authenticated;
revoke all on function private.prevent_finance_document_snapshot_mutation() from public, anon, authenticated;
revoke all on function private.validate_finance_email_delivery() from public, anon, authenticated;
