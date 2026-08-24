begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(20);

select has_table('public', 'notifications', 'Shared notifications table exists');
select has_table('public', 'notification_deliveries', 'Notification delivery history table exists');
select has_column('public', 'notifications', 'recipient_membership_id', 'Notifications target a membership');
select has_column('public', 'notifications', 'deep_link', 'Notifications support internal deep links');
select has_column('public', 'notifications', 'dedupe_key', 'Notifications support event deduplication');
select has_column('public', 'notifications', 'read_at', 'Notifications track read state');
select has_column('public', 'notification_deliveries', 'next_attempt_at', 'Delivery history stores retry timing');
select has_column('public', 'notification_deliveries', 'attempt_count', 'Delivery history stores attempts');

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'notifications_open_dedupe_unique'
      and indexdef ilike '%where%'
  ),
  'Unread deduplicated notifications use a partial unique index'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'notifications_recipient_unread_idx'
  ),
  'Unread-count lookups use a recipient index'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'notification_deliveries_retry_idx'
  ),
  'Retry workers can scan pending deliveries efficiently'
);
select ok(
  exists (
    select 1 from pg_trigger
    where tgname = 'notifications_validate_tenant'
      and not tgisinternal
  ),
  'Notification recipients are protected by a tenant trigger'
);
select ok(
  exists (
    select 1 from pg_trigger
    where tgname = 'notification_deliveries_validate_tenant'
      and not tgisinternal
  ),
  'Notification deliveries are protected by a tenant trigger'
);
select ok(
  exists (
    select 1 from pg_trigger
    where tgname = 'notifications_create_in_app_delivery'
      and not tgisinternal
  ),
  'Every notification records its in-app delivery'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.notifications'::regclass),
  true,
  'Notifications have RLS enabled'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.notification_deliveries'::regclass),
  true,
  'Notification delivery history has RLS enabled'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'notifications'
      and policyname = 'notifications_select_recipient'
  ),
  'Notification reads are restricted to the recipient'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'notifications'
      and policyname = 'notifications_update_recipient'
  ),
  'Notification read-state updates are restricted to the recipient'
);
select ok(
  not has_table_privilege('authenticated', 'public.notifications', 'INSERT'),
  'Authenticated clients cannot forge notifications'
);
select ok(
  not has_table_privilege('authenticated', 'public.notification_deliveries', 'INSERT'),
  'Authenticated clients cannot forge delivery history'
);

select * from finish();
rollback;
