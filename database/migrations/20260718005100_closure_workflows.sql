-- Closure workflows: deterministic Support triage, approval-backed Asset requests,
-- automatic Asset return requests, and approval-backed Vendor bills.

set lock_timeout = '10s';
set statement_timeout = '120s';

insert into public.permissions (module, resource, action, description, is_sensitive)
values
  ('support', 'routing_rule', 'manage', 'Manage deterministic Support categorization and priority rules.', true),
  ('assets', 'request', 'view', 'View Asset requests within the granted scope.', false),
  ('assets', 'request', 'create', 'Create Asset requests for the current employee.', false),
  ('assets', 'request', 'submit', 'Submit Asset requests to the shared Approval engine.', false),
  ('assets', 'request', 'manage', 'Manage and fulfill approved Asset requests.', true),
  ('assets', 'request', 'cancel', 'Cancel eligible Asset requests within the granted scope.', false),
  ('assets', 'return_request', 'view', 'View Asset return requests within the granted scope.', false),
  ('assets', 'return_request', 'acknowledge', 'Acknowledge an Asset return request assigned to the current employee.', false),
  ('assets', 'return_request', 'manage', 'Create, cancel, and complete Asset return requests.', true),
  ('vendors', 'bill', 'submit', 'Submit matched Vendor bills to the shared Approval engine.', true)
on conflict (module, resource, action) do update
set description = excluded.description, is_sensitive = excluded.is_sensitive;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'organization'
from public.role_templates role_template
cross join public.permissions permission
where permission.key = 'support.routing_rule.manage'
  and role_template.key in ('owner', 'system_administrator', 'operations_administrator', 'support_manager')
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'own'
from public.role_templates role_template
cross join public.permissions permission
where role_template.key in (
    'employee', 'team_lead', 'sales_manager', 'sales_executive', 'project_manager',
    'finance_manager', 'accountant', 'hr_manager', 'legal_manager', 'support_agent', 'support_manager'
  )
  and permission.key in (
    'assets.request.view', 'assets.request.create', 'assets.request.submit', 'assets.request.cancel',
    'assets.return_request.view', 'assets.return_request.acknowledge'
  )
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'organization'
from public.role_templates role_template
cross join public.permissions permission
where role_template.key in ('owner', 'system_administrator', 'operations_administrator', 'hr_manager')
  and permission.key in (
    'assets.request.view', 'assets.request.create', 'assets.request.submit',
    'assets.request.manage', 'assets.request.cancel',
    'assets.return_request.view', 'assets.return_request.acknowledge', 'assets.return_request.manage'
  )
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

-- Every workforce role keeps Employee-equivalent Asset self-service even when
-- the organization assigns a specialist role as the member's only template.
insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'own'
from public.role_templates role_template
cross join public.permissions permission
where role_template.key in (
    'sales_manager', 'sales_executive', 'project_manager', 'finance_manager',
    'accountant', 'legal_manager', 'support_agent', 'support_manager'
  )
  and permission.key in (
    'assets.workspace.view', 'assets.asset.view', 'assets.asset.acknowledge'
  )
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'organization'
from public.role_templates role_template
cross join public.permissions permission
where role_template.key in ('owner', 'system_administrator', 'operations_administrator', 'finance_manager', 'accountant')
  and permission.key = 'vendors.bill.submit'
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_permissions (role_id, permission_id, scope, conditions)
select role.id, template_permission.permission_id, template_permission.scope,
  template_permission.conditions
from public.roles role
join public.role_template_permissions template_permission
  on template_permission.role_template_key = role.template_key
join public.permissions permission on permission.id = template_permission.permission_id
where permission.key in (
  'support.routing_rule.manage',
  'assets.request.view', 'assets.request.create', 'assets.request.submit',
  'assets.request.manage', 'assets.request.cancel',
  'assets.return_request.view', 'assets.return_request.acknowledge', 'assets.return_request.manage',
  'vendors.bill.submit',
  'assets.workspace.view', 'assets.asset.view', 'assets.asset.acknowledge'
)
on conflict (role_id, permission_id) do update
set scope = excluded.scope, conditions = excluded.conditions, updated_at = now();

create table public.support_ticket_routing_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  position integer not null default 100,
  keywords text[] not null,
  category_id uuid not null references public.support_ticket_categories(id) on delete cascade,
  priority text not null,
  status text not null default 'active',
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint support_routing_rules_name_valid check (char_length(btrim(name)) between 2 and 100),
  constraint support_routing_rules_position_valid check (position between 1 and 10000),
  constraint support_routing_rules_keywords_valid check (cardinality(keywords) between 1 and 30),
  constraint support_routing_rules_priority_valid check (priority in ('low', 'normal', 'high', 'urgent')),
  constraint support_routing_rules_status_valid check (status in ('active', 'inactive')),
  unique (organization_id, name)
);
create index support_ticket_routing_rules_match_idx
  on public.support_ticket_routing_rules (organization_id, status, position, id);

alter table public.support_tickets
  add column triage_source text not null default 'manual',
  add column triage_rule_id uuid references public.support_ticket_routing_rules(id) on delete set null,
  add column triaged_at timestamptz,
  add column triage_explanation text;
alter table public.support_tickets
  add constraint support_tickets_triage_source_valid check (triage_source in ('manual', 'rule', 'fallback')),
  add constraint support_tickets_triage_explanation_valid check (
    triage_explanation is null or char_length(btrim(triage_explanation)) between 2 and 300
  );

create table public.asset_request_counters (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  next_number bigint not null default 1,
  updated_at timestamptz not null default now(),
  constraint asset_request_counters_positive check (next_number > 0)
);

create table public.asset_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_number bigint not null,
  requester_membership_id uuid not null references public.memberships(id) on delete restrict,
  category_id uuid not null references public.asset_categories(id) on delete restrict,
  request_type text not null default 'new_asset',
  title text not null,
  justification text not null,
  needed_by_date date,
  expected_return_at timestamptz,
  status text not null default 'draft',
  approval_request_id uuid unique references public.approval_requests(id) on delete set null,
  fulfilled_asset_id uuid references public.assets(id) on delete set null,
  fulfilled_assignment_id uuid references public.asset_assignments(id) on delete set null,
  fulfilled_at timestamptz,
  cancelled_at timestamptz,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  updated_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asset_requests_number_positive check (request_number > 0),
  constraint asset_requests_type_valid check (request_type in ('new_asset', 'replacement', 'temporary')),
  constraint asset_requests_title_valid check (char_length(btrim(title)) between 3 and 180),
  constraint asset_requests_justification_valid check (char_length(btrim(justification)) between 10 and 4000),
  constraint asset_requests_status_valid check (
    status in ('draft', 'pending_approval', 'approved', 'revision_requested', 'rejected', 'fulfilled', 'cancelled')
  ),
  constraint asset_requests_fulfillment_valid check (
    (status = 'fulfilled' and fulfilled_asset_id is not null and fulfilled_assignment_id is not null and fulfilled_at is not null)
    or status <> 'fulfilled'
  ),
  constraint asset_requests_cancelled_valid check (
    (status = 'cancelled' and cancelled_at is not null) or status <> 'cancelled'
  ),
  unique (organization_id, request_number)
);
create index asset_requests_workspace_idx
  on public.asset_requests (organization_id, status, needed_by_date, updated_at desc);
create index asset_requests_requester_idx
  on public.asset_requests (organization_id, requester_membership_id, created_at desc);

create table public.asset_return_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete restrict,
  assignment_id uuid not null references public.asset_assignments(id) on delete restrict,
  membership_id uuid not null references public.memberships(id) on delete restrict,
  reason text not null,
  due_at timestamptz not null,
  status text not null default 'pending',
  source_offboarding_plan_id uuid references public.hr_offboarding_plans(id) on delete set null,
  requested_by_membership_id uuid references public.memberships(id) on delete set null,
  acknowledged_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asset_return_requests_reason_valid check (reason in ('offboarding', 'transfer', 'manual', 'expected_return')),
  constraint asset_return_requests_status_valid check (status in ('pending', 'acknowledged', 'completed', 'cancelled', 'overdue')),
  constraint asset_return_requests_notes_valid check (notes is null or char_length(btrim(notes)) between 2 and 2000),
  constraint asset_return_requests_completion_valid check (
    (status = 'completed' and completed_at is not null)
    or (status = 'cancelled' and cancelled_at is not null)
    or status not in ('completed', 'cancelled')
  )
);
create unique index asset_return_requests_active_assignment_idx
  on public.asset_return_requests (assignment_id)
  where status in ('pending', 'acknowledged', 'overdue');
create index asset_return_requests_workspace_idx
  on public.asset_return_requests (organization_id, status, due_at);
create index asset_return_requests_member_idx
  on public.asset_return_requests (organization_id, membership_id, due_at);

alter table public.procurement_vendor_bills
  add column approval_request_id uuid unique references public.approval_requests(id) on delete set null;
alter table public.procurement_vendor_bills drop constraint procurement_bills_status_valid;
alter table public.procurement_vendor_bills
  add constraint procurement_bills_status_valid check (
    status in (
      'received', 'matched', 'pending_approval', 'approved', 'revision_requested',
      'rejected', 'disputed', 'partially_paid', 'paid', 'void'
    )
  );

create or replace function private.validate_support_routing_rule_tenant()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.support_ticket_categories category
    where category.id = new.category_id and category.organization_id = new.organization_id
  ) or not exists (
    select 1 from public.memberships membership
    where membership.id = new.created_by_membership_id
      and membership.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Support routing rule must remain inside one organization';
  end if;
  if exists (
    select 1 from unnest(new.keywords) keyword
    where char_length(btrim(keyword)) < 2 or char_length(btrim(keyword)) > 60
  ) then
    raise exception using errcode = '23514', message = 'Support routing keywords must be 2 to 60 characters';
  end if;
  new.keywords := array(
    select distinct lower(btrim(keyword)) from unnest(new.keywords) keyword order by 1
  );
  return new;
end;
$$;

create or replace function private.apply_support_ticket_automatic_triage()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_rule public.support_ticket_routing_rules%rowtype;
  v_category public.support_ticket_categories%rowtype;
  v_search text := lower(coalesce(new.subject, '') || ' ' || coalesce(new.description, ''));
begin
  if new.category_id is not null then
    new.triage_source := 'manual';
    new.triage_rule_id := null;
    new.triaged_at := coalesce(new.triaged_at, now());
    new.triage_explanation := coalesce(new.triage_explanation, 'Category and priority selected manually.');
    return new;
  end if;

  select rule.* into v_rule
  from public.support_ticket_routing_rules rule
  where rule.organization_id = new.organization_id
    and rule.status = 'active'
    and exists (
      select 1 from public.support_ticket_categories category
      where category.id = rule.category_id and category.status = 'active'
    )
    and exists (
      select 1 from unnest(rule.keywords) keyword
      where position(lower(keyword) in v_search) > 0
    )
  order by rule.position, rule.id
  limit 1;

  if v_rule.id is not null then
    new.category_id := v_rule.category_id;
    new.priority := v_rule.priority;
    new.triage_source := 'rule';
    new.triage_rule_id := v_rule.id;
    new.triaged_at := now();
    new.triage_explanation := 'Matched routing rule: ' || v_rule.name;
    new.first_response_due_at := now() + private.support_ticket_sla_minutes(new.priority, 'first_response') * interval '1 minute';
    new.resolution_due_at := now() + private.support_ticket_sla_minutes(new.priority, 'resolution') * interval '1 minute';
    return new;
  end if;

  select category.* into v_category
  from public.support_ticket_categories category
  where category.organization_id = new.organization_id and category.status = 'active'
  order by case when category.name = 'General enquiry' then 0 else 1 end, category.name
  limit 1;

  if v_category.id is not null then
    new.category_id := v_category.id;
    new.priority := v_category.default_priority;
    new.triage_source := 'fallback';
    new.triage_rule_id := null;
    new.triaged_at := now();
    new.triage_explanation := 'No routing rule matched; active category default applied.';
    new.first_response_due_at := now() + private.support_ticket_sla_minutes(new.priority, 'first_response') * interval '1 minute';
    new.resolution_due_at := now() + private.support_ticket_sla_minutes(new.priority, 'resolution') * interval '1 minute';
  end if;
  return new;
end;
$$;

create or replace function private.validate_asset_request_tenant()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.memberships membership
    where membership.id = new.requester_membership_id
      and membership.organization_id = new.organization_id
  ) or not exists (
    select 1 from public.asset_categories category
    where category.id = new.category_id and category.organization_id = new.organization_id
  ) or not exists (
    select 1 from public.memberships membership
    where membership.id = new.created_by_membership_id
      and membership.organization_id = new.organization_id
  ) or not exists (
    select 1 from public.memberships membership
    where membership.id = new.updated_by_membership_id
      and membership.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Asset request must remain inside one organization';
  end if;
  if new.approval_request_id is not null and not exists (
    select 1 from public.approval_requests approval
    where approval.id = new.approval_request_id
      and approval.organization_id = new.organization_id
      and approval.source_module = 'assets'
      and approval.entity_type = 'asset_request'
      and approval.entity_id = new.id::text
  ) then
    raise exception using errcode = '23514', message = 'Asset request approval must match the request';
  end if;
  if new.fulfilled_asset_id is not null and not exists (
    select 1 from public.assets asset
    where asset.id = new.fulfilled_asset_id and asset.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Fulfilled Asset must match the request organization';
  end if;
  if new.fulfilled_assignment_id is not null and not exists (
    select 1 from public.asset_assignments assignment
    where assignment.id = new.fulfilled_assignment_id
      and assignment.organization_id = new.organization_id
      and assignment.asset_id = new.fulfilled_asset_id
      and assignment.membership_id = new.requester_membership_id
  ) then
    raise exception using errcode = '23514', message = 'Fulfilled assignment must match the request';
  end if;
  return new;
end;
$$;

create or replace function private.validate_asset_return_request_tenant()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.asset_assignments assignment
    where assignment.id = new.assignment_id
      and assignment.organization_id = new.organization_id
      and assignment.asset_id = new.asset_id
      and assignment.membership_id = new.membership_id
  ) then
    raise exception using errcode = '23514', message = 'Asset return request must match an assignment in the organization';
  end if;
  if new.source_offboarding_plan_id is not null and not exists (
    select 1 from public.hr_offboarding_plans plan
    where plan.id = new.source_offboarding_plan_id
      and plan.organization_id = new.organization_id
      and plan.membership_id = new.membership_id
  ) then
    raise exception using errcode = '23514', message = 'Offboarding source must match the return request';
  end if;
  if new.requested_by_membership_id is not null and not exists (
    select 1 from public.memberships membership
    where membership.id = new.requested_by_membership_id
      and membership.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Return-request actor must match the organization';
  end if;
  return new;
end;
$$;

create or replace function private.asset_request_membership_access_allowed(
  p_request_id uuid,
  p_membership_id uuid,
  p_permission_key text
)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_request public.asset_requests%rowtype;
  v_scope text;
begin
  select * into v_request from public.asset_requests where id = p_request_id;
  if v_request.id is null then return false; end if;
  v_scope := private.membership_effective_permission_scope(p_membership_id, p_permission_key);
  if v_scope is null then return false; end if;
  if v_scope = 'organization' then return true; end if;
  return private.crm_scope_allows_membership(
    p_membership_id, v_scope, v_request.requester_membership_id, v_request.created_by_membership_id
  );
end;
$$;

create or replace function private.asset_return_request_membership_access_allowed(
  p_return_request_id uuid,
  p_membership_id uuid,
  p_permission_key text
)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_request public.asset_return_requests%rowtype;
  v_scope text;
begin
  select * into v_request from public.asset_return_requests where id = p_return_request_id;
  if v_request.id is null then return false; end if;
  v_scope := private.membership_effective_permission_scope(p_membership_id, p_permission_key);
  if v_scope is null then return false; end if;
  if v_scope = 'organization' then return true; end if;
  return private.crm_scope_allows_membership(
    p_membership_id, v_scope, v_request.membership_id, v_request.requested_by_membership_id
  );
end;
$$;

create or replace function private.create_asset_return_requests_for_member(
  p_organization_id uuid,
  p_membership_id uuid,
  p_reason text,
  p_due_at timestamptz,
  p_offboarding_plan_id uuid,
  p_requested_by_membership_id uuid
)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  if p_reason not in ('offboarding', 'transfer', 'manual', 'expected_return') then
    raise exception using errcode = '22023', message = 'Unsupported Asset return reason';
  end if;
  insert into public.asset_return_requests (
    organization_id, asset_id, assignment_id, membership_id, reason, due_at,
    source_offboarding_plan_id, requested_by_membership_id
  )
  select assignment.organization_id, assignment.asset_id, assignment.id,
    assignment.membership_id, p_reason, p_due_at, p_offboarding_plan_id,
    p_requested_by_membership_id
  from public.asset_assignments assignment
  where assignment.organization_id = p_organization_id
    and assignment.membership_id = p_membership_id
    and assignment.returned_at is null
    and not exists (
      select 1 from public.asset_return_requests existing
      where existing.assignment_id = assignment.id
        and existing.status in ('pending', 'acknowledged', 'overdue')
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


create or replace function private.record_asset_return_request_creation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_actor_user_id uuid;
begin
  if new.requested_by_membership_id is not null then
    select membership.user_id into v_actor_user_id
    from public.memberships membership where membership.id = new.requested_by_membership_id;
  end if;
  insert into public.notifications (
    organization_id, recipient_membership_id, category, severity, title, message,
    deep_link, source_module, source_entity_type, source_entity_id, dedupe_key,
    metadata, created_by_membership_id
  ) values (
    new.organization_id, new.membership_id, 'asset_return', 'warning',
    'Asset return requested',
    'Review and acknowledge the Asset return request before the due date.',
    '/assets', 'assets', 'asset_return_request', new.id::text,
    'asset-return-request:' || new.id::text,
    jsonb_build_object('reason', new.reason, 'dueAt', new.due_at),
    new.requested_by_membership_id
  );
  insert into public.asset_events (
    organization_id, asset_id, event_type, actor_membership_id, details
  ) values (
    new.organization_id, new.asset_id, 'assets.return_requested',
    new.requested_by_membership_id,
    jsonb_build_object('returnRequestId', new.id, 'reason', new.reason, 'dueAt', new.due_at)
  );
  insert into public.audit_events (
    organization_id, actor_user_id, actor_type, action, entity_type, entity_id, source,
    after_state, changed_fields, metadata
  ) values (
    new.organization_id, v_actor_user_id,
    case when v_actor_user_id is null then 'system' else 'user' end,
    'assets.return_request.created', 'asset_return_request', new.id::text, 'database_trigger',
    jsonb_build_object('assetId', new.asset_id, 'membershipId', new.membership_id,
      'reason', new.reason, 'dueAt', new.due_at),
    array['return_request'], jsonb_build_object('sourceOffboardingPlanId', new.source_offboarding_plan_id)
  );
  return new;
end;
$$;

create or replace function private.seed_offboarding_asset_return_requests()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.create_asset_return_requests_for_member(
    new.organization_id,
    new.membership_id,
    'offboarding',
    (new.last_working_date::timestamptz + interval '17 hours'),
    new.id,
    new.created_by_membership_id
  );
  return new;
end;
$$;

create or replace function private.sync_offboarding_asset_return_requests()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_return record;
  v_actor_user_id uuid;
begin
  select membership.user_id into v_actor_user_id
  from public.memberships membership where membership.id = new.updated_by_membership_id;

  if new.status = 'cancelled' and old.status <> 'cancelled' then
    for v_return in
      update public.asset_return_requests
      set status = 'cancelled', cancelled_at = now(), updated_at = now()
      where source_offboarding_plan_id = new.id
        and status in ('pending', 'acknowledged', 'overdue')
      returning id, asset_id
    loop
      insert into public.asset_events (
        organization_id, asset_id, event_type, actor_membership_id, details
      ) values (
        new.organization_id, v_return.asset_id, 'assets.return_request_cancelled',
        new.updated_by_membership_id,
        jsonb_build_object('returnRequestId', v_return.id, 'sourceOffboardingPlanId', new.id)
      );
      insert into public.audit_events (
        organization_id, actor_user_id, actor_type, action, entity_type, entity_id,
        source, after_state, changed_fields, metadata
      ) values (
        new.organization_id, v_actor_user_id, 'user', 'assets.return_request.cancelled',
        'asset_return_request', v_return.id::text, 'database_trigger',
        jsonb_build_object('status', 'cancelled'), array['status', 'cancelledAt'],
        jsonb_build_object('sourceOffboardingPlanId', new.id)
      );
    end loop;
  elsif new.last_working_date is distinct from old.last_working_date then
    for v_return in
      update public.asset_return_requests
      set due_at = new.last_working_date::timestamptz + interval '17 hours', updated_at = now()
      where source_offboarding_plan_id = new.id
        and status in ('pending', 'acknowledged', 'overdue')
      returning id, asset_id, due_at
    loop
      insert into public.asset_events (
        organization_id, asset_id, event_type, actor_membership_id, details
      ) values (
        new.organization_id, v_return.asset_id, 'assets.return_request_rescheduled',
        new.updated_by_membership_id,
        jsonb_build_object('returnRequestId', v_return.id, 'dueAt', v_return.due_at)
      );
      insert into public.audit_events (
        organization_id, actor_user_id, actor_type, action, entity_type, entity_id,
        source, after_state, changed_fields, metadata
      ) values (
        new.organization_id, v_actor_user_id, 'user', 'assets.return_request.rescheduled',
        'asset_return_request', v_return.id::text, 'database_trigger',
        jsonb_build_object('dueAt', v_return.due_at), array['dueAt'],
        jsonb_build_object('sourceOffboardingPlanId', new.id)
      );
    end loop;
  end if;
  return new;
end;
$$;

create or replace function private.seed_transfer_asset_return_requests()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'active' and new.status = 'active'
    and (
      (old.department_id is not null and new.department_id is distinct from old.department_id)
      or (old.manager_membership_id is not null and new.manager_membership_id is distinct from old.manager_membership_id)
    ) then
    perform private.create_asset_return_requests_for_member(
      new.organization_id, new.id, 'transfer', now() + interval '7 days', null, null
    );
  end if;
  return new;
end;
$$;

create or replace function private.apply_asset_request_approval_result()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.source_module <> 'assets' or new.entity_type <> 'asset_request'
    or new.entity_id is null or old.status = new.status then return new; end if;
  if new.status = 'approved' then
    update public.asset_requests
    set status = 'approved', approval_request_id = new.id, updated_at = now()
    where id = new.entity_id::uuid and organization_id = new.organization_id
      and status = 'pending_approval';
  elsif new.status = 'revision_requested' then
    update public.asset_requests
    set status = 'revision_requested', approval_request_id = new.id, updated_at = now()
    where id = new.entity_id::uuid and organization_id = new.organization_id
      and status = 'pending_approval';
  elsif new.status = 'rejected' then
    update public.asset_requests
    set status = 'rejected', approval_request_id = new.id, updated_at = now()
    where id = new.entity_id::uuid and organization_id = new.organization_id
      and status = 'pending_approval';
  elsif new.status in ('cancelled', 'expired', 'invalidated') then
    update public.asset_requests
    set status = 'draft', approval_request_id = new.id, updated_at = now()
    where id = new.entity_id::uuid and organization_id = new.organization_id
      and status = 'pending_approval';
  end if;
  return new;
end;
$$;

create or replace function private.validate_vendor_bill_approval()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.approval_request_id is not null and not exists (
    select 1 from public.approval_requests approval
    where approval.id = new.approval_request_id
      and approval.organization_id = new.organization_id
      and approval.source_module = 'vendors'
      and approval.entity_type = 'vendor_bill'
      and approval.entity_id = new.id::text
  ) then
    raise exception using errcode = '23514', message = 'Vendor-bill approval must match the bill';
  end if;
  return new;
end;
$$;

create or replace function private.apply_vendor_bill_approval_result()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_changed integer := 0;
begin
  if new.source_module <> 'vendors' or new.entity_type <> 'vendor_bill'
    or new.entity_id is null or old.status = new.status then return new; end if;
  if new.status = 'approved' then
    update public.procurement_vendor_bills
    set status = 'approved', approval_request_id = new.id,
      approved_at = coalesce(approved_at, now()), updated_at = now()
    where id = new.entity_id::uuid and organization_id = new.organization_id
      and status = 'pending_approval';
  elsif new.status = 'revision_requested' then
    update public.procurement_vendor_bills
    set status = 'revision_requested', approval_request_id = new.id, updated_at = now()
    where id = new.entity_id::uuid and organization_id = new.organization_id
      and status = 'pending_approval';
  elsif new.status = 'rejected' then
    update public.procurement_vendor_bills
    set status = 'rejected', approval_request_id = new.id, updated_at = now()
    where id = new.entity_id::uuid and organization_id = new.organization_id
      and status = 'pending_approval';
  elsif new.status in ('cancelled', 'expired', 'invalidated') then
    update public.procurement_vendor_bills
    set status = case when match_status = 'matched' then 'matched' else 'received' end,
      approval_request_id = new.id, updated_at = now()
    where id = new.entity_id::uuid and organization_id = new.organization_id
      and status = 'pending_approval';
  end if;
  get diagnostics v_changed = row_count;
  if v_changed > 0 then
    insert into public.procurement_events (
      organization_id, vendor_bill_id, event_type, details
    ) values (
      new.organization_id, new.entity_id::uuid,
      'procurement.bill_approval_' || new.status,
      jsonb_build_object('approvalRequestId', new.id, 'status', new.status)
    );
  end if;
  return new;
end;
$$;

create trigger support_ticket_routing_rules_set_updated_at
before update on public.support_ticket_routing_rules
for each row execute function private.set_updated_at();
create trigger support_ticket_routing_rules_validate_tenant
before insert or update on public.support_ticket_routing_rules
for each row execute function private.validate_support_routing_rule_tenant();
create trigger support_tickets_automatic_triage
before insert on public.support_tickets
for each row execute function private.apply_support_ticket_automatic_triage();

create trigger asset_requests_set_updated_at
before update on public.asset_requests
for each row execute function private.set_updated_at();
create trigger asset_requests_validate_tenant
before insert or update on public.asset_requests
for each row execute function private.validate_asset_request_tenant();
create trigger asset_return_requests_set_updated_at
before update on public.asset_return_requests
for each row execute function private.set_updated_at();
create trigger asset_return_requests_validate_tenant
before insert or update on public.asset_return_requests
for each row execute function private.validate_asset_return_request_tenant();
create trigger asset_return_requests_record_creation
after insert on public.asset_return_requests
for each row execute function private.record_asset_return_request_creation();
create trigger asset_request_approval_result
after update of status on public.approval_requests
for each row execute function private.apply_asset_request_approval_result();
create trigger hr_offboarding_asset_return_requests
after insert on public.hr_offboarding_plans
for each row execute function private.seed_offboarding_asset_return_requests();
create trigger hr_offboarding_sync_asset_return_requests
after update of status, last_working_date on public.hr_offboarding_plans
for each row execute function private.sync_offboarding_asset_return_requests();
create trigger memberships_transfer_asset_return_requests
after update of department_id, manager_membership_id on public.memberships
for each row execute function private.seed_transfer_asset_return_requests();

create trigger procurement_vendor_bills_validate_approval
before insert or update on public.procurement_vendor_bills
for each row execute function private.validate_vendor_bill_approval();
create trigger vendor_bill_approval_result
after update of status on public.approval_requests
for each row execute function private.apply_vendor_bill_approval_result();

alter table public.support_ticket_routing_rules enable row level security;
alter table public.asset_request_counters enable row level security;
alter table public.asset_requests enable row level security;
alter table public.asset_return_requests enable row level security;

revoke all on public.support_ticket_routing_rules from public, anon;
revoke all on public.asset_request_counters from public, anon, authenticated;
revoke all on public.asset_requests from public, anon;
revoke all on public.asset_return_requests from public, anon;

grant select on public.support_ticket_routing_rules to authenticated;
grant select on public.asset_requests to authenticated;
grant select on public.asset_return_requests to authenticated;
grant all on public.support_ticket_routing_rules, public.asset_request_counters,
  public.asset_requests, public.asset_return_requests to service_role;

create policy support_ticket_routing_rules_select on public.support_ticket_routing_rules
for select to authenticated using (private.has_permission(organization_id, 'support.workspace.view'));
create policy asset_requests_select on public.asset_requests
for select to authenticated using (
  private.asset_request_membership_access_allowed(id, private.current_membership_id(organization_id), 'assets.request.view')
);
create policy asset_return_requests_select on public.asset_return_requests
for select to authenticated using (
  private.asset_return_request_membership_access_allowed(id, private.current_membership_id(organization_id), 'assets.return_request.view')
);

revoke all on function private.validate_support_routing_rule_tenant() from public, anon, authenticated;
revoke all on function private.apply_support_ticket_automatic_triage() from public, anon, authenticated;
revoke all on function private.validate_asset_request_tenant() from public, anon, authenticated;
revoke all on function private.validate_asset_return_request_tenant() from public, anon, authenticated;
revoke all on function private.asset_request_membership_access_allowed(uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.asset_return_request_membership_access_allowed(uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.create_asset_return_requests_for_member(uuid, uuid, text, timestamptz, uuid, uuid) from public, anon, authenticated;
revoke all on function private.record_asset_return_request_creation() from public, anon, authenticated;
revoke all on function private.seed_offboarding_asset_return_requests() from public, anon, authenticated;
revoke all on function private.sync_offboarding_asset_return_requests() from public, anon, authenticated;
revoke all on function private.seed_transfer_asset_return_requests() from public, anon, authenticated;
revoke all on function private.apply_asset_request_approval_result() from public, anon, authenticated;
revoke all on function private.validate_vendor_bill_approval() from public, anon, authenticated;
revoke all on function private.apply_vendor_bill_approval_result() from public, anon, authenticated;
grant execute on function private.asset_request_membership_access_allowed(uuid, uuid, text) to service_role;
grant execute on function private.asset_return_request_membership_access_allowed(uuid, uuid, text) to service_role;

insert into public.support_ticket_routing_rules (
  organization_id, name, position, keywords, category_id, priority, created_by_membership_id
)
select organization.id, seed.name, seed.position, seed.keywords, category.id,
  seed.priority, actor.id
from public.organizations organization
join lateral (
  select membership.id from public.memberships membership
  where membership.organization_id = organization.id and membership.status = 'active'
  order by membership.created_at, membership.id limit 1
) actor on true
join lateral (values
  ('Service incident', 10, array['outage', 'down', 'unavailable', 'service interruption', 'production error']::text[], 'Incident', 'high'),
  ('Urgent access incident', 5, array['security incident', 'account locked', 'cannot log in', 'access revoked']::text[], 'Incident', 'urgent'),
  ('Billing enquiry', 20, array['invoice', 'payment', 'billing', 'refund', 'estimate', 'credit note']::text[], 'Billing', 'normal'),
  ('Change request', 30, array['change request', 'feature request', 'modify', 'enhancement', 'update requested']::text[], 'Change request', 'normal')
) seed(name, position, keywords, category_name, priority) on true
join public.support_ticket_categories category
  on category.organization_id = organization.id and category.name = seed.category_name
on conflict (organization_id, name) do nothing;
