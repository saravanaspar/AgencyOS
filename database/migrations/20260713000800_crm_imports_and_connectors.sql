-- Secure CRM import runs, external-source idempotency, and connector records.

set lock_timeout = '10s';
set statement_timeout = '120s';

insert into public.permissions (module, resource, action, description, is_sensitive)
values
  ('crm', 'import', 'view', 'View CRM import history and row-level import errors.', false),
  ('crm', 'import', 'execute', 'Import CRM leads from approved files or configured external sources.', true),
  ('crm', 'connection', 'manage', 'Create, pause, sync, and remove CRM source connections.', true)
on conflict (module, resource, action) do update
set description = excluded.description, is_sensitive = excluded.is_sensitive;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'organization'
from public.role_templates as role_template
cross join public.permissions as permission
where role_template.key in ('owner', 'sales_manager')
  and permission.key in ('crm.import.view', 'crm.import.execute', 'crm.connection.manage')
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'organization'
from public.role_templates as role_template
cross join public.permissions as permission
where role_template.key in ('system_administrator', 'operations_administrator', 'auditor')
  and permission.key = 'crm.import.view'
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_permissions (role_id, permission_id, scope, conditions)
select role.id, template_permission.permission_id, template_permission.scope, template_permission.conditions
from public.roles as role
join public.role_template_permissions as template_permission
  on template_permission.role_template_key = role.template_key
join public.permissions as permission on permission.id = template_permission.permission_id
where permission.key in ('crm.import.view', 'crm.import.execute', 'crm.connection.manage')
on conflict (role_id, permission_id) do update
set scope = excluded.scope, conditions = excluded.conditions, updated_at = now();

create table public.crm_import_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null,
  name text not null,
  mode text not null,
  status text not null default 'active',
  account_reference text,
  configuration jsonb not null default '{}'::jsonb,
  encrypted_credentials text,
  webhook_key_hash text,
  last_sync_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_import_connections_provider_valid check (
    provider in ('meta_lead_ads', 'google_ads', 'hubspot', 'salesforce', 'zoho', 'pipedrive')
  ),
  constraint crm_import_connections_mode_valid check (mode in ('webhook', 'pull')),
  constraint crm_import_connections_provider_mode_valid check (
    (provider in ('meta_lead_ads', 'google_ads') and mode = 'webhook')
    or (provider in ('hubspot', 'salesforce', 'zoho', 'pipedrive') and mode = 'pull')
  ),
  constraint crm_import_connections_status_valid check (status in ('active', 'paused', 'error')),
  constraint crm_import_connections_name_not_blank check (btrim(name) <> ''),
  constraint crm_import_connections_configuration_object check (jsonb_typeof(configuration) = 'object'),
  unique (organization_id, provider, name)
);

create index crm_import_connections_org_status_idx
  on public.crm_import_connections (organization_id, status, provider);

create table public.crm_import_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid references public.crm_import_connections(id) on delete set null,
  source_type text not null,
  source_name text not null,
  file_name text,
  status text not null default 'processing',
  duplicate_policy text not null default 'skip',
  total_rows integer not null default 0,
  created_count integer not null default 0,
  merged_count integer not null default 0,
  skipped_count integer not null default 0,
  failed_count integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint crm_import_runs_source_type_valid check (
    source_type in ('csv', 'xlsx', 'meta_lead_ads', 'google_ads', 'hubspot', 'salesforce', 'zoho', 'pipedrive')
  ),
  constraint crm_import_runs_status_valid check (status in ('processing', 'completed', 'failed')),
  constraint crm_import_runs_duplicate_policy_valid check (duplicate_policy in ('skip', 'merge')),
  constraint crm_import_runs_source_name_not_blank check (btrim(source_name) <> ''),
  constraint crm_import_runs_counts_nonnegative check (
    total_rows >= 0 and created_count >= 0 and merged_count >= 0 and skipped_count >= 0 and failed_count >= 0
  ),
  constraint crm_import_runs_summary_object check (jsonb_typeof(summary) = 'object')
);

create index crm_import_runs_org_started_idx
  on public.crm_import_runs (organization_id, started_at desc);

create table public.crm_import_errors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  import_run_id uuid not null references public.crm_import_runs(id) on delete cascade,
  row_number integer,
  external_id text,
  code text not null,
  message text not null,
  redacted_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint crm_import_errors_row_positive check (row_number is null or row_number > 0),
  constraint crm_import_errors_code_not_blank check (btrim(code) <> ''),
  constraint crm_import_errors_message_not_blank check (btrim(message) <> ''),
  constraint crm_import_errors_payload_object check (jsonb_typeof(redacted_payload) = 'object')
);

create index crm_import_errors_run_idx on public.crm_import_errors (import_run_id, row_number);

create table public.crm_external_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid references public.crm_import_connections(id) on delete set null,
  provider text not null,
  external_object text not null default 'lead',
  external_id text not null,
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  payload_hash text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint crm_external_records_provider_not_blank check (btrim(provider) <> ''),
  constraint crm_external_records_object_not_blank check (btrim(external_object) <> ''),
  constraint crm_external_records_id_not_blank check (btrim(external_id) <> ''),
  unique (organization_id, provider, external_object, external_id)
);

create index crm_external_records_lead_idx on public.crm_external_records (lead_id);

create table public.crm_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.crm_import_connections(id) on delete cascade,
  provider_event_id text not null,
  payload_hash text not null,
  status text not null default 'received',
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error_message text,
  constraint crm_webhook_deliveries_event_not_blank check (btrim(provider_event_id) <> ''),
  constraint crm_webhook_deliveries_hash_not_blank check (btrim(payload_hash) <> ''),
  constraint crm_webhook_deliveries_status_valid check (status in ('received', 'processed', 'failed', 'duplicate')),
  unique (connection_id, provider_event_id)
);

create index crm_webhook_deliveries_org_received_idx
  on public.crm_webhook_deliveries (organization_id, received_at desc);

create trigger crm_import_connections_set_updated_at
before update on public.crm_import_connections
for each row execute function private.set_updated_at();

create or replace function private.validate_crm_import_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_organization_id uuid;
begin
  select organization_id into v_organization_id
  from public.memberships where id = new.created_by_membership_id and status = 'active';
  if v_organization_id is null or v_organization_id <> new.organization_id then
    raise exception using errcode = '23514', message = 'CRM import creator must belong to the same organization';
  end if;

  if new.connection_id is not null then
    select organization_id into v_organization_id
    from public.crm_import_connections where id = new.connection_id;
    if v_organization_id is null or v_organization_id <> new.organization_id then
      raise exception using errcode = '23514', message = 'CRM import connection must belong to the same organization';
    end if;
  end if;
  return new;
end;
$$;

create trigger crm_import_connections_validate_tenant
before insert or update of organization_id, created_by_membership_id
on public.crm_import_connections
for each row execute function private.validate_crm_import_tenant();

create trigger crm_import_runs_validate_tenant
before insert or update of organization_id, connection_id, created_by_membership_id
on public.crm_import_runs
for each row execute function private.validate_crm_import_tenant();

create or replace function private.validate_crm_import_child_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_organization_id uuid;
begin
  if tg_table_name = 'crm_import_errors' then
    select organization_id into v_organization_id from public.crm_import_runs where id = new.import_run_id;
  elsif tg_table_name = 'crm_external_records' then
    select organization_id into v_organization_id from public.crm_leads where id = new.lead_id;
    if v_organization_id is null or v_organization_id <> new.organization_id then
      raise exception using errcode = '23514', message = 'CRM external lead must belong to the same organization';
    end if;
    if new.connection_id is not null and not exists (
      select 1 from public.crm_import_connections as connection
      where connection.id = new.connection_id
        and connection.organization_id = new.organization_id
    ) then
      raise exception using errcode = '23514', message = 'CRM external connection must belong to the same organization';
    end if;
    return new;
  else
    select organization_id into v_organization_id from public.crm_import_connections where id = new.connection_id;
  end if;

  if v_organization_id is null or v_organization_id <> new.organization_id then
    raise exception using errcode = '23514', message = 'CRM import child record must belong to the same organization';
  end if;
  return new;
end;
$$;

create trigger crm_import_errors_validate_tenant
before insert or update of organization_id, import_run_id
on public.crm_import_errors
for each row execute function private.validate_crm_import_child_tenant();

create trigger crm_external_records_validate_tenant
before insert or update of organization_id, lead_id, connection_id
on public.crm_external_records
for each row execute function private.validate_crm_import_child_tenant();

create trigger crm_webhook_deliveries_validate_tenant
before insert or update of organization_id, connection_id
on public.crm_webhook_deliveries
for each row execute function private.validate_crm_import_child_tenant();

alter table public.crm_import_connections enable row level security;
alter table public.crm_import_runs enable row level security;
alter table public.crm_import_errors enable row level security;
alter table public.crm_external_records enable row level security;
alter table public.crm_webhook_deliveries enable row level security;

revoke all on public.crm_import_connections from anon, authenticated;
revoke all on public.crm_import_runs from anon, authenticated;
revoke all on public.crm_import_errors from anon, authenticated;
revoke all on public.crm_external_records from anon, authenticated;
revoke all on public.crm_webhook_deliveries from anon, authenticated;

grant select (id, organization_id, provider, name, mode, status, account_reference, configuration, last_sync_at, last_success_at, last_error, created_by_membership_id, created_by, created_at, updated_at)
  on public.crm_import_connections to authenticated;
grant select on public.crm_import_runs to authenticated;
grant select on public.crm_import_errors to authenticated;
grant select on public.crm_external_records to authenticated;
grant select on public.crm_webhook_deliveries to authenticated;

grant all on public.crm_import_connections to service_role;
grant all on public.crm_import_runs to service_role;
grant all on public.crm_import_errors to service_role;
grant all on public.crm_external_records to service_role;
grant all on public.crm_webhook_deliveries to service_role;

create policy crm_import_connections_select_authorized
on public.crm_import_connections for select to authenticated
using (private.has_permission(organization_id, 'crm.import.view'));

create policy crm_import_runs_select_authorized
on public.crm_import_runs for select to authenticated
using (private.has_permission(organization_id, 'crm.import.view'));

create policy crm_import_errors_select_authorized
on public.crm_import_errors for select to authenticated
using (private.has_permission(organization_id, 'crm.import.view'));

create policy crm_external_records_select_authorized
on public.crm_external_records for select to authenticated
using (private.has_permission(organization_id, 'crm.import.view'));

create policy crm_webhook_deliveries_select_authorized
on public.crm_webhook_deliveries for select to authenticated
using (private.has_permission(organization_id, 'crm.import.view'));
