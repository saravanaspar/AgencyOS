begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(35);

select has_table('public', 'finance_cash_forecast_settings', 'Cash forecast policy is persisted');
select has_table('public', 'finance_cash_recurring_items', 'Recurring cash assumptions are persisted');
select has_table('public', 'finance_collection_policies', 'Collection policy is persisted');
select has_table('public', 'finance_collection_cases', 'Collection cases are persisted');
select has_table('public', 'finance_collection_events', 'Collection evidence is persisted');
select has_table('public', 'founder_work_item_states', 'Founder work state overlay is persisted');
select has_table('public', 'report_delivery_destinations', 'External report destinations are persisted');

select has_column('public', 'finance_collection_cases', 'delivery_attempt_count', 'Collection retries count durable attempts');
select has_column('public', 'finance_collection_cases', 'next_delivery_attempt_at', 'Collection retries persist their next attempt');
select has_column('public', 'finance_collection_cases', 'last_delivery_error', 'Collection retries retain their last error');
select has_index('public', 'finance_collection_events', 'finance_collection_events_stage_unique', 'Collection stage evidence is idempotent');
select has_index('public', 'finance_collection_events', 'finance_collection_events_reminder_channel_unique', 'Collection reminder evidence is idempotent per channel');

select has_column('public', 'hr_salary_structures', 'approval_request_id', 'Salary revisions link to the shared approval request');
select has_function('private', 'apply_hr_salary_approval_result', array[]::text[], 'Approved salary requests are applied by a database function');
select has_function('private', 'validate_hr_salary_approval_link', array[]::text[], 'Salary structures validate their shared approval link');
select ok(exists (
  select 1 from pg_trigger
  where tgname = 'approval_requests_apply_hr_salary_result' and not tgisinternal
), 'Approval terminal state applies salary revision');
select ok(exists (
  select 1 from pg_trigger
  where tgname = 'hr_salary_structures_validate_shared_approval' and not tgisinternal
), 'Direct salary revision persistence is database guarded');

select ok(exists (
  select 1 from pg_trigger
  where tgname = 'finance_collection_events_append_only' and not tgisinternal
), 'Collection evidence is append only');

select ok(exists (
  select 1 from public.permissions where key = 'finance.cash_forecast.manage' and is_sensitive
), 'Cash forecast management is a sensitive permission');
select ok(exists (
  select 1 from public.permissions where key = 'finance.collection.manage' and is_sensitive
), 'Collection management is a sensitive permission');
select ok(exists (
  select 1 from public.permissions where key = 'reports.delivery_destination.manage' and is_sensitive
), 'External report destination management is a sensitive permission');

select ok(exists (
  select 1 from public.role_template_permissions grant_row
  join public.permissions permission on permission.id = grant_row.permission_id
  where grant_row.role_template_key = 'finance_manager'
    and permission.key = 'finance.cash_forecast.manage'
    and grant_row.scope = 'organization'
), 'Finance Manager can manage the cash forecast');
select ok(exists (
  select 1 from public.role_template_permissions grant_row
  join public.permissions permission on permission.id = grant_row.permission_id
  where grant_row.role_template_key = 'finance_manager'
    and permission.key = 'finance.collection.manage'
    and grant_row.scope = 'organization'
), 'Finance Manager can manage collections');
select ok(not exists (
  select 1 from public.role_template_permissions grant_row
  join public.permissions permission on permission.id = grant_row.permission_id
  where grant_row.role_template_key = 'employee'
    and permission.key in ('finance.cash_forecast.manage', 'finance.collection.manage', 'reports.delivery_destination.manage')
), 'Employee role receives none of the new sensitive management permissions');

select is(private.report_section_permission('founder_monthly'), 'reports.founder_pack.view', 'Monthly founder pack uses founder-pack authorization');
select ok(exists (
  select 1 from pg_constraint
  where conname = 'report_schedules_delivery_channels_check'
    and pg_get_constraintdef(oid) like '%slack%'
    and pg_get_constraintdef(oid) like '%telegram%'
    and pg_get_constraintdef(oid) like '%webhook%'
), 'Report schedules accept the three external channels');
select ok(exists (
  select 1 from pg_constraint
  where conname = 'report_delivery_recipients_channel_check'
    and pg_get_constraintdef(oid) like '%slack%'
    and pg_get_constraintdef(oid) like '%telegram%'
    and pg_get_constraintdef(oid) like '%webhook%'
), 'Report recipient rows accept the three external channels');

select ok((select relrowsecurity from pg_class where oid = 'public.finance_cash_forecast_settings'::regclass), 'Cash forecast policy has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.finance_collection_cases'::regclass), 'Collection cases have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.founder_work_item_states'::regclass), 'Founder work state has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.report_delivery_destinations'::regclass), 'External report destinations have RLS');

select ok(exists (
  select 1 from pg_indexes
  where schemaname = 'public' and tablename = 'report_delivery_destinations'
    and indexname = 'report_delivery_destinations_one_active_channel'
), 'Only one active external destination is allowed per member/channel');
select ok(exists (
  select 1 from pg_policies
  where schemaname = 'public' and tablename = 'founder_work_item_states'
    and policyname = 'founder_work_item_states_owner_or_delegate'
), 'Founder work is visible to the founder owner or active delegate');
select ok(exists (
  select 1 from pg_trigger
  where tgname = 'report_delivery_destinations_validate_tenant' and not tgisinternal
), 'External destination references are tenant validated');
select ok(exists (
  select 1 from pg_trigger
  where tgname = 'finance_collection_events_validate_tenant' and not tgisinternal
), 'Collection evidence references are tenant validated');

select * from finish();
rollback;
