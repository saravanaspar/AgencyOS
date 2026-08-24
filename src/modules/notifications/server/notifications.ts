import "server-only";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { toJsonValue } from "@/lib/server/json-value";
import { invalidateWorkspaceCounters } from "@/modules/identity/server/workspace-counters";
import { withInfrastructureRetry } from "@/lib/server/retry";
import {
  defaultNotificationPreferences,
  normalizeNotificationPreferences,
  safeNotificationDeepLink,
  type NotificationCenterData,
  type NotificationCategory,
  type NotificationDeliverySummary,
  type NotificationPreferences,
  type NotificationSeverity,
  type NotificationStatusFilter,
} from "@/modules/notifications/notifications";
import { publicNotificationDeliveryConfiguration } from "@/modules/notifications/server/delivery-config";
import { scheduleNotificationDeliveries } from "@/modules/notifications/server/delivery-queue";
import {
  authorizeCurrentUser,
  type AuthorizationFailureReason,
} from "@/modules/permissions/server/authorization";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

export const notificationPermissionKeys = {
  view: "notifications.notification.view",
  update: "notifications.notification.update",
  managePreferences: "notifications.preference.manage_settings",
} as const;

export const NOTIFICATION_PAGE_SIZE = 25;

interface PreferenceRow {
  notification_preferences: unknown;
}

interface NotificationRow {
  id: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
  message: string;
  deep_link: string | null;
  source_module: string;
  source_entity_type: string | null;
  occurrence_count: number;
  last_occurred_at: Date;
  read_at: Date | null;
  deliveries: Array<{
    channel: NotificationDeliverySummary["channel"];
    status: NotificationDeliverySummary["status"];
    attemptCount: number;
    nextAttemptAt: string | null;
    deliveredAt: string | null;
    lastErrorCode: string | null;
  }>;
}

interface CountRow {
  count: number;
}

interface SummaryRow {
  unread_count: number;
  total_count: number;
  occurred_today: number;
  has_active_push_subscription: boolean;
}

export type NotificationCenterResult =
  | { allowed: true; data: NotificationCenterData }
  | { allowed: false; reason: AuthorizationFailureReason };

export interface EnqueueNotificationInput {
  organizationId: string;
  recipientMembershipId: string;
  category: NotificationCategory;
  severity?: NotificationSeverity;
  title: string;
  message: string;
  deepLink?: string | null;
  sourceModule: string;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  dedupeKey?: string | null;
  metadata?: Record<string, unknown>;
  createdByMembershipId?: string | null;
  externalDelivery?: boolean;
}

function enabledCategories(preferences: NotificationPreferences): NotificationCategory[] {
  return Object.entries(preferences.categories)
    .filter(([, enabled]) => enabled)
    .map(([category]) => category as NotificationCategory);
}

async function readPreferences(membershipId: string): Promise<NotificationPreferences> {
  const database = getDatabaseClient();
  const rows = await withInfrastructureRetry(
    () => database<PreferenceRow[]>`
      select notification_preferences
      from public.user_preferences
      where membership_id = ${membershipId}::uuid
      limit 1
    `,
    { attempts: 2, operationName: "Notification preference lookup" },
  );
  return normalizeNotificationPreferences(rows[0]?.notification_preferences);
}

export async function getNotificationCenterData(filters: {
  status: NotificationStatusFilter;
  category: NotificationCategory | "";
  page: number;
}): Promise<NotificationCenterResult> {
  const authorization = await authorizeCurrentUser([notificationPermissionKeys.view]);
  if (!authorization.allowed) return authorization;

  const { context } = authorization;
  const preferences = await readPreferences(context.membership.id);
  const categories = enabledCategories(preferences);
  const database = getDatabaseClient();
  const offset = (filters.page - 1) * NOTIFICATION_PAGE_SIZE;

  const [items, countRows, summaryRows] = await Promise.all([
    withInfrastructureRetry(
      () => database<NotificationRow[]>`
        select
          notification.id,
          notification.category,
          notification.severity,
          notification.title,
          notification.message,
          notification.deep_link,
          notification.source_module,
          notification.source_entity_type,
          notification.occurrence_count,
          notification.last_occurred_at,
          notification.read_at,
          coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'channel', delivery.channel,
                'status', delivery.status,
                'attemptCount', delivery.attempt_count,
                'nextAttemptAt', delivery.next_attempt_at,
                'deliveredAt', delivery.delivered_at,
                'lastErrorCode', delivery.last_error_code
              ) order by delivery.created_at, delivery.id
            )
            from public.notification_deliveries as delivery
            where delivery.notification_id = notification.id
          ), '[]'::jsonb) as deliveries
        from public.notifications as notification
        where notification.organization_id = ${context.membership.organizationId}::uuid
          and notification.recipient_membership_id = ${context.membership.id}::uuid
          and notification.archived_at is null
          and notification.category = any(${categories}::text[])
          and (
            ${filters.status} = 'all'
            or (${filters.status} = 'unread' and notification.read_at is null)
            or (${filters.status} = 'read' and notification.read_at is not null)
          )
          and (${filters.category} = '' or notification.category = ${filters.category})
        order by notification.last_occurred_at desc, notification.id desc
        limit ${NOTIFICATION_PAGE_SIZE}
        offset ${offset}
      `,
      { attempts: 2, operationName: "Notification center list" },
    ),
    withInfrastructureRetry(
      () => database<CountRow[]>`
        select count(*)::integer as count
        from public.notifications as notification
        where notification.organization_id = ${context.membership.organizationId}::uuid
          and notification.recipient_membership_id = ${context.membership.id}::uuid
          and notification.archived_at is null
          and notification.category = any(${categories}::text[])
          and (
            ${filters.status} = 'all'
            or (${filters.status} = 'unread' and notification.read_at is null)
            or (${filters.status} = 'read' and notification.read_at is not null)
          )
          and (${filters.category} = '' or notification.category = ${filters.category})
      `,
      { attempts: 2, operationName: "Notification center count" },
    ),
    withInfrastructureRetry(
      () => database<SummaryRow[]>`
        select
          count(*) filter (where notification.read_at is null)::integer as unread_count,
          count(*)::integer as total_count,
          count(*) filter (
            where notification.last_occurred_at >= date_trunc('day', now())
          )::integer as occurred_today,
          exists (
            select 1
            from public.notification_push_subscriptions as push_subscription
            where push_subscription.organization_id = ${context.membership.organizationId}::uuid
              and push_subscription.membership_id = ${context.membership.id}::uuid
              and push_subscription.status = 'active'
          ) as has_active_push_subscription
        from public.notifications as notification
        where notification.organization_id = ${context.membership.organizationId}::uuid
          and notification.recipient_membership_id = ${context.membership.id}::uuid
          and notification.archived_at is null
          and notification.category = any(${categories}::text[])
      `,
      { attempts: 2, operationName: "Notification center summary" },
    ),
  ]);

  const totalItems = countRows[0]?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / NOTIFICATION_PAGE_SIZE));
  const page = Math.min(filters.page, totalPages);
  const summary = summaryRows[0] ?? {
    unread_count: 0,
    total_count: 0,
    occurred_today: 0,
    has_active_push_subscription: false,
  };
  const deliveryConfiguration = publicNotificationDeliveryConfiguration();

  return {
    allowed: true,
    data: {
      items: items.map((item) => ({
        id: item.id,
        category: item.category,
        severity: item.severity,
        title: item.title,
        message: item.message,
        deepLink: safeNotificationDeepLink(item.deep_link),
        sourceModule: item.source_module,
        sourceEntityType: item.source_entity_type,
        occurrenceCount: item.occurrence_count,
        lastOccurredAt: item.last_occurred_at.toISOString(),
        readAt: item.read_at?.toISOString() ?? null,
        deliveries: item.deliveries.map((delivery) => ({
          channel: delivery.channel,
          status: delivery.status,
          attemptCount: delivery.attemptCount ?? 0,
          nextAttemptAt: delivery.nextAttemptAt,
          deliveredAt: delivery.deliveredAt,
          lastErrorCode: delivery.lastErrorCode,
        })),
      })),
      preferences,
      deliveryConfiguration: {
        ...deliveryConfiguration,
        hasActivePushSubscription: summary.has_active_push_subscription,
      },
      filters: { ...filters, page },
      pagination: {
        page,
        pageSize: NOTIFICATION_PAGE_SIZE,
        totalItems,
        totalPages,
      },
      summary: {
        unreadCount: summary.unread_count,
        totalCount: summary.total_count,
        occurredToday: summary.occurred_today,
      },
    },
  };
}

export async function markNotificationRead(
  context: CurrentPermissionContext,
  notificationId: string,
): Promise<void> {
  const database = getDatabaseClient();
  const rows = await database<{ id: string }[]>`
    update public.notifications
    set read_at = coalesce(read_at, now())
    where id = ${notificationId}::uuid
      and organization_id = ${context.membership.organizationId}::uuid
      and recipient_membership_id = ${context.membership.id}::uuid
      and archived_at is null
    returning id
  `;
  if (!rows[0]) throw new Error("Notification was not found.");
  await invalidateWorkspaceCounters(context.membership.organizationId, context.membership.id);
}

export async function markAllNotificationsRead(context: CurrentPermissionContext): Promise<number> {
  const preferences = await readPreferences(context.membership.id);
  const categories = enabledCategories(preferences);
  const database = getDatabaseClient();
  const rows = await database<{ id: string }[]>`
    update public.notifications
    set read_at = now()
    where organization_id = ${context.membership.organizationId}::uuid
      and recipient_membership_id = ${context.membership.id}::uuid
      and archived_at is null
      and read_at is null
      and category = any(${categories}::text[])
    returning id
  `;
  await invalidateWorkspaceCounters(context.membership.organizationId, context.membership.id);
  return rows.length;
}

export async function updateNotificationPreferences(
  context: CurrentPermissionContext,
  preferences: NotificationPreferences,
): Promise<void> {
  const database = getDatabaseClient();
  const normalized = normalizeNotificationPreferences(preferences);
  const rows = await withInfrastructureRetry(
    () => database<{ membership_id: string }[]>`
      insert into public.user_preferences as stored_preference (
        membership_id,
        notification_preferences
      )
      values (${context.membership.id}::uuid, ${database.json(toJsonValue(normalized))})
      on conflict (membership_id)
      do update set
        notification_preferences = excluded.notification_preferences,
        updated_at = now()
      returning stored_preference.membership_id
    `,
    { attempts: 2, operationName: "Notification preference update" },
  );
  if (!rows[0]) throw new Error("Notification preference update returned no row.");
  await invalidateWorkspaceCounters(context.membership.organizationId, context.membership.id);
}

export async function enqueueNotification(input: EnqueueNotificationInput): Promise<string> {
  const database = getDatabaseClient();
  const deepLink = safeNotificationDeepLink(input.deepLink);
  const title = input.title.trim().slice(0, 160);
  const message = input.message.trim().slice(0, 1_000);
  if (!title || !message) throw new Error("Notification title and message are required.");
  if (!/^[a-z][a-z0-9_]*$/.test(input.sourceModule)) {
    throw new Error("Notification source module is invalid.");
  }

  const rows = await database<{ id: string }[]>`
    insert into public.notifications (
      organization_id,
      recipient_membership_id,
      category,
      severity,
      title,
      message,
      deep_link,
      source_module,
      source_entity_type,
      source_entity_id,
      dedupe_key,
      metadata,
      created_by_membership_id
    ) values (
      ${input.organizationId}::uuid,
      ${input.recipientMembershipId}::uuid,
      ${input.category},
      ${input.severity ?? "info"},
      ${title},
      ${message},
      ${deepLink},
      ${input.sourceModule},
      ${input.sourceEntityType ?? null},
      ${input.sourceEntityId ?? null},
      ${input.dedupeKey?.trim().slice(0, 300) || null},
      ${database.json(toJsonValue(input.metadata ?? {}))},
      ${input.createdByMembershipId ?? null}::uuid
    )
    on conflict (recipient_membership_id, dedupe_key)
      where dedupe_key is not null and read_at is null and archived_at is null
    do update set
      severity = excluded.severity,
      title = excluded.title,
      message = excluded.message,
      deep_link = excluded.deep_link,
      metadata = excluded.metadata,
      occurrence_count = public.notifications.occurrence_count + 1,
      last_occurred_at = now(),
      updated_at = now()
    returning id
  `;

  const notificationId = rows[0]?.id ?? "";
  if (notificationId) {
    await invalidateWorkspaceCounters(input.organizationId, input.recipientMembershipId);
    if (input.externalDelivery !== false) {
      try {
        await scheduleNotificationDeliveries(notificationId);
      } catch {
        console.warn("[AgencyOS] Notification external delivery scheduling failed.", {
          notificationId,
        });
      }
    }
  }
  return notificationId;
}

export function notificationPreferencesForForm(input: {
  enabledCategories: NotificationCategory[];
  emailEnabled: boolean;
  browserPushEnabled: boolean;
  digest: "none" | "daily" | "weekly";
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
}): NotificationPreferences {
  const enabledCategories = new Set(input.enabledCategories);
  return {
    ...defaultNotificationPreferences,
    categories: Object.fromEntries(
      Object.keys(defaultNotificationPreferences.categories).map((category) => [
        category,
        enabledCategories.has(category as NotificationCategory),
      ]),
    ) as NotificationPreferences["categories"],
    emailEnabled: input.emailEnabled,
    browserPushEnabled: input.browserPushEnabled,
    digest: input.digest,
    quietHours: {
      enabled: input.quietHoursEnabled,
      start: input.quietHoursStart,
      end: input.quietHoursEnd,
    },
  };
}

export type NotificationAudience =
  | { kind: "person"; membershipId: string }
  | { kind: "named"; membershipIds: string[] }
  | { kind: "department"; departmentId: string }
  | { kind: "general" };

export interface EnqueueAudienceNotificationInput extends Omit<
  EnqueueNotificationInput,
  "recipientMembershipId"
> {
  audience: NotificationAudience;
  /**
   * Every resolved recipient must hold all of these permissions. This is how
   * a module-level "general" notification stays visible only to people who can
   * actually open the related section/record class.
   */
  requiredPermissionKeys?: string[];
}

export interface AudienceNotificationResult {
  requestedRecipients: number;
  deliveredToInbox: number;
  failedRecipients: Array<{ membershipId: string; error: string }>;
}

export async function resolveNotificationAudienceMembershipIds(input: {
  organizationId: string;
  audience: NotificationAudience;
  requiredPermissionKeys?: string[];
}): Promise<string[]> {
  const database = getDatabaseClient();
  const required = Array.from(
    new Set([notificationPermissionKeys.view, ...(input.requiredPermissionKeys ?? [])]),
  );
  const namedIds =
    input.audience.kind === "person"
      ? [input.audience.membershipId]
      : input.audience.kind === "named"
        ? input.audience.membershipIds
        : [];
  const departmentId = input.audience.kind === "department" ? input.audience.departmentId : null;
  const isGeneral = input.audience.kind === "general";
  const isDepartment = input.audience.kind === "department";
  const rows = await database<Array<{ id: string }>>`
    select membership.id
    from public.memberships membership
    where membership.organization_id = ${input.organizationId}::uuid
      and membership.status = 'active'
      and (
        ${isGeneral}
        or (${isDepartment} and membership.department_id = ${departmentId}::uuid)
        or membership.id = any(${namedIds}::uuid[])
      )
      and not exists (
        select 1
        from unnest(${required}::text[]) permission_key
        where not private.membership_has_permission(membership.id, permission_key)
      )
    order by membership.created_at, membership.id
    limit 1000
  `;
  return rows.map((row) => row.id);
}

export async function enqueueNotificationAudience(
  input: EnqueueAudienceNotificationInput,
): Promise<AudienceNotificationResult> {
  const recipients = await resolveNotificationAudienceMembershipIds(input);
  const failedRecipients: AudienceNotificationResult["failedRecipients"] = [];
  let deliveredToInbox = 0;
  for (const membershipId of recipients) {
    try {
      await enqueueNotification({
        ...input,
        recipientMembershipId: membershipId,
        dedupeKey: input.dedupeKey ? `${input.dedupeKey}:${membershipId}` : null,
      });
      deliveredToInbox += 1;
    } catch (error) {
      failedRecipients.push({
        membershipId,
        error: error instanceof Error ? error.message.slice(0, 160) : "notification-enqueue-failed",
      });
    }
  }
  return {
    requestedRecipients: recipients.length,
    deliveredToInbox,
    failedRecipients,
  };
}
