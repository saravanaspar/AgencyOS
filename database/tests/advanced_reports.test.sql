begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(12);

select has_table('public', 'report_saved_views', 'Saved report views exist');
select has_table('public', 'report_schedules', 'Report schedules exist');
select has_table('public', 'report_snapshots', 'Report snapshots exist');
select has_table('public', 'report_schedule_runs', 'Report schedule runs exist');

select ok(
  exists(select 1 from public.permissions where key = 'reports.schedule.manage' and is_sensitive),
  'Scheduling is a sensitive permission'
);
select ok(
  exists(select 1 from public.permissions where key = 'reports.snapshot.download' and is_sensitive),
  'Snapshot downloads use a sensitive permission'
);
select ok(
  exists(
    select 1 from public.role_template_permissions grant_row
    join public.permissions permission on permission.id = grant_row.permission_id
    where grant_row.role_template_key = 'owner'
      and permission.key = 'reports.schedule.manage'
      and grant_row.scope = 'own'
  ),
  'Owner schedules are restricted to own saved views'
);
select ok(
  not exists(
    select 1 from public.role_template_permissions grant_row
    join public.permissions permission on permission.id = grant_row.permission_id
    where grant_row.role_template_key in ('employee', 'auditor')
      and permission.key in ('reports.schedule.manage', 'reports.snapshot.create')
  ),
  'Employee and Auditor do not receive scheduled delivery by default'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.report_saved_views'::regclass),
  'Saved views have RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.report_schedules'::regclass),
  'Schedules have RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.report_snapshots'::regclass),
  'Snapshots have RLS enabled'
);
select has_trigger(
  'public', 'report_schedule_runs', 'report_schedule_runs_append_only',
  'Schedule run evidence is append-only'
);

select * from finish();
rollback;
