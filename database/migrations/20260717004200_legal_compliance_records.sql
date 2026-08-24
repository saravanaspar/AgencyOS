-- Legal compliance records. Reuses Documents for immutable files, existing permission scopes,
-- Notifications for due-date delivery, and Audit for evidence.

set lock_timeout = '10s';
set statement_timeout = '120s';

insert into public.permissions (module, resource, action, description, is_sensitive)
values
  ('legal', 'record', 'view', 'View legal compliance-record metadata within the granted scope.', true),
  ('legal', 'record', 'create', 'Create legal compliance records linked to immutable Documents versions.', true),
  ('legal', 'record', 'update', 'Update active legal compliance-record metadata and linked versions.', true),
  ('legal', 'record', 'manage_lifecycle', 'Close, archive, and restore legal compliance records.', true),
  ('legal', 'record', 'download', 'Open linked compliance-record files through Documents.', true),
  ('legal', 'record', 'manage_privileged', 'Access and classify legally privileged compliance records.', true)
on conflict (module, resource, action) do update
set description = excluded.description, is_sensitive = excluded.is_sensitive;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'organization'
from public.role_templates as role_template
cross join public.permissions as permission
where permission.module = 'legal' and permission.resource = 'record'
  and role_template.key in ('owner', 'legal_manager')
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'auditor', permission.id, 'organization'
from public.permissions as permission
where permission.key in ('legal.record.view', 'legal.record.download')
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_permissions (role_id, permission_id, scope, conditions)
select role.id, template_permission.permission_id, template_permission.scope,
  template_permission.conditions
from public.roles as role
join public.role_template_permissions as template_permission
  on template_permission.role_template_key = role.template_key
join public.permissions as permission on permission.id = template_permission.permission_id
where permission.module = 'legal' and permission.resource = 'record'
on conflict (role_id, permission_id) do update
set scope = excluded.scope, conditions = excluded.conditions, updated_at = now();

create table public.legal_compliance_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  internal_reference text not null,
  title text not null,
  record_type text not null,
  status text not null default 'active',
  responsible_owner_membership_id uuid not null references public.memberships(id) on delete restrict,
  department_id uuid references public.departments(id) on delete set null,
  issuing_authority text,
  jurisdiction text,
  identifier_last_four text,
  issue_date date,
  effective_date date,
  expiry_date date,
  renewal_date date,
  review_date date,
  response_due_date date,
  confidentiality_level text not null default 'confidential',
  legal_privilege boolean not null default false,
  document_id uuid not null references public.documents(id) on delete restrict,
  document_version_id uuid not null references public.document_versions(id) on delete restrict,
  summary text,
  closure_reason text,
  closed_at timestamptz,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint legal_compliance_records_reference_valid check (
    internal_reference ~ '^[A-Z0-9][A-Z0-9._/-]{2,39}$'
  ),
  constraint legal_compliance_records_title_valid check (char_length(btrim(title)) between 2 and 180),
  constraint legal_compliance_records_type_valid check (
    record_type in ('privacy_document', 'corporate_registration', 'gst_record', 'pan_record',
      'licence', 'insurance_policy', 'intellectual_property', 'compliance_certificate',
      'board_resolution', 'legal_notice', 'dispute_record')
  ),
  constraint legal_compliance_records_status_valid check (status in ('active', 'closed', 'archived')),
  constraint legal_compliance_records_confidentiality_valid check (
    confidentiality_level in ('internal', 'confidential', 'restricted')
  ),
  constraint legal_compliance_records_identifier_valid check (
    identifier_last_four is null or identifier_last_four ~ '^[A-Z0-9]{2,4}$'
  ),
  constraint legal_compliance_records_authority_valid check (
    issuing_authority is null or char_length(btrim(issuing_authority)) between 2 and 180
  ),
  constraint legal_compliance_records_jurisdiction_valid check (
    jurisdiction is null or char_length(btrim(jurisdiction)) between 2 and 120
  ),
  constraint legal_compliance_records_summary_valid check (
    summary is null or char_length(btrim(summary)) between 2 and 2000
  ),
  constraint legal_compliance_records_date_order_valid check (
    expiry_date is null or coalesce(effective_date, issue_date, expiry_date) <= expiry_date
  ),
  constraint legal_compliance_records_renewal_valid check (
    renewal_date is null or effective_date is null or renewal_date >= effective_date
  ),
  constraint legal_compliance_records_closure_contract check (
    (status = 'active' and closed_at is null and closure_reason is null)
    or (status in ('closed', 'archived') and closed_at is not null and closure_reason is not null)
  ),
  unique (organization_id, internal_reference)
);
create index legal_compliance_records_workspace_idx
  on public.legal_compliance_records (organization_id, status, updated_at desc);
create index legal_compliance_records_owner_idx
  on public.legal_compliance_records (organization_id, responsible_owner_membership_id, status);
create index legal_compliance_records_expiry_idx
  on public.legal_compliance_records (organization_id, expiry_date) where expiry_date is not null;
create index legal_compliance_records_review_idx
  on public.legal_compliance_records (organization_id, review_date) where review_date is not null;
create index legal_compliance_records_response_idx
  on public.legal_compliance_records (organization_id, response_due_date)
  where response_due_date is not null;

create table public.legal_compliance_record_reminders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  record_id uuid not null references public.legal_compliance_records(id) on delete cascade,
  reminder_type text not null,
  remind_on date not null,
  status text not null default 'pending',
  acknowledged_by_membership_id uuid references public.memberships(id) on delete set null,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint legal_compliance_reminders_type_valid check (
    reminder_type in ('expiry', 'renewal', 'review', 'response')
  ),
  constraint legal_compliance_reminders_status_valid check (
    status in ('pending', 'acknowledged', 'cancelled')
  ),
  constraint legal_compliance_reminders_ack_contract check (
    (status = 'acknowledged' and acknowledged_by_membership_id is not null and acknowledged_at is not null)
    or (status <> 'acknowledged' and acknowledged_by_membership_id is null and acknowledged_at is null)
  ),
  unique (record_id, reminder_type, remind_on)
);
create index legal_compliance_record_reminders_due_idx
  on public.legal_compliance_record_reminders (organization_id, status, remind_on);

create table public.legal_compliance_record_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  record_id uuid not null references public.legal_compliance_records(id) on delete restrict,
  event_type text not null,
  actor_membership_id uuid references public.memberships(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint legal_compliance_events_type_valid check (event_type ~ '^[a-z][a-z0-9_.]{2,79}$'),
  constraint legal_compliance_events_details_object check (jsonb_typeof(details) = 'object')
);
create index legal_compliance_record_events_history_idx
  on public.legal_compliance_record_events (record_id, created_at desc, id desc);

create or replace function private.validate_legal_compliance_record()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_document_classification text; v_file_status text;
begin
  if tg_op = 'INSERT' or new.responsible_owner_membership_id is distinct from old.responsible_owner_membership_id then
    if not exists (
      select 1 from public.memberships m where m.id = new.responsible_owner_membership_id
        and m.organization_id = new.organization_id and m.status = 'active'
    ) then raise exception 'Compliance-record owner must be an active organization member.'; end if;
  end if;
  if tg_op = 'INSERT' and not exists (
    select 1 from public.memberships m where m.id = new.created_by_membership_id
      and m.organization_id = new.organization_id
  ) then raise exception 'Compliance-record creator must belong to the organization.'; end if;
  if new.department_id is not null and (tg_op = 'INSERT' or new.department_id is distinct from old.department_id)
    and not exists (
      select 1 from public.departments d where d.id = new.department_id
        and d.organization_id = new.organization_id
    ) then raise exception 'Compliance-record department must belong to the organization.'; end if;
  if tg_op = 'INSERT' or new.document_id is distinct from old.document_id
    or new.document_version_id is distinct from old.document_version_id then
    select d.classification, f.status into v_document_classification, v_file_status
    from public.documents d
    join public.document_versions dv on dv.id = new.document_version_id and dv.document_id = d.id
    join public.private_files f on f.id = dv.private_file_id
    where d.id = new.document_id and d.organization_id = new.organization_id;
    if v_document_classification is null then
      raise exception 'Compliance record must reference an organization document version.';
    end if;
    if v_file_status <> 'available' then
      raise exception 'Compliance record requires a clean available document version.';
    end if;
  else
    select classification into v_document_classification from public.documents where id = new.document_id;
  end if;
  if new.legal_privilege and v_document_classification <> 'restricted' then
    raise exception 'Legally privileged records require a restricted linked document.';
  end if;
  return new;
end; $$;

create or replace function private.legal_compliance_record_membership_access_allowed(
  p_record_id uuid,
  p_membership_id uuid,
  p_permission_key text
) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_record public.legal_compliance_records%rowtype; v_scope text;
begin
  select * into v_record from public.legal_compliance_records where id = p_record_id;
  if v_record.id is null then return false; end if;
  if not exists (
    select 1 from public.memberships m where m.id = p_membership_id
      and m.organization_id = v_record.organization_id and m.status = 'active'
  ) then return false; end if;
  v_scope := private.membership_effective_permission_scope(p_membership_id, p_permission_key);
  if v_scope is null then return false; end if;
  if v_record.legal_privilege and private.membership_effective_permission_scope(
    p_membership_id, 'legal.record.manage_privileged'
  ) is null then return false; end if;
  return private.crm_scope_allows_membership(
    p_membership_id, v_scope, v_record.responsible_owner_membership_id,
    v_record.created_by_membership_id
  );
end; $$;

create or replace function private.legal_compliance_record_access_allowed(
  p_record_id uuid,
  p_permission_key text
) returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid; v_member uuid;
begin
  select organization_id into v_org from public.legal_compliance_records where id = p_record_id;
  if v_org is null then return false; end if;
  v_member := private.current_membership_id(v_org);
  if v_member is null then return false; end if;
  return private.legal_compliance_record_membership_access_allowed(
    p_record_id, v_member, p_permission_key
  );
end; $$;

create or replace function private.sync_legal_compliance_record_reminders()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.legal_compliance_record_reminders
  set status = 'cancelled', acknowledged_by_membership_id = null,
    acknowledged_at = null, updated_at = now()
  where record_id = new.id and status = 'pending';
  if new.status <> 'active' then return new; end if;
  if new.expiry_date is not null then
    insert into public.legal_compliance_record_reminders
      (organization_id, record_id, reminder_type, remind_on)
    values (new.organization_id, new.id, 'expiry', new.expiry_date)
    on conflict (record_id, reminder_type, remind_on) do update
      set status = 'pending', acknowledged_by_membership_id = null,
        acknowledged_at = null, updated_at = now();
  end if;
  if new.renewal_date is not null then
    insert into public.legal_compliance_record_reminders
      (organization_id, record_id, reminder_type, remind_on)
    values (new.organization_id, new.id, 'renewal', new.renewal_date)
    on conflict (record_id, reminder_type, remind_on) do update
      set status = 'pending', acknowledged_by_membership_id = null,
        acknowledged_at = null, updated_at = now();
  end if;
  if new.review_date is not null then
    insert into public.legal_compliance_record_reminders
      (organization_id, record_id, reminder_type, remind_on)
    values (new.organization_id, new.id, 'review', new.review_date)
    on conflict (record_id, reminder_type, remind_on) do update
      set status = 'pending', acknowledged_by_membership_id = null,
        acknowledged_at = null, updated_at = now();
  end if;
  if new.response_due_date is not null then
    insert into public.legal_compliance_record_reminders
      (organization_id, record_id, reminder_type, remind_on)
    values (new.organization_id, new.id, 'response', new.response_due_date)
    on conflict (record_id, reminder_type, remind_on) do update
      set status = 'pending', acknowledged_by_membership_id = null,
        acknowledged_at = null, updated_at = now();
  end if;
  return new;
end; $$;

create trigger legal_compliance_records_validate
before insert or update on public.legal_compliance_records
for each row execute function private.validate_legal_compliance_record();
create trigger legal_compliance_records_updated
before update on public.legal_compliance_records
for each row execute function private.set_updated_at();
create trigger legal_compliance_records_sync_reminders_insert
after insert on public.legal_compliance_records
for each row execute function private.sync_legal_compliance_record_reminders();
create trigger legal_compliance_records_sync_reminders
after update of status, expiry_date, renewal_date, review_date, response_due_date
on public.legal_compliance_records
for each row when (
  old.status is distinct from new.status
  or old.expiry_date is distinct from new.expiry_date
  or old.renewal_date is distinct from new.renewal_date
  or old.review_date is distinct from new.review_date
  or old.response_due_date is distinct from new.response_due_date
) execute function private.sync_legal_compliance_record_reminders();
create trigger legal_compliance_record_reminders_updated
before update on public.legal_compliance_record_reminders
for each row execute function private.set_updated_at();
create trigger legal_compliance_record_events_no_update
before update on public.legal_compliance_record_events
for each row execute function private.prevent_document_immutable_mutation();
create trigger legal_compliance_record_events_no_delete
before delete on public.legal_compliance_record_events
for each row execute function private.prevent_document_immutable_mutation();

alter table public.legal_compliance_records enable row level security;
alter table public.legal_compliance_record_reminders enable row level security;
alter table public.legal_compliance_record_events enable row level security;

revoke all on public.legal_compliance_records, public.legal_compliance_record_reminders,
  public.legal_compliance_record_events from anon;
grant select (
  id, organization_id, internal_reference, title, record_type, status,
  responsible_owner_membership_id, department_id, issuing_authority, jurisdiction,
  identifier_last_four, issue_date, effective_date, expiry_date, renewal_date,
  review_date, response_due_date, confidentiality_level, legal_privilege,
  document_id, document_version_id, created_by_membership_id, created_at, updated_at
) on public.legal_compliance_records to authenticated;
grant select (
  id, organization_id, record_id, reminder_type, remind_on, status, created_at, updated_at
) on public.legal_compliance_record_reminders to authenticated;
grant select (
  id, organization_id, record_id, event_type, actor_membership_id, created_at
) on public.legal_compliance_record_events to authenticated;
grant all on public.legal_compliance_records, public.legal_compliance_record_reminders,
  public.legal_compliance_record_events to service_role;

create policy legal_compliance_records_select on public.legal_compliance_records
for select to authenticated using (
  private.legal_compliance_record_access_allowed(id, 'legal.record.view')
);
create policy legal_compliance_record_reminders_select on public.legal_compliance_record_reminders
for select to authenticated using (
  private.legal_compliance_record_access_allowed(record_id, 'legal.record.view')
);
create policy legal_compliance_record_events_select on public.legal_compliance_record_events
for select to authenticated using (
  private.legal_compliance_record_access_allowed(record_id, 'legal.record.view')
);

revoke all on function private.validate_legal_compliance_record() from public, anon, authenticated;
revoke all on function private.sync_legal_compliance_record_reminders() from public, anon, authenticated;
revoke all on function private.legal_compliance_record_membership_access_allowed(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function private.legal_compliance_record_membership_access_allowed(uuid, uuid, text)
  to service_role;
revoke all on function private.legal_compliance_record_access_allowed(uuid, text) from public, anon;
grant execute on function private.legal_compliance_record_access_allowed(uuid, text)
  to authenticated, service_role;
