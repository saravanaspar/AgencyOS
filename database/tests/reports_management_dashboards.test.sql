begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(8);

select has_table('public', 'audit_events', 'Report export evidence uses the shared audit log');
select has_table('public', 'finance_invoices', 'Reports read the canonical finance ledger');
select has_table('public', 'project_time_entries', 'Reports read canonical project time entries');

select ok(
  exists(select 1 from public.permissions where key = 'reports.export.create' and is_sensitive),
  'Report export permission is registered as sensitive'
);

select ok(
  exists(
    select 1
    from public.role_template_permissions grant_row
    join public.permissions permission on permission.id = grant_row.permission_id
    where grant_row.role_template_key = 'owner'
      and permission.key = 'reports.export.create'
      and grant_row.scope = 'organization'
  ),
  'Owner can export reports'
);

select ok(
  not exists(
    select 1
    from public.role_template_permissions grant_row
    join public.permissions permission on permission.id = grant_row.permission_id
    where grant_row.role_template_key in ('employee', 'auditor', 'support_agent', 'sales_executive')
      and permission.key = 'reports.export.create'
  ),
  'Employee, Auditor, Support Agent, and Sales Executive do not receive report export by default'
);

select ok(
  exists(
    select 1
    from public.role_template_permissions grant_row
    join public.permissions permission on permission.id = grant_row.permission_id
    where grant_row.role_template_key = 'finance_manager'
      and permission.key = 'reports.export.create'
  ),
  'Finance Manager can export authorized reports'
);

select ok(
  exists(
    select 1
    from public.role_template_permissions grant_row
    join public.permissions permission on permission.id = grant_row.permission_id
    where grant_row.role_template_key = 'support_manager'
      and permission.key = 'reports.export.create'
  ),
  'Support Manager can export authorized reports'
);

select * from finish();
rollback;
