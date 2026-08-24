-- Private employee supporting documents. Metadata is separate from generated legal letters,
-- while files reuse the shared quarantine, malware scanning, integrity, MinIO, and audit pipeline.

set lock_timeout = '10s';
set statement_timeout = '120s';

insert into public.permissions (module, resource, action, description, is_sensitive)
values
  ('hr', 'employee_supporting_document', 'view', 'View private employee supporting documents inside the effective employee scope.', true),
  ('hr', 'employee_supporting_document', 'manage', 'Upload, review, replace, and control visibility of private employee supporting documents.', true),
  ('hr', 'employee_supporting_document', 'upload_own', 'Upload allowed supporting documents for the current employee record.', true)
on conflict (module, resource, action) do update
set description = excluded.description, is_sensitive = excluded.is_sensitive;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'organization'
from public.role_templates as role_template
cross join public.permissions as permission
where role_template.key in ('owner', 'hr_manager')
  and permission.module = 'hr'
  and permission.resource = 'employee_supporting_document'
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'employee', permission.id, 'own'
from public.permissions as permission
where permission.key in (
  'hr.employee_supporting_document.view',
  'hr.employee_supporting_document.upload_own'
)
on conflict (role_template_key, permission_id) do update set scope = excluded.scope;

insert into public.role_permissions (role_id, permission_id, scope, conditions)
select role.id, template_permission.permission_id, template_permission.scope,
  template_permission.conditions
from public.roles as role
join public.role_template_permissions as template_permission
  on template_permission.role_template_key = role.template_key
join public.permissions as permission on permission.id = template_permission.permission_id
where permission.module = 'hr'
  and permission.resource = 'employee_supporting_document'
on conflict (role_id, permission_id) do update
set scope = excluded.scope, conditions = excluded.conditions, updated_at = now();

create table public.hr_employee_supporting_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  category text not null,
  title text not null,
  internal_reference text not null,
  issuer text,
  identifier_suffix text,
  issued_date date,
  expiry_date date,
  employee_visible boolean not null default true,
  review_status text not null default 'pending',
  reviewed_at timestamptz,
  reviewed_by_membership_id uuid references public.memberships(id) on delete set null,
  status text not null default 'current',
  version integer not null,
  sha256 text not null,
  private_file_id uuid not null unique references public.private_files(id) on delete restrict,
  supersedes_document_id uuid references public.hr_employee_supporting_documents(id) on delete restrict,
  uploaded_by_membership_id uuid not null references public.memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint hr_employee_supporting_documents_category_valid check (
    category in (
      'identification', 'education', 'certificate', 'visa_work_permit',
      'background_check', 'exit_document'
    )
  ),
  constraint hr_employee_supporting_documents_title_valid check (
    char_length(btrim(title)) between 2 and 180
  ),
  constraint hr_employee_supporting_documents_reference_valid check (
    char_length(internal_reference) between 1 and 80
    and internal_reference ~ '^[A-Z0-9][A-Z0-9._/-]*$'
  ),
  constraint hr_employee_supporting_documents_issuer_valid check (
    issuer is null or char_length(btrim(issuer)) between 1 and 180
  ),
  constraint hr_employee_supporting_documents_identifier_suffix_valid check (
    identifier_suffix is null or identifier_suffix ~ '^[A-Z0-9]{1,4}$'
  ),
  constraint hr_employee_supporting_documents_identifier_category_valid check (
    identifier_suffix is null or category in ('identification', 'certificate', 'visa_work_permit')
  ),
  constraint hr_employee_supporting_documents_dates_valid check (
    issued_date is null or expiry_date is null or expiry_date >= issued_date
  ),
  constraint hr_employee_supporting_documents_review_valid check (
    review_status in ('pending', 'verified', 'rejected')
  ),
  constraint hr_employee_supporting_documents_review_pair check (
    (review_status = 'pending' and reviewed_at is null and reviewed_by_membership_id is null)
    or (review_status in ('verified', 'rejected') and reviewed_at is not null and reviewed_by_membership_id is not null)
  ),
  constraint hr_employee_supporting_documents_status_valid check (
    status in ('current', 'superseded', 'withdrawn')
  ),
  constraint hr_employee_supporting_documents_version_valid check (version > 0),
  constraint hr_employee_supporting_documents_sha_valid check (sha256 ~ '^[a-f0-9]{64}$'),
  unique (organization_id, membership_id, category, internal_reference, version),
  unique (organization_id, membership_id, category, internal_reference, sha256)
);

create unique index hr_employee_supporting_documents_current_unique
  on public.hr_employee_supporting_documents (
    organization_id, membership_id, category, internal_reference
  ) where status = 'current';
create index hr_employee_supporting_documents_member_idx
  on public.hr_employee_supporting_documents (
    organization_id, membership_id, category, created_at desc
  );
create index hr_employee_supporting_documents_expiry_idx
  on public.hr_employee_supporting_documents (organization_id, expiry_date)
  where status = 'current' and expiry_date is not null;
create index hr_employee_supporting_documents_review_idx
  on public.hr_employee_supporting_documents (organization_id, review_status, created_at desc)
  where status = 'current';

create or replace function private.validate_hr_employee_supporting_document()
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
    raise exception using errcode = '23514', message = 'hr-supporting-document-membership-mismatch';
  end if;
  if not exists (
    select 1 from public.memberships as uploader
    where uploader.id = new.uploaded_by_membership_id
      and uploader.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'hr-supporting-document-uploader-mismatch';
  end if;
  if new.reviewed_by_membership_id is not null and not exists (
    select 1 from public.memberships as reviewer
    where reviewer.id = new.reviewed_by_membership_id
      and reviewer.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'hr-supporting-document-reviewer-mismatch';
  end if;
  if not exists (
    select 1 from public.private_files as file
    where file.id = new.private_file_id
      and file.organization_id = new.organization_id
      and file.module_key = 'hr'
      and file.entity_type = 'hr_employee_supporting_document'
      and file.entity_id = new.id
  ) then
    raise exception using errcode = '23514', message = 'hr-supporting-document-private-file-mismatch';
  end if;
  if new.supersedes_document_id is not null and not exists (
    select 1 from public.hr_employee_supporting_documents as prior
    where prior.id = new.supersedes_document_id
      and prior.organization_id = new.organization_id
      and prior.membership_id = new.membership_id
      and prior.category = new.category
      and prior.internal_reference = new.internal_reference
      and prior.version < new.version
  ) then
    raise exception using errcode = '23514', message = 'hr-supporting-document-supersedes-mismatch';
  end if;
  return new;
end;
$$;

create trigger hr_employee_supporting_documents_validate
before insert or update on public.hr_employee_supporting_documents
for each row execute function private.validate_hr_employee_supporting_document();

alter table public.hr_employee_supporting_documents enable row level security;

revoke all on public.hr_employee_supporting_documents from public, anon, authenticated;
grant select on public.hr_employee_supporting_documents to authenticated;
grant all on public.hr_employee_supporting_documents to service_role;

create policy hr_employee_supporting_documents_select_authorized
on public.hr_employee_supporting_documents for select to authenticated
using (
  private.has_permission(organization_id, 'hr.employee_supporting_document.view')
  and private.crm_scope_allows_membership(
    private.current_membership_id(organization_id),
    private.effective_permission_scope(organization_id, 'hr.employee_supporting_document.view'),
    membership_id,
    membership_id
  )
  and (
    private.effective_permission_scope(
      organization_id, 'hr.employee_supporting_document.view'
    ) <> 'own'
    or employee_visible = true
  )
);

comment on table public.hr_employee_supporting_documents is
  'Immutable scanner-gated employee supporting-document versions. Full identifiers are not stored as metadata; only an optional final-four suffix is permitted.';
