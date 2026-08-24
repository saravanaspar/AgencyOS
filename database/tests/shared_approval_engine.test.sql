begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(49);

select has_table('public', 'approval_definitions', 'Approval definitions table exists');
select has_table('public', 'approval_definition_steps', 'Approval definition steps table exists');
select has_table('public', 'approval_requests', 'Approval requests table exists');
select has_table('public', 'approval_request_steps', 'Materialized request steps table exists');
select has_table('public', 'approval_actions', 'Append-only approval actions table exists');
select has_table('public', 'approval_delegations', 'Approval delegations table exists');

select has_column('public', 'approval_definitions', 'version', 'Policies are versioned');
select has_column('public', 'approval_definition_steps', 'stage_order', 'Policy steps support ordered stages');
select has_column('public', 'approval_definition_steps', 'decision_mode', 'Parallel stages support any/all decisions');
select has_column('public', 'approval_definition_steps', 'conditions', 'Policy steps support bounded conditions');
select has_column('public', 'approval_requests', 'snapshot', 'Requests store immutable snapshots');
select has_column('public', 'approval_requests', 'snapshot_hash', 'Requests store snapshot hashes');
select has_column('public', 'approval_requests', 'current_stage', 'Requests track the active stage');
select has_column('public', 'approval_requests', 'status', 'Requests track terminal and pending state');
select has_column('public', 'approval_request_steps', 'approver_membership_id', 'Request steps target memberships');
select has_column('public', 'approval_request_steps', 'status', 'Request steps track decision state');
select has_column('public', 'approval_request_steps', 'reminder_count', 'Request steps track reminders');
select has_column('public', 'approval_request_steps', 'escalated_at', 'Request steps track escalation');
select has_column('public', 'approval_actions', 'action', 'Approval history stores action type');
select has_column('public', 'approval_actions', 'metadata', 'Approval history stores bounded metadata');
select has_column('public', 'approval_delegations', 'ends_at', 'Delegations are time bounded');
select has_column('public', 'approval_delegations', 'status', 'Delegations track lifecycle status');

select ok(
  exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'approval_definitions_active_key_unique' and indexdef ilike '%where%'),
  'Only one active policy version exists per organization and key'
);
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'approval_requests_pending_entity_unique' and indexdef ilike '%where%'),
  'Only one pending approval request exists per source entity'
);
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'approval_request_steps_due_idx'),
  'Expiry worker has a due-step index'
);
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'approval_request_steps_reminder_idx'),
  'Reminder worker has a due-reminder index'
);
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'approval_request_steps_escalation_idx'),
  'Escalation worker has a due-escalation index'
);
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'approval_delegations_expiry_idx'),
  'Delegation expiry has a bounded scan index'
);

select ok(exists (select 1 from pg_trigger where tgname = 'approval_requests_snapshot_immutable' and not tgisinternal), 'Request business snapshots are immutable');
select ok(exists (select 1 from pg_trigger where tgname = 'approval_actions_prevent_update' and not tgisinternal), 'Approval history rejects updates');
select ok(exists (select 1 from pg_trigger where tgname = 'approval_actions_prevent_delete' and not tgisinternal), 'Approval history rejects deletes');
select ok(exists (select 1 from pg_trigger where tgname = 'approval_delegations_validate_tenant' and not tgisinternal), 'Delegations validate membership tenants');

select is((select relrowsecurity from pg_class where oid = 'public.approval_definitions'::regclass), true, 'Approval definitions have RLS');
select is((select relrowsecurity from pg_class where oid = 'public.approval_definition_steps'::regclass), true, 'Approval definition steps have RLS');
select is((select relrowsecurity from pg_class where oid = 'public.approval_requests'::regclass), true, 'Approval requests have RLS');
select is((select relrowsecurity from pg_class where oid = 'public.approval_request_steps'::regclass), true, 'Approval request steps have RLS');
select is((select relrowsecurity from pg_class where oid = 'public.approval_actions'::regclass), true, 'Approval actions have RLS');
select is((select relrowsecurity from pg_class where oid = 'public.approval_delegations'::regclass), true, 'Approval delegations have RLS');

select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'approval_requests' and policyname = 'approval_requests_select_visible'), 'Request reads use scope-aware visibility');
select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'approval_actions' and policyname = 'approval_actions_select_visible'), 'History reads follow request visibility');
select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'approval_delegations' and policyname = 'approval_delegations_select_involved'), 'Delegation reads are limited to involved or authorized members');

select ok(not has_table_privilege('authenticated', 'public.approval_requests', 'INSERT'), 'Authenticated clients cannot forge approval requests');
select ok(not has_table_privilege('authenticated', 'public.approval_actions', 'INSERT'), 'Authenticated clients cannot forge approval history');
select ok(not has_table_privilege('authenticated', 'public.approval_delegations', 'UPDATE'), 'Authenticated clients cannot bypass delegation service checks');

select has_function('private', 'approval_request_visible', array['uuid'], 'Scope-aware request visibility function exists');
select has_function('private', 'prevent_approval_snapshot_mutation', array[]::text[], 'Immutable snapshot trigger function exists');
select has_function('private', 'prevent_approval_action_mutation', array[]::text[], 'Append-only action trigger function exists');

select ok(exists (select 1 from public.permissions where key = 'approvals.definition.manage_settings'), 'Policy management permission is registered');
select ok(exists (
  select 1
  from public.role_template_permissions as template_permission
  join public.permissions as permission on permission.id = template_permission.permission_id
  where template_permission.role_template_key = 'owner'
    and permission.module = 'approvals'
    and template_permission.scope = 'organization'
), 'Owner template receives organization-scoped approval permissions');

select * from finish();
rollback;
