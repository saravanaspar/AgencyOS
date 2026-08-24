-- External notification delivery workers and encrypted browser-push subscriptions.

set lock_timeout = '10s';
set statement_timeout = '120s';

alter table public.notification_deliveries
  add column locked_at timestamptz,
  add column lock_token uuid;

create index notification_deliveries_worker_due_idx
  on public.notification_deliveries (next_attempt_at, created_at)
  where status in ('pending', 'failed') and channel in ('email', 'browser_push', 'n8n');

create table public.notification_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  endpoint_hash text not null,
  encrypted_subscription text not null,
  expiration_time bigint,
  status text not null default 'active',
  failure_count integer not null default 0,
  last_used_at timestamptz,
  last_error_code text,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_push_subscriptions_status_valid
    check (status in ('active', 'revoked')),
  constraint notification_push_subscriptions_endpoint_hash_valid
    check (endpoint_hash ~ '^[a-f0-9]{64}$'),
  constraint notification_push_subscriptions_envelope_not_blank
    check (btrim(encrypted_subscription) <> ''),
  constraint notification_push_subscriptions_failure_nonnegative
    check (failure_count >= 0),
  constraint notification_push_subscriptions_error_not_blank
    check (last_error_code is null or btrim(last_error_code) <> ''),
  constraint notification_push_subscriptions_membership_endpoint_unique
    unique (membership_id, endpoint_hash)
);

create unique index notification_push_subscriptions_active_endpoint_unique
  on public.notification_push_subscriptions (endpoint_hash)
  where status = 'active';

create index notification_push_subscriptions_active_member_idx
  on public.notification_push_subscriptions (membership_id, updated_at desc)
  where status = 'active';

create or replace function private.validate_notification_push_subscription_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_membership_organization_id uuid;
begin
  select organization_id
  into v_membership_organization_id
  from public.memberships
  where id = new.membership_id;

  if v_membership_organization_id is null
     or v_membership_organization_id <> new.organization_id then
    raise exception using
      errcode = '23514',
      message = 'Notification push subscription must match its membership tenant';
  end if;

  return new;
end;
$$;

create trigger notification_push_subscriptions_validate_tenant
before insert or update of organization_id, membership_id
on public.notification_push_subscriptions
for each row execute function private.validate_notification_push_subscription_tenant();

create trigger notification_push_subscriptions_set_updated_at
before update on public.notification_push_subscriptions
for each row execute function private.set_updated_at();

alter table public.notification_push_subscriptions enable row level security;

revoke all on public.notification_push_subscriptions from anon, authenticated;
grant all on public.notification_push_subscriptions to service_role;
