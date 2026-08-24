-- General private document library. Reuses the shared private-file quarantine, MinIO,
-- malware-scanning, integrity, audit, membership, and permission infrastructure.

set lock_timeout = '10s';
set statement_timeout = '120s';

insert into public.permissions (module, resource, action, description, is_sensitive)
values
  ('documents', 'folder', 'manage', 'Create, rename, move, archive, and restore document folders.', true),
  ('documents', 'taxonomy', 'manage', 'Manage document categories and tags.', true),
  ('documents', 'document', 'view', 'View document metadata and permitted version history.', true),
  ('documents', 'document', 'create', 'Create documents and upload immutable versions.', true),
  ('documents', 'document', 'update', 'Update permitted document metadata and entity links.', true),
  ('documents', 'document', 'download', 'Preview or download permitted document versions.', true),
  ('documents', 'document', 'comment', 'Add comments to permitted documents.', true),
  ('documents', 'document', 'manage_access', 'Grant or revoke explicit document access.', true),
  ('documents', 'document', 'legal_hold', 'Apply or release document legal holds.', true),
  ('documents', 'document', 'archive', 'Archive or restore permitted documents.', true)
on conflict (module, resource, action) do update
set description = excluded.description, is_sensitive = excluded.is_sensitive;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'organization'
from public.role_templates as role_template
cross join public.permissions as permission
where permission.module = 'documents'
  and role_template.key in ('owner', 'system_administrator', 'operations_administrator', 'legal_manager')
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'organization'
from public.role_templates as role_template
cross join public.permissions as permission
where permission.key in (
    'documents.document.view', 'documents.document.create', 'documents.document.update',
    'documents.document.download', 'documents.document.comment', 'documents.document.archive'
  )
  and role_template.key in (
    'finance_manager', 'accountant', 'hr_manager', 'project_manager', 'team_lead',
    'sales_manager', 'sales_executive', 'support_manager', 'support_agent'
  )
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'own'
from public.role_templates as role_template
cross join public.permissions as permission
where permission.key in (
    'documents.document.view', 'documents.document.create',
    'documents.document.download', 'documents.document.comment'
  )
  and role_template.key = 'employee'
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'auditor', permission.id, 'organization'
from public.permissions as permission
where permission.key in ('documents.document.view', 'documents.document.download')
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_permissions (role_id, permission_id, scope, conditions)
select role.id, template_permission.permission_id, template_permission.scope,
  template_permission.conditions
from public.roles as role
join public.role_template_permissions as template_permission
  on template_permission.role_template_key = role.template_key
join public.permissions as permission on permission.id = template_permission.permission_id
where permission.module = 'documents'
on conflict (role_id, permission_id) do update
set scope = excluded.scope, conditions = excluded.conditions, updated_at = now();

create table public.document_folders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  parent_folder_id uuid references public.document_folders(id) on delete restrict,
  name text not null,
  description text,
  classification text not null default 'internal',
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_folders_name_valid check (char_length(btrim(name)) between 1 and 120),
  constraint document_folders_description_valid check (
    description is null or char_length(btrim(description)) between 1 and 500
  ),
  constraint document_folders_classification_valid check (
    classification in ('internal', 'confidential', 'restricted')
  ),
  constraint document_folders_not_self_parent check (parent_folder_id is null or parent_folder_id <> id)
);

create unique index document_folders_active_sibling_name_unique
  on public.document_folders (
    organization_id,
    coalesce(parent_folder_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(btrim(name))
  ) where archived_at is null;
create index document_folders_parent_idx
  on public.document_folders (organization_id, parent_folder_id, name);

create table public.document_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'active',
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_categories_name_valid check (char_length(btrim(name)) between 1 and 80),
  constraint document_categories_description_valid check (
    description is null or char_length(btrim(description)) between 1 and 300
  ),
  constraint document_categories_status_valid check (status in ('active', 'inactive')),
  unique (organization_id, name)
);

create table public.document_tags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint document_tags_name_valid check (char_length(btrim(name)) between 1 and 50)
);
create unique index document_tags_name_unique
  on public.document_tags (organization_id, lower(btrim(name)));

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  folder_id uuid references public.document_folders(id) on delete set null,
  category_id uuid references public.document_categories(id) on delete set null,
  title text not null,
  description text,
  classification text not null default 'internal',
  owner_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  current_version_id uuid,
  expiry_date date,
  review_date date,
  retention_until date,
  legal_hold boolean not null default false,
  legal_hold_reason text,
  legal_hold_applied_at timestamptz,
  legal_hold_applied_by_membership_id uuid references public.memberships(id) on delete restrict,
  status text not null default 'active',
  archived_at timestamptz,
  archived_by_membership_id uuid references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint documents_title_valid check (char_length(btrim(title)) between 1 and 180),
  constraint documents_description_valid check (
    description is null or char_length(btrim(description)) between 1 and 2000
  ),
  constraint documents_classification_valid check (
    classification in ('internal', 'confidential', 'restricted')
  ),
  constraint documents_status_valid check (status in ('active', 'archived')),
  constraint documents_archive_contract check (
    (status = 'archived' and archived_at is not null and archived_by_membership_id is not null)
    or (status = 'active' and archived_at is null and archived_by_membership_id is null)
  ),
  constraint documents_legal_hold_contract check (
    (legal_hold and legal_hold_reason is not null and legal_hold_applied_at is not null
      and legal_hold_applied_by_membership_id is not null)
    or (not legal_hold and legal_hold_reason is null and legal_hold_applied_at is null
      and legal_hold_applied_by_membership_id is null)
  ),
  constraint documents_legal_hold_reason_valid check (
    legal_hold_reason is null or char_length(btrim(legal_hold_reason)) between 3 and 1000
  ),
  constraint documents_retention_dates_valid check (
    retention_until is null or expiry_date is null or retention_until >= expiry_date
  )
);
create index documents_library_idx
  on public.documents (organization_id, status, folder_id, category_id, updated_at desc);
create index documents_expiry_idx
  on public.documents (organization_id, expiry_date) where expiry_date is not null;
create index documents_review_idx
  on public.documents (organization_id, review_date) where review_date is not null;
create index documents_retention_idx
  on public.documents (organization_id, retention_until) where retention_until is not null;

create table public.document_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete restrict,
  version_number integer not null,
  private_file_id uuid not null unique references public.private_files(id) on delete restrict,
  version_note text,
  uploaded_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint document_versions_number_valid check (version_number > 0),
  constraint document_versions_note_valid check (
    version_note is null or char_length(btrim(version_note)) between 1 and 500
  ),
  unique (document_id, version_number)
);
create index document_versions_history_idx
  on public.document_versions (document_id, version_number desc);

alter table public.documents
  add constraint documents_current_version_fk
  foreign key (current_version_id) references public.document_versions(id) on delete restrict;

create table public.document_tag_links (
  document_id uuid not null references public.documents(id) on delete cascade,
  tag_id uuid not null references public.document_tags(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (document_id, tag_id)
);

create table public.document_entity_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint document_entity_links_type_valid check (
    entity_type in ('client', 'contact', 'lead', 'project', 'task', 'invoice', 'estimate', 'employee')
  ),
  unique (document_id, entity_type, entity_id)
);
create index document_entity_links_entity_idx
  on public.document_entity_links (organization_id, entity_type, entity_id);

create table public.document_access_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  access_level text not null,
  granted_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_access_grants_level_valid check (
    access_level in ('viewer', 'commenter', 'editor')
  ),
  constraint document_access_grants_expiry_valid check (expires_at is null or expires_at > created_at),
  unique (document_id, membership_id)
);
create index document_access_grants_member_idx
  on public.document_access_grants (organization_id, membership_id, expires_at);

create table public.document_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  body text not null,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint document_comments_body_valid check (char_length(btrim(body)) between 1 and 2000)
);
create index document_comments_document_idx
  on public.document_comments (document_id, created_at, id);

create table public.document_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete restrict,
  version_id uuid references public.document_versions(id) on delete restrict,
  event_type text not null,
  actor_membership_id uuid references public.memberships(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint document_events_type_valid check (event_type ~ '^[a-z][a-z0-9_.]{2,79}$'),
  constraint document_events_details_object check (jsonb_typeof(details) = 'object')
);
create index document_events_history_idx
  on public.document_events (document_id, created_at desc, id desc);

create or replace function private.validate_document_folder()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_parent_organization_id uuid;
  v_cursor uuid;
begin
  if new.parent_folder_id is not null then
    select organization_id into v_parent_organization_id
    from public.document_folders where id = new.parent_folder_id;
    if v_parent_organization_id is null or v_parent_organization_id <> new.organization_id then
      raise exception using errcode = '23514', message = 'Document folder parent must belong to the same organization';
    end if;
    v_cursor := new.parent_folder_id;
    while v_cursor is not null loop
      if v_cursor = new.id then
        raise exception using errcode = '23514', message = 'Document folder hierarchy cannot contain a cycle';
      end if;
      select parent_folder_id into v_cursor from public.document_folders where id = v_cursor;
    end loop;
  end if;
  if not exists (
    select 1 from public.memberships where id = new.created_by_membership_id
      and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Document folder creator must match its organization';
  end if;
  return new;
end;
$$;

create or replace function private.validate_document_record()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_organization_id uuid;
begin
  if new.folder_id is not null then
    select organization_id into v_organization_id from public.document_folders where id = new.folder_id;
    if v_organization_id is null or v_organization_id <> new.organization_id then
      raise exception using errcode = '23514', message = 'Document folder must match its organization';
    end if;
  end if;
  if new.category_id is not null then
    select organization_id into v_organization_id from public.document_categories where id = new.category_id;
    if v_organization_id is null or v_organization_id <> new.organization_id then
      raise exception using errcode = '23514', message = 'Document category must match its organization';
    end if;
  end if;
  if not exists (
    select 1 from public.memberships where id = new.owner_membership_id
      and organization_id = new.organization_id
  ) or not exists (
    select 1 from public.memberships where id = new.created_by_membership_id
      and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Document owner and creator must match its organization';
  end if;
  return new;
end;
$$;

create or replace function private.validate_document_version()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_document_organization_id uuid;
  v_file public.private_files%rowtype;
begin
  select organization_id into v_document_organization_id from public.documents where id = new.document_id;
  select * into v_file from public.private_files where id = new.private_file_id;
  if v_document_organization_id is null or v_document_organization_id <> new.organization_id
     or v_file.id is null or v_file.organization_id <> new.organization_id
     or v_file.module_key <> 'documents' or v_file.entity_type <> 'document'
     or v_file.entity_id <> new.document_id or v_file.uploaded_by_membership_id <> new.uploaded_by_membership_id
     or v_file.status = 'deleted' then
    raise exception using errcode = '23514', message = 'Document version must match its document and private file';
  end if;
  return new;
end;
$$;

create or replace function private.validate_document_current_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.current_version_id is not null and not exists (
    select 1 from public.document_versions
    where id = new.current_version_id and document_id = new.id and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Current version must belong to the document';
  end if;
  return new;
end;
$$;

create or replace function private.validate_document_tag_link()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.documents where id = new.document_id and organization_id = new.organization_id)
     or not exists (select 1 from public.document_tags where id = new.tag_id and organization_id = new.organization_id)
     or not exists (select 1 from public.memberships where id = new.created_by_membership_id and organization_id = new.organization_id) then
    raise exception using errcode = '23514', message = 'Document tag link must remain inside one organization';
  end if;
  return new;
end;
$$;

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
  end case;
  if not v_exists then
    raise exception using errcode = '23514', message = 'Linked entity was not found in this organization';
  end if;
  return new;
end;
$$;

create or replace function private.validate_document_access_grant()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.documents where id = new.document_id and organization_id = new.organization_id)
     or not exists (select 1 from public.memberships where id = new.membership_id and organization_id = new.organization_id and status = 'active')
     or not exists (select 1 from public.memberships where id = new.granted_by_membership_id and organization_id = new.organization_id) then
    raise exception using errcode = '23514', message = 'Document access grant must remain inside one active organization';
  end if;
  return new;
end;
$$;

create or replace function private.validate_document_child_tenant()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.documents where id = new.document_id and organization_id = new.organization_id) then
    raise exception using errcode = '23514', message = 'Document child record must match its organization';
  end if;
  if new.created_by_membership_id is not null and not exists (
    select 1 from public.memberships where id = new.created_by_membership_id and organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'Document child actor must match its organization';
  end if;
  return new;
end;
$$;

create or replace function private.validate_document_event()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.documents where id = new.document_id and organization_id = new.organization_id)
     or (new.version_id is not null and not exists (
       select 1 from public.document_versions where id = new.version_id
         and document_id = new.document_id and organization_id = new.organization_id
     ))
     or (new.actor_membership_id is not null and not exists (
       select 1 from public.memberships where id = new.actor_membership_id and organization_id = new.organization_id
     )) then
    raise exception using errcode = '23514', message = 'Document event must match its document tenant';
  end if;
  return new;
end;
$$;

create or replace function private.prevent_document_immutable_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '23514', message = 'Document versions, comments, and history are append-only';
end;
$$;

create or replace function private.membership_effective_permission_scope(
  p_membership_id uuid,
  p_permission_key text
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_override_effect text;
  v_override_scope text;
  v_role_scope text;
begin
  select membership.organization_id into v_organization_id
  from public.memberships as membership
  join public.organizations as organization
    on organization.id = membership.organization_id and organization.status = 'active'
  where membership.id = p_membership_id and membership.status = 'active';
  if v_organization_id is null then return null; end if;

  select override_grant.effect, override_grant.scope
  into v_override_effect, v_override_scope
  from public.membership_permission_overrides as override_grant
  join public.permissions as permission on permission.id = override_grant.permission_id
  where override_grant.membership_id = p_membership_id
    and permission.key = p_permission_key
    and (override_grant.expires_at is null or override_grant.expires_at > now())
  limit 1;
  if v_override_effect = 'deny' then return null; end if;

  select role_permission.scope into v_role_scope
  from public.membership_roles as assignment
  join public.roles as role on role.id = assignment.role_id
    and role.organization_id = v_organization_id and role.status = 'active'
  join public.role_permissions as role_permission on role_permission.role_id = role.id
  join public.permissions as permission on permission.id = role_permission.permission_id
  where assignment.membership_id = p_membership_id and permission.key = p_permission_key
  order by case role_permission.scope
    when 'organization' then 8 when 'selected_projects' then 7 when 'managed_employees' then 6
    when 'department' then 5 when 'team' then 4 when 'assigned_or_created' then 3
    when 'assigned' then 2 else 1 end desc
  limit 1;

  if v_override_effect = 'allow' then
    return coalesce(v_override_scope, v_role_scope, 'organization');
  end if;
  return v_role_scope;
end;
$$;

-- Preserve the existing current-session API while sharing the same arbitrary-membership
-- resolution with trusted workers and document access checks.
create or replace function private.effective_permission_scope(
  p_organization_id uuid,
  p_permission_key text
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select private.membership_effective_permission_scope(
    private.current_membership_id(p_organization_id), p_permission_key
  )
$$;

create or replace function private.membership_display_name(p_membership_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    employee.preferred_name,
    employee.legal_name,
    profile.display_name,
    nullif(trim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
    split_part(coalesce(auth_user.email, ''), '@', 1),
    'AgencyOS user'
  )
  from public.memberships as membership
  join auth.users as auth_user on auth_user.id = membership.user_id
  left join public.profiles as profile on profile.id = membership.user_id
  left join public.hr_employee_profiles as employee
    on employee.membership_id = membership.id
   and employee.organization_id = membership.organization_id
  where membership.id = p_membership_id
$$;

create or replace function private.document_membership_access_allowed(
  p_document_id uuid,
  p_membership_id uuid,
  p_action text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_document public.documents%rowtype;
  v_permission_key text;
  v_permission_scope text;
  v_grant_level text;
  v_scope_allowed boolean := false;
  v_manage_scope text;
begin
  select * into v_document from public.documents where id = p_document_id;
  if v_document.id is null or not exists (
    select 1 from public.memberships
    where id = p_membership_id and organization_id = v_document.organization_id and status = 'active'
  ) then return false; end if;

  v_permission_key := case p_action
    when 'view' then 'documents.document.view'
    when 'download' then 'documents.document.download'
    when 'comment' then 'documents.document.comment'
    when 'edit' then 'documents.document.update'
    when 'archive' then 'documents.document.archive'
    when 'manage_access' then 'documents.document.manage_access'
    when 'legal_hold' then 'documents.document.legal_hold'
    else null
  end;
  if v_permission_key is null then return false; end if;

  v_permission_scope := private.membership_effective_permission_scope(
    p_membership_id, v_permission_key
  );
  if v_permission_scope is null then return false; end if;

  v_scope_allowed := private.crm_scope_allows_membership(
    p_membership_id,
    v_permission_scope,
    v_document.owner_membership_id,
    v_document.created_by_membership_id
  );

  select access_level into v_grant_level
  from public.document_access_grants
  where document_id = p_document_id and membership_id = p_membership_id
    and (expires_at is null or expires_at > now());

  if p_action = 'manage_access' or p_action = 'legal_hold' then
    return v_scope_allowed;
  end if;

  v_manage_scope := private.membership_effective_permission_scope(
    p_membership_id, 'documents.document.manage_access'
  );
  if v_manage_scope is not null and private.crm_scope_allows_membership(
    p_membership_id,
    v_manage_scope,
    v_document.owner_membership_id,
    v_document.created_by_membership_id
  ) then
    return true;
  end if;

  if p_action in ('view', 'download') and v_grant_level in ('viewer', 'commenter', 'editor') then
    return true;
  end if;
  if p_action = 'comment' and v_grant_level in ('commenter', 'editor') then return true; end if;
  if p_action in ('edit', 'archive') and v_grant_level = 'editor' then return true; end if;
  if not v_scope_allowed then return false; end if;

  if p_action in ('view', 'download') then
    return v_document.classification = 'internal'
      or v_document.owner_membership_id = p_membership_id
      or v_document.created_by_membership_id = p_membership_id;
  elsif p_action = 'comment' then
    return v_document.classification = 'internal'
      or v_document.owner_membership_id = p_membership_id
      or v_document.created_by_membership_id = p_membership_id;
  else
    return v_document.owner_membership_id = p_membership_id
      or v_document.created_by_membership_id = p_membership_id;
  end if;
end;
$$;

create or replace function private.document_access_allowed(
  p_document_id uuid,
  p_action text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_membership_id uuid;
begin
  select organization_id into v_organization_id
  from public.documents where id = p_document_id;
  if v_organization_id is null then return false; end if;
  v_membership_id := private.current_membership_id(v_organization_id);
  if v_membership_id is null then return false; end if;
  return private.document_membership_access_allowed(
    p_document_id, v_membership_id, p_action
  );
end;
$$;

create trigger document_folders_validate
before insert or update of organization_id, parent_folder_id, created_by_membership_id
on public.document_folders for each row execute function private.validate_document_folder();
create trigger document_folders_set_updated_at
before update on public.document_folders for each row execute function private.set_updated_at();
create trigger document_categories_set_updated_at
before update on public.document_categories for each row execute function private.set_updated_at();
create trigger documents_validate
before insert or update of organization_id, folder_id, category_id, owner_membership_id, created_by_membership_id
on public.documents for each row execute function private.validate_document_record();
create trigger documents_validate_current_version
before update of current_version_id on public.documents
for each row execute function private.validate_document_current_version();
create trigger documents_set_updated_at
before update on public.documents for each row execute function private.set_updated_at();
create trigger document_versions_validate
before insert on public.document_versions for each row execute function private.validate_document_version();
create trigger document_versions_prevent_update
before update on public.document_versions for each row execute function private.prevent_document_immutable_mutation();
create trigger document_versions_prevent_delete
before delete on public.document_versions for each row execute function private.prevent_document_immutable_mutation();
create trigger document_tag_links_validate
before insert or update on public.document_tag_links for each row execute function private.validate_document_tag_link();
create trigger document_entity_links_validate
before insert or update on public.document_entity_links for each row execute function private.validate_document_entity_link();
create trigger document_access_grants_validate
before insert or update on public.document_access_grants for each row execute function private.validate_document_access_grant();
create trigger document_access_grants_set_updated_at
before update on public.document_access_grants for each row execute function private.set_updated_at();
create trigger document_comments_validate
before insert on public.document_comments for each row execute function private.validate_document_child_tenant();
create trigger document_comments_prevent_update
before update on public.document_comments for each row execute function private.prevent_document_immutable_mutation();
create trigger document_comments_prevent_delete
before delete on public.document_comments for each row execute function private.prevent_document_immutable_mutation();
create trigger document_events_validate
before insert on public.document_events for each row execute function private.validate_document_event();
create trigger document_events_prevent_update
before update on public.document_events for each row execute function private.prevent_document_immutable_mutation();
create trigger document_events_prevent_delete
before delete on public.document_events for each row execute function private.prevent_document_immutable_mutation();


alter table public.document_folders enable row level security;
alter table public.document_categories enable row level security;
alter table public.document_tags enable row level security;
alter table public.documents enable row level security;
alter table public.document_versions enable row level security;
alter table public.document_tag_links enable row level security;
alter table public.document_entity_links enable row level security;
alter table public.document_access_grants enable row level security;
alter table public.document_comments enable row level security;
alter table public.document_events enable row level security;

revoke all on public.document_folders, public.document_categories, public.document_tags,
  public.documents, public.document_versions, public.document_tag_links,
  public.document_entity_links, public.document_access_grants, public.document_comments,
  public.document_events from anon;
grant select on public.document_folders, public.document_categories, public.document_tags,
  public.document_versions, public.document_tag_links, public.document_entity_links,
  public.document_access_grants, public.document_comments to authenticated;
grant select (
  id, organization_id, folder_id, category_id, title, description, classification,
  owner_membership_id, created_by_membership_id, current_version_id, expiry_date,
  review_date, retention_until, legal_hold, status, archived_at,
  archived_by_membership_id, created_at, updated_at
) on public.documents to authenticated;
grant select (
  id, organization_id, document_id, version_id, event_type, actor_membership_id, created_at
) on public.document_events to authenticated;
grant all on public.document_folders, public.document_categories, public.document_tags,
  public.documents, public.document_versions, public.document_tag_links,
  public.document_entity_links, public.document_access_grants, public.document_comments,
  public.document_events to service_role;

create policy document_folders_select_authorized on public.document_folders
for select to authenticated using (
  private.has_permission(organization_id, 'documents.workspace.view')
  and (
    classification = 'internal'
    or private.has_permission(organization_id, 'documents.folder.manage')
    or exists (
      select 1 from public.documents as document
      where document.folder_id = document_folders.id
        and private.document_access_allowed(document.id, 'view')
    )
  )
);
create policy document_categories_select_authorized on public.document_categories
for select to authenticated using (private.has_permission(organization_id, 'documents.workspace.view'));
create policy document_tags_select_authorized on public.document_tags
for select to authenticated using (private.has_permission(organization_id, 'documents.workspace.view'));
create policy documents_select_authorized on public.documents
for select to authenticated using (
  private.document_access_allowed(id, 'view')
);
create policy document_versions_select_authorized on public.document_versions
for select to authenticated using (
  private.document_access_allowed(document_id, 'view')
);
create policy document_tag_links_select_authorized on public.document_tag_links
for select to authenticated using (
  private.document_access_allowed(document_id, 'view')
);
create policy document_entity_links_select_authorized on public.document_entity_links
for select to authenticated using (
  private.document_access_allowed(document_id, 'view')
);
create policy document_access_grants_select_authorized on public.document_access_grants
for select to authenticated using (
  membership_id = private.current_membership_id(organization_id)
  or private.document_access_allowed(document_id, 'manage_access')
);
create policy document_comments_select_authorized on public.document_comments
for select to authenticated using (
  private.document_access_allowed(document_id, 'view')
);
create policy document_events_select_authorized on public.document_events
for select to authenticated using (
  private.document_access_allowed(document_id, 'view')
);

revoke all on function private.validate_document_folder() from public, anon, authenticated;
revoke all on function private.validate_document_record() from public, anon, authenticated;
revoke all on function private.validate_document_version() from public, anon, authenticated;
revoke all on function private.validate_document_current_version() from public, anon, authenticated;
revoke all on function private.validate_document_tag_link() from public, anon, authenticated;
revoke all on function private.validate_document_entity_link() from public, anon, authenticated;
revoke all on function private.validate_document_access_grant() from public, anon, authenticated;
revoke all on function private.validate_document_child_tenant() from public, anon, authenticated;
revoke all on function private.validate_document_event() from public, anon, authenticated;
revoke all on function private.prevent_document_immutable_mutation() from public, anon, authenticated;
revoke all on function private.membership_effective_permission_scope(uuid, text) from public, anon, authenticated;
grant execute on function private.membership_effective_permission_scope(uuid, text) to service_role;
revoke all on function private.membership_display_name(uuid) from public, anon, authenticated;
grant execute on function private.membership_display_name(uuid) to service_role;
revoke all on function private.document_membership_access_allowed(uuid, uuid, text) from public, anon, authenticated;
grant execute on function private.document_membership_access_allowed(uuid, uuid, text) to service_role;
revoke all on function private.document_access_allowed(uuid, text) from public, anon;
grant execute on function private.document_access_allowed(uuid, text) to authenticated, service_role;
