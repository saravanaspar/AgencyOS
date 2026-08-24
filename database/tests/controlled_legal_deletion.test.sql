begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(40);

select has_table('public', 'legal_deletion_policies', 'legal deletion policies exist');
select has_table('public', 'legal_deletion_requests', 'legal deletion requests exist');
select has_table('public', 'legal_deletion_objects', 'legal deletion object evidence exists');
select has_table('public', 'legal_deletion_events', 'legal deletion event history exists');
select has_column('public', 'legal_deletion_policies', 'second_approval_required', 'second-person approval is configurable');
select has_column('public', 'legal_deletion_requests', 'approval_request_id', 'deletion request links shared approval');
select has_column('public', 'legal_deletion_requests', 'eligibility_snapshot', 'eligibility evidence is retained');
select has_column('public', 'legal_deletion_requests', 'audit_digest', 'completion digest is retained');
select has_column('public', 'legal_deletion_requests', 'purge_claim_token', 'purge execution ownership is retained');
select has_column('public', 'legal_deletion_requests', 'purge_claimed_at', 'stale purge claims can be recovered');
select has_column('public', 'legal_deletion_objects', 'sha256', 'object checksum evidence is retained');
select has_column('public', 'legal_contracts', 'deleted_at', 'contract tombstones are supported');
select has_column('public', 'legal_compliance_records', 'deleted_at', 'compliance-record tombstones are supported');
select has_index('public', 'legal_deletion_requests', 'legal_deletion_requests_active_target_unique', 'one active deletion request per target is enforced');
select has_index('public', 'legal_deletion_requests', 'legal_deletion_requests_history_idx', 'deletion history is indexed');
select has_index('public', 'legal_deletion_objects', 'legal_deletion_objects_request_idx', 'object cleanup is indexed');
select has_index('public', 'legal_deletion_events', 'legal_deletion_events_history_idx', 'deletion events are indexed');
select ok((select relrowsecurity from pg_class where oid = 'public.legal_deletion_policies'::regclass), 'policies have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.legal_deletion_requests'::regclass), 'requests have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.legal_deletion_objects'::regclass), 'objects have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.legal_deletion_events'::regclass), 'events have RLS');
select ok(exists(select 1 from public.permissions where key = 'legal.deletion.request' and is_sensitive), 'deletion request permission exists');
select ok(exists(select 1 from public.permissions where key = 'legal.deletion.execute' and is_sensitive), 'deletion execute permission exists');
select ok(exists(select 1 from public.permissions where key = 'legal.deletion.configure' and is_sensitive), 'deletion policy permission exists');
select ok(exists(
  select 1 from public.role_template_permissions rtp join public.permissions p on p.id = rtp.permission_id
  where rtp.role_template_key = 'legal_manager' and p.key = 'legal.deletion.execute'
), 'legal managers receive controlled deletion execution');
select ok(exists(
  select 1 from public.role_template_permissions rtp join public.permissions p on p.id = rtp.permission_id
  where rtp.role_template_key = 'auditor' and p.key = 'legal.deletion.view'
), 'auditors receive deletion history visibility only');
select ok(exists(select 1 from pg_trigger where tgname = 'approval_requests_apply_legal_deletion' and not tgisinternal), 'approval outcomes synchronize deletion status');
select ok(exists(select 1 from pg_trigger where tgname = 'legal_deletion_requests_no_delete' and not tgisinternal), 'deletion requests cannot be deleted');
select ok(exists(select 1 from pg_trigger where tgname = 'legal_deletion_objects_no_delete' and not tgisinternal), 'object evidence cannot be deleted');
select ok(exists(select 1 from pg_trigger where tgname = 'legal_deletion_events_no_delete' and not tgisinternal), 'deletion events cannot be deleted');
select ok(exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'legal_deletion_requests' and policyname = 'legal_deletion_requests_select'), 'request select policy exists');
select ok(exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'legal_deletion_objects' and policyname = 'legal_deletion_objects_select'), 'object select policy exists');
select ok(exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'legal_deletion_events' and policyname = 'legal_deletion_events_select'), 'event select policy exists');
select ok(
  has_column_privilege('authenticated', 'public.legal_deletion_requests', 'target_reference', 'SELECT')
  and not has_column_privilege('authenticated', 'public.legal_deletion_requests', 'reason', 'SELECT')
  and not has_column_privilege('authenticated', 'public.legal_deletion_requests', 'eligibility_snapshot', 'SELECT')
  and not has_table_privilege('authenticated', 'public.legal_deletion_requests', 'INSERT'),
  'ordinary authenticated clients receive safe read-only request columns'
);
select ok(
  has_column_privilege('authenticated', 'public.legal_deletion_objects', 'sha256', 'SELECT')
  and not has_column_privilege('authenticated', 'public.legal_deletion_objects', 'last_error_code', 'SELECT')
  and not has_table_privilege('authenticated', 'public.legal_deletion_objects', 'UPDATE'),
  'object evidence is read-only with internal failure details hidden'
);
select ok(
  has_column_privilege('authenticated', 'public.legal_deletion_events', 'event_type', 'SELECT')
  and not has_column_privilege('authenticated', 'public.legal_deletion_events', 'details', 'SELECT')
  and not has_table_privilege('authenticated', 'public.legal_deletion_events', 'INSERT'),
  'event details and writes remain server-only'
);
select ok(
  not has_function_privilege('authenticated', 'private.legal_deletion_request_membership_access_allowed(uuid,uuid,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'private.legal_deletion_request_access_allowed(uuid,text)', 'EXECUTE'),
  'authenticated clients can invoke only the current-membership request wrapper'
);
select ok(exists(select 1 from pg_constraint where conname = 'legal_deletion_requests_completion_contract'), 'completed deletion evidence is constrained');
select ok(exists(select 1 from pg_constraint where conname = 'legal_deletion_requests_approval_contract'), 'approval configuration is constrained');
select ok(exists(select 1 from pg_constraint where conname = 'legal_deletion_objects_purged_contract'), 'object purge evidence is constrained');

select * from finish();
rollback;
