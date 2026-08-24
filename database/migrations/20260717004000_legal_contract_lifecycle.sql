-- Legal contract lifecycle foundation. Reuses Documents for immutable files,
-- Approvals for decisions, Notifications for reminders, and Audit for evidence.

set lock_timeout = '10s';
set statement_timeout = '120s';

insert into public.permissions (module, resource, action, description, is_sensitive)
values
  ('legal', 'contract', 'view', 'View legal contract metadata within the granted scope.', true),
  ('legal', 'contract', 'create', 'Create contract requests and draft metadata.', true),
  ('legal', 'contract', 'update', 'Update draft commercial and legal metadata.', true),
  ('legal', 'contract', 'review', 'Submit, review, and return contract approval requests.', true),
  ('legal', 'contract', 'manage_templates', 'Register and retire contract templates.', true),
  ('legal', 'contract', 'manage_signatures', 'Track signatures and register signed copies.', true),
  ('legal', 'contract', 'manage_lifecycle', 'Activate, terminate, and expire contracts.', true),
  ('legal', 'contract', 'download', 'Open contract versions through the private document library.', true)
on conflict (module, resource, action) do update
set description = excluded.description, is_sensitive = excluded.is_sensitive;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'organization'
from public.role_templates as role_template
cross join public.permissions as permission
where permission.module = 'legal'
  and role_template.key in ('owner', 'legal_manager')
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'finance_manager', permission.id, 'organization'
from public.permissions as permission
where permission.key in ('legal.workspace.view', 'legal.contract.view', 'legal.contract.download')
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'own'
from public.role_templates as role_template
cross join public.permissions as permission
where permission.key in ('legal.workspace.view', 'legal.contract.view', 'legal.contract.create', 'legal.contract.update', 'legal.contract.download')
  and role_template.key in ('sales_manager', 'project_manager', 'operations_administrator')
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'auditor', permission.id, 'organization'
from public.permissions as permission
where permission.key in ('legal.workspace.view', 'legal.contract.view', 'legal.contract.download')
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_permissions (role_id, permission_id, scope, conditions)
select role.id, template_permission.permission_id, template_permission.scope,
  template_permission.conditions
from public.roles as role
join public.role_template_permissions as template_permission
  on template_permission.role_template_key = role.template_key
join public.permissions as permission on permission.id = template_permission.permission_id
where permission.module = 'legal'
on conflict (role_id, permission_id) do update
set scope = excluded.scope, conditions = excluded.conditions, updated_at = now();

create table public.legal_contract_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  contract_type text not null,
  description text,
  source_document_id uuid not null references public.documents(id) on delete restrict,
  source_version_id uuid not null references public.document_versions(id) on delete restrict,
  status text not null default 'active',
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint legal_contract_templates_name_valid check (char_length(btrim(name)) between 2 and 140),
  constraint legal_contract_templates_type_valid check (
    contract_type in ('client_contract', 'master_service_agreement', 'statement_of_work',
      'nda', 'vendor_agreement', 'contractor_agreement', 'partnership_agreement',
      'data_processing_agreement', 'other')
  ),
  constraint legal_contract_templates_description_valid check (
    description is null or char_length(btrim(description)) between 2 and 1000
  ),
  constraint legal_contract_templates_status_valid check (status in ('active', 'inactive')),
  unique (organization_id, name)
);

create table public.legal_contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  internal_reference text not null,
  title text not null,
  contract_type text not null,
  counterparty_name text not null,
  counterparty_company_id uuid references public.crm_companies(id) on delete set null,
  responsible_owner_membership_id uuid not null references public.memberships(id) on delete restrict,
  department_id uuid references public.departments(id) on delete set null,
  template_id uuid references public.legal_contract_templates(id) on delete set null,
  status text not null default 'request',
  effective_date date,
  end_date date,
  renewal_date date,
  notice_period_days integer,
  jurisdiction text,
  governing_law text,
  contract_value_minor bigint,
  currency text,
  signature_status text not null default 'not_started',
  finance_review_required boolean not null default false,
  owner_approval_required boolean not null default false,
  current_version_id uuid,
  approved_version_id uuid,
  signed_version_id uuid,
  approval_request_id uuid references public.approval_requests(id) on delete set null,
  termination_reason text,
  terminated_at timestamptz,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint legal_contracts_reference_valid check (internal_reference ~ '^[A-Z0-9][A-Z0-9._/-]{2,39}$'),
  constraint legal_contracts_title_valid check (char_length(btrim(title)) between 2 and 180),
  constraint legal_contracts_counterparty_valid check (char_length(btrim(counterparty_name)) between 2 and 180),
  constraint legal_contracts_type_valid check (
    contract_type in ('client_contract', 'master_service_agreement', 'statement_of_work',
      'nda', 'vendor_agreement', 'contractor_agreement', 'partnership_agreement',
      'data_processing_agreement', 'other')
  ),
  constraint legal_contracts_status_valid check (
    status in ('request', 'draft', 'in_review', 'approved', 'awaiting_signature',
      'active', 'terminated', 'expired', 'cancelled')
  ),
  constraint legal_contracts_signature_valid check (
    signature_status in ('not_started', 'sent', 'partially_signed', 'signed', 'declined', 'expired')
  ),
  constraint legal_contracts_dates_valid check (
    end_date is null or effective_date is null or end_date >= effective_date
  ),
  constraint legal_contracts_renewal_valid check (
    renewal_date is null or effective_date is null or renewal_date >= effective_date
  ),
  constraint legal_contracts_notice_valid check (notice_period_days is null or notice_period_days between 0 and 3650),
  constraint legal_contracts_value_valid check (contract_value_minor is null or contract_value_minor >= 0),
  constraint legal_contracts_currency_valid check (currency is null or currency ~ '^[A-Z]{3}$'),
  constraint legal_contracts_termination_contract check (
    (status = 'terminated' and terminated_at is not null and termination_reason is not null)
    or (status <> 'terminated' and terminated_at is null and termination_reason is null)
  ),
  unique (organization_id, internal_reference)
);
create index legal_contracts_workspace_idx
  on public.legal_contracts (organization_id, status, updated_at desc);
create index legal_contracts_owner_idx
  on public.legal_contracts (organization_id, responsible_owner_membership_id, status);
create index legal_contracts_renewal_idx
  on public.legal_contracts (organization_id, renewal_date) where renewal_date is not null;
create index legal_contracts_end_idx
  on public.legal_contracts (organization_id, end_date) where end_date is not null;

create table public.legal_contract_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contract_id uuid not null references public.legal_contracts(id) on delete restrict,
  version_number integer not null,
  document_id uuid not null references public.documents(id) on delete restrict,
  document_version_id uuid not null references public.document_versions(id) on delete restrict,
  version_kind text not null,
  status text not null default 'draft',
  note text,
  uploaded_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint legal_contract_versions_number_valid check (version_number > 0),
  constraint legal_contract_versions_kind_valid check (
    version_kind in ('template', 'draft', 'counterparty', 'final', 'signed')
  ),
  constraint legal_contract_versions_status_valid check (
    status in ('draft', 'approved', 'superseded', 'signed')
  ),
  constraint legal_contract_versions_note_valid check (
    note is null or char_length(btrim(note)) between 2 and 500
  ),
  unique (contract_id, version_number),
  unique (contract_id, document_version_id)
);
create index legal_contract_versions_history_idx
  on public.legal_contract_versions (contract_id, version_number desc);

alter table public.legal_contracts
  add constraint legal_contracts_current_version_fk
  foreign key (current_version_id) references public.legal_contract_versions(id) on delete restrict,
  add constraint legal_contracts_approved_version_fk
  foreign key (approved_version_id) references public.legal_contract_versions(id) on delete restrict,
  add constraint legal_contracts_signed_version_fk
  foreign key (signed_version_id) references public.legal_contract_versions(id) on delete restrict;

create table public.legal_contract_reminders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contract_id uuid not null references public.legal_contracts(id) on delete cascade,
  reminder_type text not null,
  remind_on date not null,
  status text not null default 'pending',
  acknowledged_by_membership_id uuid references public.memberships(id) on delete set null,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint legal_contract_reminders_type_valid check (reminder_type in ('renewal', 'notice', 'expiry')),
  constraint legal_contract_reminders_status_valid check (status in ('pending', 'acknowledged', 'cancelled')),
  constraint legal_contract_reminders_ack_contract check (
    (status = 'acknowledged' and acknowledged_by_membership_id is not null and acknowledged_at is not null)
    or (status <> 'acknowledged' and acknowledged_by_membership_id is null and acknowledged_at is null)
  ),
  unique (contract_id, reminder_type, remind_on)
);
create index legal_contract_reminders_due_idx
  on public.legal_contract_reminders (organization_id, status, remind_on);

create table public.legal_contract_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contract_id uuid not null references public.legal_contracts(id) on delete restrict,
  version_id uuid references public.legal_contract_versions(id) on delete restrict,
  event_type text not null,
  actor_membership_id uuid references public.memberships(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint legal_contract_events_type_valid check (event_type ~ '^[a-z][a-z0-9_.]{2,79}$'),
  constraint legal_contract_events_details_object check (jsonb_typeof(details) = 'object')
);
create index legal_contract_events_history_idx
  on public.legal_contract_events (contract_id, created_at desc, id desc);

alter table public.document_entity_links drop constraint document_entity_links_type_valid;
alter table public.document_entity_links add constraint document_entity_links_type_valid check (
  entity_type in ('client', 'contact', 'lead', 'project', 'task', 'invoice', 'estimate', 'employee', 'contract')
);

create or replace function private.validate_legal_contract_template()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT'
    or new.source_document_id is distinct from old.source_document_id
    or new.source_version_id is distinct from old.source_version_id then
    if not exists (
      select 1 from public.documents d
      join public.document_versions v on v.id = new.source_version_id and v.document_id = d.id
      where d.id = new.source_document_id and d.organization_id = new.organization_id
    ) then raise exception 'Template document version must belong to the organization and document.'; end if;
  end if;
  if tg_op = 'INSERT' and not exists (
    select 1 from public.memberships m where m.id = new.created_by_membership_id
      and m.organization_id = new.organization_id and m.status = 'active'
  ) then raise exception 'Template creator must be an active organization member.'; end if;
  return new;
end; $$;

create or replace function private.validate_legal_contract()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.responsible_owner_membership_id is distinct from old.responsible_owner_membership_id then
    if not exists (
      select 1 from public.memberships m where m.id = new.responsible_owner_membership_id
        and m.organization_id = new.organization_id and m.status = 'active'
    ) then raise exception 'Contract owner must be an active organization member.'; end if;
  end if;
  if tg_op = 'INSERT' and not exists (
    select 1 from public.memberships m where m.id = new.created_by_membership_id
      and m.organization_id = new.organization_id
  ) then raise exception 'Contract creator must belong to the organization.'; end if;
  if new.department_id is not null and (tg_op = 'INSERT' or new.department_id is distinct from old.department_id) and not exists (
    select 1 from public.departments d where d.id = new.department_id and d.organization_id = new.organization_id
  ) then raise exception 'Contract department must belong to the organization.'; end if;
  if new.counterparty_company_id is not null and (tg_op = 'INSERT' or new.counterparty_company_id is distinct from old.counterparty_company_id) and not exists (
    select 1 from public.crm_companies c where c.id = new.counterparty_company_id and c.organization_id = new.organization_id
  ) then raise exception 'Counterparty company must belong to the organization.'; end if;
  if new.template_id is not null and (tg_op = 'INSERT' or new.template_id is distinct from old.template_id) and not exists (
    select 1 from public.legal_contract_templates t where t.id = new.template_id and t.organization_id = new.organization_id
  ) then raise exception 'Contract template must belong to the organization.'; end if;
  return new;
end; $$;

create or replace function private.validate_legal_contract_version()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_contract public.legal_contracts%rowtype;
begin
  select * into v_contract from public.legal_contracts where id = new.contract_id for update;
  if v_contract.id is null or v_contract.organization_id <> new.organization_id then
    raise exception 'Contract version must belong to the contract organization.';
  end if;
  if exists (
    select 1 from public.legal_contract_versions v
    where v.contract_id = new.contract_id and v.status in ('approved', 'signed')
      and v.document_version_id = new.document_version_id
  ) then raise exception 'Approved or signed contract versions are immutable.'; end if;
  if not exists (
    select 1 from public.document_versions dv
    join public.documents d on d.id = dv.document_id
    where dv.id = new.document_version_id and d.id = new.document_id
      and d.organization_id = new.organization_id
  ) then raise exception 'Contract version must reference a valid organization document version.'; end if;
  if not exists (
    select 1 from public.memberships m where m.id = new.uploaded_by_membership_id
      and m.organization_id = new.organization_id
  ) then raise exception 'Uploader must belong to the organization.'; end if;
  return new;
end; $$;

create or replace function private.prevent_legal_contract_version_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Legal contract versions are immutable.';
  end if;
  if new.id = old.id
    and new.organization_id = old.organization_id
    and new.contract_id = old.contract_id
    and new.version_number = old.version_number
    and new.document_id = old.document_id
    and new.document_version_id = old.document_version_id
    and new.version_kind = old.version_kind
    and new.note is not distinct from old.note
    and new.uploaded_by_membership_id = old.uploaded_by_membership_id
    and new.created_at = old.created_at
    and old.status = 'draft'
    and new.status in ('approved', 'superseded', 'signed') then
    return new;
  end if;
  raise exception 'Legal contract versions are immutable.';
end; $$;

create or replace function private.legal_contract_membership_access_allowed(
  p_contract_id uuid,
  p_membership_id uuid,
  p_permission_key text
) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_contract public.legal_contracts%rowtype; v_scope text;
begin
  select * into v_contract from public.legal_contracts where id = p_contract_id;
  if v_contract.id is null then return false; end if;
  if not exists (
    select 1 from public.memberships m where m.id = p_membership_id
      and m.organization_id = v_contract.organization_id and m.status = 'active'
  ) then return false; end if;
  v_scope := private.membership_effective_permission_scope(p_membership_id, p_permission_key);
  if v_scope is null then return false; end if;
  return private.crm_scope_allows_membership(
    p_membership_id, v_scope, v_contract.responsible_owner_membership_id, v_contract.created_by_membership_id
  );
end; $$;

create or replace function private.legal_contract_access_allowed(p_contract_id uuid, p_permission_key text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid; v_member uuid;
begin
  select organization_id into v_org from public.legal_contracts where id = p_contract_id;
  if v_org is null then return false; end if;
  v_member := private.current_membership_id(v_org);
  if v_member is null then return false; end if;
  return private.legal_contract_membership_access_allowed(p_contract_id, v_member, p_permission_key);
end; $$;

create or replace function private.sync_legal_contract_reminders()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_notice_date date;
begin
  if new.status not in ('active', 'awaiting_signature', 'approved') then
    update public.legal_contract_reminders set status = 'cancelled', updated_at = now()
    where contract_id = new.id and status = 'pending';
    return new;
  end if;
  if new.renewal_date is not null then
    insert into public.legal_contract_reminders (organization_id, contract_id, reminder_type, remind_on)
    values (new.organization_id, new.id, 'renewal', new.renewal_date)
    on conflict (contract_id, reminder_type, remind_on) do update set status = 'pending', updated_at = now();
  end if;
  if new.end_date is not null then
    insert into public.legal_contract_reminders (organization_id, contract_id, reminder_type, remind_on)
    values (new.organization_id, new.id, 'expiry', new.end_date)
    on conflict (contract_id, reminder_type, remind_on) do update set status = 'pending', updated_at = now();
    if new.notice_period_days is not null then
      v_notice_date := new.end_date - new.notice_period_days;
      insert into public.legal_contract_reminders (organization_id, contract_id, reminder_type, remind_on)
      values (new.organization_id, new.id, 'notice', v_notice_date)
      on conflict (contract_id, reminder_type, remind_on) do update set status = 'pending', updated_at = now();
    end if;
  end if;
  return new;
end; $$;

create or replace function private.apply_legal_contract_approval_result()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_contract_id uuid;
begin
  if new.source_module <> 'legal' or new.entity_type <> 'contract' or new.entity_id is null
    or old.status = new.status then return new; end if;
  v_contract_id := new.entity_id;
  if new.status = 'approved' then
    update public.legal_contracts
    set status = 'approved', approved_version_id = current_version_id,
      approval_request_id = new.id, updated_at = now()
    where id = v_contract_id and organization_id = new.organization_id;
    update public.legal_contract_versions
    set status = case when id = (select current_version_id from public.legal_contracts where id = v_contract_id)
      then 'approved' else 'superseded' end
    where contract_id = v_contract_id and status = 'draft';
    insert into public.legal_contract_events (organization_id, contract_id, version_id, event_type, details)
    select organization_id, id, approved_version_id, 'contract.approved', jsonb_build_object('approvalRequestId', new.id)
    from public.legal_contracts where id = v_contract_id;
  elsif new.status in ('rejected', 'revision_requested', 'cancelled', 'expired', 'invalidated') then
    update public.legal_contracts
    set status = 'draft', approval_request_id = new.id, updated_at = now()
    where id = v_contract_id and organization_id = new.organization_id and status = 'in_review';
    insert into public.legal_contract_events (organization_id, contract_id, event_type, details)
    select organization_id, id, 'contract.approval_closed', jsonb_build_object('approvalRequestId', new.id, 'status', new.status)
    from public.legal_contracts where id = v_contract_id;
  end if;
  return new;
end; $$;

create trigger legal_contract_templates_validate before insert or update on public.legal_contract_templates
for each row execute function private.validate_legal_contract_template();
create trigger legal_contract_templates_updated before update on public.legal_contract_templates
for each row execute function private.set_updated_at();
create trigger legal_contracts_validate before insert or update on public.legal_contracts
for each row execute function private.validate_legal_contract();
create trigger legal_contracts_updated before update on public.legal_contracts
for each row execute function private.set_updated_at();
create trigger legal_contract_versions_validate before insert on public.legal_contract_versions
for each row execute function private.validate_legal_contract_version();
create trigger legal_contract_versions_no_update before update on public.legal_contract_versions
for each row execute function private.prevent_legal_contract_version_mutation();
create trigger legal_contract_versions_no_delete before delete on public.legal_contract_versions
for each row execute function private.prevent_legal_contract_version_mutation();
create trigger legal_contract_events_no_update before update on public.legal_contract_events
for each row execute function private.prevent_document_immutable_mutation();
create trigger legal_contract_events_no_delete before delete on public.legal_contract_events
for each row execute function private.prevent_document_immutable_mutation();
create trigger approval_requests_apply_legal_contract after update of status on public.approval_requests
for each row execute function private.apply_legal_contract_approval_result();
create trigger legal_contracts_sync_reminders
after insert or update of status, renewal_date, end_date, notice_period_days on public.legal_contracts
for each row execute function private.sync_legal_contract_reminders();


alter table public.legal_contract_templates enable row level security;
alter table public.legal_contracts enable row level security;
alter table public.legal_contract_versions enable row level security;
alter table public.legal_contract_events enable row level security;
alter table public.legal_contract_reminders enable row level security;

revoke all on public.legal_contract_templates, public.legal_contracts,
  public.legal_contract_versions, public.legal_contract_events, public.legal_contract_reminders from anon;
grant select on public.legal_contract_templates to authenticated;
grant select (
  id, organization_id, internal_reference, title, contract_type, counterparty_name,
  counterparty_company_id, responsible_owner_membership_id, department_id, template_id,
  status, effective_date, end_date, renewal_date, notice_period_days, jurisdiction,
  governing_law, contract_value_minor, currency, signature_status,
  finance_review_required, owner_approval_required, current_version_id,
  approved_version_id, signed_version_id, approval_request_id, created_by_membership_id,
  created_at, updated_at
) on public.legal_contracts to authenticated;
grant select on public.legal_contract_versions to authenticated;
grant select (
  id, organization_id, contract_id, version_id, event_type, actor_membership_id, created_at
) on public.legal_contract_events to authenticated;
grant select on public.legal_contract_reminders to authenticated;
grant all on public.legal_contract_templates, public.legal_contracts,
  public.legal_contract_versions, public.legal_contract_events, public.legal_contract_reminders to service_role;

create policy legal_contract_templates_select on public.legal_contract_templates
for select to authenticated using (
  private.has_permission(organization_id, 'legal.workspace.view')
  and private.has_permission(organization_id, 'legal.contract.view')
);
create policy legal_contracts_select on public.legal_contracts
for select to authenticated using (
  private.legal_contract_access_allowed(id, 'legal.contract.view')
);
create policy legal_contract_versions_select on public.legal_contract_versions
for select to authenticated using (
  private.legal_contract_access_allowed(contract_id, 'legal.contract.view')
);
create policy legal_contract_events_select on public.legal_contract_events
for select to authenticated using (
  private.legal_contract_access_allowed(contract_id, 'legal.contract.view')
);
create policy legal_contract_reminders_select on public.legal_contract_reminders
for select to authenticated using (
  private.legal_contract_access_allowed(contract_id, 'legal.contract.view')
);

revoke all on function private.validate_legal_contract_template() from public, anon, authenticated;
revoke all on function private.validate_legal_contract() from public, anon, authenticated;
revoke all on function private.validate_legal_contract_version() from public, anon, authenticated;
revoke all on function private.prevent_legal_contract_version_mutation() from public, anon, authenticated;
revoke all on function private.apply_legal_contract_approval_result() from public, anon, authenticated;
revoke all on function private.sync_legal_contract_reminders() from public, anon, authenticated;
revoke all on function private.legal_contract_membership_access_allowed(uuid, uuid, text) from public, anon, authenticated;
grant execute on function private.legal_contract_membership_access_allowed(uuid, uuid, text) to service_role;
revoke all on function private.legal_contract_access_allowed(uuid, text) from public, anon;
grant execute on function private.legal_contract_access_allowed(uuid, text) to authenticated, service_role;
