-- Signed n8n callback records and non-secret Vaultwarden item links.

set lock_timeout = '10s';
set statement_timeout = '120s';

insert into public.permissions (module, resource, action, description, is_sensitive)
values
  ('automation', 'definition', 'view', 'View AgencyOS automation definitions.', true),
  ('automation', 'definition', 'manage_settings', 'Create, enable and disable AgencyOS automation definitions.', true),
  ('automation', 'execution', 'view', 'View signed n8n callback execution history.', true),
  ('automation', 'vault_link', 'view', 'View non-secret Vaultwarden item references for authorized records.', true),
  ('automation', 'vault_link', 'manage_settings', 'Create and revoke non-secret Vaultwarden item references.', true)
on conflict (module, resource, action) do update
set description = excluded.description, is_sensitive = excluded.is_sensitive;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'owner', permission.id, 'organization'
from public.permissions as permission
where permission.module = 'automation'
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template_key, permission.id, 'organization'
from (values ('system_administrator'), ('operations_administrator')) as template(role_template_key)
cross join public.permissions as permission
where permission.key in (
  'automation.definition.view',
  'automation.execution.view',
  'automation.vault_link.view'
)
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'system_administrator', permission.id, 'organization'
from public.permissions as permission
where permission.key in (
  'automation.definition.manage_settings',
  'automation.vault_link.manage_settings'
)
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_permissions (role_id, permission_id, scope, conditions)
select role.id, template_permission.permission_id, template_permission.scope, template_permission.conditions
from public.roles as role
join public.role_template_permissions as template_permission
  on template_permission.role_template_key = role.template_key
join public.permissions as permission on permission.id = template_permission.permission_id
where permission.module = 'automation'
on conflict (role_id, permission_id) do update
set scope = excluded.scope, conditions = excluded.conditions, updated_at = now();

create table public.automation_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  trigger_key text not null,
  conditions jsonb not null default '{}'::jsonb,
  n8n_workflow_id text not null,
  enabled boolean not null default true,
  allowed_modules text[] not null default '{}'::text[],
  secret_reference text not null default 'env:N8N_CALLBACK_SIGNING_SECRET',
  owner_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  updated_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  last_execution_at timestamptz,
  last_result text,
  error_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_definitions_name_not_blank check (btrim(name) <> '' and length(name) <= 160),
  constraint automation_definitions_trigger_key_valid check (trigger_key ~ '^[a-z][a-z0-9._-]{2,119}$'),
  constraint automation_definitions_conditions_object check (jsonb_typeof(conditions) = 'object'),
  constraint automation_definitions_workflow_not_blank check (btrim(n8n_workflow_id) <> '' and length(n8n_workflow_id) <= 160),
  constraint automation_definitions_modules_bounded check (cardinality(allowed_modules) between 1 and 32),
  constraint automation_definitions_secret_reference_fixed check (secret_reference = 'env:N8N_CALLBACK_SIGNING_SECRET'),
  constraint automation_definitions_last_result_valid check (last_result is null or last_result in ('started', 'succeeded', 'failed', 'cancelled')),
  constraint automation_definitions_error_count_nonnegative check (error_count >= 0)
);

create unique index automation_definitions_name_unique
  on public.automation_definitions (organization_id, lower(name));
create index automation_definitions_enabled_idx
  on public.automation_definitions (organization_id, enabled, updated_at desc);

create table public.automation_callback_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  automation_id uuid not null references public.automation_definitions(id) on delete cascade,
  external_execution_id text not null,
  workflow_id text not null,
  source_module text not null,
  status text not null,
  nonce_hash text not null,
  payload_hash text not null,
  result_summary text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  constraint automation_callback_execution_not_blank check (btrim(external_execution_id) <> '' and length(external_execution_id) <= 160),
  constraint automation_callback_workflow_not_blank check (btrim(workflow_id) <> '' and length(workflow_id) <= 160),
  constraint automation_callback_source_module_valid check (source_module ~ '^[a-z][a-z0-9_-]{1,39}$'),
  constraint automation_callback_status_valid check (status in ('started', 'succeeded', 'failed', 'cancelled')),
  constraint automation_callback_nonce_hash_valid check (nonce_hash ~ '^[a-f0-9]{64}$'),
  constraint automation_callback_payload_hash_valid check (payload_hash ~ '^[a-f0-9]{64}$'),
  constraint automation_callback_summary_bounded check (result_summary is null or length(result_summary) <= 2000),
  constraint automation_callback_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create unique index automation_callback_execution_unique
  on public.automation_callback_events (automation_id, external_execution_id);
create unique index automation_callback_nonce_unique
  on public.automation_callback_events (automation_id, nonce_hash);
create index automation_callback_recent_idx
  on public.automation_callback_events (automation_id, received_at desc);
create index automation_callback_org_recent_idx
  on public.automation_callback_events (organization_id, received_at desc);

create table public.vaultwarden_item_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  entity_label text not null,
  item_reference uuid not null,
  visibility_permission_key text not null,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  revoked_by_membership_id uuid references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint vaultwarden_item_links_entity_type_valid check (entity_type in ('project', 'client', 'vendor')),
  constraint vaultwarden_item_links_label_not_blank check (btrim(entity_label) <> '' and length(entity_label) <= 180),
  constraint vaultwarden_item_links_permission_not_blank check (btrim(visibility_permission_key) <> ''),
  constraint vaultwarden_item_links_revocation_consistent check (
    (revoked_at is null and revoked_by_membership_id is null)
    or (revoked_at is not null and revoked_by_membership_id is not null)
  )
);

create unique index vaultwarden_item_links_active_unique
  on public.vaultwarden_item_links (organization_id, entity_type, entity_id, item_reference)
  where revoked_at is null;
create index vaultwarden_item_links_entity_idx
  on public.vaultwarden_item_links (organization_id, entity_type, entity_id, created_at desc)
  where revoked_at is null;

create or replace function private.validate_automation_definition_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.memberships
    where id = new.owner_membership_id and organization_id = new.organization_id and status = 'active'
  ) then
    raise exception using errcode = '23514', message = 'Automation owner must be active in the same organization';
  end if;
  if not exists (
    select 1 from public.memberships
    where id = new.created_by_membership_id and organization_id = new.organization_id and status = 'active'
  ) then
    raise exception using errcode = '23514', message = 'Automation creator must be active in the same organization';
  end if;
  if not exists (
    select 1 from public.memberships
    where id = new.updated_by_membership_id and organization_id = new.organization_id and status = 'active'
  ) then
    raise exception using errcode = '23514', message = 'Automation updater must be active in the same organization';
  end if;
  if exists (
    select 1 from unnest(new.allowed_modules) as module_name
    where module_name !~ '^[a-z][a-z0-9_-]{1,39}$'
  ) then
    raise exception using errcode = '23514', message = 'Automation allowed modules are invalid';
  end if;
  return new;
end;
$$;

create trigger automation_definitions_validate_tenant
before insert or update on public.automation_definitions
for each row execute function private.validate_automation_definition_tenant();

create or replace function private.validate_automation_callback_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.automation_definitions as definition
    where definition.id = new.automation_id
      and definition.organization_id = new.organization_id
      and definition.n8n_workflow_id = new.workflow_id
      and new.source_module = any(definition.allowed_modules)
  ) then
    raise exception using errcode = '23514', message = 'Automation callback does not match its definition';
  end if;
  return new;
end;
$$;

create trigger automation_callback_events_validate_tenant
before insert on public.automation_callback_events
for each row execute function private.validate_automation_callback_tenant();

create or replace function private.prevent_automation_callback_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'Automation callback history is append-only';
end;
$$;

create trigger automation_callback_events_no_update
before update on public.automation_callback_events
for each row execute function private.prevent_automation_callback_mutation();
create trigger automation_callback_events_no_delete
before delete on public.automation_callback_events
for each row execute function private.prevent_automation_callback_mutation();

create or replace function private.validate_vaultwarden_item_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  expected_permission text;
begin
  expected_permission := case new.entity_type
    when 'project' then 'projects.project.view'
    when 'client' then 'crm.company.view'
    when 'vendor' then 'vendors.workspace.view'
  end;
  if new.visibility_permission_key <> expected_permission then
    raise exception using errcode = '23514', message = 'Vaultwarden link visibility permission is invalid';
  end if;
  if new.entity_type = 'project' and not exists (
    select 1 from public.projects where id = new.entity_id and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Vaultwarden project link is invalid';
  end if;
  if new.entity_type = 'client' and not exists (
    select 1 from public.crm_companies where id = new.entity_id and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Vaultwarden client link is invalid';
  end if;
  if not exists (
    select 1 from public.memberships
    where id = new.created_by_membership_id and organization_id = new.organization_id and status = 'active'
  ) then
    raise exception using errcode = '23514', message = 'Vaultwarden link creator must be active in the same organization';
  end if;
  if new.revoked_by_membership_id is not null and not exists (
    select 1 from public.memberships
    where id = new.revoked_by_membership_id and organization_id = new.organization_id and status = 'active'
  ) then
    raise exception using errcode = '23514', message = 'Vaultwarden link revoker must be active in the same organization';
  end if;
  return new;
end;
$$;

create trigger vaultwarden_item_links_validate
before insert or update on public.vaultwarden_item_links
for each row execute function private.validate_vaultwarden_item_link();

create or replace function private.prevent_vaultwarden_item_link_rewrite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.organization_id <> old.organization_id
    or new.entity_type <> old.entity_type
    or new.entity_id <> old.entity_id
    or new.entity_label <> old.entity_label
    or new.item_reference <> old.item_reference
    or new.visibility_permission_key <> old.visibility_permission_key
    or new.created_by_membership_id <> old.created_by_membership_id
    or new.created_at <> old.created_at then
    raise exception using errcode = '55000', message = 'Vaultwarden item references are immutable; revoke and recreate the link';
  end if;
  if old.revoked_at is not null then
    raise exception using errcode = '55000', message = 'Revoked Vaultwarden item links are immutable';
  end if;
  return new;
end;
$$;

create trigger vaultwarden_item_links_prevent_rewrite
before update on public.vaultwarden_item_links
for each row execute function private.prevent_vaultwarden_item_link_rewrite();

create or replace function private.vaultwarden_item_link_target_visible(
  p_organization_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_visibility_permission_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.has_permission(p_organization_id, p_visibility_permission_key)
    and case p_entity_type
      when 'project' then
        p_visibility_permission_key = 'projects.project.view'
        and exists (
          select 1
          from public.projects as project
          where project.id = p_entity_id
            and project.organization_id = p_organization_id
            and private.project_permission_allows(project.id, 'projects.project.view')
        )
      when 'client' then
        p_visibility_permission_key = 'crm.company.view'
        and exists (
          select 1
          from public.crm_companies as company
          where company.id = p_entity_id
            and company.organization_id = p_organization_id
            and private.crm_scope_allows_membership(
              private.current_membership_id(p_organization_id),
              private.effective_permission_scope(p_organization_id, 'crm.company.view'),
              company.account_owner_membership_id,
              company.created_by_membership_id
            )
        )
      when 'vendor' then p_visibility_permission_key = 'vendors.workspace.view'
      else false
    end;
$$;

create or replace function private.vaultwarden_item_link_visible(p_link_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.vaultwarden_item_links as link
    where link.id = p_link_id
      and link.revoked_at is null
      and private.has_permission(link.organization_id, 'automation.vault_link.view')
      and private.vaultwarden_item_link_target_visible(
        link.organization_id,
        link.entity_type,
        link.entity_id,
        link.visibility_permission_key
      )
  );
$$;

alter table public.automation_definitions enable row level security;
alter table public.automation_callback_events enable row level security;
alter table public.vaultwarden_item_links enable row level security;

revoke all on public.automation_definitions from anon;
revoke all on public.automation_callback_events from anon, authenticated;
revoke all on public.vaultwarden_item_links from anon;

grant select, insert, update on public.automation_definitions to authenticated;
grant select, insert, update on public.vaultwarden_item_links to authenticated;
grant all on public.automation_definitions, public.automation_callback_events, public.vaultwarden_item_links to service_role;

revoke all on function private.vaultwarden_item_link_target_visible(uuid, text, uuid, text) from public, anon;
revoke all on function private.vaultwarden_item_link_visible(uuid) from public, anon;
grant execute on function private.vaultwarden_item_link_target_visible(uuid, text, uuid, text) to authenticated, service_role;
grant execute on function private.vaultwarden_item_link_visible(uuid) to authenticated, service_role;

create policy automation_definitions_select_authorized
on public.automation_definitions
for select to authenticated
using (private.has_permission(organization_id, 'automation.definition.view'));

create policy automation_definitions_insert_authorized
on public.automation_definitions
for insert to authenticated
with check (private.has_permission(organization_id, 'automation.definition.manage_settings'));

create policy automation_definitions_update_authorized
on public.automation_definitions
for update to authenticated
using (private.has_permission(organization_id, 'automation.definition.manage_settings'))
with check (private.has_permission(organization_id, 'automation.definition.manage_settings'));

create policy automation_callback_events_select_authorized
on public.automation_callback_events
for select to authenticated
using (private.has_permission(organization_id, 'automation.execution.view'));

create policy vaultwarden_item_links_select_authorized
on public.vaultwarden_item_links
for select to authenticated
using (private.vaultwarden_item_link_visible(id));

create policy vaultwarden_item_links_insert_authorized
on public.vaultwarden_item_links
for insert to authenticated
with check (
  private.has_permission(organization_id, 'automation.vault_link.manage_settings')
  and private.vaultwarden_item_link_target_visible(
    organization_id,
    entity_type,
    entity_id,
    visibility_permission_key
  )
);

create policy vaultwarden_item_links_update_authorized
on public.vaultwarden_item_links
for update to authenticated
using (
  private.has_permission(organization_id, 'automation.vault_link.manage_settings')
  and private.vaultwarden_item_link_target_visible(
    organization_id,
    entity_type,
    entity_id,
    visibility_permission_key
  )
)
with check (private.has_permission(organization_id, 'automation.vault_link.manage_settings'));
