begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(32);

select has_table('public', 'finance_document_snapshots', 'Finance PDF snapshots exist');
select has_table('public', 'finance_email_deliveries', 'Finance email delivery history exists');

select has_column('public', 'finance_estimates', 'client_decision_note', 'Estimate decisions preserve evidence');
select has_column('public', 'finance_estimates', 'client_decision_recorded_at', 'Estimate decisions preserve time');
select has_column('public', 'finance_estimates', 'client_decision_recorded_by_membership_id', 'Estimate decisions preserve actor');
select has_column('public', 'finance_email_deliveries', 'request_token', 'Email attempts have request tokens');

select has_function('private', 'validate_finance_document_snapshot', array[]::text[], 'Snapshot insert validation exists');
select has_function('private', 'prevent_finance_document_snapshot_mutation', array[]::text[], 'Snapshot immutability exists');
select has_function('private', 'validate_finance_email_delivery', array[]::text[], 'Delivery transition validation exists');

select ok(exists (
  select 1 from pg_indexes where schemaname = 'public'
    and indexname = 'finance_invoices_source_estimate_unique'
    and indexdef ilike '%where%'
), 'Only one invoice may be converted from an estimate');
select ok(exists (
  select 1 from pg_constraint where conrelid = 'public.finance_email_deliveries'::regclass
    and contype = 'u' and pg_get_constraintdef(oid) ilike '%organization_id, request_token%'
), 'Delivery request tokens are tenant-idempotent');

select ok(exists (select 1 from pg_trigger where tgname = 'finance_document_snapshots_validate' and not tgisinternal), 'Snapshot validation trigger exists');
select ok(exists (select 1 from pg_trigger where tgname = 'finance_document_snapshots_prevent_update' and not tgisinternal), 'Snapshot updates are blocked');
select ok(exists (select 1 from pg_trigger where tgname = 'finance_document_snapshots_prevent_delete' and not tgisinternal), 'Snapshot deletes are blocked');
select ok(exists (select 1 from pg_trigger where tgname = 'finance_email_deliveries_validate' and not tgisinternal), 'Delivery transitions are guarded');

select is((select relrowsecurity from pg_class where oid = 'public.finance_document_snapshots'::regclass), true, 'Snapshots have RLS');
select is((select relrowsecurity from pg_class where oid = 'public.finance_email_deliveries'::regclass), true, 'Delivery history has RLS');

select ok(not has_table_privilege('anon', 'public.finance_document_snapshots', 'SELECT'), 'Anonymous users cannot read finance PDFs');
select ok(not has_table_privilege('anon', 'public.finance_email_deliveries', 'SELECT'), 'Anonymous users cannot read delivery history');
select ok(has_table_privilege('authenticated', 'public.finance_document_snapshots', 'SELECT'), 'Authenticated users may read snapshots through RLS');
select ok(has_table_privilege('authenticated', 'public.finance_email_deliveries', 'SELECT'), 'Authenticated users may read delivery history through RLS');

select ok(exists (select 1 from public.permissions where key = 'finance.estimate.accept' and is_sensitive), 'Estimate acceptance permission exists');
select ok(exists (select 1 from public.permissions where key = 'finance.estimate.convert' and is_sensitive), 'Estimate conversion permission exists');
select ok(exists (select 1 from public.permissions where key = 'finance.document.download' and is_sensitive), 'Finance download permission exists');
select ok(exists (select 1 from public.permissions where key = 'finance.document.send' and is_sensitive), 'Finance send permission exists');

select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'finance_document_snapshots' and policyname = 'finance_document_snapshots_select_authorized'), 'Snapshot select policy exists');
select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'finance_email_deliveries' and policyname = 'finance_email_deliveries_select_authorized'), 'Delivery select policy exists');

select ok(exists (
  select 1 from public.role_template_permissions rtp
  join public.permissions p on p.id = rtp.permission_id
  where rtp.role_template_key = 'finance_manager' and p.key = 'finance.document.send'
), 'Finance managers may send documents');
select ok(exists (
  select 1 from public.role_template_permissions rtp
  join public.permissions p on p.id = rtp.permission_id
  where rtp.role_template_key = 'accountant' and p.key = 'finance.estimate.convert'
), 'Accountants may convert accepted estimates');
select ok(exists (
  select 1 from public.role_template_permissions rtp
  join public.permissions p on p.id = rtp.permission_id
  where rtp.role_template_key = 'auditor' and p.key = 'finance.document.download'
), 'Auditors may download finance evidence');
select ok(not exists (
  select 1 from public.role_template_permissions rtp
  join public.permissions p on p.id = rtp.permission_id
  where rtp.role_template_key = 'auditor' and p.key = 'finance.document.send'
), 'Auditors cannot send finance documents');

select ok(exists (
  select 1 from pg_constraint where conrelid = 'public.finance_document_snapshots'::regclass
    and contype = 'u' and pg_get_constraintdef(oid) ilike '%organization_id, entity_type, entity_id, version_number%'
), 'Each document version has one immutable snapshot');

select * from finish();
rollback;
