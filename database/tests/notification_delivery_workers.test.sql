begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(19);

select has_table('public', 'notification_push_subscriptions', 'Push subscription table exists');
select has_column('public', 'notification_deliveries', 'locked_at', 'Deliveries store worker lock time');
select has_column('public', 'notification_deliveries', 'lock_token', 'Deliveries store worker lock token');
select has_column('public', 'notification_push_subscriptions', 'organization_id', 'Push subscriptions are tenant scoped');
select has_column('public', 'notification_push_subscriptions', 'membership_id', 'Push subscriptions target a membership');
select has_column('public', 'notification_push_subscriptions', 'endpoint_hash', 'Push endpoints have a searchable hash');
select has_column('public', 'notification_push_subscriptions', 'encrypted_subscription', 'Push endpoint data is encrypted');
select has_column('public', 'notification_push_subscriptions', 'status', 'Push subscriptions support revocation');
select has_column('public', 'notification_push_subscriptions', 'failure_count', 'Push failures are observable');

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'notification_deliveries_worker_due_idx'
      and indexdef ilike '%where%'
  ),
  'Workers use a partial due-delivery index'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'notification_push_subscriptions_active_endpoint_unique'
      and indexdef ilike '%where%'
  ),
  'One active membership owns each browser push endpoint'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'notification_push_subscriptions_active_member_idx'
  ),
  'Active device lookups use a membership index'
);
select ok(
  exists (
    select 1 from pg_trigger
    where tgname = 'notification_push_subscriptions_validate_tenant'
      and not tgisinternal
  ),
  'Push subscriptions use tenant validation'
);
select ok(
  exists (
    select 1 from pg_trigger
    where tgname = 'notification_push_subscriptions_set_updated_at'
      and not tgisinternal
  ),
  'Push subscriptions maintain update timestamps'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.notification_push_subscriptions'::regclass),
  true,
  'Push subscriptions have RLS enabled'
);
select ok(
  not has_table_privilege('anon', 'public.notification_push_subscriptions', 'SELECT'),
  'Anonymous clients cannot read push subscriptions'
);
select ok(
  not has_table_privilege('authenticated', 'public.notification_push_subscriptions', 'SELECT'),
  'Authenticated clients cannot read encrypted push subscriptions directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.notification_push_subscriptions', 'INSERT'),
  'Authenticated clients cannot forge push subscriptions directly'
);
select ok(
  has_table_privilege('service_role', 'public.notification_push_subscriptions', 'INSERT'),
  'Trusted server workers may manage push subscriptions'
);

select * from finish();
rollback;
