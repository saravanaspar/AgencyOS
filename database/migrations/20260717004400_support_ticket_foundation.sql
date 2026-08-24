-- Support ticket foundation. Reuses CRM clients/contacts, Projects, Documents,
-- Notifications, memberships, permission scopes, and Audit rather than duplicating them.

set lock_timeout = '10s';
set statement_timeout = '120s';

insert into public.permissions (module, resource, action, description, is_sensitive)
values
  ('support', 'ticket', 'view', 'View support tickets within the granted scope.', false),
  ('support', 'ticket', 'create', 'Create support tickets for authorized clients and projects.', false),
  ('support', 'ticket', 'update', 'Update ticket classification, priority, due date, and linked records.', false),
  ('support', 'ticket', 'assign', 'Assign support agents and teams.', true),
  ('support', 'ticket', 'reply', 'Add public ticket replies.', false),
  ('support', 'ticket', 'internal_note', 'Read and add internal support notes.', true),
  ('support', 'ticket', 'manage_watchers', 'Add and remove ticket watchers.', false),
  ('support', 'ticket', 'resolve', 'Resolve tickets and record the resolution.', true),
  ('support', 'ticket', 'close', 'Close resolved tickets and record satisfaction.', false),
  ('support', 'ticket', 'reopen', 'Reopen resolved or closed tickets.', false),
  ('support', 'category', 'manage', 'Manage support ticket categories.', true)
on conflict (module, resource, action) do update
set description = excluded.description, is_sensitive = excluded.is_sensitive;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'organization'
from public.role_templates as role_template
cross join public.permissions as permission
where permission.module = 'support'
  and role_template.key in ('owner', 'system_administrator', 'operations_administrator', 'support_manager')
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'support_agent', permission.id,
  case when permission.key in ('support.ticket.create', 'support.workspace.view') then 'organization'
       else 'assigned_or_created' end
from public.permissions as permission
where permission.key in (
  'support.workspace.view', 'support.ticket.view', 'support.ticket.create',
  'support.ticket.update', 'support.ticket.reply', 'support.ticket.internal_note',
  'support.ticket.manage_watchers', 'support.ticket.resolve', 'support.ticket.reopen'
)
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'own'
from public.role_templates as role_template
cross join public.permissions as permission
where role_template.key in (
    'employee', 'team_lead', 'sales_manager', 'sales_executive', 'project_manager',
    'finance_manager', 'accountant', 'hr_manager', 'legal_manager'
  )
  and permission.key in (
    'support.workspace.view', 'support.ticket.view', 'support.ticket.create',
    'support.ticket.reply', 'support.ticket.close', 'support.ticket.reopen'
  )
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'auditor', permission.id, 'organization'
from public.permissions as permission
where permission.key in ('support.workspace.view', 'support.ticket.view')
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_permissions (role_id, permission_id, scope, conditions)
select role.id, template_permission.permission_id, template_permission.scope,
  template_permission.conditions
from public.roles as role
join public.role_template_permissions as template_permission
  on template_permission.role_template_key = role.template_key
join public.permissions as permission on permission.id = template_permission.permission_id
where permission.module = 'support'
on conflict (role_id, permission_id) do update
set scope = excluded.scope, conditions = excluded.conditions, updated_at = now();

create table public.support_ticket_counters (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  next_number bigint not null default 1,
  updated_at timestamptz not null default now(),
  constraint support_ticket_counters_positive check (next_number > 0)
);

create table public.support_ticket_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  default_priority text not null default 'normal',
  status text not null default 'active',
  created_by_membership_id uuid references public.memberships(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint support_ticket_categories_name_valid check (char_length(btrim(name)) between 2 and 80),
  constraint support_ticket_categories_description_valid check (
    description is null or char_length(btrim(description)) between 2 and 500
  ),
  constraint support_ticket_categories_priority_valid check (
    default_priority in ('low', 'normal', 'high', 'urgent')
  ),
  constraint support_ticket_categories_status_valid check (status in ('active', 'inactive')),
  unique (organization_id, name)
);

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ticket_number bigint not null,
  subject text not null,
  description text not null,
  client_company_id uuid references public.crm_companies(id) on delete set null,
  contact_id uuid references public.crm_contacts(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  category_id uuid references public.support_ticket_categories(id) on delete set null,
  priority text not null default 'normal',
  status text not null default 'new',
  assigned_agent_membership_id uuid references public.memberships(id) on delete set null,
  assigned_team_id uuid references public.teams(id) on delete set null,
  due_at timestamptz,
  first_response_due_at timestamptz not null,
  resolution_due_at timestamptz not null,
  first_responded_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  waiting_started_at timestamptz,
  waiting_total_seconds bigint not null default 0,
  resolution_summary text,
  satisfaction_score smallint,
  satisfaction_comment text,
  reopened_count integer not null default 0,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint support_tickets_number_positive check (ticket_number > 0),
  constraint support_tickets_subject_valid check (char_length(btrim(subject)) between 2 and 180),
  constraint support_tickets_description_valid check (char_length(btrim(description)) between 2 and 10000),
  constraint support_tickets_priority_valid check (priority in ('low', 'normal', 'high', 'urgent')),
  constraint support_tickets_status_valid check (
    status in ('new', 'open', 'pending_customer', 'pending_internal', 'resolved', 'closed')
  ),
  constraint support_tickets_waiting_valid check (waiting_total_seconds >= 0),
  constraint support_tickets_reopened_valid check (reopened_count >= 0),
  constraint support_tickets_resolution_valid check (
    (status in ('resolved', 'closed') and resolved_at is not null and resolution_summary is not null)
    or (status not in ('resolved', 'closed'))
  ),
  constraint support_tickets_closed_valid check (
    (status = 'closed' and closed_at is not null) or (status <> 'closed' and closed_at is null)
  ),
  constraint support_tickets_satisfaction_valid check (
    satisfaction_score is null or satisfaction_score between 1 and 5
  ),
  constraint support_tickets_satisfaction_comment_valid check (
    satisfaction_comment is null or char_length(btrim(satisfaction_comment)) between 2 and 1000
  ),
  unique (organization_id, ticket_number)
);
create index support_tickets_workspace_idx
  on public.support_tickets (organization_id, status, priority, last_activity_at desc);
create index support_tickets_agent_idx
  on public.support_tickets (organization_id, assigned_agent_membership_id, status);
create index support_tickets_client_idx
  on public.support_tickets (organization_id, client_company_id, status)
  where client_company_id is not null;
create index support_tickets_sla_idx
  on public.support_tickets (organization_id, resolution_due_at)
  where status not in ('resolved', 'closed');

create table public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ticket_id uuid not null references public.support_tickets(id) on delete restrict,
  message_type text not null,
  body text not null,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint support_ticket_messages_type_valid check (message_type in ('public_reply', 'internal_note')),
  constraint support_ticket_messages_body_valid check (char_length(btrim(body)) between 1 and 10000)
);
create index support_ticket_messages_history_idx
  on public.support_ticket_messages (ticket_id, created_at, id);

create table public.support_ticket_watchers (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (ticket_id, membership_id)
);
create index support_ticket_watchers_member_idx
  on public.support_ticket_watchers (organization_id, membership_id, ticket_id);

create table public.support_ticket_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ticket_id uuid not null references public.support_tickets(id) on delete restrict,
  event_type text not null,
  actor_membership_id uuid references public.memberships(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint support_ticket_events_type_valid check (event_type ~ '^[a-z][a-z0-9_.]{2,79}$'),
  constraint support_ticket_events_details_object check (jsonb_typeof(details) = 'object')
);
create index support_ticket_events_history_idx
  on public.support_ticket_events (ticket_id, created_at desc, id desc);

create or replace function private.support_ticket_sla_minutes(p_priority text, p_kind text)
returns integer language sql immutable set search_path = '' as $$
  select case p_kind
    when 'first_response' then case p_priority when 'urgent' then 30 when 'high' then 120 when 'normal' then 480 else 1440 end
    when 'resolution' then case p_priority when 'urgent' then 240 when 'high' then 960 when 'normal' then 2880 else 7200 end
    else null end
$$;

create or replace function private.validate_support_ticket()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.memberships where id = new.created_by_membership_id
      and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Ticket creator must belong to its organization';
  end if;
  if new.assigned_agent_membership_id is not null and not exists (
    select 1 from public.memberships where id = new.assigned_agent_membership_id
      and organization_id = new.organization_id and status = 'active'
  ) then
    raise exception using errcode = '23514', message = 'Assigned agent must be active in the ticket organization';
  end if;
  if new.assigned_team_id is not null and not exists (
    select 1 from public.teams where id = new.assigned_team_id
      and organization_id = new.organization_id and status = 'active'
  ) then
    raise exception using errcode = '23514', message = 'Assigned team must be active in the ticket organization';
  end if;
  if new.category_id is not null and not exists (
    select 1 from public.support_ticket_categories where id = new.category_id
      and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Ticket category must belong to its organization';
  end if;
  if new.client_company_id is not null and not exists (
    select 1 from public.crm_companies where id = new.client_company_id
      and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Ticket client must belong to its organization';
  end if;
  if new.contact_id is not null and not exists (
    select 1 from public.crm_contacts where id = new.contact_id
      and organization_id = new.organization_id
      and (new.client_company_id is null or company_id = new.client_company_id)
  ) then
    raise exception using errcode = '23514', message = 'Ticket contact must match its organization and client';
  end if;
  if new.project_id is not null and not exists (
    select 1 from public.projects where id = new.project_id
      and organization_id = new.organization_id
      and (new.client_company_id is null or crm_company_id = new.client_company_id)
  ) then
    raise exception using errcode = '23514', message = 'Ticket project must match its organization and client';
  end if;
  return new;
end;
$$;

create or replace function private.validate_support_ticket_child()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.support_tickets where id = new.ticket_id
      and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Ticket child record must match its organization';
  end if;
  if new.created_by_membership_id is not null and not exists (
    select 1 from public.memberships where id = new.created_by_membership_id
      and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Ticket child actor must match its organization';
  end if;
  if tg_table_name = 'support_ticket_watchers' and not exists (
    select 1 from public.memberships where id = new.membership_id
      and organization_id = new.organization_id and status = 'active'
  ) then
    raise exception using errcode = '23514', message = 'Ticket watcher must be active in its organization';
  end if;
  return new;
end;
$$;

create or replace function private.validate_support_ticket_event()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.support_tickets where id = new.ticket_id
      and organization_id = new.organization_id
  ) or (new.actor_membership_id is not null and not exists (
    select 1 from public.memberships where id = new.actor_membership_id
      and organization_id = new.organization_id
  )) then
    raise exception using errcode = '23514', message = 'Ticket event must match its organization';
  end if;
  return new;
end;
$$;

create or replace function private.prevent_support_history_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '23514', message = 'Support messages and ticket history are append-only';
end;
$$;

create or replace function private.support_ticket_membership_access_allowed(
  p_ticket_id uuid,
  p_membership_id uuid,
  p_permission_key text
)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_ticket public.support_tickets%rowtype;
  v_scope text;
begin
  select * into v_ticket from public.support_tickets where id = p_ticket_id;
  if v_ticket.id is null then return false; end if;
  v_scope := private.membership_effective_permission_scope(p_membership_id, p_permission_key);
  if v_scope is null then return false; end if;
  if v_scope = 'organization' then return true; end if;
  if p_membership_id in (v_ticket.created_by_membership_id, v_ticket.assigned_agent_membership_id) then
    return true;
  end if;
  if p_permission_key in ('support.ticket.view', 'support.ticket.reply') and exists (
    select 1 from public.support_ticket_watchers
    where ticket_id = p_ticket_id and membership_id = p_membership_id
  ) then return true; end if;
  if v_scope = 'team' and v_ticket.assigned_team_id is not null and exists (
    select 1 from public.team_members where team_id = v_ticket.assigned_team_id
      and membership_id = p_membership_id
  ) then return true; end if;
  return private.crm_scope_allows_membership(
    p_membership_id, v_scope,
    v_ticket.assigned_agent_membership_id,
    v_ticket.created_by_membership_id
  );
end;
$$;

create or replace function private.support_ticket_access_allowed(
  p_ticket_id uuid,
  p_permission_key text
)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.support_ticket_membership_access_allowed(
    p_ticket_id,
    private.current_membership_id((select organization_id from public.support_tickets where id = p_ticket_id)),
    p_permission_key
  )
$$;

create trigger support_ticket_categories_set_updated_at
before update on public.support_ticket_categories
for each row execute function private.set_updated_at();
create trigger support_tickets_set_updated_at
before update on public.support_tickets
for each row execute function private.set_updated_at();
create trigger support_tickets_validate_tenant
before insert or update on public.support_tickets
for each row execute function private.validate_support_ticket();
create trigger support_ticket_messages_validate_tenant
before insert or update on public.support_ticket_messages
for each row execute function private.validate_support_ticket_child();
create trigger support_ticket_watchers_validate_tenant
before insert or update on public.support_ticket_watchers
for each row execute function private.validate_support_ticket_child();
create trigger support_ticket_events_validate_tenant
before insert or update on public.support_ticket_events
for each row execute function private.validate_support_ticket_event();
create trigger support_ticket_messages_immutable
before update or delete on public.support_ticket_messages
for each row execute function private.prevent_support_history_mutation();
create trigger support_ticket_events_immutable
before update or delete on public.support_ticket_events
for each row execute function private.prevent_support_history_mutation();

-- Add Support tickets to the existing Documents entity-link catalogue.
alter table public.document_entity_links
  drop constraint document_entity_links_type_valid;
alter table public.document_entity_links
  add constraint document_entity_links_type_valid check (
    entity_type in ('client', 'contact', 'lead', 'project', 'task', 'invoice', 'estimate', 'employee', 'ticket')
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
  end case;
  if not v_exists then
    raise exception using errcode = '23514', message = 'Linked entity was not found in this organization';
  end if;
  return new;
end;
$$;

alter table public.support_ticket_counters enable row level security;
alter table public.support_ticket_categories enable row level security;
alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;
alter table public.support_ticket_watchers enable row level security;
alter table public.support_ticket_events enable row level security;

revoke all on public.support_ticket_counters from public, anon, authenticated;
revoke all on public.support_ticket_categories from public, anon;
revoke all on public.support_tickets from public, anon;
revoke all on public.support_ticket_messages from public, anon;
revoke all on public.support_ticket_watchers from public, anon;
revoke all on public.support_ticket_events from public, anon;

grant select on public.support_ticket_categories to authenticated;
grant select on public.support_tickets to authenticated;
grant select on public.support_ticket_messages to authenticated;
grant select on public.support_ticket_watchers to authenticated;
grant select (id, organization_id, ticket_id, event_type, actor_membership_id, created_at)
  on public.support_ticket_events to authenticated;
grant all on public.support_ticket_counters, public.support_ticket_categories, public.support_tickets,
  public.support_ticket_messages, public.support_ticket_watchers, public.support_ticket_events to service_role;

create policy support_ticket_categories_select on public.support_ticket_categories
for select to authenticated using (private.has_permission(organization_id, 'support.workspace.view'));
create policy support_tickets_select on public.support_tickets
for select to authenticated using (private.support_ticket_access_allowed(id, 'support.ticket.view'));
create policy support_ticket_messages_select on public.support_ticket_messages
for select to authenticated using (
  private.support_ticket_access_allowed(ticket_id, 'support.ticket.view')
  and (message_type = 'public_reply' or private.support_ticket_access_allowed(ticket_id, 'support.ticket.internal_note'))
);
create policy support_ticket_watchers_select on public.support_ticket_watchers
for select to authenticated using (private.support_ticket_access_allowed(ticket_id, 'support.ticket.view'));
create policy support_ticket_events_select on public.support_ticket_events
for select to authenticated using (private.support_ticket_access_allowed(ticket_id, 'support.ticket.view'));

revoke all on function private.support_ticket_sla_minutes(text, text) from public, anon;
revoke all on function private.validate_support_ticket() from public, anon, authenticated;
revoke all on function private.validate_support_ticket_child() from public, anon, authenticated;
revoke all on function private.validate_support_ticket_event() from public, anon, authenticated;
revoke all on function private.prevent_support_history_mutation() from public, anon, authenticated;
revoke all on function private.support_ticket_membership_access_allowed(uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.support_ticket_access_allowed(uuid, text) from public, anon;
grant execute on function private.support_ticket_sla_minutes(text, text) to service_role;
grant execute on function private.support_ticket_membership_access_allowed(uuid, uuid, text) to service_role;
grant execute on function private.support_ticket_access_allowed(uuid, text) to authenticated, service_role;

-- Seed practical categories for existing organizations. They remain editable by Support Managers.
insert into public.support_ticket_categories (
  organization_id, name, description, default_priority, created_by_membership_id
)
select organization.id, seed.name, seed.description, seed.default_priority,
  (select membership.id from public.memberships membership
   where membership.organization_id = organization.id and membership.status = 'active'
   order by membership.created_at, membership.id limit 1)
from public.organizations organization
cross join (values
  ('General enquiry', 'General questions and customer requests.', 'normal'),
  ('Incident', 'Service interruption or degraded delivery.', 'high'),
  ('Billing', 'Invoice, payment, estimate, or billing questions.', 'normal'),
  ('Change request', 'Requested change to an active project or delivered service.', 'normal')
) as seed(name, description, default_priority)
where exists (select 1 from public.memberships membership where membership.organization_id = organization.id)
on conflict (organization_id, name) do nothing;
