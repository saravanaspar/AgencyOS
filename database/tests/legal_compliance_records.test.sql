begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(34);

select has_table('public', 'legal_compliance_records', 'legal compliance records exist');
select has_table('public', 'legal_compliance_record_reminders', 'legal compliance reminders exist');
select has_table('public', 'legal_compliance_record_events', 'legal compliance events exist');
select has_column('public', 'legal_compliance_records', 'record_type', 'record type is stored');
select has_column('public', 'legal_compliance_records', 'identifier_last_four', 'only masked identifier suffix is searchable');
select has_column('public', 'legal_compliance_records', 'legal_privilege', 'legal privilege classification is stored');
select has_column('public', 'legal_compliance_records', 'document_version_id', 'record pins a Documents version');
select has_column('public', 'legal_compliance_records', 'response_due_date', 'legal response due dates are tracked');
select has_index('public', 'legal_compliance_records', 'legal_compliance_records_workspace_idx', 'workspace query is indexed');
select has_index('public', 'legal_compliance_records', 'legal_compliance_records_expiry_idx', 'expiry query is indexed');
select has_index('public', 'legal_compliance_records', 'legal_compliance_records_response_idx', 'response due query is indexed');
select has_index('public', 'legal_compliance_record_events', 'legal_compliance_record_events_history_idx', 'event history is indexed');
select ok((select relrowsecurity from pg_class where oid = 'public.legal_compliance_records'::regclass), 'records have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.legal_compliance_record_reminders'::regclass), 'reminders have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.legal_compliance_record_events'::regclass), 'events have RLS');
select ok(exists(select 1 from public.permissions where key = 'legal.record.view' and is_sensitive), 'record view permission exists');
select ok(exists(select 1 from public.permissions where key = 'legal.record.manage_privileged' and is_sensitive), 'privilege permission exists');
select ok(exists(
  select 1 from public.role_template_permissions rtp join public.permissions p on p.id = rtp.permission_id
  where rtp.role_template_key = 'legal_manager' and p.key = 'legal.record.manage_privileged'
), 'legal managers receive privileged-record control');
select ok(exists(
  select 1 from public.role_template_permissions rtp join public.permissions p on p.id = rtp.permission_id
  where rtp.role_template_key = 'auditor' and p.key = 'legal.record.view'
), 'auditors receive non-privileged record visibility');
select ok(exists(
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'legal_compliance_record_membership_access_allowed'
    and p.prosecdef
), 'record scope uses a security-definer helper');
select ok(exists(select 1 from pg_trigger where tgname = 'legal_compliance_records_validate' and not tgisinternal), 'record tenant and document validation exists');
select ok(exists(select 1 from pg_trigger where tgname = 'legal_compliance_records_sync_reminders_insert' and not tgisinternal), 'record creation seeds reminders');
select ok(exists(select 1 from pg_trigger where tgname = 'legal_compliance_records_sync_reminders' and not tgisinternal), 'changed record dates synchronize reminders');
select ok(exists(select 1 from pg_trigger where tgname = 'legal_compliance_record_events_no_update' and not tgisinternal), 'event updates are blocked');
select ok(exists(select 1 from pg_trigger where tgname = 'legal_compliance_record_events_no_delete' and not tgisinternal), 'event deletion is blocked');
select ok(exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'legal_compliance_records' and policyname = 'legal_compliance_records_select'), 'record select policy exists');
select ok(
  has_column_privilege('authenticated', 'public.legal_compliance_records', 'title', 'SELECT')
  and not has_column_privilege('authenticated', 'public.legal_compliance_records', 'summary', 'SELECT')
  and not has_column_privilege('authenticated', 'public.legal_compliance_records', 'closure_reason', 'SELECT')
  and not has_table_privilege('authenticated', 'public.legal_compliance_records', 'INSERT'),
  'authenticated clients receive read-only safe record columns'
);
select ok(
  has_column_privilege('authenticated', 'public.legal_compliance_record_reminders', 'remind_on', 'SELECT')
  and not has_column_privilege('authenticated', 'public.legal_compliance_record_reminders', 'acknowledged_by_membership_id', 'SELECT'),
  'reminder acknowledgement actors are hidden from ordinary authenticated clients'
);
select ok(
  has_column_privilege('authenticated', 'public.legal_compliance_record_events', 'event_type', 'SELECT')
  and not has_column_privilege('authenticated', 'public.legal_compliance_record_events', 'details', 'SELECT')
  and not has_table_privilege('authenticated', 'public.legal_compliance_record_events', 'INSERT'),
  'authenticated clients cannot read sensitive event details'
);
select ok(
  not has_function_privilege('authenticated', 'private.legal_compliance_record_membership_access_allowed(uuid,uuid,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'private.legal_compliance_record_access_allowed(uuid,text)', 'EXECUTE'),
  'authenticated users can invoke only the current-membership wrapper'
);
select ok(exists(select 1 from pg_constraint where conname = 'legal_compliance_records_closure_contract'), 'closure evidence is constrained');
select ok(exists(select 1 from pg_constraint where conname = 'legal_compliance_records_identifier_valid'), 'identifier suffix is constrained');
select ok(exists(select 1 from pg_constraint where conname = 'legal_compliance_reminders_ack_contract'), 'reminder acknowledgement evidence is constrained');
select ok(exists(select 1 from pg_constraint where conname = 'legal_compliance_records_type_valid'), 'planned compliance record types are constrained');

select * from finish();
rollback;
