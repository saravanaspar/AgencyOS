begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(19);

select has_table('public', 'hr_salary_structures', 'Salary structures exist');
select has_table('public', 'hr_salary_structure_components', 'Salary components exist');
select has_table('public', 'hr_salary_slips', 'Salary slips exist');
select has_column('public', 'hr_salary_structures', 'effective_from', 'Salary revisions are effective dated');
select has_column('public', 'hr_salary_structures', 'effective_to', 'Salary revisions preserve history');
select has_column('public', 'hr_salary_slips', 'acknowledged_at', 'Salary slips support acknowledgement');
select col_is_fk('public', 'hr_salary_structures', 'membership_id', 'Salary reuses membership identity');
select col_is_fk('public', 'hr_salary_slips', 'private_file_id', 'Salary slips reuse private files');
select ok((select relrowsecurity from pg_class where oid = 'public.hr_salary_structures'::regclass), 'Salary RLS is enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.hr_salary_structure_components'::regclass), 'Component RLS is enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.hr_salary_slips'::regclass), 'Slip RLS is enabled');
select is(
  (select count(*)::integer from public.permissions where key in (
    'hr.salary.view', 'hr.salary.manage', 'hr.salary_slip.view',
    'hr.salary_slip.manage', 'hr.salary_slip.acknowledge'
  )),
  5,
  'Salary permission catalogue is complete'
);
select is(
  (select scope from public.role_template_permissions as grant_row
   join public.permissions as permission on permission.id = grant_row.permission_id
   where grant_row.role_template_key = 'employee' and permission.key = 'hr.salary.view'),
  'own',
  'Employees see only their salary'
);
select is(
  (select count(*)::integer from public.role_template_permissions as grant_row
   join public.permissions as permission on permission.id = grant_row.permission_id
   where grant_row.role_template_key = 'team_lead' and permission.key like 'hr.salary%'),
  0,
  'Team leads receive no salary access automatically'
);
select is(
  (select scope from public.role_template_permissions as grant_row
   join public.permissions as permission on permission.id = grant_row.permission_id
   where grant_row.role_template_key = 'auditor' and permission.key = 'hr.salary_slip.view'),
  'organization',
  'Auditor salary-slip access is explicit'
);
select ok(
  exists (select 1 from pg_trigger where tgrelid = 'public.hr_salary_structures'::regclass
    and tgname = 'hr_salary_structure_prepare_revision' and not tgisinternal),
  'Salary revision trigger exists'
);
select ok(
  exists (select 1 from pg_trigger where tgrelid = 'public.hr_salary_slips'::regclass
    and tgname = 'hr_salary_slip_validate' and not tgisinternal),
  'Salary slip validation trigger exists'
);
select ok(
  exists (select 1 from pg_policies where schemaname = 'public'
    and tablename = 'hr_salary_structures'
    and policyname = 'hr_salary_structures_select_authorized'),
  'Scoped salary select policy exists'
);
select ok(
  exists (select 1 from pg_policies where schemaname = 'public'
    and tablename = 'hr_salary_slips'
    and policyname = 'hr_salary_slips_select_authorized'),
  'Scoped salary-slip select policy exists'
);

select * from finish();
rollback;
