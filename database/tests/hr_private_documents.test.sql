begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(14);

select has_table('public', 'hr_document_templates', 'HR document templates table exists');
select has_table('public', 'hr_document_template_defaults', 'HR document template defaults table exists');
select has_table('public', 'hr_employee_documents', 'HR employee documents table exists');

select ok(
  exists(
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'hr_document_templates'
      and policyname = 'hr_document_templates_select_authorized'
  ),
  'template metadata has an explicit select policy'
);
select ok(
  exists(
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'hr_document_template_defaults'
      and policyname = 'hr_document_template_defaults_select_authorized'
  ),
  'template defaults have an explicit select policy'
);
select ok(
  exists(
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'hr_employee_documents'
      and policyname = 'hr_employee_documents_select_authorized'
  ),
  'employee documents have an explicit scoped select policy'
);

select ok(
  exists(
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'hr_document_template_defaults'
      and c.contype = 'p'
      and pg_get_constraintdef(c.oid) = 'PRIMARY KEY (organization_id, document_type)'
  ),
  'one default exists per document type and organization'
);
select ok(
  exists(
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'hr_employee_documents'
      and indexdef ilike 'CREATE UNIQUE INDEX%private_file_id%'
  ),
  'one private file links to one employee document'
);
select ok(
  exists(
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'hr_document_templates_name_version_unique'
  ),
  'template names have immutable versions'
);
select ok(
  exists(
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'hr_employee_documents_reference_idx'
  ),
  'document reference history is indexed'
);

select ok(
  exists(select 1 from public.permissions where key = 'hr.document_template.manage' and is_sensitive),
  'template management is a sensitive permission'
);
select ok(
  exists(select 1 from public.permissions where key = 'hr.employee_document.view' and is_sensitive),
  'private document view is a sensitive permission'
);
select ok(
  exists(
    select 1
    from public.role_template_permissions rtp
    join public.permissions p on p.id = rtp.permission_id
    where rtp.role_template_key = 'employee'
      and p.key = 'hr.employee_document.view'
      and rtp.scope = 'own'
  ),
  'employees receive own-scope private document view'
);
select ok(
  not exists(
    select 1
    from public.role_template_permissions rtp
    join public.permissions p on p.id = rtp.permission_id
    where rtp.role_template_key = 'team_lead'
      and p.resource in ('document_template', 'employee_document')
  ),
  'team leads receive no private HR document access by default'
);

select * from finish();
rollback;
