-- Shared, tenant-safe approval definitions, requests, decisions, delegation, and timer processing.

set lock_timeout = '10s';
set statement_timeout = '120s';

insert into public.permissions (module, resource, action, description, is_sensitive)
values
  ('approvals', 'definition', 'view', 'View approval policies and their configured steps.', true),
  ('approvals', 'definition', 'manage_settings', 'Create and retire organization approval policies.', true),
  ('approvals', 'request', 'reassign', 'Reassign a pending approval step to another eligible member.', true),
  ('approvals', 'delegation', 'manage_settings', 'Manage personal approval delegations.', true)
on conflict (module, resource, action) do update
set
  description = excluded.description,
  is_sensitive = excluded.is_sensitive;

-- Owner keeps every registered permission.
insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'owner', permission.id, 'organization'
from public.permissions as permission
where permission.module = 'approvals'
on conflict (role_template_key, permission_id) do update
set scope = excluded.scope;

-- Operations administrators manage the shared engine.
insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'operations_administrator', permission.id, 'organization'
from public.permissions as permission
where permission.module = 'approvals'
on conflict (role_template_key, permission_id) do update
set scope = excluded.scope;

-- System administrators may inspect policy and request state without becoming business approvers.
insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'system_administrator', permission.id, 'organization'
from public.permissions as permission
where permission.key in (
  'approvals.definition.view',
  'approvals.request.view'
)
on conflict (role_template_key, permission_id) do update
set scope = excluded.scope;

-- Every employee can inspect active policy names, submit requests, and manage personal delegation.
insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'organization'
from public.role_templates as role_template
cross join public.permissions as permission
where role_template.key in (
  'finance_manager', 'accountant', 'hr_manager', 'project_manager', 'team_lead',
  'sales_manager', 'sales_executive', 'support_manager', 'support_agent',
  'legal_manager', 'auditor', 'employee'
)
and permission.key in (
  'approvals.definition.view',
  'approvals.request.create',
  'approvals.delegation.manage_settings'
)
on conflict (role_template_key, permission_id) do update
set scope = excluded.scope;

-- Normal users may read only approval requests they submitted or that are assigned to them.
insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'assigned_or_created'
from public.role_templates as role_template
cross join public.permissions as permission
where role_template.key in (
  'finance_manager', 'accountant', 'hr_manager', 'project_manager', 'team_lead',
  'sales_manager', 'sales_executive', 'support_manager', 'support_agent',
  'legal_manager', 'employee'
)
and permission.key = 'approvals.request.view'
on conflict (role_template_key, permission_id) do update
set scope = excluded.scope;

-- Auditor retains organization-wide read-only approval evidence.
insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'auditor', permission.id, 'organization'
from public.permissions as permission
where permission.key = 'approvals.request.view'
on conflict (role_template_key, permission_id) do update
set scope = excluded.scope;

-- Manager roles can decide and reassign only work routed to them.
insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'assigned'
from public.role_templates as role_template
cross join public.permissions as permission
where role_template.key in (
  'finance_manager', 'hr_manager', 'project_manager', 'team_lead',
  'sales_manager', 'support_manager', 'legal_manager'
)
and permission.key in (
  'approvals.request.approve',
  'approvals.request.reject',
  'approvals.request.reassign'
)
on conflict (role_template_key, permission_id) do update
set scope = excluded.scope;

-- Apply template changes to existing organization roles.
insert into public.role_permissions (role_id, permission_id, scope)
select role.id, template_permission.permission_id, template_permission.scope
from public.roles as role
join public.role_template_permissions as template_permission
  on template_permission.role_template_key = role.template_key
join public.permissions as permission
  on permission.id = template_permission.permission_id
where permission.module = 'approvals'
on conflict (role_id, permission_id) do update
set scope = excluded.scope;

create table public.approval_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  name text not null,
  description text,
  source_module text not null,
  entity_type text not null,
  version integer not null default 1,
  status text not null default 'active',
  allow_self_approval boolean not null default false,
  allow_reassignment boolean not null default true,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  updated_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approval_definitions_key_format check (key ~ '^[a-z][a-z0-9_]{1,79}$'),
  constraint approval_definitions_name_not_blank check (btrim(name) <> '' and length(name) <= 120),
  constraint approval_definitions_description_not_blank check (
    description is null or (btrim(description) <> '' and length(description) <= 1000)
  ),
  constraint approval_definitions_source_module_format check (
    source_module ~ '^[a-z][a-z0-9_]*$' and length(source_module) <= 80
  ),
  constraint approval_definitions_entity_type_format check (
    entity_type ~ '^[a-z][a-z0-9_]*$' and length(entity_type) <= 80
  ),
  constraint approval_definitions_version_positive check (version > 0),
  constraint approval_definitions_status_valid check (status in ('active', 'inactive')),
  unique (organization_id, key, version)
);

create unique index approval_definitions_active_key_unique
  on public.approval_definitions (organization_id, key)
  where status = 'active';

create index approval_definitions_org_status_idx
  on public.approval_definitions (organization_id, status, name);

create table public.approval_definition_steps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  definition_id uuid not null references public.approval_definitions(id) on delete cascade,
  name text not null,
  stage_order smallint not null,
  sort_order smallint not null default 1,
  selector_type text not null,
  selector_role_key text,
  selector_membership_id uuid references public.memberships(id) on delete restrict,
  decision_mode text not null default 'any',
  conditions jsonb not null default '{}'::jsonb,
  comment_required boolean not null default false,
  reminder_after_hours integer,
  escalation_after_hours integer,
  expires_after_hours integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approval_definition_steps_name_not_blank check (btrim(name) <> '' and length(name) <= 120),
  constraint approval_definition_steps_stage_range check (stage_order between 1 and 50),
  constraint approval_definition_steps_sort_range check (sort_order between 1 and 50),
  constraint approval_definition_steps_selector_valid check (
    selector_type in ('manager', 'role', 'membership')
  ),
  constraint approval_definition_steps_selector_shape check (
    (selector_type = 'manager' and selector_role_key is null and selector_membership_id is null)
    or (selector_type = 'role' and selector_role_key is not null and selector_membership_id is null)
    or (selector_type = 'membership' and selector_role_key is null and selector_membership_id is not null)
  ),
  constraint approval_definition_steps_role_key_format check (
    selector_role_key is null or selector_role_key ~ '^[a-z][a-z0-9_]{1,79}$'
  ),
  constraint approval_definition_steps_decision_mode_valid check (
    decision_mode in ('any', 'all')
  ),
  constraint approval_definition_steps_conditions_object check (
    jsonb_typeof(conditions) = 'object'
  ),
  constraint approval_definition_steps_reminder_range check (
    reminder_after_hours is null or reminder_after_hours between 1 and 720
  ),
  constraint approval_definition_steps_escalation_range check (
    escalation_after_hours is null or escalation_after_hours between 1 and 2160
  ),
  constraint approval_definition_steps_expiry_range check (
    expires_after_hours is null or expires_after_hours between 1 and 8760
  ),
  constraint approval_definition_steps_timer_order check (
    escalation_after_hours is null
    or reminder_after_hours is null
    or escalation_after_hours >= reminder_after_hours
  ),
  unique (definition_id, stage_order, sort_order)
);

create index approval_definition_steps_definition_idx
  on public.approval_definition_steps (definition_id, stage_order, sort_order);

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  definition_id uuid not null references public.approval_definitions(id) on delete restrict,
  definition_version integer not null,
  requester_membership_id uuid not null references public.memberships(id) on delete restrict,
  title text not null,
  source_module text not null,
  entity_type text not null,
  entity_id text,
  deep_link text,
  department_id uuid references public.departments(id) on delete set null,
  amount numeric(18, 2),
  currency text,
  snapshot jsonb not null,
  snapshot_hash text not null,
  status text not null default 'pending',
  current_stage smallint,
  submitted_at timestamptz not null default now(),
  due_at timestamptz,
  completed_at timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approval_requests_title_not_blank check (btrim(title) <> '' and length(title) <= 160),
  constraint approval_requests_source_module_format check (
    source_module ~ '^[a-z][a-z0-9_]*$' and length(source_module) <= 80
  ),
  constraint approval_requests_entity_type_format check (
    entity_type ~ '^[a-z][a-z0-9_]*$' and length(entity_type) <= 80
  ),
  constraint approval_requests_entity_id_not_blank check (
    entity_id is null or (btrim(entity_id) <> '' and length(entity_id) <= 200)
  ),
  constraint approval_requests_deep_link_safe check (
    deep_link is null
    or (
      length(deep_link) <= 500
      and left(deep_link, 1) = '/'
      and left(deep_link, 2) <> '//'
      and position(chr(92) in deep_link) = 0
      and deep_link !~ '[[:cntrl:]]'
    )
  ),
  constraint approval_requests_amount_nonnegative check (amount is null or amount >= 0),
  constraint approval_requests_amount_currency_pair check ((amount is null) = (currency is null)),
  constraint approval_requests_currency_shape check (
    currency is null or currency ~ '^[A-Z]{3}$'
  ),
  constraint approval_requests_snapshot_object check (jsonb_typeof(snapshot) = 'object'),
  constraint approval_requests_snapshot_size check (octet_length(snapshot::text) <= 65536),
  constraint approval_requests_snapshot_hash_shape check (snapshot_hash ~ '^[a-f0-9]{64}$'),
  constraint approval_requests_status_valid check (
    status in (
      'pending', 'approved', 'rejected', 'revision_requested',
      'cancelled', 'expired', 'invalidated'
    )
  ),
  constraint approval_requests_current_stage_range check (
    current_stage is null or current_stage between 1 and 50
  ),
  constraint approval_requests_definition_version_positive check (definition_version > 0)
);

create index approval_requests_org_status_idx
  on public.approval_requests (organization_id, status, submitted_at desc);
create index approval_requests_requester_idx
  on public.approval_requests (requester_membership_id, submitted_at desc);
create index approval_requests_entity_idx
  on public.approval_requests (organization_id, source_module, entity_type, entity_id)
  where entity_id is not null;
create unique index approval_requests_pending_entity_unique
  on public.approval_requests (organization_id, source_module, entity_type, entity_id)
  where entity_id is not null and status = 'pending';

create table public.approval_request_steps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.approval_requests(id) on delete cascade,
  definition_step_id uuid not null references public.approval_definition_steps(id) on delete restrict,
  stage_order smallint not null,
  sort_order smallint not null,
  step_name text not null,
  selector_type text not null,
  decision_mode text not null,
  approver_membership_id uuid not null references public.memberships(id) on delete restrict,
  delegated_from_membership_id uuid references public.memberships(id) on delete restrict,
  status text not null default 'waiting',
  comment_required boolean not null default false,
  due_at timestamptz,
  reminder_at timestamptz,
  escalation_at timestamptz,
  reminder_count integer not null default 0,
  last_reminded_at timestamptz,
  escalated_at timestamptz,
  acted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approval_request_steps_stage_range check (stage_order between 1 and 50),
  constraint approval_request_steps_sort_range check (sort_order between 1 and 50),
  constraint approval_request_steps_name_not_blank check (btrim(step_name) <> '' and length(step_name) <= 120),
  constraint approval_request_steps_selector_valid check (
    selector_type in ('manager', 'role', 'membership')
  ),
  constraint approval_request_steps_decision_mode_valid check (
    decision_mode in ('any', 'all')
  ),
  constraint approval_request_steps_status_valid check (
    status in (
      'waiting', 'pending', 'approved', 'rejected', 'revision_requested',
      'skipped', 'cancelled', 'expired'
    )
  ),
  constraint approval_request_steps_reminder_nonnegative check (reminder_count >= 0),
  constraint approval_request_steps_delegate_not_same check (
    delegated_from_membership_id is null
    or delegated_from_membership_id <> approver_membership_id
  ),
  unique (request_id, definition_step_id, approver_membership_id)
);

create index approval_request_steps_assignee_idx
  on public.approval_request_steps (approver_membership_id, status, created_at desc);
create index approval_request_steps_request_stage_idx
  on public.approval_request_steps (request_id, stage_order, status);
create index approval_request_steps_due_idx
  on public.approval_request_steps (due_at, id)
  where status = 'pending' and due_at is not null;
create index approval_request_steps_reminder_idx
  on public.approval_request_steps (reminder_at, id)
  where status = 'pending' and reminder_at is not null;
create index approval_request_steps_escalation_idx
  on public.approval_request_steps (escalation_at, id)
  where status = 'pending' and escalation_at is not null and escalated_at is null;

create table public.approval_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.approval_requests(id) on delete cascade,
  request_step_id uuid references public.approval_request_steps(id) on delete set null,
  actor_membership_id uuid references public.memberships(id) on delete restrict,
  action text not null,
  comment text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint approval_actions_action_valid check (
    action in (
      'submitted', 'approved', 'rejected', 'revision_requested', 'cancelled',
      'reassigned', 'delegated', 'reminded', 'escalated', 'expired', 'invalidated'
    )
  ),
  constraint approval_actions_comment_not_blank check (
    comment is null or (btrim(comment) <> '' and length(comment) <= 2000)
  ),
  constraint approval_actions_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint approval_actions_metadata_size check (octet_length(metadata::text) <= 16384)
);

create index approval_actions_request_history_idx
  on public.approval_actions (request_id, created_at, id);

create table public.approval_delegations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  from_membership_id uuid not null references public.memberships(id) on delete cascade,
  to_membership_id uuid not null references public.memberships(id) on delete cascade,
  source_module text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'active',
  reason text,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  revoked_by_membership_id uuid references public.memberships(id) on delete restrict,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approval_delegations_not_self check (from_membership_id <> to_membership_id),
  constraint approval_delegations_source_module_format check (
    source_module is null or source_module ~ '^[a-z][a-z0-9_]*$'
  ),
  constraint approval_delegations_window_valid check (
    ends_at > starts_at and ends_at - starts_at <= interval '366 days'
  ),
  constraint approval_delegations_status_valid check (status in ('active', 'revoked', 'expired')),
  constraint approval_delegations_reason_not_blank check (
    reason is null or (btrim(reason) <> '' and length(reason) <= 500)
  )
);

create index approval_delegations_active_from_idx
  on public.approval_delegations (from_membership_id, starts_at, ends_at)
  where status = 'active';
create index approval_delegations_active_to_idx
  on public.approval_delegations (to_membership_id, starts_at, ends_at)
  where status = 'active';
create index approval_delegations_expiry_idx
  on public.approval_delegations (ends_at, id)
  where status = 'active';

create or replace function private.membership_has_permission(
  p_membership_id uuid,
  p_permission_key text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
begin
  select membership.organization_id
  into v_organization_id
  from public.memberships as membership
  join public.organizations as organization
    on organization.id = membership.organization_id
   and organization.status = 'active'
  where membership.id = p_membership_id
    and membership.status = 'active';

  if v_organization_id is null then return false; end if;

  if exists (
    select 1
    from public.membership_permission_overrides as override_grant
    join public.permissions as permission on permission.id = override_grant.permission_id
    where override_grant.membership_id = p_membership_id
      and permission.key = p_permission_key
      and override_grant.effect = 'deny'
      and (override_grant.expires_at is null or override_grant.expires_at > now())
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.membership_permission_overrides as override_grant
    join public.permissions as permission on permission.id = override_grant.permission_id
    where override_grant.membership_id = p_membership_id
      and permission.key = p_permission_key
      and override_grant.effect = 'allow'
      and (override_grant.expires_at is null or override_grant.expires_at > now())
  ) then
    return true;
  end if;

  return exists (
    select 1
    from public.membership_roles as assignment
    join public.roles as role
      on role.id = assignment.role_id
     and role.organization_id = v_organization_id
     and role.status = 'active'
    join public.role_permissions as role_permission on role_permission.role_id = role.id
    join public.permissions as permission on permission.id = role_permission.permission_id
    where assignment.membership_id = p_membership_id
      and permission.key = p_permission_key
  );
end;
$$;

revoke all on function private.membership_has_permission(uuid, text) from public, anon;
grant execute on function private.membership_has_permission(uuid, text) to authenticated, service_role;

create or replace function private.validate_approval_definition_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator_organization_id uuid;
  v_updater_organization_id uuid;
begin
  select organization_id into v_creator_organization_id
  from public.memberships where id = new.created_by_membership_id;
  select organization_id into v_updater_organization_id
  from public.memberships where id = new.updated_by_membership_id;

  if v_creator_organization_id is null
     or v_updater_organization_id is null
     or v_creator_organization_id <> new.organization_id
     or v_updater_organization_id <> new.organization_id then
    raise exception using errcode = '23514', message = 'Approval definition members must belong to its organization';
  end if;
  return new;
end;
$$;

create or replace function private.validate_approval_definition_step_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_definition_organization_id uuid;
  v_membership_organization_id uuid;
begin
  select organization_id into v_definition_organization_id
  from public.approval_definitions where id = new.definition_id;
  if v_definition_organization_id is null or v_definition_organization_id <> new.organization_id then
    raise exception using errcode = '23514', message = 'Approval step must match its definition tenant';
  end if;

  if new.selector_membership_id is not null then
    select organization_id into v_membership_organization_id
    from public.memberships where id = new.selector_membership_id;
    if v_membership_organization_id is null or v_membership_organization_id <> new.organization_id then
      raise exception using errcode = '23514', message = 'Named approval member must match the definition tenant';
    end if;
  end if;

  if new.selector_role_key is not null and not exists (
    select 1 from public.roles
    where organization_id = new.organization_id
      and key = new.selector_role_key
      and status = 'active'
  ) then
    raise exception using errcode = '23514', message = 'Approval role selector must reference an active organization role';
  end if;
  return new;
end;
$$;

create or replace function private.validate_approval_request_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_definition_organization_id uuid;
  v_definition_version integer;
  v_definition_status text;
  v_definition_source_module text;
  v_definition_entity_type text;
  v_requester_organization_id uuid;
  v_requester_status text;
  v_department_organization_id uuid;
begin
  select organization_id, version, status, source_module, entity_type
  into v_definition_organization_id, v_definition_version, v_definition_status,
       v_definition_source_module, v_definition_entity_type
  from public.approval_definitions where id = new.definition_id;
  select organization_id, status
  into v_requester_organization_id, v_requester_status
  from public.memberships where id = new.requester_membership_id;

  if v_definition_organization_id is null
     or v_requester_organization_id is null
     or v_definition_organization_id <> new.organization_id
     or v_requester_organization_id <> new.organization_id
     or v_requester_status <> 'active'
     or v_definition_version <> new.definition_version
     or v_definition_source_module <> new.source_module
     or v_definition_entity_type <> new.entity_type
     or (tg_op = 'INSERT' and v_definition_status <> 'active') then
    raise exception using errcode = '23514', message = 'Approval request must match an active definition and requester tenant';
  end if;

  if new.department_id is not null then
    select organization_id into v_department_organization_id
    from public.departments where id = new.department_id;
    if v_department_organization_id is null or v_department_organization_id <> new.organization_id then
      raise exception using errcode = '23514', message = 'Approval request department must match its tenant';
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.prevent_approval_snapshot_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.snapshot is distinct from old.snapshot
     or new.snapshot_hash is distinct from old.snapshot_hash
     or new.definition_id is distinct from old.definition_id
     or new.definition_version is distinct from old.definition_version
     or new.requester_membership_id is distinct from old.requester_membership_id
     or new.title is distinct from old.title
     or new.source_module is distinct from old.source_module
     or new.entity_type is distinct from old.entity_type
     or new.entity_id is distinct from old.entity_id
     or new.deep_link is distinct from old.deep_link
     or new.department_id is distinct from old.department_id
     or new.amount is distinct from old.amount
     or new.currency is distinct from old.currency
     or new.submitted_at is distinct from old.submitted_at then
    raise exception using errcode = '55000', message = 'Approval request snapshot and business identity are immutable';
  end if;
  return new;
end;
$$;

create or replace function private.validate_approval_request_step_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_organization_id uuid;
  v_definition_step_organization_id uuid;
  v_approver_organization_id uuid;
  v_approver_status text;
  v_delegate_organization_id uuid;
  v_requester_membership_id uuid;
  v_allow_self_approval boolean;
begin
  select organization_id into v_request_organization_id
  from public.approval_requests where id = new.request_id;
  select organization_id into v_definition_step_organization_id
  from public.approval_definition_steps where id = new.definition_step_id;
  select organization_id, status into v_approver_organization_id, v_approver_status
  from public.memberships where id = new.approver_membership_id;
  select request.requester_membership_id, definition.allow_self_approval
  into v_requester_membership_id, v_allow_self_approval
  from public.approval_requests as request
  join public.approval_definitions as definition on definition.id = request.definition_id
  where request.id = new.request_id;

  if v_request_organization_id is null
     or v_definition_step_organization_id is null
     or v_approver_organization_id is null
     or v_request_organization_id <> new.organization_id
     or v_definition_step_organization_id <> new.organization_id
     or v_approver_organization_id <> new.organization_id
     or v_approver_status <> 'active'
     or not private.membership_has_permission(new.approver_membership_id, 'approvals.request.approve')
     or (not v_allow_self_approval and new.approver_membership_id = v_requester_membership_id) then
    raise exception using errcode = '23514', message = 'Approval request step must use an eligible same-tenant approver';
  end if;

  if new.delegated_from_membership_id is not null then
    select organization_id into v_delegate_organization_id
    from public.memberships where id = new.delegated_from_membership_id;
    if v_delegate_organization_id is null or v_delegate_organization_id <> new.organization_id then
      raise exception using errcode = '23514', message = 'Delegated approval member must match the request tenant';
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.validate_approval_action_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_organization_id uuid;
  v_step_request_id uuid;
  v_actor_organization_id uuid;
begin
  select organization_id into v_request_organization_id
  from public.approval_requests where id = new.request_id;
  if v_request_organization_id is null or v_request_organization_id <> new.organization_id then
    raise exception using errcode = '23514', message = 'Approval action must match its request tenant';
  end if;

  if new.request_step_id is not null then
    select request_id into v_step_request_id
    from public.approval_request_steps where id = new.request_step_id;
    if v_step_request_id is null or v_step_request_id <> new.request_id then
      raise exception using errcode = '23514', message = 'Approval action step must belong to its request';
    end if;
  end if;

  if new.actor_membership_id is not null then
    select organization_id into v_actor_organization_id
    from public.memberships where id = new.actor_membership_id;
    if v_actor_organization_id is null or v_actor_organization_id <> new.organization_id then
      raise exception using errcode = '23514', message = 'Approval action actor must match its tenant';
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.prevent_approval_action_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'Approval action history is append-only';
end;
$$;

create or replace function private.validate_approval_delegation_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from_organization_id uuid;
  v_to_organization_id uuid;
  v_creator_organization_id uuid;
  v_revoker_organization_id uuid;
begin
  select organization_id into v_from_organization_id from public.memberships where id = new.from_membership_id;
  select organization_id into v_to_organization_id from public.memberships where id = new.to_membership_id;
  select organization_id into v_creator_organization_id from public.memberships where id = new.created_by_membership_id;
  if new.revoked_by_membership_id is not null then
    select organization_id into v_revoker_organization_id from public.memberships where id = new.revoked_by_membership_id;
  end if;

  if v_from_organization_id is null
     or v_to_organization_id is null
     or v_creator_organization_id is null
     or v_from_organization_id <> new.organization_id
     or v_to_organization_id <> new.organization_id
     or v_creator_organization_id <> new.organization_id
     or (new.revoked_by_membership_id is not null and v_revoker_organization_id <> new.organization_id) then
    raise exception using errcode = '23514', message = 'Approval delegation members must match its tenant';
  end if;
  return new;
end;
$$;

create or replace function private.approval_request_visible(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.approval_requests as request
    cross join lateral (
      select
        private.current_membership_id(request.organization_id) as membership_id,
        private.effective_permission_scope(
          request.organization_id,
          'approvals.request.view'
        ) as permission_scope
    ) as access
    where request.id = p_request_id
      and private.is_active_member(request.organization_id)
      and private.has_permission(request.organization_id, 'approvals.request.view')
      and (
        request.requester_membership_id = access.membership_id
        or exists (
          select 1
          from public.approval_request_steps as step
          where step.request_id = request.id
            and step.approver_membership_id = access.membership_id
        )
        or private.crm_scope_allows_membership(
          access.membership_id,
          access.permission_scope,
          request.requester_membership_id,
          request.requester_membership_id
        )
      )
  )
$$;

create trigger approval_definitions_validate_tenant
before insert or update of organization_id, created_by_membership_id, updated_by_membership_id
on public.approval_definitions
for each row execute function private.validate_approval_definition_tenant();

create trigger approval_definition_steps_validate_tenant
before insert or update of organization_id, definition_id, selector_role_key, selector_membership_id
on public.approval_definition_steps
for each row execute function private.validate_approval_definition_step_tenant();

create trigger approval_requests_validate_tenant
before insert or update of organization_id, definition_id, requester_membership_id, department_id
on public.approval_requests
for each row execute function private.validate_approval_request_tenant();

create trigger approval_requests_snapshot_immutable
before update on public.approval_requests
for each row execute function private.prevent_approval_snapshot_mutation();

create trigger approval_request_steps_validate_tenant
before insert or update of organization_id, request_id, definition_step_id, approver_membership_id, delegated_from_membership_id
on public.approval_request_steps
for each row execute function private.validate_approval_request_step_tenant();

create trigger approval_actions_validate_tenant
before insert on public.approval_actions
for each row execute function private.validate_approval_action_tenant();

create trigger approval_actions_prevent_update
before update on public.approval_actions
for each row execute function private.prevent_approval_action_mutation();

create trigger approval_actions_prevent_delete
before delete on public.approval_actions
for each row execute function private.prevent_approval_action_mutation();

create trigger approval_delegations_validate_tenant
before insert or update of organization_id, from_membership_id, to_membership_id, created_by_membership_id, revoked_by_membership_id
on public.approval_delegations
for each row execute function private.validate_approval_delegation_tenant();

create trigger approval_definitions_set_updated_at
before update on public.approval_definitions
for each row execute function private.set_updated_at();
create trigger approval_definition_steps_set_updated_at
before update on public.approval_definition_steps
for each row execute function private.set_updated_at();
create trigger approval_requests_set_updated_at
before update on public.approval_requests
for each row execute function private.set_updated_at();
create trigger approval_request_steps_set_updated_at
before update on public.approval_request_steps
for each row execute function private.set_updated_at();
create trigger approval_delegations_set_updated_at
before update on public.approval_delegations
for each row execute function private.set_updated_at();

alter table public.approval_definitions enable row level security;
alter table public.approval_definition_steps enable row level security;
alter table public.approval_requests enable row level security;
alter table public.approval_request_steps enable row level security;
alter table public.approval_actions enable row level security;
alter table public.approval_delegations enable row level security;

revoke all on public.approval_definitions from anon, authenticated;
revoke all on public.approval_definition_steps from anon, authenticated;
revoke all on public.approval_requests from anon, authenticated;
revoke all on public.approval_request_steps from anon, authenticated;
revoke all on public.approval_actions from anon, authenticated;
revoke all on public.approval_delegations from anon, authenticated;

grant select on public.approval_definitions to authenticated;
grant select on public.approval_definition_steps to authenticated;
grant select on public.approval_requests to authenticated;
grant select on public.approval_request_steps to authenticated;
grant select on public.approval_actions to authenticated;
grant select on public.approval_delegations to authenticated;
grant all on public.approval_definitions to service_role;
grant all on public.approval_definition_steps to service_role;
grant all on public.approval_requests to service_role;
grant all on public.approval_request_steps to service_role;
grant all on public.approval_actions to service_role;
grant all on public.approval_delegations to service_role;

create policy approval_definitions_select_authorized
on public.approval_definitions
for select to authenticated
using (
  private.is_active_member(organization_id)
  and (
    private.has_permission(organization_id, 'approvals.definition.view')
    or private.has_permission(organization_id, 'approvals.definition.manage_settings')
  )
);

create policy approval_definition_steps_select_authorized
on public.approval_definition_steps
for select to authenticated
using (
  exists (
    select 1 from public.approval_definitions as definition
    where definition.id = definition_id
      and (
        private.has_permission(definition.organization_id, 'approvals.definition.view')
        or private.has_permission(definition.organization_id, 'approvals.definition.manage_settings')
      )
  )
);

create policy approval_requests_select_visible
on public.approval_requests
for select to authenticated
using (private.approval_request_visible(id));

create policy approval_request_steps_select_visible
on public.approval_request_steps
for select to authenticated
using (private.approval_request_visible(request_id));

create policy approval_actions_select_visible
on public.approval_actions
for select to authenticated
using (private.approval_request_visible(request_id));

create policy approval_delegations_select_involved
on public.approval_delegations
for select to authenticated
using (
  private.is_active_member(organization_id)
  and private.has_permission(organization_id, 'approvals.delegation.manage_settings')
  and (
    from_membership_id = private.current_membership_id(organization_id)
    or to_membership_id = private.current_membership_id(organization_id)
    or private.has_permission(organization_id, 'approvals.definition.manage_settings')
  )
);
