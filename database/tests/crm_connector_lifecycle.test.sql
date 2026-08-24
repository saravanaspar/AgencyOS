begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(22);

select has_table(
  'public',
  'crm_connection_notifications',
  'Connector operator notifications table exists'
);
select has_table('private', 'crm_oauth_states', 'Private OAuth state table exists');
select has_column(
  'public',
  'crm_import_connections',
  'auth_method',
  'Connections track their credential flow'
);
select has_column(
  'public',
  'crm_import_connections',
  'sync_checkpoint',
  'Connections store incremental checkpoints'
);
select has_column(
  'public',
  'crm_import_connections',
  'sync_cursor',
  'Connections store continuation cursors'
);
select has_column(
  'public',
  'crm_import_connections',
  'next_sync_at',
  'Connections store the next scheduled run'
);
select has_column(
  'public',
  'crm_import_connections',
  'backoff_until',
  'Connections store retry backoff boundaries'
);
select has_column(
  'public',
  'crm_import_connections',
  'last_health_status',
  'Connections store health state'
);
select has_column(
  'public',
  'crm_import_connections',
  'credential_version',
  'Connections track credential rotation versions'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'crm_import_connections_auth_method_valid'
  ),
  'Connection authentication methods are constrained'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'crm_import_connections_sync_interval_valid'
  ),
  'Scheduled sync intervals are constrained'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'crm_import_connections_schedule_pull_only'
  ),
  'Only pull connections may be scheduled'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'crm_import_connections_due_sync_idx'
  ),
  'Due connection scans use a partial index'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'crm_connection_notifications_open_unique'
      and indexdef ilike '%where%'
      and indexdef ilike '%status%'
      and indexdef ilike '%open%'
  ),
  'Open connector alerts are deduplicated by connection and code'
);
select ok(
  exists (
    select 1 from pg_trigger
    where tgname = 'crm_connection_notifications_validate_tenant'
      and not tgisinternal
  ),
  'Connector alerts validate tenant consistency'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.crm_connection_notifications'::regclass),
  true,
  'Connector alerts have RLS enabled'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'crm_connection_notifications'
      and policyname = 'crm_connection_notifications_select_authorized'
  ),
  'Connector alert reads require CRM import visibility'
);
select ok(
  not has_table_privilege('authenticated', 'public.crm_connection_notifications', 'INSERT'),
  'Authenticated clients cannot create operator alerts directly'
);
select ok(
  not has_table_privilege('authenticated', 'private.crm_oauth_states', 'SELECT'),
  'OAuth state records are not exposed to authenticated clients'
);
select has_function(
  'private',
  'membership_has_permission',
  array['uuid', 'text'],
  'Scheduled jobs use a dedicated membership reauthorization function'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.membership_has_permission(uuid,text)',
    'EXECUTE'
  ),
  'Authenticated clients cannot call the scheduler authorization helper'
);
select ok(
  exists (
    select 1
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname = 'membership_has_permission'
      and procedure.prosecdef = true
  ),
  'Scheduler authorization helper is security-definer'
);

select * from finish();
rollback;
