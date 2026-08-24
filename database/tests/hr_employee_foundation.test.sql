begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(14);

select has_table('public', 'hr_designations', 'HR designation catalogue exists');
select has_table('public', 'hr_employee_profiles', 'HR employee profiles exist');
select has_column('public', 'hr_employee_profiles', 'membership_id', 'Employee profile reuses membership identity');
select has_column('public', 'hr_employee_profiles', 'lifecycle_status', 'Employee lifecycle status is stored');
select has_column('public', 'hr_employee_profiles', 'designation_id', 'Employee profile links to a designation');
select col_is_fk('public', 'hr_employee_profiles', 'membership_id', 'Employee membership is protected by a foreign key');
select col_is_fk('public', 'hr_employee_profiles', 'designation_id', 'Employee designation is protected by a foreign key');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.hr_designations'::regclass),
  'Designation RLS is enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.hr_employee_profiles'::regclass),
  'Employee profile RLS is enabled'
);
select is(
  (select count(*)::integer from public.permissions where key in (
    'hr.employee.view', 'hr.employee.create', 'hr.employee.update',
    'hr.employee.update_self', 'hr.designation.view', 'hr.designation.manage'
  )),
  6,
  'HR employee and designation permission catalogue is complete'
);
select is(
  (select scope from public.role_template_permissions as grant_row
   join public.permissions as permission on permission.id = grant_row.permission_id
   where grant_row.role_template_key = 'employee' and permission.key = 'hr.employee.view'),
  'own',
  'Employees can view only their own HR record by default'
);
select is(
  (select scope from public.role_template_permissions as grant_row
   join public.permissions as permission on permission.id = grant_row.permission_id
   where grant_row.role_template_key = 'team_lead' and permission.key = 'hr.employee.view'),
  'managed_employees',
  'Team leads receive managed-employee visibility'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'hr_employee_profiles'
      and policyname = 'hr_employee_profiles_select_authorized'
  ),
  'Employee profile select policy exists'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'hr_employee_profiles'
      and policyname = 'hr_employee_profiles_update_authorized'
  ),
  'Employee profile update policy exists'
);

select * from finish();
rollback;
