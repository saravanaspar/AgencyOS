import "server-only";

import { createHash, createPrivateKey, createSign, randomUUID } from "node:crypto";

import { sendEmailWithResend } from "@/integrations/email/resend";
import { getDatabaseClient } from "@/integrations/postgres/database";
import { readBoundedResponseText } from "@/lib/server/bounded-response";
import { getApplicationEnv } from "@/lib/validation/env";
import {
  isWithinQuietHours,
  nextQuietHoursEnd,
  notificationRetryDelaySeconds,
  retryAfterSeconds,
  type ExternalNotificationChannel,
} from "@/modules/notifications/notification-delivery";
import {
  normalizeNotificationPreferences,
  safeNotificationDeepLink,
  type NotificationCategory,
  type NotificationSeverity,
} from "@/modules/notifications/notifications";
import { getNotificationDeliveryConfiguration } from "@/modules/notifications/server/delivery-config";
import { decryptPushSubscription } from "@/modules/notifications/server/delivery-queue";

const MAX_DELIVERIES_PER_RUN = 40;
const MAX_ATTEMPTS = 6;
const DELIVERY_TIMEOUT_MS = 8_000;

interface PushEnvelopeRow {
  id: string;
  encrypted_subscription: string;
}

interface ClaimedDeliveryRow {
  id: string;
  lock_token: string;
  organization_id: string;
  notification_id: string;
  recipient_membership_id: string;
  channel: ExternalNotificationChannel;
  attempt_count: number;
  title: string | null;
  message: string | null;
  category: NotificationCategory | null;
  severity: NotificationSeverity | null;
  deep_link: string | null;
  source_module: string | null;
  source_entity_type: string | null;
  source_entity_id: string | null;
  notification_archived_at: Date | null;
  membership_status: string | null;
  organization_status: string | null;
  recipient_email: string | null;
  notification_preferences: unknown;
  push_subscriptions: PushEnvelopeRow[];
}

interface DeliveryResult {
  outcome: "delivered" | "retry" | "deferred" | "suppressed";
  errorCode?: string;
  providerReference?: string;
  retryAfterSeconds?: number;
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function vapidAuthorization(
  endpoint: string,
  publicKey: string,
  privateKey: string,
  subject: string,
) {
  const publicBytes = Buffer.from(publicKey, "base64url");
  const privateBytes = Buffer.from(privateKey, "base64url");
  if (publicBytes.length !== 65 || publicBytes[0] !== 4 || privateBytes.length !== 32) {
    throw new Error("VAPID key material is invalid.");
  }
  const audience = new URL(endpoint).origin;
  const header = base64UrlJson({ typ: "JWT", alg: "ES256" });
  const payload = base64UrlJson({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: subject,
  });
  const input = `${header}.${payload}`;
  const key = createPrivateKey({
    format: "jwk",
    key: {
      kty: "EC",
      crv: "P-256",
      x: publicBytes.subarray(1, 33).toString("base64url"),
      y: publicBytes.subarray(33, 65).toString("base64url"),
      d: privateBytes.toString("base64url"),
    },
  });
  const signer = createSign("SHA256");
  signer.update(input);
  signer.end();
  const signature = signer.sign({ key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${input}.${signature.toString("base64url")}, k=${publicKey}`;
}

function safeAbsoluteLink(deepLink: string | null): string {
  const appUrl = new URL(getApplicationEnv().appUrl);
  return new URL(safeNotificationDeepLink(deepLink) ?? "/notifications", appUrl).toString();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}

async function postWithTimeout(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
  });
}

async function deliverEmail(row: ClaimedDeliveryRow): Promise<DeliveryResult> {
  const configuration = getNotificationDeliveryConfiguration().email;
  if (
    !configuration.configured ||
    !configuration.resendApiKey ||
    !configuration.from ||
    !row.recipient_email ||
    !row.title ||
    !row.message
  ) {
    return { outcome: "retry", errorCode: "email_not_configured", retryAfterSeconds: 3_600 };
  }

  const link = safeAbsoluteLink(row.deep_link);
  const result = await sendEmailWithResend(
    { apiKey: configuration.resendApiKey, from: configuration.from },
    {
      to: row.recipient_email,
      subject: row.title,
      text: `${row.message}\n\nOpen in AgencyOS: ${link}`,
      html: `<p>${escapeHtml(row.message)}</p><p><a href="${escapeHtml(link)}">Open in AgencyOS</a></p>`,
      idempotencyKey: createHash("sha256").update(`email:${row.id}`).digest("hex"),
    },
  );

  if (result.delivered) {
    return { outcome: "delivered", providerReference: result.providerReference };
  }
  return {
    outcome: result.retryable ? "retry" : "suppressed",
    errorCode: result.errorCode,
    retryAfterSeconds:
      result.retryAfterSeconds ?? notificationRetryDelaySeconds(row.attempt_count + 1),
  };
}

async function revokePushSubscription(id: string, errorCode: string): Promise<void> {
  const database = getDatabaseClient();
  await database`
    update public.notification_push_subscriptions
    set status = 'revoked', revoked_at = now(), last_error_code = ${errorCode}
    where id = ${id}::uuid
  `;
}

async function deliverBrowserPush(row: ClaimedDeliveryRow): Promise<DeliveryResult> {
  const configuration = getNotificationDeliveryConfiguration().browserPush;
  if (
    !configuration.configured ||
    !configuration.publicKey ||
    !configuration.privateKey ||
    !configuration.subject
  ) {
    return { outcome: "retry", errorCode: "push_not_configured", retryAfterSeconds: 3_600 };
  }
  const pushSubscriptions = row.push_subscriptions ?? [];
  if (!pushSubscriptions.length) {
    return { outcome: "suppressed", errorCode: "push_subscription_missing" };
  }

  let delivered = false;
  let retryable = false;
  let retryDelay = notificationRetryDelaySeconds(row.attempt_count + 1);
  for (const stored of pushSubscriptions) {
    try {
      const subscription = decryptPushSubscription(stored.encrypted_subscription);
      const response = await postWithTimeout(subscription.endpoint, {
        method: "POST",
        headers: {
          authorization: vapidAuthorization(
            subscription.endpoint,
            configuration.publicKey,
            configuration.privateKey,
            configuration.subject,
          ),
          ttl: "60",
          urgency: row.severity === "error" ? "high" : "normal",
        },
      });
      await readBoundedResponseText(response, 8 * 1024, "Push response was too large.");
      if (response.ok || response.status === 201) {
        delivered = true;
      } else if (response.status === 404 || response.status === 410) {
        await revokePushSubscription(stored.id, "endpoint_expired");
      } else if (response.status === 429 || response.status >= 500) {
        retryable = true;
        retryDelay = Math.max(
          retryDelay,
          retryAfterSeconds(response.headers.get("retry-after")) ?? retryDelay,
        );
      }
    } catch {
      retryable = true;
    }
  }
  if (delivered) return { outcome: "delivered" };
  if (retryable) {
    return {
      outcome: "retry",
      errorCode: "push_provider_unavailable",
      retryAfterSeconds: retryDelay,
    };
  }
  return { outcome: "suppressed", errorCode: "push_endpoints_expired" };
}

async function claimDeliveries(limit: number): Promise<ClaimedDeliveryRow[]> {
  const database = getDatabaseClient();
  const token = randomUUID();
  return database<ClaimedDeliveryRow[]>`
    with due as (
      select delivery.id
      from public.notification_deliveries as delivery
      where delivery.channel in ('email', 'browser_push')
        and delivery.status in ('pending', 'failed')
        and coalesce(delivery.next_attempt_at, delivery.created_at) <= now()
        and (delivery.locked_at is null or delivery.locked_at < now() - interval '5 minutes')
        and delivery.attempt_count < ${MAX_ATTEMPTS}
      order by coalesce(delivery.next_attempt_at, delivery.created_at), delivery.created_at
      for update skip locked
      limit ${Math.min(MAX_DELIVERIES_PER_RUN, Math.max(1, limit))}
    ), claimed as (
      update public.notification_deliveries as delivery
      set locked_at = now(), lock_token = ${token}::uuid
      from due
      where delivery.id = due.id
      returning delivery.*
    )
    select
      claimed.id,
      claimed.lock_token,
      claimed.organization_id,
      claimed.notification_id,
      claimed.recipient_membership_id,
      claimed.channel,
      claimed.attempt_count,
      notification.title,
      notification.message,
      notification.category,
      notification.severity,
      notification.deep_link,
      notification.source_module,
      notification.source_entity_type,
      notification.source_entity_id,
      notification.archived_at as notification_archived_at,
      membership.status as membership_status,
      organization.status as organization_status,
      auth_user.email as recipient_email,
      preference.notification_preferences,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', push_subscription.id,
          'encrypted_subscription', push_subscription.encrypted_subscription
        ))
        from public.notification_push_subscriptions as push_subscription
        where push_subscription.organization_id = claimed.organization_id
          and push_subscription.membership_id = claimed.recipient_membership_id
          and push_subscription.status = 'active'
      ), '[]'::jsonb) as push_subscriptions
    from claimed
    left join public.notifications as notification on notification.id = claimed.notification_id
    left join public.memberships as membership on membership.id = claimed.recipient_membership_id
    left join public.organizations as organization on organization.id = claimed.organization_id
    left join public.identity_accounts as auth_user on auth_user.id = membership.user_id
    left join public.user_preferences as preference on preference.membership_id = membership.id
  `;
}

async function finalizeDelivery(row: ClaimedDeliveryRow, result: DeliveryResult): Promise<void> {
  const database = getDatabaseClient();
  const nextAttempt =
    result.outcome === "retry" || result.outcome === "deferred"
      ? new Date(Date.now() + (result.retryAfterSeconds ?? 60) * 1_000)
      : null;
  const attemptCount = result.outcome === "deferred" ? row.attempt_count : row.attempt_count + 1;
  const finalOutcome =
    result.outcome === "retry" && attemptCount >= MAX_ATTEMPTS ? "suppressed" : result.outcome;
  await database`
    update public.notification_deliveries
    set
      status = ${finalOutcome === "delivered" ? "delivered" : finalOutcome === "retry" ? "failed" : finalOutcome === "deferred" ? "pending" : "suppressed"},
      attempt_count = ${attemptCount},
      attempted_at = now(),
      delivered_at = case when ${finalOutcome} = 'delivered' then now() else delivered_at end,
      next_attempt_at = case when ${finalOutcome} in ('retry', 'deferred') then ${nextAttempt} else null end,
      last_error_code = ${finalOutcome === "delivered" || finalOutcome === "deferred" ? null : (result.errorCode ?? "delivery_failed")},
      last_error_message = ${finalOutcome === "delivered" || finalOutcome === "deferred" ? null : "External notification delivery was not completed."},
      provider_reference = ${result.providerReference ?? null},
      locked_at = null,
      lock_token = null
    where id = ${row.id}::uuid
      and lock_token = ${row.lock_token}::uuid
  `;
}

async function processDelivery(row: ClaimedDeliveryRow): Promise<DeliveryResult> {
  if (
    !row.title ||
    !row.message ||
    !row.category ||
    row.notification_archived_at ||
    row.membership_status !== "active" ||
    row.organization_status !== "active"
  ) {
    return { outcome: "suppressed", errorCode: "recipient_inactive" };
  }
  const preferences = normalizeNotificationPreferences(row.notification_preferences);
  if (!preferences.categories[row.category]) {
    return { outcome: "suppressed", errorCode: "category_disabled" };
  }
  const enabled =
    (row.channel === "email" && preferences.emailEnabled) ||
    (row.channel === "browser_push" && preferences.browserPushEnabled);
  if (!enabled) return { outcome: "suppressed", errorCode: "channel_disabled" };
  if (
    preferences.quietHours.enabled &&
    isWithinQuietHours(new Date(), preferences.quietHours.start, preferences.quietHours.end)
  ) {
    return {
      outcome: "deferred",
      errorCode: "quiet_hours",
      retryAfterSeconds: Math.max(
        60,
        Math.ceil(
          (nextQuietHoursEnd(new Date(), preferences.quietHours.end).getTime() - Date.now()) /
            1_000,
        ),
      ),
    };
  }
  if (row.channel === "email") return deliverEmail(row);
  return deliverBrowserPush(row);
}

export interface NotificationDeliveryRunSummary {
  claimed: number;
  delivered: number;
  retried: number;
  suppressed: number;
}

export async function runNotificationDeliveryWorker(
  limit = MAX_DELIVERIES_PER_RUN,
): Promise<NotificationDeliveryRunSummary> {
  const rows = await claimDeliveries(limit);
  const summary: NotificationDeliveryRunSummary = {
    claimed: rows.length,
    delivered: 0,
    retried: 0,
    suppressed: 0,
  };
  for (let index = 0; index < rows.length; index += 4) {
    const batch = rows.slice(index, index + 4);
    await Promise.all(
      batch.map(async (row) => {
        let result: DeliveryResult;
        try {
          result = await processDelivery(row);
        } catch {
          result = {
            outcome: "retry",
            errorCode: "delivery_worker_error",
            retryAfterSeconds: notificationRetryDelaySeconds(row.attempt_count + 1),
          };
        }
        await finalizeDelivery(row, result);
        if (result.outcome === "delivered") summary.delivered += 1;
        else if (result.outcome === "retry" || result.outcome === "deferred") summary.retried += 1;
        else summary.suppressed += 1;
      }),
    );
  }
  return summary;
}
