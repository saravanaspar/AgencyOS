-- Replace provider-specific persisted labels with the provider-neutral object-storage contract.

alter table public.hr_document_template_defaults
  drop constraint hr_document_template_defaults_source_pair,
  drop constraint hr_document_template_defaults_source_valid;

update public.hr_document_template_defaults
set source_type = 'object_storage'
where source_type = 'minio';

alter table public.hr_document_template_defaults
  add constraint hr_document_template_defaults_source_valid
    check (source_type in ('builtin', 'object_storage')),
  add constraint hr_document_template_defaults_source_pair check (
    (source_type = 'builtin' and builtin_key is not null and custom_template_id is null)
    or (
      source_type = 'object_storage'
      and builtin_key is null
      and custom_template_id is not null
    )
  );

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
  if new.source_type = 'object_storage' and not exists (
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

alter table public.hr_employee_documents
  drop constraint hr_employee_documents_template_pair,
  drop constraint hr_employee_documents_template_source_valid;

update public.hr_employee_documents
set template_source = 'object_storage'
where template_source = 'minio';

alter table public.hr_employee_documents
  add constraint hr_employee_documents_template_source_valid
    check (template_source in ('builtin', 'object_storage')),
  add constraint hr_employee_documents_template_pair check (
    (
      template_source = 'builtin'
      and builtin_template_key is not null
      and custom_template_id is null
    )
    or (
      template_source = 'object_storage'
      and builtin_template_key is null
      and custom_template_id is not null
    )
  );

alter table public.security_restore_drills
  drop constraint security_restore_drills_type_valid;

update public.security_restore_drills
set drill_type = 'object_storage'
where drill_type = 'minio';

alter table public.security_restore_drills
  add constraint security_restore_drills_type_valid check (
    drill_type in ('database', 'object_storage', 'configuration', 'redis', 'automation', 'full')
  );

comment on column public.hr_document_template_defaults.source_type is
  'Template source: built-in application template or provider-neutral private object storage.';
comment on column public.hr_employee_documents.template_source is
  'Template source recorded when the immutable employee document was rendered.';
