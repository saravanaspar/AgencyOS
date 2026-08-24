-- Transactional automation outbox, retryable n8n dispatch, and permission-aware AI evidence.

set lock_timeout = '10s';
set statement_timeout = '120s';

insert into public.permissions (module, resource, action, description, is_sensitive)
values
  ('automation', 'execution', 'retry', 'Retry dead-letter automation dispatches.', true),
  ('automation', 'ai_execution', 'view', 'View permission-aware AI execution and approval evidence.', true)
on conflict (module, resource, action) do update
set description = excluded.description, is_sensitive = excluded.is_sensitive;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select template.role_template_key, permission.id, 'organization'
from (values ('owner'), ('system_administrator'), ('operations_administrator')) as template(role_template_key)
join public.permissions as permission on permission.key in (
  'automation.execution.retry', 'automation.ai_execution.view'
)
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'auditor', permission.id, 'organization'
from public.permissions as permission
where permission.key = 'automation.ai_execution.view'
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

create table public.automation_domain_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_key text not null,
  source_module text not null,
  entity_type text not null,
  entity_id uuid not null,
  actor_membership_id uuid references public.memberships(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  occurred_at timestamptz not null default now(),
  routed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint automation_domain_events_key_valid check (event_key ~ '^[a-z][a-z0-9._-]{2,119}$'),
  constraint automation_domain_events_module_valid check (source_module ~ '^[a-z][a-z0-9_-]{1,39}$'),
  constraint automation_domain_events_entity_valid check (entity_type ~ '^[a-z][a-z0-9_-]{1,79}$'),
  constraint automation_domain_events_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint automation_domain_events_payload_bounded check (octet_length(payload::text) <= 16384),
  constraint automation_domain_events_idempotency_valid check (
    char_length(btrim(idempotency_key)) between 8 and 240
  ),
  unique (organization_id, idempotency_key)
);
create index automation_domain_events_unrouted_idx
  on public.automation_domain_events (created_at, id)
  where routed_at is null;
create index automation_domain_events_org_history_idx
  on public.automation_domain_events (organization_id, occurred_at desc, id desc);

create table public.automation_dispatches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_id uuid not null references public.automation_domain_events(id) on delete restrict,
  automation_id uuid not null references public.automation_definitions(id) on delete restrict,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  max_attempts integer not null default 8,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  lock_token uuid,
  delivered_at timestamptz,
  last_http_status integer,
  last_error_code text,
  last_error_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_dispatches_status_valid check (
    status in ('pending', 'processing', 'retry', 'delivered', 'dead_letter', 'cancelled')
  ),
  constraint automation_dispatches_attempt_valid check (
    attempt_count between 0 and 100 and max_attempts between 1 and 100 and attempt_count <= max_attempts
  ),
  constraint automation_dispatches_http_valid check (
    last_http_status is null or last_http_status between 100 and 599
  ),
  constraint automation_dispatches_error_bounded check (
    (last_error_code is null or char_length(last_error_code) <= 80)
    and (last_error_summary is null or char_length(last_error_summary) <= 1000)
  ),
  constraint automation_dispatches_delivery_consistent check (
    (status = 'delivered' and delivered_at is not null)
    or (status <> 'delivered' and delivered_at is null)
  ),
  unique (event_id, automation_id)
);
create index automation_dispatches_due_idx
  on public.automation_dispatches (available_at, created_at, id)
  where status in ('pending', 'retry');
create index automation_dispatches_org_history_idx
  on public.automation_dispatches (organization_id, created_at desc, id desc);
create index automation_dispatches_dead_letter_idx
  on public.automation_dispatches (organization_id, updated_at desc)
  where status = 'dead_letter';

create table public.automation_dispatch_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  dispatch_id uuid not null references public.automation_dispatches(id) on delete restrict,
  attempt_number integer not null,
  outcome text not null,
  request_hash text not null,
  response_hash text,
  http_status integer,
  error_code text,
  error_summary text,
  started_at timestamptz not null,
  completed_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint automation_dispatch_attempts_number_valid check (attempt_number between 1 and 100),
  constraint automation_dispatch_attempts_outcome_valid check (
    outcome in ('delivered', 'retry', 'dead_letter')
  ),
  constraint automation_dispatch_attempts_hash_valid check (
    request_hash ~ '^[a-f0-9]{64}$' and (response_hash is null or response_hash ~ '^[a-f0-9]{64}$')
  ),
  constraint automation_dispatch_attempts_http_valid check (
    http_status is null or http_status between 100 and 599
  ),
  constraint automation_dispatch_attempts_error_bounded check (
    (error_code is null or char_length(error_code) <= 80)
    and (error_summary is null or char_length(error_summary) <= 1000)
  ),
  constraint automation_dispatch_attempts_time_valid check (completed_at >= started_at),
  unique (dispatch_id, attempt_number)
);
create index automation_dispatch_attempts_history_idx
  on public.automation_dispatch_attempts (dispatch_id, attempt_number desc);

create table public.automation_ai_mutation_intents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requester_membership_id uuid not null references public.memberships(id) on delete restrict,
  tool_name text not null,
  arguments_hash text not null,
  argument_summary jsonb not null default '{}'::jsonb,
  approval_request_id uuid not null unique references public.approval_requests(id) on delete restrict,
  status text not null default 'pending_approval',
  execution_started_at timestamptz,
  executed_at timestamptz,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_ai_intents_tool_valid check (tool_name ~ '^agencyos\.[a-z0-9_.-]{3,160}$'),
  constraint automation_ai_intents_hash_valid check (arguments_hash ~ '^[a-f0-9]{64}$'),
  constraint automation_ai_intents_summary_object check (jsonb_typeof(argument_summary) = 'object'),
  constraint automation_ai_intents_summary_bounded check (octet_length(argument_summary::text) <= 8192),
  constraint automation_ai_intents_status_valid check (
    status in ('pending_approval', 'executing', 'executed', 'failed', 'cancelled')
  ),
  constraint automation_ai_intents_execution_consistent check (
    (status = 'executing' and execution_started_at is not null and executed_at is null)
    or (status = 'executed' and execution_started_at is not null and executed_at is not null)
    or (status in ('pending_approval', 'failed', 'cancelled'))
  ),
  constraint automation_ai_intents_failure_bounded check (
    failure_code is null or char_length(failure_code) <= 80
  )
);
create index automation_ai_intents_requester_idx
  on public.automation_ai_mutation_intents (organization_id, requester_membership_id, created_at desc);
create index automation_ai_intents_approval_idx
  on public.automation_ai_mutation_intents (approval_request_id)
  where approval_request_id is not null;

create table public.automation_ai_execution_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_membership_id uuid not null references public.memberships(id) on delete restrict,
  mutation_intent_id uuid references public.automation_ai_mutation_intents(id) on delete restrict,
  tool_name text not null,
  operation_mode text not null,
  status text not null,
  input_hash text not null,
  input_summary jsonb not null default '{}'::jsonb,
  output_summary jsonb not null default '{}'::jsonb,
  error_code text,
  started_at timestamptz not null,
  completed_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint automation_ai_events_tool_valid check (tool_name ~ '^agencyos\.[a-z0-9_.-]{3,160}$'),
  constraint automation_ai_events_mode_valid check (operation_mode in ('read', 'mutation', 'sensitive_mutation')),
  constraint automation_ai_events_status_valid check (
    status in ('started', 'approval_required', 'succeeded', 'failed')
  ),
  constraint automation_ai_events_hash_valid check (input_hash ~ '^[a-f0-9]{64}$'),
  constraint automation_ai_events_summaries_object check (
    jsonb_typeof(input_summary) = 'object' and jsonb_typeof(output_summary) = 'object'
  ),
  constraint automation_ai_events_summaries_bounded check (
    octet_length(input_summary::text) <= 8192 and octet_length(output_summary::text) <= 8192
  ),
  constraint automation_ai_events_error_bounded check (error_code is null or char_length(error_code) <= 80),
  constraint automation_ai_events_time_valid check (completed_at >= started_at)
);
create index automation_ai_events_org_history_idx
  on public.automation_ai_execution_events (organization_id, created_at desc, id desc);
create index automation_ai_events_actor_idx
  on public.automation_ai_execution_events (actor_membership_id, created_at desc);

create or replace function private.prevent_automation_append_only_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Automation event history is append-only.' using errcode = '42501';
end;
$$;

create or replace function private.validate_automation_domain_event_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.routed_at is null
     and new.routed_at is not null
     and new.id = old.id
     and new.organization_id = old.organization_id
     and new.event_key = old.event_key
     and new.source_module = old.source_module
     and new.entity_type = old.entity_type
     and new.entity_id = old.entity_id
     and new.actor_membership_id is not distinct from old.actor_membership_id
     and new.payload is not distinct from old.payload
     and new.idempotency_key = old.idempotency_key
     and new.occurred_at = old.occurred_at
     and new.created_at = old.created_at then
    return new;
  end if;
  raise exception 'Automation domain events are append-only after routing.' using errcode = '42501';
end;
$$;

create trigger automation_domain_events_no_update
before update on public.automation_domain_events
for each row execute function private.validate_automation_domain_event_update();
create trigger automation_domain_events_no_delete
before delete on public.automation_domain_events
for each row execute function private.prevent_automation_append_only_mutation();
create trigger automation_dispatch_attempts_no_update
before update on public.automation_dispatch_attempts
for each row execute function private.prevent_automation_append_only_mutation();
create trigger automation_dispatch_attempts_no_delete
before delete on public.automation_dispatch_attempts
for each row execute function private.prevent_automation_append_only_mutation();
create trigger automation_ai_execution_events_no_update
before update on public.automation_ai_execution_events
for each row execute function private.prevent_automation_append_only_mutation();
create trigger automation_ai_execution_events_no_delete
before delete on public.automation_ai_execution_events
for each row execute function private.prevent_automation_append_only_mutation();

create or replace function private.validate_automation_domain_event_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.actor_membership_id is not null and not exists (
    select 1 from public.memberships as membership
    where membership.id = new.actor_membership_id
      and membership.organization_id = new.organization_id
  ) then
    raise exception 'Automation event actor must belong to the organization.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger automation_domain_events_validate_tenant
before insert on public.automation_domain_events
for each row execute function private.validate_automation_domain_event_tenant();

create or replace function private.validate_automation_dispatch_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.automation_domain_events as event
    join public.automation_definitions as definition
      on definition.id = new.automation_id
    where event.id = new.event_id
      and event.organization_id = new.organization_id
      and definition.organization_id = new.organization_id
  ) then
    raise exception 'Automation dispatch references must belong to one organization.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger automation_dispatches_validate_tenant
before insert or update on public.automation_dispatches
for each row execute function private.validate_automation_dispatch_tenant();

create or replace function private.validate_automation_dispatch_attempt_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.automation_dispatches as dispatch
    where dispatch.id = new.dispatch_id and dispatch.organization_id = new.organization_id
  ) then
    raise exception 'Automation dispatch attempt must belong to the dispatch organization.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger automation_dispatch_attempts_validate_tenant
before insert on public.automation_dispatch_attempts
for each row execute function private.validate_automation_dispatch_attempt_tenant();

create or replace function private.validate_automation_ai_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.memberships as membership
    where membership.id = new.requester_membership_id
      and membership.organization_id = new.organization_id
  ) then
    raise exception 'AI mutation requester must belong to the organization.' using errcode = '23514';
  end if;
  if new.approval_request_id is not null and not exists (
    select 1 from public.approval_requests as request
    where request.id = new.approval_request_id
      and request.organization_id = new.organization_id
      and request.requester_membership_id = new.requester_membership_id
      and request.source_module = 'automation'
      and request.entity_type = 'ai_tool_call'
      and request.entity_id = new.id::text
  ) then
    raise exception 'AI mutation approval request is invalid.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger automation_ai_intents_validate_tenant
before insert or update on public.automation_ai_mutation_intents
for each row execute function private.validate_automation_ai_tenant();

create or replace function private.validate_automation_ai_event_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.memberships as membership
    where membership.id = new.actor_membership_id
      and membership.organization_id = new.organization_id
  ) then
    raise exception 'AI execution actor must belong to the organization.' using errcode = '23514';
  end if;
  if new.mutation_intent_id is not null and not exists (
    select 1 from public.automation_ai_mutation_intents as intent
    where intent.id = new.mutation_intent_id and intent.organization_id = new.organization_id
  ) then
    raise exception 'AI execution intent must belong to the organization.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger automation_ai_events_validate_tenant
before insert on public.automation_ai_execution_events
for each row execute function private.validate_automation_ai_event_tenant();

create or replace function private.emit_automation_domain_event(
  p_organization_id uuid,
  p_event_key text,
  p_source_module text,
  p_entity_type text,
  p_entity_id uuid,
  p_actor_membership_id uuid,
  p_payload jsonb,
  p_idempotency_key text,
  p_occurred_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_id uuid;
begin
  if jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object'
     or octet_length(coalesce(p_payload, '{}'::jsonb)::text) > 16384 then
    raise exception 'Automation event payload is invalid.' using errcode = '22023';
  end if;
  insert into public.automation_domain_events (
    organization_id, event_key, source_module, entity_type, entity_id,
    actor_membership_id, payload, idempotency_key, occurred_at
  ) values (
    p_organization_id, p_event_key, p_source_module, p_entity_type, p_entity_id,
    p_actor_membership_id, coalesce(p_payload, '{}'::jsonb), p_idempotency_key, p_occurred_at
  )
  on conflict (organization_id, idempotency_key) do update
    set idempotency_key = excluded.idempotency_key
  returning id into event_id;
  return event_id;
end;
$$;

create or replace function private.emit_lead_converted_automation_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'converted' and old.status <> 'converted' then
    perform private.emit_automation_domain_event(
      new.organization_id, 'crm.lead_converted', 'crm', 'lead', new.id,
      new.owner_membership_id,
      jsonb_build_object(
        'leadId', new.id, 'companyId', new.converted_company_id,
        'contactId', new.converted_contact_id, 'ownerMembershipId', new.owner_membership_id,
        'currency', new.currency, 'estimatedValue', new.estimated_value,
        'convertedAt', new.converted_at
      ),
      'crm.lead_converted:' || new.id::text,
      coalesce(new.converted_at, now())
    );
  end if;
  return new;
end;
$$;
create trigger crm_leads_emit_converted_automation
  after update of status on public.crm_leads
  for each row execute function private.emit_lead_converted_automation_event();

create or replace function private.emit_project_created_automation_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.emit_automation_domain_event(
    new.organization_id, 'projects.project_created', 'projects', 'project', new.id,
    new.created_by_membership_id,
    jsonb_build_object(
      'projectId', new.id, 'code', new.code, 'status', new.status,
      'ownerMembershipId', new.owner_membership_id, 'companyId', new.company_id,
      'startDate', new.start_date, 'dueDate', new.due_date
    ),
    'projects.project_created:' || new.id::text,
    new.created_at
  );
  return new;
end;
$$;
create trigger projects_emit_created_automation
  after insert on public.projects
  for each row execute function private.emit_project_created_automation_event();

create or replace function private.emit_invoice_automation_events()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.issued_at is not null and old.issued_at is null then
    perform private.emit_automation_domain_event(
      new.organization_id, 'finance.invoice_issued', 'finance', 'invoice', new.id,
      new.created_by_membership_id,
      jsonb_build_object(
        'invoiceId', new.id, 'invoiceNumber', new.invoice_number,
        'companyId', new.company_id, 'projectId', new.project_id,
        'issueDate', new.issue_date, 'dueDate', new.due_date,
        'currency', new.currency, 'totalMinor', new.total_minor
      ),
      'finance.invoice_issued:' || new.id::text,
      new.issued_at
    );
  end if;
  if new.status = 'overdue' and old.status <> 'overdue' then
    perform private.emit_automation_domain_event(
      new.organization_id, 'finance.invoice_overdue', 'finance', 'invoice', new.id,
      new.created_by_membership_id,
      jsonb_build_object(
        'invoiceId', new.id, 'invoiceNumber', new.invoice_number,
        'companyId', new.company_id, 'projectId', new.project_id,
        'dueDate', new.due_date, 'currency', new.currency,
        'balanceMinor', new.balance_minor
      ),
      'finance.invoice_overdue:' || new.id::text || ':' || coalesce(new.due_date::text, 'undated'),
      now()
    );
  end if;
  return new;
end;
$$;
create trigger finance_invoices_emit_automation
  after update of issued_at, status on public.finance_invoices
  for each row execute function private.emit_invoice_automation_events();

create or replace function private.emit_payment_received_automation_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.emit_automation_domain_event(
    new.organization_id, 'finance.payment_received', 'finance', 'payment', new.id,
    new.entered_by_membership_id,
    jsonb_build_object(
      'paymentId', new.id, 'companyId', new.company_id,
      'paymentDate', new.payment_date, 'currency', new.currency,
      'amountMinor', new.amount_minor, 'reconciliationStatus', new.reconciliation_status
    ),
    'finance.payment_received:' || new.id::text,
    new.created_at
  );
  return new;
end;
$$;
create trigger finance_payments_emit_received_automation
  after insert on public.finance_payments
  for each row execute function private.emit_payment_received_automation_event();

create or replace function private.emit_employee_lifecycle_automation_events()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.lifecycle_status = 'preboarding'
     and new.lifecycle_status in ('active', 'probation', 'confirmed') then
    perform private.emit_automation_domain_event(
      new.organization_id, 'hr.employee_onboarded', 'hr', 'employee', new.id,
      new.updated_by_membership_id,
      jsonb_build_object(
        'employeeId', new.id, 'membershipId', new.membership_id,
        'lifecycleStatus', new.lifecycle_status, 'joiningDate', new.joining_date,
        'designationId', new.designation_id
      ),
      'hr.employee_onboarded:' || new.id::text,
      now()
    );
  end if;
  if new.lifecycle_status = 'exited' and old.lifecycle_status <> 'exited' then
    perform private.emit_automation_domain_event(
      new.organization_id, 'hr.employee_offboarded', 'hr', 'employee', new.id,
      new.updated_by_membership_id,
      jsonb_build_object(
        'employeeId', new.id, 'membershipId', new.membership_id,
        'lifecycleStatus', new.lifecycle_status
      ),
      'hr.employee_offboarded:' || new.id::text,
      now()
    );
  end if;
  return new;
end;
$$;
create trigger hr_employee_profiles_emit_lifecycle_automation
  after update of lifecycle_status on public.hr_employee_profiles
  for each row execute function private.emit_employee_lifecycle_automation_events();

create or replace function private.emit_leave_approved_automation_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'approved' and old.status <> 'approved' then
    perform private.emit_automation_domain_event(
      new.organization_id, 'hr.leave_approved', 'hr', 'leave_request', new.id,
      new.requested_by_membership_id,
      jsonb_build_object(
        'leaveRequestId', new.id, 'membershipId', new.membership_id,
        'leaveTypeId', new.leave_type_id, 'startDate', new.start_date,
        'endDate', new.end_date, 'requestedDays', new.requested_days
      ),
      'hr.leave_approved:' || new.id::text,
      now()
    );
  end if;
  return new;
end;
$$;
create trigger hr_leave_requests_emit_approved_automation
  after update of status on public.hr_leave_requests
  for each row execute function private.emit_leave_approved_automation_event();

create or replace function private.emit_ticket_escalated_automation_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.priority = 'urgent' and old.priority <> 'urgent' then
    perform private.emit_automation_domain_event(
      new.organization_id, 'support.ticket_escalated', 'support', 'support_ticket', new.id,
      new.assigned_agent_membership_id,
      jsonb_build_object(
        'ticketId', new.id, 'ticketNumber', new.ticket_number,
        'status', new.status, 'priority', new.priority,
        'clientCompanyId', new.client_company_id,
        'assignedAgentMembershipId', new.assigned_agent_membership_id,
        'assignedTeamId', new.assigned_team_id,
        'resolutionDueAt', new.resolution_due_at
      ),
      'support.ticket_escalated:' || new.id::text || ':' || new.updated_at::text,
      now()
    );
  end if;
  return new;
end;
$$;
create trigger support_tickets_emit_escalated_automation
  after update of priority on public.support_tickets
  for each row execute function private.emit_ticket_escalated_automation_event();

create or replace function private.emit_asset_assigned_automation_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.emit_automation_domain_event(
    new.organization_id, 'assets.asset_assigned', 'assets', 'asset_assignment', new.id,
    new.assigned_by_membership_id,
    jsonb_build_object(
      'assignmentId', new.id, 'assetId', new.asset_id,
      'membershipId', new.membership_id, 'checkoutAt', new.checkout_at,
      'expectedReturnAt', new.expected_return_at, 'condition', new.checkout_condition
    ),
    'assets.asset_assigned:' || new.id::text,
    new.created_at
  );
  return new;
end;
$$;
create trigger asset_assignments_emit_assigned_automation
  after insert on public.asset_assignments
  for each row execute function private.emit_asset_assigned_automation_event();

alter table public.automation_domain_events enable row level security;
alter table public.automation_dispatches enable row level security;
alter table public.automation_dispatch_attempts enable row level security;
alter table public.automation_ai_mutation_intents enable row level security;
alter table public.automation_ai_execution_events enable row level security;

revoke all on public.automation_domain_events from anon, authenticated;
revoke all on public.automation_dispatches from anon;
revoke all on public.automation_dispatch_attempts from anon, authenticated;
revoke all on public.automation_ai_mutation_intents from anon, authenticated;
revoke all on public.automation_ai_execution_events from anon, authenticated;

grant select on public.automation_domain_events to authenticated;
grant select on public.automation_dispatches to authenticated;
grant select on public.automation_dispatch_attempts to authenticated;
grant select on public.automation_ai_mutation_intents to authenticated;
grant select on public.automation_ai_execution_events to authenticated;
grant all on public.automation_domain_events, public.automation_dispatches,
  public.automation_dispatch_attempts, public.automation_ai_mutation_intents,
  public.automation_ai_execution_events to service_role;

revoke all on function private.prevent_automation_append_only_mutation() from public, anon, authenticated;
revoke all on function private.validate_automation_domain_event_update() from public, anon, authenticated;
revoke all on function private.validate_automation_domain_event_tenant() from public, anon, authenticated;
revoke all on function private.emit_lead_converted_automation_event() from public, anon, authenticated;
revoke all on function private.emit_project_created_automation_event() from public, anon, authenticated;
revoke all on function private.emit_invoice_automation_events() from public, anon, authenticated;
revoke all on function private.emit_payment_received_automation_event() from public, anon, authenticated;
revoke all on function private.emit_employee_lifecycle_automation_events() from public, anon, authenticated;
revoke all on function private.emit_leave_approved_automation_event() from public, anon, authenticated;
revoke all on function private.emit_ticket_escalated_automation_event() from public, anon, authenticated;
revoke all on function private.emit_asset_assigned_automation_event() from public, anon, authenticated;
revoke all on function private.validate_automation_dispatch_tenant() from public, anon, authenticated;
revoke all on function private.validate_automation_dispatch_attempt_tenant() from public, anon, authenticated;
revoke all on function private.validate_automation_ai_tenant() from public, anon, authenticated;
revoke all on function private.validate_automation_ai_event_tenant() from public, anon, authenticated;
revoke all on function private.emit_automation_domain_event(uuid, text, text, text, uuid, uuid, jsonb, text, timestamptz) from public, anon, authenticated;
grant execute on function private.emit_automation_domain_event(uuid, text, text, text, uuid, uuid, jsonb, text, timestamptz) to service_role;

create policy automation_domain_events_select_authorized
on public.automation_domain_events for select to authenticated
using (private.has_permission(organization_id, 'automation.execution.view'));

create policy automation_dispatches_select_authorized
on public.automation_dispatches for select to authenticated
using (private.has_permission(organization_id, 'automation.execution.view'));
create policy automation_dispatch_attempts_select_authorized
on public.automation_dispatch_attempts for select to authenticated
using (private.has_permission(organization_id, 'automation.execution.view'));

create policy automation_ai_intents_select_authorized
on public.automation_ai_mutation_intents for select to authenticated
using (
  requester_membership_id = private.current_membership_id(organization_id)
  or private.has_permission(organization_id, 'automation.ai_execution.view')
);

create policy automation_ai_events_select_authorized
on public.automation_ai_execution_events for select to authenticated
using (
  actor_membership_id = private.current_membership_id(organization_id)
  or private.has_permission(organization_id, 'automation.ai_execution.view')
);

comment on table public.automation_domain_events is
  'Append-only, transactionally emitted metadata events. No file contents, credentials, secrets, or private narrative payloads.';
comment on table public.automation_dispatches is
  'Per-workflow delivery state with bounded retry, backoff, dead-letter, and operator recovery.';
comment on table public.automation_ai_execution_events is
  'Redacted and bounded MCP execution evidence; raw prompts, private payloads, credentials, files, and full outputs are not stored.';
