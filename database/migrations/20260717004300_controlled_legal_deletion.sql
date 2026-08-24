-- Controlled legal deletion. Reuses Documents retention and legal holds, the shared approval
-- engine, private-file tombstones and object purging, and append-only audit evidence.

set lock_timeout = '10s';
set statement_timeout = '120s';

insert into public.permissions (module, resource, action, description, is_sensitive)
values
  ('legal', 'deletion', 'view', 'View controlled legal-deletion policy and request history.', true),
  ('legal', 'deletion', 'request', 'Request deletion of eligible legal records within scope.', true),
  ('legal', 'deletion', 'execute', 'Execute approved legal deletions and secure object removal.', true),
  ('legal', 'deletion', 'configure', 'Configure second-person approval for legal deletion.', true)
on conflict (module, resource, action) do update
set description = excluded.description, is_sensitive = excluded.is_sensitive;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'organization'
from public.role_templates as role_template
cross join public.permissions as permission
where permission.module = 'legal' and permission.resource = 'deletion'
  and role_template.key in ('owner', 'legal_manager')
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'auditor', permission.id, 'organization'
from public.permissions as permission
where permission.key = 'legal.deletion.view'
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_permissions (role_id, permission_id, scope, conditions)
select role.id, template_permission.permission_id, template_permission.scope,
  template_permission.conditions
from public.roles as role
join public.role_template_permissions as template_permission
  on template_permission.role_template_key = role.template_key
join public.permissions as permission on permission.id = template_permission.permission_id
where permission.module = 'legal' and permission.resource = 'deletion'
on conflict (role_id, permission_id) do update
set scope = excluded.scope, conditions = excluded.conditions, updated_at = now();

create table public.legal_deletion_policies (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  second_approval_required boolean not null default true,
  updated_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  updated_at timestamptz not null default now()
);

create table public.legal_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  target_type text not null,
  target_id uuid not null,
  target_reference text not null,
  target_title text not null,
  target_status text not null,
  target_owner_membership_id uuid not null references public.memberships(id) on delete restrict,
  target_created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  requested_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  reason text not null,
  status text not null,
  second_approval_required boolean not null,
  approval_request_id uuid unique references public.approval_requests(id) on delete restrict,
  eligibility_snapshot jsonb not null default '{}'::jsonb,
  object_count integer not null default 0,
  audit_digest text,
  failure_code text,
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  execution_started_at timestamptz,
  purge_claim_token uuid,
  purge_claimed_at timestamptz,
  completed_at timestamptz,
  completed_by_membership_id uuid references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint legal_deletion_requests_target_type_valid check (
    target_type in ('contract', 'compliance_record')
  ),
  constraint legal_deletion_requests_reference_valid check (
    char_length(btrim(target_reference)) between 2 and 80
  ),
  constraint legal_deletion_requests_title_valid check (
    char_length(btrim(target_title)) between 2 and 180
  ),
  constraint legal_deletion_requests_reason_valid check (
    char_length(btrim(reason)) between 10 and 1000
  ),
  constraint legal_deletion_requests_status_valid check (
    status in ('pending_approval', 'approved', 'rejected', 'revision_requested',
      'cancelled', 'expired', 'invalidated', 'purging', 'purge_failed', 'completed')
  ),
  constraint legal_deletion_requests_eligibility_object check (
    jsonb_typeof(eligibility_snapshot) = 'object'
  ),
  constraint legal_deletion_requests_object_count_valid check (object_count >= 0),
  constraint legal_deletion_requests_digest_valid check (
    audit_digest is null or audit_digest ~ '^[0-9a-f]{64}$'
  ),
  constraint legal_deletion_requests_failure_valid check (
    failure_code is null or failure_code ~ '^[a-z][a-z0-9_.-]{2,79}$'
  ),
  constraint legal_deletion_requests_approval_contract check (
    (second_approval_required and approval_request_id is not null)
    or (not second_approval_required and approval_request_id is null)
  ),
  constraint legal_deletion_requests_approval_time_contract check (
    (status = 'pending_approval' and approved_at is null)
    or (status <> 'pending_approval')
  ),
  constraint legal_deletion_requests_execution_contract check (
    (status = 'purging' and execution_started_at is not null
      and purge_claim_token is not null and purge_claimed_at is not null)
    or (status in ('purge_failed', 'completed') and execution_started_at is not null
      and purge_claim_token is null and purge_claimed_at is null)
    or (status not in ('purging', 'purge_failed', 'completed') and execution_started_at is null
      and purge_claim_token is null and purge_claimed_at is null)
  ),
  constraint legal_deletion_requests_completion_contract check (
    (status = 'completed' and completed_at is not null
      and completed_by_membership_id is not null and audit_digest is not null)
    or (status <> 'completed' and completed_at is null and completed_by_membership_id is null)
  )
);
create unique index legal_deletion_requests_active_target_unique
  on public.legal_deletion_requests (organization_id, target_type, target_id)
  where status in ('pending_approval', 'approved', 'purging', 'purge_failed');
create index legal_deletion_requests_history_idx
  on public.legal_deletion_requests (organization_id, requested_at desc, id desc);
create index legal_deletion_requests_approval_idx
  on public.legal_deletion_requests (approval_request_id) where approval_request_id is not null;

create table public.legal_deletion_objects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.legal_deletion_requests(id) on delete restrict,
  document_id uuid not null references public.documents(id) on delete restrict,
  document_version_id uuid not null references public.document_versions(id) on delete restrict,
  private_file_id uuid not null references public.private_files(id) on delete restrict,
  sha256 text not null,
  size_bytes bigint not null,
  purge_status text not null default 'pending',
  purge_attempt_count integer not null default 0,
  purged_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint legal_deletion_objects_sha_valid check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint legal_deletion_objects_size_valid check (size_bytes > 0),
  constraint legal_deletion_objects_status_valid check (
    purge_status in ('pending', 'purged', 'failed')
  ),
  constraint legal_deletion_objects_attempts_valid check (purge_attempt_count between 0 and 100),
  constraint legal_deletion_objects_error_valid check (
    last_error_code is null or last_error_code ~ '^[a-z][a-z0-9_.-]{2,79}$'
  ),
  constraint legal_deletion_objects_purged_contract check (
    (purge_status = 'purged' and purged_at is not null and last_error_code is null)
    or (purge_status <> 'purged' and purged_at is null)
  ),
  unique (request_id, private_file_id)
);
create index legal_deletion_objects_request_idx
  on public.legal_deletion_objects (request_id, purge_status, id);

create table public.legal_deletion_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.legal_deletion_requests(id) on delete restrict,
  event_type text not null,
  actor_membership_id uuid references public.memberships(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint legal_deletion_events_type_valid check (event_type ~ '^[a-z][a-z0-9_.]{2,79}$'),
  constraint legal_deletion_events_details_object check (jsonb_typeof(details) = 'object')
);
create index legal_deletion_events_history_idx
  on public.legal_deletion_events (request_id, created_at desc, id desc);

alter table public.legal_contracts
  add column deleted_at timestamptz,
  add column deleted_by_membership_id uuid references public.memberships(id) on delete restrict,
  add column deletion_request_id uuid unique references public.legal_deletion_requests(id) on delete restrict,
  add constraint legal_contracts_deletion_contract check (
    (deleted_at is null and deleted_by_membership_id is null and deletion_request_id is null)
    or (deleted_at is not null and deleted_by_membership_id is not null and deletion_request_id is not null)
  );
create index legal_contracts_not_deleted_idx
  on public.legal_contracts (organization_id, updated_at desc) where deleted_at is null;

alter table public.legal_compliance_records
  add column deleted_at timestamptz,
  add column deleted_by_membership_id uuid references public.memberships(id) on delete restrict,
  add column deletion_request_id uuid unique references public.legal_deletion_requests(id) on delete restrict,
  add constraint legal_compliance_records_deletion_contract check (
    (deleted_at is null and deleted_by_membership_id is null and deletion_request_id is null)
    or (deleted_at is not null and deleted_by_membership_id is not null and deletion_request_id is not null)
  );
create index legal_compliance_records_not_deleted_idx
  on public.legal_compliance_records (organization_id, updated_at desc) where deleted_at is null;

create or replace function private.legal_contract_membership_access_allowed(
  p_contract_id uuid,
  p_membership_id uuid,
  p_permission_key text
) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_contract public.legal_contracts%rowtype; v_scope text;
begin
  select * into v_contract from public.legal_contracts where id = p_contract_id;
  if v_contract.id is null or v_contract.deleted_at is not null then return false; end if;
  if not exists (
    select 1 from public.memberships m where m.id = p_membership_id
      and m.organization_id = v_contract.organization_id and m.status = 'active'
  ) then return false; end if;
  v_scope := private.membership_effective_permission_scope(p_membership_id, p_permission_key);
  if v_scope is null then return false; end if;
  return private.crm_scope_allows_membership(
    p_membership_id, v_scope, v_contract.responsible_owner_membership_id,
    v_contract.created_by_membership_id
  );
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
  if v_record.id is null or v_record.deleted_at is not null then return false; end if;
  if not exists (
    select 1 from public.memberships m where m.id = p_membership_id
      and m.organization_id = v_record.organization_id and m.status = 'active'
  ) then return false; end if;
  if v_record.legal_privilege and not private.membership_has_permission(
    p_membership_id, 'legal.record.manage_privileged'
  ) then return false; end if;
  v_scope := private.membership_effective_permission_scope(p_membership_id, p_permission_key);
  if v_scope is null then return false; end if;
  return private.crm_scope_allows_membership(
    p_membership_id, v_scope, v_record.responsible_owner_membership_id,
    v_record.created_by_membership_id
  );
end; $$;

create or replace function private.legal_deletion_request_membership_access_allowed(
  p_request_id uuid,
  p_membership_id uuid,
  p_permission_key text
) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_request public.legal_deletion_requests%rowtype; v_scope text;
begin
  select * into v_request from public.legal_deletion_requests where id = p_request_id;
  if v_request.id is null then return false; end if;
  if not exists (
    select 1 from public.memberships m where m.id = p_membership_id
      and m.organization_id = v_request.organization_id and m.status = 'active'
  ) then return false; end if;
  v_scope := private.membership_effective_permission_scope(p_membership_id, p_permission_key);
  if v_scope is null then return false; end if;
  return private.crm_scope_allows_membership(
    p_membership_id, v_scope, v_request.target_owner_membership_id,
    v_request.target_created_by_membership_id
  );
end; $$;

create or replace function private.legal_deletion_request_access_allowed(
  p_request_id uuid,
  p_permission_key text
) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid; v_member uuid;
begin
  select organization_id into v_org from public.legal_deletion_requests where id = p_request_id;
  if v_org is null then return false; end if;
  v_member := private.current_membership_id(v_org);
  if v_member is null then return false; end if;
  return private.legal_deletion_request_membership_access_allowed(
    p_request_id, v_member, p_permission_key
  );
end; $$;

create or replace function private.validate_legal_deletion_policy()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.memberships membership
    where membership.id = new.updated_by_membership_id
      and membership.organization_id = new.organization_id
      and membership.status = 'active'
  ) then raise exception 'Deletion policy updater must be an active organization member.'; end if;
  return new;
end; $$;

create or replace function private.validate_legal_deletion_request()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_approval record;
begin
  if not exists (
    select 1 from public.memberships membership
    where membership.id = new.requested_by_membership_id
      and membership.organization_id = new.organization_id
  ) then raise exception 'Deletion requester must belong to the organization.'; end if;
  if not exists (
    select 1 from public.memberships membership
    where membership.id in (new.target_owner_membership_id, new.target_created_by_membership_id)
      and membership.organization_id = new.organization_id
    group by membership.organization_id having count(distinct membership.id) >=
      case when new.target_owner_membership_id = new.target_created_by_membership_id then 1 else 2 end
  ) then raise exception 'Deletion target members must belong to the organization.'; end if;
  if new.second_approval_required then
    select organization_id, source_module, entity_type, entity_id, requester_membership_id
      into v_approval
    from public.approval_requests where id = new.approval_request_id;
    if v_approval.organization_id is distinct from new.organization_id
      or v_approval.source_module <> 'legal'
      or v_approval.entity_type <> 'legal_deletion'
      or v_approval.entity_id is distinct from new.id::text
      or v_approval.requester_membership_id is distinct from new.requested_by_membership_id
    then raise exception 'Legal deletion approval request is invalid.'; end if;
  end if;
  return new;
end; $$;

create or replace function private.prevent_legal_deletion_request_invalid_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.id <> old.id
    or new.organization_id <> old.organization_id
    or new.target_type <> old.target_type
    or new.target_id <> old.target_id
    or new.target_reference <> old.target_reference
    or new.target_title <> old.target_title
    or new.target_status <> old.target_status
    or new.target_owner_membership_id <> old.target_owner_membership_id
    or new.target_created_by_membership_id <> old.target_created_by_membership_id
    or new.requested_by_membership_id <> old.requested_by_membership_id
    or new.reason <> old.reason
    or new.second_approval_required <> old.second_approval_required
    or new.approval_request_id is distinct from old.approval_request_id
    or new.eligibility_snapshot <> old.eligibility_snapshot
    or new.object_count <> old.object_count
    or new.requested_at <> old.requested_at
    or new.created_at <> old.created_at
  then raise exception 'Legal deletion request evidence is immutable.'; end if;

  if not (
    (old.status = 'pending_approval' and new.status in (
      'approved', 'rejected', 'revision_requested', 'cancelled', 'expired', 'invalidated'
    ))
    or (old.status in ('approved', 'purge_failed') and new.status = 'purging')
    or (old.status = 'purging' and new.status in ('completed', 'purge_failed'))
    or (old.status = new.status)
  ) then raise exception 'Legal deletion request status transition is invalid.'; end if;
  return new;
end; $$;

create or replace function private.prevent_legal_deletion_request_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin raise exception 'Legal deletion request history is permanent.'; end; $$;

create or replace function private.prevent_legal_deletion_object_invalid_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.id <> old.id or new.organization_id <> old.organization_id
    or new.request_id <> old.request_id or new.document_id <> old.document_id
    or new.document_version_id <> old.document_version_id
    or new.private_file_id <> old.private_file_id or new.sha256 <> old.sha256
    or new.size_bytes <> old.size_bytes or new.created_at <> old.created_at
  then raise exception 'Legal deletion object evidence is immutable.'; end if;
  if old.purge_status = 'purged' and new.purge_status <> 'purged' then
    raise exception 'Purged object evidence cannot be reversed.';
  end if;
  return new;
end; $$;

create or replace function private.prevent_legal_deletion_history_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin raise exception 'Legal deletion history is immutable.'; end; $$;

create or replace function private.apply_legal_deletion_approval_result()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  if old.status = new.status or new.source_module <> 'legal'
    or new.entity_type <> 'legal_deletion' then return new; end if;
  v_status := case new.status
    when 'approved' then 'approved'
    when 'rejected' then 'rejected'
    when 'revision_requested' then 'revision_requested'
    when 'cancelled' then 'cancelled'
    when 'expired' then 'expired'
    when 'invalidated' then 'invalidated'
    else null
  end;
  if v_status is null then return new; end if;
  update public.legal_deletion_requests
  set status = v_status,
      approved_at = case when v_status = 'approved' then coalesce(completed_at, now()) else approved_at end,
      updated_at = now()
  where approval_request_id = new.id and status = 'pending_approval';
  insert into public.legal_deletion_events (
    organization_id, request_id, event_type, details
  )
  select organization_id, id, 'deletion.approval_' || v_status,
    jsonb_build_object('approvalRequestId', new.id)
  from public.legal_deletion_requests where approval_request_id = new.id;
  return new;
end; $$;

create trigger legal_deletion_policies_validate
before insert or update on public.legal_deletion_policies
for each row execute function private.validate_legal_deletion_policy();
create trigger legal_deletion_policies_updated
before update on public.legal_deletion_policies
for each row execute function private.set_updated_at();
create trigger legal_deletion_requests_validate
before insert on public.legal_deletion_requests
for each row execute function private.validate_legal_deletion_request();
create trigger legal_deletion_requests_prevent_invalid_update
before update on public.legal_deletion_requests
for each row execute function private.prevent_legal_deletion_request_invalid_mutation();
create trigger legal_deletion_requests_updated
before update on public.legal_deletion_requests
for each row execute function private.set_updated_at();
create trigger legal_deletion_requests_no_delete
before delete on public.legal_deletion_requests
for each row execute function private.prevent_legal_deletion_request_delete();
create trigger legal_deletion_objects_prevent_invalid_update
before update on public.legal_deletion_objects
for each row execute function private.prevent_legal_deletion_object_invalid_mutation();
create trigger legal_deletion_objects_updated
before update on public.legal_deletion_objects
for each row execute function private.set_updated_at();
create trigger legal_deletion_objects_no_delete
before delete on public.legal_deletion_objects
for each row execute function private.prevent_legal_deletion_history_mutation();
create trigger legal_deletion_events_no_update
before update on public.legal_deletion_events
for each row execute function private.prevent_legal_deletion_history_mutation();
create trigger legal_deletion_events_no_delete
before delete on public.legal_deletion_events
for each row execute function private.prevent_legal_deletion_history_mutation();
create trigger approval_requests_apply_legal_deletion
after update of status on public.approval_requests
for each row execute function private.apply_legal_deletion_approval_result();

alter table public.legal_deletion_policies enable row level security;
alter table public.legal_deletion_requests enable row level security;
alter table public.legal_deletion_objects enable row level security;
alter table public.legal_deletion_events enable row level security;

revoke all on public.legal_deletion_policies, public.legal_deletion_requests,
  public.legal_deletion_objects, public.legal_deletion_events from anon, authenticated;
grant select (organization_id, second_approval_required, updated_at)
  on public.legal_deletion_policies to authenticated;
grant select (
  id, organization_id, target_type, target_id, target_reference, target_title, target_status,
  target_owner_membership_id, requested_by_membership_id, status, second_approval_required,
  approval_request_id, object_count, requested_at, approved_at, execution_started_at,
  purge_claimed_at, completed_at, completed_by_membership_id, created_at, updated_at
) on public.legal_deletion_requests to authenticated;
grant select (
  id, organization_id, request_id, document_id, document_version_id, private_file_id,
  sha256, size_bytes, purge_status, purge_attempt_count, purged_at, created_at, updated_at
) on public.legal_deletion_objects to authenticated;
grant select (
  id, organization_id, request_id, event_type, actor_membership_id, created_at
) on public.legal_deletion_events to authenticated;
grant all on public.legal_deletion_policies, public.legal_deletion_requests,
  public.legal_deletion_objects, public.legal_deletion_events to service_role;

create policy legal_deletion_policies_select on public.legal_deletion_policies
for select to authenticated using (
  private.has_permission(organization_id, 'legal.deletion.view')
);
create policy legal_deletion_requests_select on public.legal_deletion_requests
for select to authenticated using (
  private.legal_deletion_request_access_allowed(id, 'legal.deletion.view')
);
create policy legal_deletion_objects_select on public.legal_deletion_objects
for select to authenticated using (
  private.legal_deletion_request_access_allowed(request_id, 'legal.deletion.view')
);
create policy legal_deletion_events_select on public.legal_deletion_events
for select to authenticated using (
  private.legal_deletion_request_access_allowed(request_id, 'legal.deletion.view')
);

revoke all on function private.validate_legal_deletion_policy() from public, anon, authenticated;
revoke all on function private.validate_legal_deletion_request() from public, anon, authenticated;
revoke all on function private.prevent_legal_deletion_request_invalid_mutation()
  from public, anon, authenticated;
revoke all on function private.prevent_legal_deletion_request_delete()
  from public, anon, authenticated;
revoke all on function private.prevent_legal_deletion_object_invalid_mutation()
  from public, anon, authenticated;
revoke all on function private.prevent_legal_deletion_history_mutation()
  from public, anon, authenticated;
revoke all on function private.apply_legal_deletion_approval_result()
  from public, anon, authenticated;
revoke all on function private.legal_deletion_request_membership_access_allowed(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function private.legal_deletion_request_membership_access_allowed(uuid, uuid, text)
  to service_role;
revoke all on function private.legal_deletion_request_access_allowed(uuid, text) from public, anon;
grant execute on function private.legal_deletion_request_access_allowed(uuid, text)
  to authenticated, service_role;
