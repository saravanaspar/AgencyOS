import "server-only";

import { createHash } from "node:crypto";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { toJsonValue } from "@/lib/server/json-value";
import {
  decryptSecretObjectWithEnvironmentKey,
  encryptSecretObjectWithEnvironmentKey,
} from "@/lib/security/secret-envelope";
import {
  initialNotificationDeliveryTime,
  isAllowedBrowserPushEndpoint,
  type ExternalNotificationChannel,
} from "@/modules/notifications/notification-delivery";
import {
  normalizeNotificationPreferences,
  safeNotificationDeepLink,
  type NotificationCategory,
} from "@/modules/notifications/notifications";
import { getNotificationDeliveryConfiguration } from "@/modules/notifications/server/delivery-config";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

interface NotificationQueueRow {
  id: string;
  organization_id: string;
  recipient_membership_id: string;
  category: NotificationCategory;
  notification_preferences: unknown;
  has_push_subscription: boolean;
}

interface PushSubscriptionInput {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
}

const PUSH_ENCRYPTION_ENV = "NOTIFICATION_DELIVERY_ENCRYPTION_KEY";
const PUSH_ENCRYPTION_PURPOSE = "browser push subscription";

function endpointHash(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex");
}

export function decryptPushSubscription(envelope: string): PushSubscriptionInput {
  const value = decryptSecretObjectWithEnvironmentKey(
    envelope,
    PUSH_ENCRYPTION_ENV,
    PUSH_ENCRYPTION_PURPOSE,
  );
  if (!value.endpoint || !value.p256dh || !value.auth) {
    throw new Error("Browser push subscription is incomplete.");
  }
  return {
    endpoint: value.endpoint,
    expirationTime: value.expirationTime ? Number(value.expirationTime) : null,
    keys: { p256dh: value.p256dh, auth: value.auth },
  };
}

export async function scheduleNotificationDeliveries(notificationId: string): Promise<void> {
  const database = getDatabaseClient();
  const rows = await database<NotificationQueueRow[]>`
    select
      notification.id,
      notification.organization_id,
      notification.recipient_membership_id,
      notification.category,
      preference.notification_preferences,
      exists (
        select 1
        from public.notification_push_subscriptions as push_subscription
        where push_subscription.membership_id = notification.recipient_membership_id
          and push_subscription.organization_id = notification.organization_id
          and push_subscription.status = 'active'
      ) as has_push_subscription
    from public.notifications as notification
    left join public.user_preferences as preference
      on preference.membership_id = notification.recipient_membership_id
    join public.memberships as membership
      on membership.id = notification.recipient_membership_id
     and membership.organization_id = notification.organization_id
     and membership.status = 'active'
    join public.organizations as organization
      on organization.id = notification.organization_id
     and organization.status = 'active'
    where notification.id = ${notificationId}::uuid
      and notification.archived_at is null
    limit 1
  `;
  const row = rows[0];
  if (!row) return;

  const preferences = normalizeNotificationPreferences(row.notification_preferences);
  if (!preferences.categories[row.category]) return;
  const configuration = await getNotificationDeliveryConfiguration(row.organization_id);
  const channels: ExternalNotificationChannel[] = [];
  if (preferences.emailEnabled && configuration.email.configured) channels.push("email");
  if (
    preferences.browserPushEnabled &&
    configuration.browserPush.configured &&
    row.has_push_subscription
  ) {
    channels.push("browser_push");
  }

  for (const channel of channels) {
    const nextAttemptAt = initialNotificationDeliveryTime({
      channel,
      digest: preferences.digest,
      quietHours: preferences.quietHours,
    });
    await database`
      insert into public.notification_deliveries (
        organization_id,
        notification_id,
        recipient_membership_id,
        channel,
        status,
        next_attempt_at
      ) values (
        ${row.organization_id}::uuid,
        ${row.id}::uuid,
        ${row.recipient_membership_id}::uuid,
        ${channel},
        'pending',
        ${nextAttemptAt}
      )
      on conflict (notification_id, channel) do nothing
    `;
  }
}

export async function saveNotificationPushSubscription(
  context: CurrentPermissionContext,
  subscription: PushSubscriptionInput,
): Promise<void> {
  if (!isAllowedBrowserPushEndpoint(subscription.endpoint)) {
    throw new Error("This browser push endpoint is not supported.");
  }
  const hash = endpointHash(subscription.endpoint);
  const encrypted = encryptSecretObjectWithEnvironmentKey(
    {
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      expirationTime: subscription.expirationTime ? String(subscription.expirationTime) : "",
    },
    PUSH_ENCRYPTION_ENV,
    PUSH_ENCRYPTION_PURPOSE,
  );
  const database = getDatabaseClient();
  await database.begin(async (transaction) => {
    await transaction`
      update public.notification_push_subscriptions
      set status = 'revoked', revoked_at = now(), last_error_code = 'endpoint_reassigned'
      where endpoint_hash = ${hash}
        and membership_id <> ${context.membership.id}::uuid
        and status = 'active'
    `;
    await transaction`
      insert into public.notification_push_subscriptions (
        organization_id,
        membership_id,
        endpoint_hash,
        encrypted_subscription,
        expiration_time,
        status,
        failure_count,
        revoked_at,
        last_error_code
      ) values (
        ${context.membership.organizationId}::uuid,
        ${context.membership.id}::uuid,
        ${hash},
        ${encrypted},
        ${subscription.expirationTime ?? null},
        'active',
        0,
        null,
        null
      )
      on conflict (membership_id, endpoint_hash)
      do update set
        organization_id = excluded.organization_id,
        encrypted_subscription = excluded.encrypted_subscription,
        expiration_time = excluded.expiration_time,
        status = 'active',
        failure_count = 0,
        revoked_at = null,
        last_error_code = null,
        updated_at = now()
    `;
    await transaction`
      insert into public.user_preferences (membership_id, notification_preferences)
      values (
        ${context.membership.id}::uuid,
        ${transaction.json(toJsonValue({ browserPushEnabled: true }))}
      )
      on conflict (membership_id)
      do update set notification_preferences =
        coalesce(public.user_preferences.notification_preferences, '{}'::jsonb)
        || excluded.notification_preferences,
        updated_at = now()
    `;
  });
}

export async function revokeNotificationPushSubscriptions(
  context: CurrentPermissionContext,
  endpoint?: string | null,
): Promise<number> {
  const database = getDatabaseClient();
  const hash = endpoint ? endpointHash(endpoint) : null;
  return database.begin(async (transaction) => {
    const rows = await transaction<{ id: string }[]>`
      update public.notification_push_subscriptions
      set status = 'revoked', revoked_at = now(), last_error_code = null
      where organization_id = ${context.membership.organizationId}::uuid
        and membership_id = ${context.membership.id}::uuid
        and status = 'active'
        and (${hash}::text is null or endpoint_hash = ${hash})
      returning id
    `;
    const remaining = await transaction<{ exists: boolean }[]>`
      select exists (
        select 1
        from public.notification_push_subscriptions
        where organization_id = ${context.membership.organizationId}::uuid
          and membership_id = ${context.membership.id}::uuid
          and status = 'active'
      ) as exists
    `;
    await transaction`
      insert into public.user_preferences (membership_id, notification_preferences)
      values (
        ${context.membership.id}::uuid,
        ${transaction.json(toJsonValue({ browserPushEnabled: remaining[0]?.exists ?? false }))}
      )
      on conflict (membership_id)
      do update set notification_preferences =
        coalesce(public.user_preferences.notification_preferences, '{}'::jsonb)
        || excluded.notification_preferences,
        updated_at = now()
    `;
    return rows.length;
  });
}

export async function latestUnreadPushNotification(context: CurrentPermissionContext) {
  const database = getDatabaseClient();
  const rows = await database<
    { id: string; title: string; message: string; deep_link: string | null }[]
  >`
    select id, title, message, deep_link
    from public.notifications
    where organization_id = ${context.membership.organizationId}::uuid
      and recipient_membership_id = ${context.membership.id}::uuid
      and archived_at is null
      and read_at is null
    order by last_occurred_at desc, id desc
    limit 1
  `;
  const row = rows[0];
  return row
    ? {
        id: row.id,
        title: row.title,
        message: row.message,
        deepLink: safeNotificationDeepLink(row.deep_link) ?? "/notifications",
      }
    : null;
}
