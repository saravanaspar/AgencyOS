-- AgencyOS platform identity and tenancy baseline.
-- All tenant-owned records carry organization_id. Public tables are protected
-- by RLS in the following migration.

set lock_timeout = '10s';
set statement_timeout = '120s';

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  legal_name text not null,
  trading_name text,
  status text not null default 'active',
  logo_storage_key text,
  registered_address jsonb not null default '{}'::jsonb,
  billing_address jsonb not null default '{}'::jsonb,
  country_code text,
  timezone text not null default 'UTC',
  default_currency text not null default 'USD',
  financial_year_start_month smallint not null default 1,
  tax_identifiers jsonb not null default '{}'::jsonb,
  registration_numbers jsonb not null default '{}'::jsonb,
  primary_contact jsonb not null default '{}'::jsonb,
  email_sender jsonb not null default '{}'::jsonb,
  invoice_settings jsonb not null default '{}'::jsonb,
  date_format text not null default 'yyyy-MM-dd',
  number_format text not null default 'en-US',
  working_days smallint[] not null default array[1,2,3,4,5]::smallint[],
  business_hours jsonb not null default '{}'::jsonb,
  feature_settings jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_slug_format check (
    slug = lower(slug)
    and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  constraint organizations_legal_name_not_blank check (btrim(legal_name) <> ''),
  constraint organizations_status_valid check (status in ('active', 'suspended', 'archived')),
  constraint organizations_country_code_valid check (
    country_code is null or country_code ~ '^[A-Z]{2}$'
  ),
  constraint organizations_currency_valid check (default_currency ~ '^[A-Z]{3}$'),
  constraint organizations_financial_year_month_valid check (
    financial_year_start_month between 1 and 12
  ),
  constraint organizations_registered_address_object check (jsonb_typeof(registered_address) = 'object'),
  constraint organizations_billing_address_object check (jsonb_typeof(billing_address) = 'object'),
  constraint organizations_tax_identifiers_object check (jsonb_typeof(tax_identifiers) = 'object'),
  constraint organizations_registration_numbers_object check (jsonb_typeof(registration_numbers) = 'object'),
  constraint organizations_primary_contact_object check (jsonb_typeof(primary_contact) = 'object'),
  constraint organizations_email_sender_object check (jsonb_typeof(email_sender) = 'object'),
  constraint organizations_invoice_settings_object check (jsonb_typeof(invoice_settings) = 'object'),
  constraint organizations_business_hours_object check (jsonb_typeof(business_hours) = 'object'),
  constraint organizations_feature_settings_object check (jsonb_typeof(feature_settings) = 'object')
);

create unique index organizations_slug_unique on public.organizations (lower(slug));
create index organizations_status_idx on public.organizations (status);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text,
  last_name text,
  display_name text,
  phone text,
  avatar_storage_key text,
  job_title text,
  timezone text not null default 'UTC',
  language text not null default 'en',
  date_format text not null default 'yyyy-MM-dd',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_first_name_not_blank check (first_name is null or btrim(first_name) <> ''),
  constraint profiles_last_name_not_blank check (last_name is null or btrim(last_name) <> ''),
  constraint profiles_display_name_not_blank check (display_name is null or btrim(display_name) <> ''),
  constraint profiles_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  code text,
  status text not null default 'active',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint departments_name_not_blank check (btrim(name) <> ''),
  constraint departments_code_not_blank check (code is null or btrim(code) <> ''),
  constraint departments_status_valid check (status in ('active', 'inactive')),
  unique (organization_id, name),
  unique (organization_id, code)
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  department_id uuid references public.departments(id) on delete set null,
  manager_membership_id uuid references public.memberships(id) on delete set null,
  status text not null default 'invited',
  employee_number text,
  employment_status text,
  invitation_accepted_at timestamptz,
  activated_at timestamptz,
  suspended_at timestamptz,
  deactivated_at timestamptz,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint memberships_status_valid check (
    status in ('invited', 'active', 'suspended', 'deactivated')
  ),
  constraint memberships_employee_number_not_blank check (
    employee_number is null or btrim(employee_number) <> ''
  ),
  constraint memberships_not_self_managed check (
    manager_membership_id is null or manager_membership_id <> id
  ),
  unique (organization_id, user_id),
  unique (organization_id, employee_number)
);

create index memberships_user_status_idx on public.memberships (user_id, status);
create index memberships_organization_status_idx on public.memberships (organization_id, status);
create index memberships_department_idx on public.memberships (department_id) where department_id is not null;
create index memberships_manager_idx on public.memberships (manager_membership_id) where manager_membership_id is not null;

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'active',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teams_name_not_blank check (btrim(name) <> ''),
  constraint teams_status_valid check (status in ('active', 'inactive')),
  unique (organization_id, name)
);

create table public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  is_lead boolean not null default false,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (team_id, membership_id)
);

create index team_members_membership_idx on public.team_members (membership_id);

create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  module text not null,
  resource text not null,
  action text not null,
  key text generated always as (module || '.' || resource || '.' || action) stored,
  description text not null,
  is_sensitive boolean not null default false,
  created_at timestamptz not null default now(),
  constraint permissions_module_format check (module ~ '^[a-z][a-z0-9_]*$'),
  constraint permissions_resource_format check (resource ~ '^[a-z][a-z0-9_]*$'),
  constraint permissions_action_format check (action ~ '^[a-z][a-z0-9_]*$'),
  constraint permissions_description_not_blank check (btrim(description) <> ''),
  unique (module, resource, action),
  unique (key)
);

create table public.role_templates (
  key text primary key,
  name text not null,
  description text not null,
  is_privileged boolean not null default false,
  sort_order smallint not null default 100,
  created_at timestamptz not null default now(),
  constraint role_templates_key_format check (key ~ '^[a-z][a-z0-9_]*$'),
  constraint role_templates_name_not_blank check (btrim(name) <> ''),
  constraint role_templates_description_not_blank check (btrim(description) <> '')
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  template_key text references public.role_templates(key) on delete set null,
  key text not null,
  name text not null,
  description text,
  is_system boolean not null default false,
  is_privileged boolean not null default false,
  status text not null default 'active',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roles_key_format check (key ~ '^[a-z][a-z0-9_]*$'),
  constraint roles_name_not_blank check (btrim(name) <> ''),
  constraint roles_status_valid check (status in ('active', 'inactive')),
  unique (organization_id, key),
  unique (organization_id, name)
);

create index roles_organization_status_idx on public.roles (organization_id, status);

create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  scope text not null default 'organization',
  conditions jsonb not null default '{}'::jsonb,
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (role_id, permission_id),
  constraint role_permissions_scope_valid check (
    scope in (
      'own',
      'assigned',
      'assigned_or_created',
      'team',
      'department',
      'managed_employees',
      'selected_projects',
      'organization'
    )
  ),
  constraint role_permissions_conditions_object check (jsonb_typeof(conditions) = 'object')
);

create index role_permissions_permission_idx on public.role_permissions (permission_id);

create table public.role_template_permissions (
  role_template_key text not null references public.role_templates(key) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  scope text not null default 'organization',
  conditions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (role_template_key, permission_id),
  constraint role_template_permissions_scope_valid check (
    scope in (
      'own',
      'assigned',
      'assigned_or_created',
      'team',
      'department',
      'managed_employees',
      'selected_projects',
      'organization'
    )
  ),
  constraint role_template_permissions_conditions_object check (jsonb_typeof(conditions) = 'object')
);

create table public.membership_roles (
  membership_id uuid not null references public.memberships(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (membership_id, role_id)
);

create index membership_roles_role_idx on public.membership_roles (role_id);

create table public.membership_permission_overrides (
  membership_id uuid not null references public.memberships(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  effect text not null,
  scope text,
  conditions jsonb not null default '{}'::jsonb,
  reason text not null,
  expires_at timestamptz,
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (membership_id, permission_id),
  constraint membership_permission_overrides_effect_valid check (effect in ('allow', 'deny')),
  constraint membership_permission_overrides_scope_valid check (
    scope is null or scope in (
      'own',
      'assigned',
      'assigned_or_created',
      'team',
      'department',
      'managed_employees',
      'selected_projects',
      'organization'
    )
  ),
  constraint membership_permission_overrides_conditions_object check (jsonb_typeof(conditions) = 'object'),
  constraint membership_permission_overrides_reason_not_blank check (btrim(reason) <> '')
);

create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  token_hash text not null,
  status text not null default 'pending',
  expires_at timestamptz not null,
  invited_by uuid not null references auth.users(id) on delete restrict,
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_invitations_email_not_blank check (btrim(email) <> ''),
  constraint organization_invitations_token_hash_not_blank check (btrim(token_hash) <> ''),
  constraint organization_invitations_status_valid check (
    status in ('pending', 'accepted', 'expired', 'revoked')
  ),
  constraint organization_invitations_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create unique index organization_invitations_pending_email_unique
  on public.organization_invitations (organization_id, lower(email))
  where status = 'pending';
create unique index organization_invitations_token_hash_unique
  on public.organization_invitations (token_hash);
create index organization_invitations_expiry_idx
  on public.organization_invitations (expires_at)
  where status = 'pending';

create table public.user_preferences (
  membership_id uuid primary key references public.memberships(id) on delete cascade,
  notification_preferences jsonb not null default '{}'::jsonb,
  calendar_preferences jsonb not null default '{}'::jsonb,
  dashboard_preferences jsonb not null default '{}'::jsonb,
  locale_preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_preferences_notification_object check (jsonb_typeof(notification_preferences) = 'object'),
  constraint user_preferences_calendar_object check (jsonb_typeof(calendar_preferences) = 'object'),
  constraint user_preferences_dashboard_object check (jsonb_typeof(dashboard_preferences) = 'object'),
  constraint user_preferences_locale_object check (jsonb_typeof(locale_preferences) = 'object')
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_type text not null default 'user',
  action text not null,
  entity_type text not null,
  entity_id text,
  request_id text,
  source text not null default 'web',
  before_state jsonb,
  after_state jsonb,
  changed_fields text[] not null default '{}'::text[],
  ip_address inet,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint audit_events_actor_type_valid check (
    actor_type in ('user', 'system', 'integration', 'anonymous')
  ),
  constraint audit_events_action_not_blank check (btrim(action) <> ''),
  constraint audit_events_entity_type_not_blank check (btrim(entity_type) <> ''),
  constraint audit_events_source_not_blank check (btrim(source) <> ''),
  constraint audit_events_before_state_object check (before_state is null or jsonb_typeof(before_state) = 'object'),
  constraint audit_events_after_state_object check (after_state is null or jsonb_typeof(after_state) = 'object'),
  constraint audit_events_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index audit_events_organization_time_idx
  on public.audit_events (organization_id, occurred_at desc)
  where organization_id is not null;
create index audit_events_actor_time_idx
  on public.audit_events (actor_user_id, occurred_at desc)
  where actor_user_id is not null;
create index audit_events_entity_idx
  on public.audit_events (entity_type, entity_id, occurred_at desc)
  where entity_id is not null;
create index audit_events_request_idx
  on public.audit_events (request_id)
  where request_id is not null;

-- Enable RLS in the same migration that creates each public table. This keeps
-- a partially applied migration from exposing tables through the Data API.
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.departments enable row level security;
alter table public.memberships enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.permissions enable row level security;
alter table public.role_templates enable row level security;
alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.role_template_permissions enable row level security;
alter table public.membership_roles enable row level security;
alter table public.membership_permission_overrides enable row level security;
alter table public.organization_invitations enable row level security;
alter table public.user_preferences enable row level security;
alter table public.audit_events enable row level security;

create or replace function private.prevent_audit_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_events are append-only';
end;
$$;

create trigger audit_events_prevent_update
before update on public.audit_events
for each row execute function private.prevent_audit_event_mutation();

create trigger audit_events_prevent_delete
before delete on public.audit_events
for each row execute function private.prevent_audit_event_mutation();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (
    id,
    first_name,
    last_name,
    display_name,
    timezone,
    language
  )
  values (
    new.id,
    nullif(btrim(new.raw_user_meta_data ->> 'first_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'last_name'), ''),
    nullif(btrim(coalesce(
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'full_name'
    )), ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'timezone', ''), 'UTC'),
    coalesce(nullif(new.raw_user_meta_data ->> 'language', ''), 'en')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

create trigger organizations_set_updated_at
before update on public.organizations
for each row execute function private.set_updated_at();

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create trigger departments_set_updated_at
before update on public.departments
for each row execute function private.set_updated_at();

create trigger memberships_set_updated_at
before update on public.memberships
for each row execute function private.set_updated_at();

create trigger teams_set_updated_at
before update on public.teams
for each row execute function private.set_updated_at();

create trigger roles_set_updated_at
before update on public.roles
for each row execute function private.set_updated_at();

create trigger role_permissions_set_updated_at
before update on public.role_permissions
for each row execute function private.set_updated_at();

create trigger membership_permission_overrides_set_updated_at
before update on public.membership_permission_overrides
for each row execute function private.set_updated_at();

create trigger organization_invitations_set_updated_at
before update on public.organization_invitations
for each row execute function private.set_updated_at();

create trigger user_preferences_set_updated_at
before update on public.user_preferences
for each row execute function private.set_updated_at();
