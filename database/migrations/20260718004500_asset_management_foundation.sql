-- Asset management foundation. Reuses memberships, HR reporting scopes, Documents,
-- Notifications, permission helpers, and the central audit trail.

set lock_timeout = '10s';
set statement_timeout = '120s';

insert into public.permissions (module, resource, action, description, is_sensitive)
values
  ('assets', 'asset', 'view', 'View assets within the granted employee or organization scope.', false),
  ('assets', 'asset', 'create', 'Register organization assets and depreciation metadata.', true),
  ('assets', 'asset', 'update', 'Update asset identity, ownership, warranty, condition, and lifecycle metadata.', true),
  ('assets', 'asset', 'assign', 'Check assets out to employees and record returns.', true),
  ('assets', 'asset', 'acknowledge', 'Acknowledge receipt of an assigned asset.', false),
  ('assets', 'asset', 'maintain', 'Record inspections, repairs, services, upgrades, and calibration.', true),
  ('assets', 'asset', 'dispose', 'Dispose of retired assets with immutable evidence.', true),
  ('assets', 'asset', 'link_document', 'Link accessible Documents records to assets.', true),
  ('assets', 'category', 'manage', 'Manage asset categories.', true)
on conflict (module, resource, action) do update
set description = excluded.description, is_sensitive = excluded.is_sensitive;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'organization'
from public.role_templates as role_template
cross join public.permissions as permission
where permission.module = 'assets'
  and role_template.key in ('owner', 'system_administrator', 'operations_administrator')
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'hr_manager', permission.id, 'organization'
from public.permissions as permission
where permission.key in (
  'assets.workspace.view', 'assets.asset.view', 'assets.asset.assign',
  'assets.asset.acknowledge', 'assets.asset.link_document'
)
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'team_lead', permission.id,
  case when permission.key = 'assets.asset.view' then 'managed_employees' else 'organization' end
from public.permissions as permission
where permission.key in ('assets.workspace.view', 'assets.asset.view')
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'employee', permission.id, 'own'
from public.permissions as permission
where permission.key in (
  'assets.workspace.view', 'assets.asset.view', 'assets.asset.acknowledge'
)
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'auditor', permission.id, 'organization'
from public.permissions as permission
where permission.key in ('assets.workspace.view', 'assets.asset.view')
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_permissions (role_id, permission_id, scope, conditions)
select role.id, template_permission.permission_id, template_permission.scope,
  template_permission.conditions
from public.roles as role
join public.role_template_permissions as template_permission
  on template_permission.role_template_key = role.template_key
join public.permissions as permission on permission.id = template_permission.permission_id
where permission.module = 'assets'
on conflict (role_id, permission_id) do update
set scope = excluded.scope, conditions = excluded.conditions, updated_at = now();

create table public.asset_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  kind text not null,
  description text,
  status text not null default 'active',
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asset_categories_name_valid check (char_length(btrim(name)) between 2 and 80),
  constraint asset_categories_kind_valid check (
    kind in ('computer', 'mobile', 'display', 'accessory', 'software', 'access', 'furniture', 'other')
  ),
  constraint asset_categories_description_valid check (
    description is null or char_length(btrim(description)) between 2 and 500
  ),
  constraint asset_categories_status_valid check (status in ('active', 'inactive')),
  unique (organization_id, name)
);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_tag text not null,
  serial_number text,
  category_id uuid not null references public.asset_categories(id) on delete restrict,
  name text not null,
  manufacturer text,
  model text,
  ownership_type text not null default 'owned',
  owner_membership_id uuid references public.memberships(id) on delete set null,
  purchase_date date,
  purchase_price_minor bigint,
  currency text not null default 'USD',
  warranty_provider text,
  warranty_start_date date,
  warranty_end_date date,
  warranty_reference text,
  location text,
  status text not null default 'available',
  condition text not null default 'good',
  depreciation_method text not null default 'none',
  depreciation_start_date date,
  useful_life_months integer,
  salvage_value_minor bigint,
  notes text,
  disposal_date date,
  disposal_method text,
  disposal_reason text,
  disposal_value_minor bigint,
  disposed_by_membership_id uuid references public.memberships(id) on delete set null,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assets_tag_valid check (char_length(btrim(asset_tag)) between 2 and 80),
  constraint assets_serial_valid check (serial_number is null or char_length(btrim(serial_number)) between 1 and 160),
  constraint assets_name_valid check (char_length(btrim(name)) between 2 and 180),
  constraint assets_ownership_valid check (ownership_type in ('owned', 'leased', 'rented', 'client_owned')),
  constraint assets_status_valid check (
    status in ('ordered', 'received', 'available', 'assigned', 'under_repair', 'lost', 'stolen', 'retired', 'disposed')
  ),
  constraint assets_condition_valid check (condition in ('new', 'good', 'fair', 'poor', 'damaged', 'missing')),
  constraint assets_currency_valid check (currency ~ '^[A-Z]{3}$'),
  constraint assets_money_valid check (
    (purchase_price_minor is null or purchase_price_minor >= 0)
    and (salvage_value_minor is null or salvage_value_minor >= 0)
    and (disposal_value_minor is null or disposal_value_minor >= 0)
  ),
  constraint assets_warranty_dates_valid check (
    warranty_start_date is null or warranty_end_date is null or warranty_end_date >= warranty_start_date
  ),
  constraint assets_depreciation_method_valid check (
    depreciation_method in ('none', 'straight_line', 'declining_balance', 'manual')
  ),
  constraint assets_useful_life_valid check (useful_life_months is null or useful_life_months between 1 and 1200),
  constraint assets_depreciation_values_valid check (
    salvage_value_minor is null or purchase_price_minor is null or salvage_value_minor <= purchase_price_minor
  ),
  constraint assets_notes_valid check (notes is null or char_length(btrim(notes)) between 2 and 4000),
  constraint assets_disposal_valid check (
    (status = 'disposed' and disposal_date is not null and disposal_method is not null
      and disposal_reason is not null and disposed_by_membership_id is not null)
    or (status <> 'disposed' and disposal_date is null and disposal_method is null
      and disposal_reason is null and disposal_value_minor is null and disposed_by_membership_id is null)
  ),
  constraint assets_disposal_method_valid check (
    disposal_method is null or disposal_method in (
      'recycled', 'sold', 'donated', 'destroyed', 'returned_to_vendor', 'other'
    )
  ),
  unique (organization_id, asset_tag)
);
create unique index assets_serial_unique_idx
  on public.assets (organization_id, lower(serial_number))
  where serial_number is not null;
create index assets_workspace_idx
  on public.assets (organization_id, status, category_id, updated_at desc);
create index assets_warranty_idx
  on public.assets (organization_id, warranty_end_date)
  where warranty_end_date is not null and status <> 'disposed';

create table public.asset_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete restrict,
  membership_id uuid not null references public.memberships(id) on delete restrict,
  checkout_at timestamptz not null,
  expected_return_at timestamptz,
  checkout_condition text not null,
  checkout_notes text,
  acknowledged_at timestamptz,
  returned_at timestamptz,
  return_condition text,
  return_notes text,
  assigned_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  returned_by_membership_id uuid references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asset_assignments_checkout_condition_valid check (
    checkout_condition in ('new', 'good', 'fair', 'poor', 'damaged', 'missing')
  ),
  constraint asset_assignments_return_condition_valid check (
    return_condition is null or return_condition in ('new', 'good', 'fair', 'poor', 'damaged', 'missing')
  ),
  constraint asset_assignments_expected_return_valid check (
    expected_return_at is null or expected_return_at >= checkout_at
  ),
  constraint asset_assignments_return_valid check (
    (returned_at is null and return_condition is null and returned_by_membership_id is null)
    or (returned_at is not null and returned_at >= checkout_at and return_condition is not null
      and returned_by_membership_id is not null)
  ),
  constraint asset_assignments_notes_valid check (
    (checkout_notes is null or char_length(btrim(checkout_notes)) between 2 and 2000)
    and (return_notes is null or char_length(btrim(return_notes)) between 2 and 2000)
  )
);
create unique index asset_assignments_active_asset_idx
  on public.asset_assignments (asset_id) where returned_at is null;
create index asset_assignments_member_idx
  on public.asset_assignments (organization_id, membership_id, returned_at, checkout_at desc);

create table public.asset_condition_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete restrict,
  condition text not null,
  event_type text not null,
  notes text,
  recorded_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint asset_condition_events_condition_valid check (
    condition in ('new', 'good', 'fair', 'poor', 'damaged', 'missing')
  ),
  constraint asset_condition_events_type_valid check (
    event_type in ('registration', 'checkout', 'return', 'inspection', 'maintenance', 'incident', 'disposal')
  ),
  constraint asset_condition_events_notes_valid check (
    notes is null or char_length(btrim(notes)) between 2 and 2000
  )
);
create index asset_condition_events_history_idx
  on public.asset_condition_events (asset_id, created_at desc, id desc);

create table public.asset_maintenance_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete restrict,
  maintenance_type text not null,
  status text not null default 'scheduled',
  provider text,
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  details text not null,
  outcome text,
  cost_minor bigint,
  currency text not null default 'USD',
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  completed_by_membership_id uuid references public.memberships(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asset_maintenance_type_valid check (
    maintenance_type in ('inspection', 'repair', 'service', 'upgrade', 'calibration')
  ),
  constraint asset_maintenance_status_valid check (
    status in ('scheduled', 'in_progress', 'completed', 'cancelled')
  ),
  constraint asset_maintenance_details_valid check (char_length(btrim(details)) between 2 and 4000),
  constraint asset_maintenance_outcome_valid check (
    outcome is null or char_length(btrim(outcome)) between 2 and 4000
  ),
  constraint asset_maintenance_currency_valid check (currency ~ '^[A-Z]{3}$'),
  constraint asset_maintenance_cost_valid check (cost_minor is null or cost_minor >= 0),
  constraint asset_maintenance_dates_valid check (
    (started_at is null or scheduled_at is null or started_at >= scheduled_at)
    and (completed_at is null or started_at is null or completed_at >= started_at)
  ),
  constraint asset_maintenance_completion_valid check (
    (status = 'completed' and completed_at is not null and outcome is not null
      and completed_by_membership_id is not null)
    or status <> 'completed'
  )
);
create index asset_maintenance_history_idx
  on public.asset_maintenance_records (asset_id, created_at desc, id desc);
create index asset_maintenance_due_idx
  on public.asset_maintenance_records (organization_id, status, scheduled_at)
  where status in ('scheduled', 'in_progress');

create table public.asset_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete restrict,
  event_type text not null,
  actor_membership_id uuid references public.memberships(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint asset_events_type_valid check (event_type ~ '^[a-z][a-z0-9_.]{2,79}$'),
  constraint asset_events_details_object check (jsonb_typeof(details) = 'object')
);
create index asset_events_history_idx on public.asset_events (asset_id, created_at desc, id desc);

create or replace function private.validate_asset_category_tenant()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.memberships where id = new.created_by_membership_id
      and organization_id = new.organization_id and status = 'active'
  ) then
    raise exception using errcode = '23514', message = 'Asset category creator must be active in its organization';
  end if;
  return new;
end;
$$;

create or replace function private.validate_asset_tenant()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.asset_categories where id = new.category_id
      and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Asset category must belong to its organization';
  end if;
  if not exists (
    select 1 from public.memberships where id = new.created_by_membership_id
      and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Asset creator must belong to its organization';
  end if;
  if new.owner_membership_id is not null and not exists (
    select 1 from public.memberships where id = new.owner_membership_id
      and organization_id = new.organization_id and status = 'active'
  ) then
    raise exception using errcode = '23514', message = 'Asset owner must be active in its organization';
  end if;
  if new.disposed_by_membership_id is not null and not exists (
    select 1 from public.memberships where id = new.disposed_by_membership_id
      and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Asset disposer must belong to its organization';
  end if;
  return new;
end;
$$;

create or replace function private.validate_asset_assignment_tenant()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.assets where id = new.asset_id and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Asset assignment must match its organization';
  end if;
  if not exists (
    select 1 from public.memberships where id = new.membership_id
      and organization_id = new.organization_id and status = 'active'
  ) then
    raise exception using errcode = '23514', message = 'Asset assignee must be active in its organization';
  end if;
  if not exists (
    select 1 from public.memberships where id = new.assigned_by_membership_id
      and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Asset assignment actor must match its organization';
  end if;
  if new.returned_by_membership_id is not null and not exists (
    select 1 from public.memberships where id = new.returned_by_membership_id
      and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Asset return actor must match its organization';
  end if;
  return new;
end;
$$;

create or replace function private.validate_asset_history_tenant()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_actor uuid;
begin
  if not exists (
    select 1 from public.assets where id = new.asset_id and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Asset history must match its organization';
  end if;
  if tg_table_name = 'asset_condition_events' then
    v_actor := new.recorded_by_membership_id;
  else
    v_actor := new.actor_membership_id;
  end if;
  if v_actor is not null and not exists (
    select 1 from public.memberships where id = v_actor and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Asset history actor must match its organization';
  end if;
  return new;
end;
$$;

create or replace function private.validate_asset_maintenance_tenant()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.assets where id = new.asset_id and organization_id = new.organization_id
  ) or not exists (
    select 1 from public.memberships where id = new.created_by_membership_id
      and organization_id = new.organization_id
  ) or (new.completed_by_membership_id is not null and not exists (
    select 1 from public.memberships where id = new.completed_by_membership_id
      and organization_id = new.organization_id
  )) then
    raise exception using errcode = '23514', message = 'Asset maintenance record must remain inside one organization';
  end if;
  return new;
end;
$$;

create or replace function private.prevent_asset_history_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '23514', message = 'Asset condition and lifecycle history are append-only';
end;
$$;

create or replace function private.asset_membership_access_allowed(
  p_asset_id uuid,
  p_membership_id uuid,
  p_permission_key text
)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_asset public.assets%rowtype;
  v_scope text;
  v_assignee_id uuid;
begin
  select * into v_asset from public.assets where id = p_asset_id;
  if v_asset.id is null then return false; end if;
  select assignment.membership_id into v_assignee_id
  from public.asset_assignments as assignment
  where assignment.asset_id = p_asset_id and assignment.returned_at is null
  order by assignment.checkout_at desc limit 1;
  v_scope := private.membership_effective_permission_scope(p_membership_id, p_permission_key);
  if v_scope is null then return false; end if;
  if v_scope = 'organization' then return true; end if;
  if p_permission_key = 'assets.asset.acknowledge' then return v_assignee_id = p_membership_id; end if;
  if p_permission_key = 'assets.asset.view' and p_membership_id in (
    v_assignee_id, v_asset.owner_membership_id, v_asset.created_by_membership_id
  ) then return true; end if;
  return private.crm_scope_allows_membership(
    p_membership_id,
    v_scope,
    coalesce(v_assignee_id, v_asset.owner_membership_id),
    v_asset.created_by_membership_id
  );
end;
$$;

create or replace function private.asset_access_allowed(p_asset_id uuid, p_permission_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.asset_membership_access_allowed(
    p_asset_id,
    private.current_membership_id((select organization_id from public.assets where id = p_asset_id)),
    p_permission_key
  )
$$;

create trigger asset_categories_set_updated_at
before update on public.asset_categories
for each row execute function private.set_updated_at();
create trigger asset_categories_validate_tenant
before insert or update on public.asset_categories
for each row execute function private.validate_asset_category_tenant();
create trigger assets_set_updated_at
before update on public.assets
for each row execute function private.set_updated_at();
create trigger assets_validate_tenant
before insert or update on public.assets
for each row execute function private.validate_asset_tenant();
create trigger asset_assignments_set_updated_at
before update on public.asset_assignments
for each row execute function private.set_updated_at();
create trigger asset_assignments_validate_tenant
before insert or update on public.asset_assignments
for each row execute function private.validate_asset_assignment_tenant();
create trigger asset_condition_events_validate_tenant
before insert or update on public.asset_condition_events
for each row execute function private.validate_asset_history_tenant();
create trigger asset_events_validate_tenant
before insert or update on public.asset_events
for each row execute function private.validate_asset_history_tenant();
create trigger asset_maintenance_set_updated_at
before update on public.asset_maintenance_records
for each row execute function private.set_updated_at();
create trigger asset_maintenance_validate_tenant
before insert or update on public.asset_maintenance_records
for each row execute function private.validate_asset_maintenance_tenant();
create trigger asset_condition_events_immutable
before update or delete on public.asset_condition_events
for each row execute function private.prevent_asset_history_mutation();
create trigger asset_events_immutable
before update or delete on public.asset_events
for each row execute function private.prevent_asset_history_mutation();

-- Add Assets to the existing Documents relationship catalogue.
alter table public.document_entity_links
  drop constraint document_entity_links_type_valid;
alter table public.document_entity_links
  add constraint document_entity_links_type_valid check (
    entity_type in (
      'client', 'contact', 'lead', 'project', 'task', 'invoice', 'estimate', 'employee', 'ticket', 'asset'
    )
  );

create or replace function private.validate_document_entity_link()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_exists boolean := false;
begin
  if not exists (select 1 from public.documents where id = new.document_id and organization_id = new.organization_id)
     or not exists (select 1 from public.memberships where id = new.created_by_membership_id and organization_id = new.organization_id) then
    raise exception using errcode = '23514', message = 'Document entity link must remain inside one organization';
  end if;
  case new.entity_type
    when 'client' then select exists(select 1 from public.crm_companies where id = new.entity_id and organization_id = new.organization_id) into v_exists;
    when 'contact' then select exists(select 1 from public.crm_contacts where id = new.entity_id and organization_id = new.organization_id) into v_exists;
    when 'lead' then select exists(select 1 from public.crm_leads where id = new.entity_id and organization_id = new.organization_id) into v_exists;
    when 'project' then select exists(select 1 from public.projects where id = new.entity_id and organization_id = new.organization_id) into v_exists;
    when 'task' then select exists(select 1 from public.project_tasks where id = new.entity_id and organization_id = new.organization_id) into v_exists;
    when 'invoice' then select exists(select 1 from public.finance_invoices where id = new.entity_id and organization_id = new.organization_id) into v_exists;
    when 'estimate' then select exists(select 1 from public.finance_estimates where id = new.entity_id and organization_id = new.organization_id) into v_exists;
    when 'employee' then select exists(select 1 from public.memberships where id = new.entity_id and organization_id = new.organization_id) into v_exists;
    when 'ticket' then select exists(select 1 from public.support_tickets where id = new.entity_id and organization_id = new.organization_id) into v_exists;
    when 'asset' then select exists(select 1 from public.assets where id = new.entity_id and organization_id = new.organization_id) into v_exists;
  end case;
  if not v_exists then
    raise exception using errcode = '23514', message = 'Linked entity was not found in this organization';
  end if;
  return new;
end;
$$;

alter table public.asset_categories enable row level security;
alter table public.assets enable row level security;
alter table public.asset_assignments enable row level security;
alter table public.asset_condition_events enable row level security;
alter table public.asset_maintenance_records enable row level security;
alter table public.asset_events enable row level security;

revoke all on public.asset_categories from public, anon;
revoke all on public.assets from public, anon;
revoke all on public.asset_assignments from public, anon;
revoke all on public.asset_condition_events from public, anon;
revoke all on public.asset_maintenance_records from public, anon;
revoke all on public.asset_events from public, anon;

grant select on public.asset_categories to authenticated;
grant select on public.assets to authenticated;
grant select on public.asset_assignments to authenticated;
grant select on public.asset_condition_events to authenticated;
grant select on public.asset_maintenance_records to authenticated;
grant select (id, organization_id, asset_id, event_type, actor_membership_id, created_at)
  on public.asset_events to authenticated;
grant all on public.asset_categories, public.assets, public.asset_assignments,
  public.asset_condition_events, public.asset_maintenance_records, public.asset_events to service_role;

create policy asset_categories_select on public.asset_categories
for select to authenticated using (private.has_permission(organization_id, 'assets.workspace.view'));
create policy assets_select on public.assets
for select to authenticated using (private.asset_access_allowed(id, 'assets.asset.view'));
create policy asset_assignments_select on public.asset_assignments
for select to authenticated using (private.asset_access_allowed(asset_id, 'assets.asset.view'));
create policy asset_condition_events_select on public.asset_condition_events
for select to authenticated using (private.asset_access_allowed(asset_id, 'assets.asset.view'));
create policy asset_maintenance_records_select on public.asset_maintenance_records
for select to authenticated using (private.asset_access_allowed(asset_id, 'assets.asset.view'));
create policy asset_events_select on public.asset_events
for select to authenticated using (private.asset_access_allowed(asset_id, 'assets.asset.view'));

revoke all on function private.validate_asset_category_tenant() from public, anon, authenticated;
revoke all on function private.validate_asset_tenant() from public, anon, authenticated;
revoke all on function private.validate_asset_assignment_tenant() from public, anon, authenticated;
revoke all on function private.validate_asset_history_tenant() from public, anon, authenticated;
revoke all on function private.validate_asset_maintenance_tenant() from public, anon, authenticated;
revoke all on function private.prevent_asset_history_mutation() from public, anon, authenticated;
revoke all on function private.asset_membership_access_allowed(uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.asset_access_allowed(uuid, text) from public, anon;
grant execute on function private.asset_membership_access_allowed(uuid, uuid, text) to service_role;
grant execute on function private.asset_access_allowed(uuid, text) to authenticated, service_role;

insert into public.asset_categories (
  organization_id, name, kind, description, created_by_membership_id
)
select organization.id, seed.name, seed.kind, seed.description,
  (select membership.id from public.memberships membership
   where membership.organization_id = organization.id and membership.status = 'active'
   order by membership.created_at, membership.id limit 1)
from public.organizations organization
cross join (values
  ('Laptops', 'computer', 'Portable computers and workstations.'),
  ('Desktops', 'computer', 'Desktop computers and fixed workstations.'),
  ('Monitors', 'display', 'Monitors and presentation displays.'),
  ('Phones', 'mobile', 'Company phones and mobile devices.'),
  ('SIM cards', 'mobile', 'Company mobile subscriptions and SIM cards.'),
  ('Accessories', 'accessory', 'Peripherals, chargers, docks, and accessories.'),
  ('Software licences', 'software', 'Assigned or pooled software licences.'),
  ('Keys and access cards', 'access', 'Physical keys, badges, and access cards.'),
  ('Furniture', 'furniture', 'Office furniture and fixtures.'),
  ('Other equipment', 'other', 'Equipment that does not fit another category.')
) as seed(name, kind, description)
where exists (
  select 1 from public.memberships membership
  where membership.organization_id = organization.id and membership.status = 'active'
)
on conflict (organization_id, name) do nothing;
