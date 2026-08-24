-- Shared private-file registry, quarantine lifecycle, and malware-scan queue.

set lock_timeout = '10s';
set statement_timeout = '120s';

create table public.private_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  uploaded_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  module_key text not null,
  entity_type text not null,
  entity_id uuid not null,
  classification text not null default 'internal',
  original_file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  sha256 text not null,
  version integer not null default 1,
  status text not null default 'quarantined',
  retention_state text not null default 'active',
  quarantine_bucket text,
  quarantine_path text,
  quarantine_purged_at timestamptz,
  clean_target_path text not null,
  storage_bucket text,
  storage_path text,
  access_rules jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  scan_attempt_count integer not null default 0,
  scan_engine text,
  scan_signature text,
  scan_provider_reference text,
  scan_error_code text,
  scan_requested_at timestamptz not null default now(),
  scan_started_at timestamptz,
  scan_completed_at timestamptz,
  next_scan_at timestamptz default now(),
  locked_at timestamptz,
  lock_token uuid,
  available_at timestamptz,
  purge_after timestamptz,
  purged_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint private_files_module_key_valid check (module_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint private_files_entity_type_valid check (entity_type ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint private_files_classification_valid check (classification in ('internal', 'confidential', 'restricted')),
  constraint private_files_name_not_blank check (btrim(original_file_name) <> ''),
  constraint private_files_mime_not_blank check (btrim(mime_type) <> ''),
  constraint private_files_size_valid check (size_bytes between 1 and 26214400),
  constraint private_files_sha_valid check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint private_files_version_positive check (version > 0),
  constraint private_files_status_valid check (status in ('quarantined', 'scanning', 'available', 'rejected', 'scan_failed', 'deleted')),
  constraint private_files_retention_state_valid check (retention_state in ('active', 'hold', 'expired', 'deleted')),
  constraint private_files_access_rules_object check (jsonb_typeof(access_rules) = 'object'),
  constraint private_files_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint private_files_scan_attempts_valid check (scan_attempt_count between 0 and 5),
  constraint private_files_lock_pair check ((locked_at is null) = (lock_token is null)),
  constraint private_files_quarantine_pair check ((quarantine_bucket is null) = (quarantine_path is null)),
  constraint private_files_quarantine_bucket_contract check (quarantine_path is null or quarantine_bucket = 'private-file-quarantine'),
  constraint private_files_storage_pair check ((storage_bucket is null) = (storage_path is null)),
  constraint private_files_status_contract check (
    (status = 'quarantined' and quarantine_path is not null and storage_path is null and deleted_at is null)
    or (status = 'scanning' and quarantine_path is not null and storage_path is null and locked_at is not null and deleted_at is null)
    or (status = 'available' and storage_path is not null and scan_completed_at is not null and available_at is not null and deleted_at is null)
    or (status = 'rejected' and scan_completed_at is not null and scan_error_code is not null and deleted_at is null)
    or (status = 'scan_failed' and quarantine_path is not null and scan_error_code is not null and deleted_at is null)
    or (status = 'deleted' and deleted_at is not null)
  )
);

create unique index private_files_active_entity_sha_unique
  on public.private_files (organization_id, module_key, entity_type, entity_id, sha256)
  where status <> 'deleted';
create index private_files_entity_idx
  on public.private_files (organization_id, module_key, entity_type, entity_id, created_at desc);
create index private_files_scan_due_idx
  on public.private_files (next_scan_at, scan_requested_at, created_at)
  where status in ('quarantined', 'scan_failed');
create index private_files_stale_scan_idx
  on public.private_files (locked_at)
  where status = 'scanning';
create index private_files_purge_due_idx
  on public.private_files (purge_after, updated_at)
  where status in ('rejected', 'deleted') and purged_at is null;
create index private_files_quarantine_cleanup_idx
  on public.private_files (purge_after, updated_at)
  where status = 'available' and quarantine_purged_at is null and quarantine_path is not null;

create table public.private_file_events (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.private_files(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_type text not null,
  actor_membership_id uuid references public.memberships(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint private_file_events_type_valid check (event_type ~ '^[a-z][a-z0-9_.]{2,99}$'),
  constraint private_file_events_details_object check (jsonb_typeof(details) = 'object')
);

create index private_file_events_file_idx
  on public.private_file_events (file_id, created_at desc, id desc);
create index private_file_events_tenant_idx
  on public.private_file_events (organization_id, created_at desc);

create or replace function private.validate_private_file_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_membership_organization_id uuid;
begin
  select organization_id
  into v_membership_organization_id
  from public.memberships
  where id = new.uploaded_by_membership_id;

  if v_membership_organization_id is null
     or v_membership_organization_id <> new.organization_id then
    raise exception using
      errcode = '23514',
      message = 'Private file must match its uploader tenant';
  end if;

  return new;
end;
$$;

create or replace function private.validate_private_file_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.organization_id <> new.organization_id
     or old.uploaded_by_membership_id <> new.uploaded_by_membership_id
     or old.module_key <> new.module_key
     or old.entity_type <> new.entity_type
     or old.entity_id <> new.entity_id
     or old.original_file_name <> new.original_file_name
     or old.mime_type <> new.mime_type
     or old.size_bytes <> new.size_bytes
     or old.sha256 <> new.sha256
     or old.version <> new.version
     or old.clean_target_path <> new.clean_target_path
     or old.quarantine_bucket is distinct from new.quarantine_bucket
     or old.quarantine_path is distinct from new.quarantine_path then
    raise exception using
      errcode = '23514',
      message = 'Private file identity and content metadata are immutable';
  end if;

  if old.status <> new.status and not (
    (old.status = 'quarantined' and new.status in ('scanning', 'deleted'))
    or (old.status = 'scanning' and new.status in ('available', 'rejected', 'scan_failed', 'deleted'))
    or (old.status = 'scan_failed' and new.status in ('scanning', 'deleted'))
    or (old.status = 'available' and new.status = 'deleted')
    or (old.status = 'rejected' and new.status = 'deleted')
  ) then
    raise exception using
      errcode = '23514',
      message = 'Invalid private file lifecycle transition';
  end if;

  if old.storage_bucket is distinct from new.storage_bucket
     or old.storage_path is distinct from new.storage_path then
    if not (
      old.status = 'scanning'
      and new.status = 'available'
      and old.storage_bucket is null
      and old.storage_path is null
      and new.storage_bucket = 'private-files'
      and new.storage_path = old.clean_target_path
    ) then
      raise exception using
        errcode = '23514',
        message = 'Private file release storage is immutable';
    end if;
  end if;

  return new;
end;
$$;

create or replace function private.validate_private_file_event_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_file_organization_id uuid;
  v_actor_organization_id uuid;
begin
  select organization_id
  into v_file_organization_id
  from public.private_files
  where id = new.file_id;

  if v_file_organization_id is null or v_file_organization_id <> new.organization_id then
    raise exception using
      errcode = '23514',
      message = 'Private file event must match its file tenant';
  end if;

  if new.actor_membership_id is not null then
    select organization_id
    into v_actor_organization_id
    from public.memberships
    where id = new.actor_membership_id;

    if v_actor_organization_id is null or v_actor_organization_id <> new.organization_id then
      raise exception using
        errcode = '23514',
        message = 'Private file event actor must match its tenant';
    end if;
  end if;

  return new;
end;
$$;

create or replace function private.prevent_private_file_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = '23514',
    message = 'Private file lifecycle history is append-only';
end;
$$;

create or replace function private.prevent_private_file_hard_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = '23514',
    message = 'Private files must use the audited soft-delete lifecycle';
end;
$$;

create trigger private_files_validate_tenant
before insert or update of organization_id, uploaded_by_membership_id
on public.private_files
for each row execute function private.validate_private_file_tenant();

create trigger private_files_validate_transition
before update on public.private_files
for each row execute function private.validate_private_file_transition();

create trigger private_files_set_updated_at
before update on public.private_files
for each row execute function private.set_updated_at();

create trigger private_files_prevent_delete
before delete on public.private_files
for each row execute function private.prevent_private_file_hard_delete();

create trigger private_file_events_validate_tenant
before insert on public.private_file_events
for each row execute function private.validate_private_file_event_tenant();

create trigger private_file_events_prevent_update
before update on public.private_file_events
for each row execute function private.prevent_private_file_event_mutation();

create trigger private_file_events_prevent_delete
before delete on public.private_file_events
for each row execute function private.prevent_private_file_event_mutation();

alter table public.project_task_attachments
  add column private_file_id uuid references public.private_files(id) on delete restrict;

insert into public.private_files (
  id, organization_id, uploaded_by_membership_id, module_key, entity_type, entity_id,
  classification, original_file_name, mime_type, size_bytes, sha256, status,
  quarantine_bucket, quarantine_path, quarantine_purged_at, clean_target_path,
  storage_bucket, storage_path, access_rules, metadata, scan_attempt_count,
  scan_engine, scan_requested_at, scan_completed_at, next_scan_at, available_at, created_at, updated_at
)
select
  attachment.id, attachment.organization_id, attachment.uploaded_by_membership_id,
  'projects', 'project_task', attachment.task_id, 'internal', attachment.file_name,
  attachment.mime_type, attachment.size_bytes, attachment.sha256, 'available',
  null, null, attachment.created_at, attachment.storage_path,
  'project-attachments', attachment.storage_path,
  jsonb_build_object(
    'viewPermission', 'projects.task.view',
    'updatePermission', 'projects.task.update'
  ),
  jsonb_build_object('projectId', attachment.project_id, 'taskId', attachment.task_id, 'legacy', true),
  0, 'legacy-content-validation', attachment.created_at, attachment.created_at,
  null, attachment.created_at, attachment.created_at, attachment.created_at
from public.project_task_attachments as attachment
on conflict (id) do nothing;

alter table public.project_task_attachments
  disable trigger project_task_attachments_prevent_read_only_mutation;

update public.project_task_attachments
set private_file_id = id
where private_file_id is null;

alter table public.project_task_attachments
  enable trigger project_task_attachments_prevent_read_only_mutation;

alter table public.project_task_attachments
  alter column private_file_id set not null,
  add constraint project_task_attachments_private_file_unique unique (private_file_id);

create or replace function private.validate_project_attachment_private_file()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_file public.private_files%rowtype;
begin
  select * into v_file
  from public.private_files
  where id = new.private_file_id;

  if v_file.id is null
     or v_file.organization_id <> new.organization_id
     or v_file.module_key <> 'projects'
     or v_file.entity_type <> 'project_task'
     or v_file.entity_id <> new.task_id
     or v_file.original_file_name <> new.file_name
     or v_file.mime_type <> new.mime_type
     or v_file.size_bytes <> new.size_bytes
     or v_file.sha256 <> new.sha256
     or v_file.uploaded_by_membership_id <> new.uploaded_by_membership_id
     or v_file.status = 'deleted' then
    raise exception using
      errcode = '23514',
      message = 'Project attachment must match its shared private file';
  end if;

  return new;
end;
$$;

create trigger project_task_attachments_validate_private_file
before insert or update of private_file_id, organization_id, task_id, file_name, mime_type,
  size_bytes, sha256, uploaded_by_membership_id
on public.project_task_attachments
for each row execute function private.validate_project_attachment_private_file();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'private-file-quarantine',
  'private-file-quarantine',
  false,
  26214400,
  array['application/octet-stream']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'private-files',
  'private-files',
  false,
  26214400,
  array['image/png', 'image/jpeg', 'application/pdf', 'text/plain', 'text/csv']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter table public.private_files enable row level security;
alter table public.private_file_events enable row level security;

revoke all on public.private_files from anon, authenticated;
revoke all on public.private_file_events from anon, authenticated;
grant all on public.private_files to service_role;
grant all on public.private_file_events to service_role;

revoke all on function private.validate_private_file_tenant() from public, anon, authenticated;
revoke all on function private.validate_private_file_transition() from public, anon, authenticated;
revoke all on function private.validate_private_file_event_tenant() from public, anon, authenticated;
revoke all on function private.prevent_private_file_event_mutation() from public, anon, authenticated;
revoke all on function private.prevent_private_file_hard_delete() from public, anon, authenticated;
revoke all on function private.validate_project_attachment_private_file() from public, anon, authenticated;
