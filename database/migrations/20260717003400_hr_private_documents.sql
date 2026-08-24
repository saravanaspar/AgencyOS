-- HR private documents and swappable legal-template sources. Generated document versions
-- are immutable private files; template defaults can point to built-in or private MinIO HTML.

set lock_timeout = '10s';
set statement_timeout = '120s';

insert into public.permissions (module, resource, action, description, is_sensitive)
values
  ('hr', 'document_template', 'view', 'View HR legal-document template metadata.', true),
  ('hr', 'document_template', 'manage', 'Upload, activate, and choose HR legal-document templates.', true),
  ('hr', 'employee_document', 'view', 'View private employee documents inside the effective employee scope.', true),
  ('hr', 'employee_document', 'manage', 'Generate immutable private employee documents.', true),
  ('hr', 'employee_document', 'acknowledge', 'Acknowledge the current employee private documents.', true)
on conflict (module, resource, action) do update
set description = excluded.description, is_sensitive = excluded.is_sensitive;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'organization'
from public.role_templates as role_template
cross join public.permissions as permission
where role_template.key in ('owner', 'hr_manager')
  and permission.module = 'hr'
  and permission.resource in ('document_template', 'employee_document')
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'employee', permission.id, 'own'
from public.permissions as permission
where permission.key in ('hr.employee_document.view', 'hr.employee_document.acknowledge')
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_permissions (role_id, permission_id, scope, conditions)
select role.id, template_permission.permission_id, template_permission.scope,
  template_permission.conditions
from public.roles as role
join public.role_template_permissions as template_permission
  on template_permission.role_template_key = role.template_key
join public.permissions as permission on permission.id = template_permission.permission_id
where permission.module = 'hr'
  and permission.resource in ('document_template', 'employee_document')
on conflict (role_id, permission_id) do update
set scope = excluded.scope, conditions = excluded.conditions, updated_at = now();

create table public.hr_document_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_type text not null,
  name text not null,
  description text,
  version integer not null,
  status text not null default 'active',
  storage_bucket text not null,
  storage_path text not null,
  sha256 text not null,
  size_bytes bigint not null,
  original_file_name text not null,
  placeholder_keys jsonb not null default '[]'::jsonb,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_document_templates_type_valid check (
    document_type in ('offer_letter', 'appointment_letter', 'employment_agreement', 'nda')
  ),
  constraint hr_document_templates_name_valid check (char_length(btrim(name)) between 2 and 160),
  constraint hr_document_templates_description_valid check (
    description is null or char_length(description) <= 1000
  ),
  constraint hr_document_templates_version_valid check (version > 0),
  constraint hr_document_templates_status_valid check (status in ('active', 'inactive')),
  constraint hr_document_templates_bucket_valid check (storage_bucket = 'document-templates'),
  constraint hr_document_templates_storage_path_valid check (
    storage_path <> '' and storage_path !~ '(^/|\\|(^|/)\.\.?(/|$))'
  ),
  constraint hr_document_templates_sha_valid check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint hr_document_templates_size_valid check (size_bytes between 1 and 524288),
  constraint hr_document_templates_file_name_valid check (
    char_length(btrim(original_file_name)) between 1 and 180
  ),
  constraint hr_document_templates_placeholders_array check (
    jsonb_typeof(placeholder_keys) = 'array'
  ),
  unique (organization_id, storage_bucket, storage_path)
);

create unique index hr_document_templates_name_version_unique
  on public.hr_document_templates (organization_id, document_type, lower(name), version);

create index hr_document_templates_lookup_idx
  on public.hr_document_templates (organization_id, document_type, status, lower(name), version desc);

create table public.hr_document_template_defaults (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_type text not null,
  source_type text not null,
  builtin_key text,
  custom_template_id uuid references public.hr_document_templates(id) on delete restrict,
  updated_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (organization_id, document_type),
  constraint hr_document_template_defaults_type_valid check (
    document_type in ('offer_letter', 'appointment_letter', 'employment_agreement', 'nda')
  ),
  constraint hr_document_template_defaults_source_valid check (source_type in ('builtin', 'minio')),
  constraint hr_document_template_defaults_builtin_valid check (
    builtin_key is null or builtin_key in ('offer_letter', 'appointment_letter', 'employment_agreement', 'nda')
  ),
  constraint hr_document_template_defaults_source_pair check (
    (source_type = 'builtin' and builtin_key is not null and custom_template_id is null)
    or (source_type = 'minio' and builtin_key is null and custom_template_id is not null)
  )
);

create table public.hr_employee_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  document_type text not null,
  title text not null,
  internal_reference text not null,
  version integer not null,
  effective_date date not null,
  expiry_date date,
  status text not null default 'issued',
  template_source text not null,
  builtin_template_key text,
  custom_template_id uuid references public.hr_document_templates(id) on delete restrict,
  template_name text not null,
  template_version integer not null,
  template_sha256 text not null,
  render_context jsonb not null default '{}'::jsonb,
  private_file_id uuid not null unique references public.private_files(id) on delete restrict,
  original_file_name text not null,
  supersedes_document_id uuid references public.hr_employee_documents(id) on delete restrict,
  acknowledged_at timestamptz,
  acknowledged_by_membership_id uuid references public.memberships(id) on delete set null,
  created_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint hr_employee_documents_type_valid check (
    document_type in ('offer_letter', 'appointment_letter', 'employment_agreement', 'nda')
  ),
  constraint hr_employee_documents_title_valid check (char_length(btrim(title)) between 2 and 180),
  constraint hr_employee_documents_reference_valid check (
    char_length(internal_reference) between 1 and 80
    and internal_reference ~ '^[A-Z0-9][A-Z0-9._/-]*$'
  ),
  constraint hr_employee_documents_version_valid check (version > 0),
  constraint hr_employee_documents_dates_valid check (
    expiry_date is null or expiry_date >= effective_date
  ),
  constraint hr_employee_documents_status_valid check (status in ('issued', 'superseded')),
  constraint hr_employee_documents_template_source_valid check (template_source in ('builtin', 'minio')),
  constraint hr_employee_documents_template_pair check (
    (template_source = 'builtin' and builtin_template_key is not null and custom_template_id is null)
    or (template_source = 'minio' and builtin_template_key is null and custom_template_id is not null)
  ),
  constraint hr_employee_documents_template_version_valid check (template_version > 0),
  constraint hr_employee_documents_template_sha_valid check (template_sha256 ~ '^[0-9a-f]{64}$'),
  constraint hr_employee_documents_render_context_object check (jsonb_typeof(render_context) = 'object'),
  constraint hr_employee_documents_ack_pair check (
    (acknowledged_at is null and acknowledged_by_membership_id is null)
    or (acknowledged_at is not null and acknowledged_by_membership_id is not null)
  ),
  unique (organization_id, membership_id, document_type, internal_reference, version)
);

create index hr_employee_documents_member_idx
  on public.hr_employee_documents (organization_id, membership_id, created_at desc);
create index hr_employee_documents_reference_idx
  on public.hr_employee_documents (
    organization_id, membership_id, document_type, internal_reference, version desc
  );

create or replace function private.validate_hr_document_template()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.memberships as creator
    where creator.id = new.created_by_membership_id
      and creator.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'hr-document-template-creator-mismatch';
  end if;
  return new;
end;
$$;

create trigger hr_document_template_validate
before insert or update on public.hr_document_templates
for each row execute function private.validate_hr_document_template();

create or replace function private.validate_hr_document_template_default()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.memberships as updater
    where updater.id = new.updated_by_membership_id
      and updater.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'hr-document-template-default-updater-mismatch';
  end if;
  if new.source_type = 'builtin' and new.builtin_key <> new.document_type then
    raise exception using errcode = '23514', message = 'hr-document-template-default-builtin-type-mismatch';
  end if;
  if new.source_type = 'minio' and not exists (
    select 1 from public.hr_document_templates as template
    where template.id = new.custom_template_id
      and template.organization_id = new.organization_id
      and template.document_type = new.document_type
      and template.status = 'active'
  ) then
    raise exception using errcode = '23514', message = 'hr-document-template-default-custom-mismatch';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger hr_document_template_default_validate
before insert or update on public.hr_document_template_defaults
for each row execute function private.validate_hr_document_template_default();

create or replace function private.validate_hr_employee_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.memberships as member
    where member.id = new.membership_id and member.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'hr-employee-document-membership-mismatch';
  end if;
  if not exists (
    select 1 from public.memberships as creator
    where creator.id = new.created_by_membership_id and creator.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'hr-employee-document-creator-mismatch';
  end if;
  if new.custom_template_id is not null and not exists (
    select 1 from public.hr_document_templates as template
    where template.id = new.custom_template_id
      and template.organization_id = new.organization_id
      and template.document_type = new.document_type
  ) then
    raise exception using errcode = '23514', message = 'hr-employee-document-template-mismatch';
  end if;
  if not exists (
    select 1 from public.private_files as file
    where file.id = new.private_file_id
      and file.organization_id = new.organization_id
      and file.module_key = 'hr'
      and file.entity_type = 'hr_employee_document'
      and file.entity_id = new.id
  ) then
    raise exception using errcode = '23514', message = 'hr-employee-document-private-file-mismatch';
  end if;
  if new.acknowledged_by_membership_id is not null and new.acknowledged_by_membership_id <> new.membership_id then
    raise exception using errcode = '23514', message = 'hr-employee-document-acknowledger-mismatch';
  end if;
  return new;
end;
$$;

create trigger hr_employee_document_validate
before insert or update on public.hr_employee_documents
for each row execute function private.validate_hr_employee_document();

alter table public.hr_document_templates enable row level security;
alter table public.hr_document_template_defaults enable row level security;
alter table public.hr_employee_documents enable row level security;

revoke all on public.hr_document_templates from public, anon, authenticated;
revoke all on public.hr_document_template_defaults from public, anon, authenticated;
revoke all on public.hr_employee_documents from public, anon, authenticated;
grant select on public.hr_document_templates to authenticated;
grant select on public.hr_document_template_defaults to authenticated;
grant select on public.hr_employee_documents to authenticated;
grant all on public.hr_document_templates to service_role;
grant all on public.hr_document_template_defaults to service_role;
grant all on public.hr_employee_documents to service_role;

create policy hr_document_templates_select_authorized
on public.hr_document_templates for select to authenticated
using (private.has_permission(organization_id, 'hr.document_template.view'));

create policy hr_document_template_defaults_select_authorized
on public.hr_document_template_defaults for select to authenticated
using (private.has_permission(organization_id, 'hr.document_template.view'));

create policy hr_employee_documents_select_authorized
on public.hr_employee_documents for select to authenticated
using (
  private.has_permission(organization_id, 'hr.employee_document.view')
  and private.crm_scope_allows_membership(
    private.current_membership_id(organization_id),
    private.effective_permission_scope(organization_id, 'hr.employee_document.view'),
    membership_id,
    membership_id
  )
);

comment on table public.hr_document_templates is
  'Immutable metadata for sanitized HR legal-document HTML versions stored in the private MinIO document-templates bucket.';
comment on table public.hr_employee_documents is
  'Immutable generated private employee-document versions linked to scanner-gated private PDFs.';
