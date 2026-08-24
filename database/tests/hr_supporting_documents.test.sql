begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(19);

select has_table('public', 'hr_employee_supporting_documents', 'supporting-document table exists');
select has_column('public', 'hr_employee_supporting_documents', 'employee_visible', 'employee visibility is explicit');
select has_column('public', 'hr_employee_supporting_documents', 'identifier_suffix', 'only an identifier suffix is stored');
select has_column('public', 'hr_employee_supporting_documents', 'review_status', 'review status is recorded');
select has_column('public', 'hr_employee_supporting_documents', 'private_file_id', 'supporting documents reuse private files');
select has_column('public', 'hr_employee_supporting_documents', 'sha256', 'supporting documents retain a checksum for duplicate prevention');
select has_index('public', 'hr_employee_supporting_documents', 'hr_employee_supporting_documents_current_unique', 'one current version is enforced');
select has_index('public', 'hr_employee_supporting_documents', 'hr_employee_supporting_documents_expiry_idx', 'expiry review is indexed');
select has_index('public', 'hr_employee_supporting_documents', 'hr_employee_supporting_documents_review_idx', 'review queue is indexed');

select ok(
  exists(
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'hr_employee_supporting_documents'
      and c.contype = 'f' and pg_get_constraintdef(c.oid) like '%private_file_id%private_files%'
  ),
  'supporting document links to private files'
);
select ok(
  exists(
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'hr_employee_supporting_documents'
      and c.contype = 'f' and pg_get_constraintdef(c.oid) like '%membership_id%memberships%'
  ),
  'supporting document links to membership'
);
select ok(
  exists(
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'hr_employee_supporting_documents'
      and policyname = 'hr_employee_supporting_documents_select_authorized'
  ),
  'supporting-document RLS policy exists'
);
select ok(
  has_table_privilege('authenticated', 'public.hr_employee_supporting_documents', 'SELECT')
  and not has_table_privilege('authenticated', 'public.hr_employee_supporting_documents', 'INSERT')
  and not has_table_privilege('authenticated', 'public.hr_employee_supporting_documents', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.hr_employee_supporting_documents', 'DELETE'),
  'authenticated users receive read-only table privileges'
);
select ok(
  exists(select 1 from public.permissions where key = 'hr.employee_supporting_document.view' and is_sensitive),
  'supporting-document view permission exists and is sensitive'
);
select ok(
  exists(select 1 from public.permissions where key = 'hr.employee_supporting_document.manage' and is_sensitive),
  'supporting-document manage permission exists and is sensitive'
);
select ok(
  exists(select 1 from public.permissions where key = 'hr.employee_supporting_document.upload_own' and is_sensitive),
  'own upload permission exists and is sensitive'
);
select ok(
  exists(
    select 1 from public.role_template_permissions rtp
    join public.permissions p on p.id = rtp.permission_id
    where rtp.role_template_key = 'employee'
      and p.key = 'hr.employee_supporting_document.view'
      and rtp.scope = 'own'
  ),
  'employees receive own-scope supporting-document visibility'
);
select ok(
  not exists(
    select 1 from public.role_template_permissions rtp
    join public.permissions p on p.id = rtp.permission_id
    where rtp.role_template_key = 'team_lead'
      and p.resource = 'employee_supporting_document'
  ),
  'team leads receive no supporting-document permission by default'
);
select ok(
  exists(
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'validate_hr_employee_supporting_document'
      and p.prosecdef = true
  ),
  'tenant validation trigger function exists and is security definer'
);

select * from finish();
rollback;
