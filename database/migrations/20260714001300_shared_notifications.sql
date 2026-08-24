-- Shared in-app notifications, recipient preferences, and delivery history.

set lock_timeout = '10s';
set statement_timeout = '120s';

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recipient_membership_id uuid not null references public.memberships(id) on delete cascade,
  category text not null,
  severity text not null default 'info',
  title text not null,
  message text not null,
  deep_link text,
  source_module text not null,
  source_entity_type text,
  source_entity_id text,
  dedupe_key text,
  metadata jsonb not null default '{}'::jsonb,
  occurrence_count integer not null default 1,
  first_occurred_at timestamptz not null default now(),
  last_occurred_at timestamptz not null default now(),
  read_at timestamptz,
  archived_at timestamptz,
  created_by_membership_id uuid references public.memberships(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notifications_category_valid check (
    category in (
      'assignment',
      'mention',
      'approval_requested',
      'approval_decision',
      'task_due',
      'invoice_overdue',
      'leave_status',
      'contract_expiry',
      'licence_expiry',
      'asset_return',
      'support_reply',
      'security_alert',
      'integration_failure'
    )
  ),
  constraint notifications_severity_valid check (severity in ('info', 'warning', 'error')),
  constraint notifications_title_not_blank check (btrim(title) <> ''),
  constraint notifications_message_not_blank check (btrim(message) <> ''),
  constraint notifications_source_module_format check (source_module ~ '^[a-z][a-z0-9_]*$'),
  constraint notifications_deep_link_internal check (
    deep_link is null or (left(deep_link, 1) = '/' and left(deep_link, 2) <> '//')
  ),
  constraint notifications_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint notifications_occurrence_positive check (occurrence_count > 0)
);

create unique index notifications_open_dedupe_unique
  on public.notifications (recipient_membership_id, dedupe_key)
  where dedupe_key is not null and read_at is null and archived_at is null;

create index notifications_recipient_unread_idx
  on public.notifications (recipient_membership_id, last_occurred_at desc)
  where read_at is null and archived_at is null;

create index notifications_recipient_history_idx
  on public.notifications (recipient_membership_id, last_occurred_at desc)
  where archived_at is null;

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  notification_id uuid not null references public.notifications(id) on delete cascade,
  recipient_membership_id uuid not null references public.memberships(id) on delete cascade,
  channel text not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  next_attempt_at timestamptz,
  attempted_at timestamptz,
  delivered_at timestamptz,
  last_error_code text,
  last_error_message text,
  provider_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_deliveries_channel_valid
    check (channel in ('in_app', 'email', 'browser_push', 'n8n')),
  constraint notification_deliveries_status_valid
    check (status in ('pending', 'delivered', 'failed', 'suppressed')),
  constraint notification_deliveries_attempt_nonnegative check (attempt_count >= 0),
  constraint notification_deliveries_error_code_not_blank
    check (last_error_code is null or btrim(last_error_code) <> ''),
  constraint notification_deliveries_error_message_not_blank
    check (last_error_message is null or btrim(last_error_message) <> ''),
  unique (notification_id, channel)
);

create index notification_deliveries_retry_idx
  on public.notification_deliveries (next_attempt_at, status)
  where status in ('pending', 'failed');

create index notification_deliveries_recipient_idx
  on public.notification_deliveries (recipient_membership_id, created_at desc);

create or replace function private.validate_notification_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_recipient_organization_id uuid;
  v_creator_organization_id uuid;
begin
  select organization_id
  into v_recipient_organization_id
  from public.memberships
  where id = new.recipient_membership_id;

  if v_recipient_organization_id is null or v_recipient_organization_id <> new.organization_id then
    raise exception using errcode = '23514', message = 'Notification recipient must belong to the notification organization';
  end if;

  if new.created_by_membership_id is not null then
    select organization_id
    into v_creator_organization_id
    from public.memberships
    where id = new.created_by_membership_id;

    if v_creator_organization_id is null or v_creator_organization_id <> new.organization_id then
      raise exception using errcode = '23514', message = 'Notification creator must belong to the notification organization';
    end if;
  end if;

  return new;
end;
$$;

create trigger notifications_validate_tenant
before insert or update of organization_id, recipient_membership_id, created_by_membership_id
on public.notifications
for each row execute function private.validate_notification_tenant();

create or replace function private.validate_notification_delivery_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_notification_organization_id uuid;
  v_notification_recipient_id uuid;
begin
  select organization_id, recipient_membership_id
  into v_notification_organization_id, v_notification_recipient_id
  from public.notifications
  where id = new.notification_id;

  if v_notification_organization_id is null
     or v_notification_organization_id <> new.organization_id
     or v_notification_recipient_id <> new.recipient_membership_id then
    raise exception using errcode = '23514', message = 'Notification delivery must match its notification tenant and recipient';
  end if;

  return new;
end;
$$;

create trigger notification_deliveries_validate_tenant
before insert or update of organization_id, notification_id, recipient_membership_id
on public.notification_deliveries
for each row execute function private.validate_notification_delivery_tenant();

create or replace function private.create_in_app_notification_delivery()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.notification_deliveries (
    organization_id,
    notification_id,
    recipient_membership_id,
    channel,
    status,
    attempt_count,
    attempted_at,
    delivered_at
  ) values (
    new.organization_id,
    new.id,
    new.recipient_membership_id,
    'in_app',
    'delivered',
    1,
    now(),
    now()
  )
  on conflict (notification_id, channel) do nothing;

  return new;
end;
$$;

create trigger notifications_create_in_app_delivery
after insert on public.notifications
for each row execute function private.create_in_app_notification_delivery();

create trigger notifications_set_updated_at
before update on public.notifications
for each row execute function private.set_updated_at();

create trigger notification_deliveries_set_updated_at
before update on public.notification_deliveries
for each row execute function private.set_updated_at();

alter table public.notifications enable row level security;
alter table public.notification_deliveries enable row level security;

revoke all on public.notifications from anon, authenticated;
revoke all on public.notification_deliveries from anon, authenticated;

grant select on public.notifications to authenticated;
grant update (read_at, archived_at) on public.notifications to authenticated;
grant select on public.notification_deliveries to authenticated;
grant all on public.notifications to service_role;
grant all on public.notification_deliveries to service_role;

create policy notifications_select_recipient
on public.notifications
for select
to authenticated
using (
  private.owns_membership(recipient_membership_id)
  and private.is_active_member(organization_id)
  and private.has_permission(organization_id, 'notifications.notification.view')
);

create policy notifications_update_recipient
on public.notifications
for update
to authenticated
using (
  private.owns_membership(recipient_membership_id)
  and private.is_active_member(organization_id)
  and private.has_permission(organization_id, 'notifications.notification.update')
)
with check (
  private.owns_membership(recipient_membership_id)
  and private.is_active_member(organization_id)
  and private.has_permission(organization_id, 'notifications.notification.update')
);

create policy notification_deliveries_select_recipient
on public.notification_deliveries
for select
to authenticated
using (
  private.owns_membership(recipient_membership_id)
  and private.is_active_member(organization_id)
  and private.has_permission(organization_id, 'notifications.notification.view')
);
