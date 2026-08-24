begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(26);

select has_table('public', 'hr_leave_types', 'Leave policies exist');
select has_table('public', 'hr_leave_balances', 'Leave balances exist');
select has_table('public', 'hr_leave_requests', 'Leave requests exist');
select has_table('public', 'hr_leave_request_attachments', 'Leave evidence links exist');
select has_table('public', 'hr_leave_balance_events', 'Leave balance history exists');
select has_column('public', 'hr_leave_types', 'requires_hr_approval', 'Policy can require HR approval');
select has_column('public', 'hr_leave_types', 'attachment_required_after_days', 'Policy can require evidence');
select has_column('public', 'hr_leave_requests', 'approval_request_id', 'Leave links to shared approvals');
select has_column('public', 'hr_leave_requests', 'team_conflict_count', 'Team conflicts are persisted');
select col_is_fk('public', 'hr_leave_requests', 'membership_id', 'Leave reuses membership identity');
select col_is_fk('public', 'hr_leave_requests', 'approval_request_id', 'Leave approval link is protected');
select col_is_fk('public', 'hr_leave_request_attachments', 'private_file_id', 'Evidence reuses private files');
select ok((select relrowsecurity from pg_class where oid = 'public.hr_leave_types'::regclass), 'Policy RLS is enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.hr_leave_balances'::regclass), 'Balance RLS is enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.hr_leave_requests'::regclass), 'Request RLS is enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.hr_leave_request_attachments'::regclass), 'Evidence RLS is enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.hr_leave_balance_events'::regclass), 'History RLS is enabled');
select is(
  (select count(*)::integer from public.permissions where key in (
    'hr.leave_type.view', 'hr.leave_type.manage', 'hr.leave_balance.view',
    'hr.leave_balance.adjust', 'hr.leave_request.view', 'hr.leave_request.create',
    'hr.leave_request.cancel'
  )),
  7,
  'Leave permission catalogue is complete'
);
select is(
  (select scope from public.role_template_permissions as grant_row
   join public.permissions as permission on permission.id = grant_row.permission_id
   where grant_row.role_template_key = 'employee' and permission.key = 'hr.leave_request.view'),
  'own',
  'Employees see only their leave requests'
);
select is(
  (select scope from public.role_template_permissions as grant_row
   join public.permissions as permission on permission.id = grant_row.permission_id
   where grant_row.role_template_key = 'team_lead' and permission.key = 'hr.leave_request.view'),
  'managed_employees',
  'Team leads see managed employee leave'
);
select has_function('private', 'refresh_hr_leave_balance', array['uuid', 'uuid', 'uuid', 'integer', 'uuid'], 'Accrual refresh function exists');
select ok(
  exists (
    select 1 from pg_trigger where tgrelid = 'public.approval_requests'::regclass
      and tgname = 'approval_requests_sync_hr_leave_request' and not tgisinternal
  ),
  'Approval outcomes synchronize leave and balances'
);
select ok(
  exists (
    select 1 from pg_trigger where tgrelid = 'public.hr_leave_requests'::regclass
      and tgname = 'hr_leave_requests_validate' and not tgisinternal
  ),
  'Leave validation trigger exists'
);
select ok(
  exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'hr_leave_requests'
      and policyname = 'hr_leave_requests_select_authorized'
  ),
  'Scoped leave request select policy exists'
);
select ok(
  exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'hr_leave_request_attachments'
      and policyname = 'hr_leave_request_attachments_select_authorized'
  ),
  'Scoped evidence select policy exists'
);
select ok(
  exists (
    select 1 from pg_indexes where schemaname = 'public' and tablename = 'hr_leave_requests'
      and indexname = 'hr_leave_requests_draft_exact_unique'
  ),
  'Duplicate leave drafts are constrained'
);

select * from finish();
rollback;
