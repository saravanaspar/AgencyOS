begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(15);

select has_table('public', 'hr_attendance_records', 'HR attendance records exist');
select has_table('public', 'hr_attendance_corrections', 'HR attendance corrections exist');
select has_column('public', 'hr_attendance_records', 'attendance_date', 'Attendance date is stored');
select has_column('public', 'hr_attendance_records', 'overtime_minutes', 'Attendance overtime is stored');
select has_column('public', 'hr_attendance_corrections', 'approval_request_id', 'Corrections link to shared approvals');
select col_is_fk('public', 'hr_attendance_records', 'membership_id', 'Attendance reuses membership identity');
select col_is_fk('public', 'hr_attendance_corrections', 'approval_request_id', 'Correction approval link is protected');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.hr_attendance_records'::regclass),
  'Attendance RLS is enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.hr_attendance_corrections'::regclass),
  'Correction RLS is enabled'
);
select is(
  (select count(*)::integer from public.permissions where key in (
    'hr.attendance.view', 'hr.attendance.check', 'hr.attendance.manage',
    'hr.attendance_correction.create'
  )),
  4,
  'Attendance permission catalogue is complete'
);
select is(
  (select scope from public.role_template_permissions as grant_row
   join public.permissions as permission on permission.id = grant_row.permission_id
   where grant_row.role_template_key = 'employee' and permission.key = 'hr.attendance.view'),
  'own',
  'Employees receive own attendance visibility'
);
select is(
  (select scope from public.role_template_permissions as grant_row
   join public.permissions as permission on permission.id = grant_row.permission_id
   where grant_row.role_template_key = 'team_lead' and permission.key = 'hr.attendance.manage'),
  'managed_employees',
  'Team leads manage attendance only for managed employees'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'hr_attendance_records'
      and policyname = 'hr_attendance_records_select_authorized'
  ),
  'Attendance select policy exists'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'hr_attendance_corrections'
      and policyname = 'hr_attendance_corrections_insert_authorized'
  ),
  'Correction insert policy exists'
);
select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.approval_requests'::regclass
      and tgname = 'approval_requests_sync_hr_attendance_correction'
      and not tgisinternal
  ),
  'Approval outcome synchronization trigger exists'
);

select * from finish();
rollback;
