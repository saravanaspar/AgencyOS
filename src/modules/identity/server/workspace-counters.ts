import "server-only";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { invalidateRedisJsonCache, readThroughRedisJsonCache } from "@/integrations/redis/cache";
import { withInfrastructureRetry } from "@/lib/server/retry";

const WORKSPACE_COUNTER_CACHE_NAMESPACE = "workspace:counters";
const WORKSPACE_COUNTER_TTL_SECONDS = 4;
const MAX_LOCAL_FALLBACK_ENTRIES = 500;

export interface WorkspaceCounters {
  unreadNotificationCount: number;
  pendingApprovalCount: number;
}

interface WorkspaceCounterRow {
  unread_notification_count: number;
  pending_approval_count: number;
}

declare global {
  var __agencyOsWorkspaceCounterFallback: Map<string, WorkspaceCounters> | undefined;
}

function localFallbacks(): Map<string, WorkspaceCounters> {
  globalThis.__agencyOsWorkspaceCounterFallback ??= new Map();
  return globalThis.__agencyOsWorkspaceCounterFallback;
}

function localFallbackKey(organizationId: string, membershipId: string): string {
  return `${organizationId}:${membershipId}`;
}

function parseWorkspaceCounters(value: unknown): WorkspaceCounters | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const unread = Reflect.get(value, "unreadNotificationCount");
  const approvals = Reflect.get(value, "pendingApprovalCount");
  if (typeof unread !== "number" || !Number.isSafeInteger(unread) || unread < 0) return null;
  if (typeof approvals !== "number" || !Number.isSafeInteger(approvals) || approvals < 0) {
    return null;
  }
  return { unreadNotificationCount: unread, pendingApprovalCount: approvals };
}

function cacheIdentity(organizationId: string, membershipId: string): readonly string[] {
  return [organizationId, membershipId];
}

async function loadWorkspaceCounters(
  organizationId: string,
  membershipId: string,
): Promise<WorkspaceCounters> {
  const database = getDatabaseClient();
  const rows = await withInfrastructureRetry(
    () => database<WorkspaceCounterRow[]>`
      select
        coalesce((
          select count(*)::integer
          from public.notifications as notification
          left join public.user_preferences as preference
            on preference.membership_id = ${membershipId}::uuid
          where notification.recipient_membership_id = ${membershipId}::uuid
            and notification.organization_id = ${organizationId}::uuid
            and notification.read_at is null
            and notification.archived_at is null
            and case
              when jsonb_typeof(
                preference.notification_preferences -> 'categories' -> notification.category
              ) = 'boolean'
                then (
                  preference.notification_preferences -> 'categories' ->> notification.category
                )::boolean
              else true
            end
        ), 0) as unread_notification_count,
        case
          when private.membership_has_permission(
            ${membershipId}::uuid,
            'approvals.request.view'
          ) then coalesce((
            select count(*)::integer
            from public.approval_request_steps as approval_step
            join public.approval_requests as approval_request
              on approval_request.id = approval_step.request_id
             and approval_request.organization_id = approval_step.organization_id
             and approval_request.status = 'pending'
            where approval_step.organization_id = ${organizationId}::uuid
              and approval_step.approver_membership_id = ${membershipId}::uuid
              and approval_step.status = 'pending'
          ), 0)
          else 0
        end as pending_approval_count
    `,
    { attempts: 2, operationName: "Workspace counter lookup" },
  );
  const row = rows[0];
  return {
    unreadNotificationCount: row?.unread_notification_count ?? 0,
    pendingApprovalCount: row?.pending_approval_count ?? 0,
  };
}

export async function getWorkspaceCounters(
  organizationId: string,
  membershipId: string,
): Promise<WorkspaceCounters> {
  const fallbackKey = localFallbackKey(organizationId, membershipId);
  const fallbacks = localFallbacks();

  try {
    const counters = await readThroughRedisJsonCache(
      {
        namespace: WORKSPACE_COUNTER_CACHE_NAMESPACE,
        identity: cacheIdentity(organizationId, membershipId),
        ttlSeconds: WORKSPACE_COUNTER_TTL_SECONDS,
        maximumBytes: 1_024,
        parse: parseWorkspaceCounters,
      },
      () => loadWorkspaceCounters(organizationId, membershipId),
    );
    if (fallbacks.size >= MAX_LOCAL_FALLBACK_ENTRIES && !fallbacks.has(fallbackKey)) {
      fallbacks.clear();
    }
    fallbacks.set(fallbackKey, counters);
    return counters;
  } catch {
    // Badge counters are display-only and must never turn a valid session into an access failure.
    return fallbacks.get(fallbackKey) ?? { unreadNotificationCount: 0, pendingApprovalCount: 0 };
  }
}

export async function invalidateWorkspaceCounters(
  organizationId: string,
  membershipId: string,
): Promise<void> {
  await invalidateRedisJsonCache(
    WORKSPACE_COUNTER_CACHE_NAMESPACE,
    cacheIdentity(organizationId, membershipId),
  );
}
