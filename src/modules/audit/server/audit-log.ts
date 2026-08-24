import "server-only";

import { getDatabaseClient } from "@/integrations/postgres/database";
import type { AuditLogFilters } from "@/modules/audit/schemas/audit-log";
import {
  authorizeCurrentUser,
  type AuthorizationFailureReason,
} from "@/modules/permissions/server/authorization";

export const auditPermissionKeys = {
  export: "settings.audit.export",
  view: "settings.audit.view",
} as const;

export const AUDIT_PAGE_SIZE = 25;
export const AUDIT_EXPORT_LIMIT = 5_000;

export interface AuditLogEvent {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorType: string;
  actorEmail: string | null;
  actorDisplayName: string;
  source: string;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
  changedFields: string[];
  metadata: Record<string, unknown>;
  occurredAt: string;
}

export interface AuditLogData {
  organization: {
    id: string;
    legalName: string;
  };
  events: AuditLogEvent[];
  availableActions: string[];
  filters: AuditLogFilters;
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
  summary: {
    totalEvents: number;
    eventsLast24Hours: number;
    uniqueActors: number;
  };
  canExport: boolean;
}

export type AuditLogResult =
  { allowed: true; data: AuditLogData } | { allowed: false; reason: AuthorizationFailureReason };

export type AuditExportResult =
  | { allowed: true; events: AuditLogEvent[]; truncated: boolean }
  | { allowed: false; reason: AuthorizationFailureReason };

interface OrganizationRow {
  id: string;
  legal_name: string;
}

interface AuditEventRow {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_type: string;
  actor_email: string | null;
  actor_display_name: string;
  source: string;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  changed_fields: string[];
  metadata: Record<string, unknown>;
  occurred_at: Date;
}

interface CountRow {
  count: number;
}

interface SummaryRow {
  total_events: number;
  events_last_24_hours: number;
  unique_actors: number;
}

interface ActionRow {
  action: string;
}

function toDateBounds(filters: AuditLogFilters) {
  const fromTimestamp = filters.from ? `${filters.from}T00:00:00.000Z` : null;
  let toTimestamp: string | null = null;

  if (filters.to) {
    const date = new Date(`${filters.to}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    toTimestamp = date.toISOString();
  }

  return { fromTimestamp, toTimestamp };
}

function mapAuditEvent(row: AuditEventRow): AuditLogEvent {
  return {
    id: row.id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    actorType: row.actor_type,
    actorEmail: row.actor_email,
    actorDisplayName: row.actor_display_name,
    source: row.source,
    beforeState: row.before_state,
    afterState: row.after_state,
    changedFields: row.changed_fields,
    metadata: row.metadata,
    occurredAt: row.occurred_at.toISOString(),
  };
}

async function getAuthorizedAuditContext(requiredPermission: string) {
  return authorizeCurrentUser([requiredPermission]);
}

export async function getAuditLogData(filters: AuditLogFilters): Promise<AuditLogResult> {
  const authorization = await getAuthorizedAuditContext(auditPermissionKeys.view);

  if (!authorization.allowed) {
    return authorization;
  }

  const database = getDatabaseClient();
  const organizationId = authorization.context.membership.organizationId;
  const { fromTimestamp, toTimestamp } = toDateBounds(filters);
  const searchPattern = `%${filters.q}%`;
  const offset = (filters.page - 1) * AUDIT_PAGE_SIZE;

  try {
    const [organizations, eventRows, countRows, summaryRows, actionRows] = await Promise.all([
      database<OrganizationRow[]>`
        select id, legal_name
        from public.organizations
        where id = ${organizationId}::uuid
          and status = 'active'
        limit 1
      `,
      database<AuditEventRow[]>`
        select
          event.id::text,
          event.action,
          event.entity_type,
          event.entity_id,
          event.actor_type,
          auth_user.email as actor_email,
          coalesce(
            profile.display_name,
            nullif(auth_user.raw_user_meta_data ->> 'full_name', ''),
            auth_user.email,
            initcap(event.actor_type)
          ) as actor_display_name,
          event.source,
          event.before_state,
          event.after_state,
          event.changed_fields,
          event.metadata,
          event.occurred_at
        from public.audit_events as event
        left join public.identity_accounts as auth_user
          on auth_user.id = event.actor_user_id
        left join public.profiles as profile
          on profile.id = event.actor_user_id
        where event.organization_id = ${organizationId}::uuid
          and (${filters.q} = '' or (
            event.action ilike ${searchPattern}
            or event.entity_type ilike ${searchPattern}
            or coalesce(event.entity_id, '') ilike ${searchPattern}
            or coalesce(auth_user.email, '') ilike ${searchPattern}
            or event.metadata::text ilike ${searchPattern}
          ))
          and (${filters.action} = '' or event.action = ${filters.action})
          and (${fromTimestamp}::timestamptz is null or event.occurred_at >= ${fromTimestamp}::timestamptz)
          and (${toTimestamp}::timestamptz is null or event.occurred_at < ${toTimestamp}::timestamptz)
        order by event.occurred_at desc, event.id desc
        limit ${AUDIT_PAGE_SIZE}
        offset ${offset}
      `,
      database<CountRow[]>`
        select count(*)::int as count
        from public.audit_events as event
        left join public.identity_accounts as auth_user
          on auth_user.id = event.actor_user_id
        where event.organization_id = ${organizationId}::uuid
          and (${filters.q} = '' or (
            event.action ilike ${searchPattern}
            or event.entity_type ilike ${searchPattern}
            or coalesce(event.entity_id, '') ilike ${searchPattern}
            or coalesce(auth_user.email, '') ilike ${searchPattern}
            or event.metadata::text ilike ${searchPattern}
          ))
          and (${filters.action} = '' or event.action = ${filters.action})
          and (${fromTimestamp}::timestamptz is null or event.occurred_at >= ${fromTimestamp}::timestamptz)
          and (${toTimestamp}::timestamptz is null or event.occurred_at < ${toTimestamp}::timestamptz)
      `,
      database<SummaryRow[]>`
        select
          count(*)::int as total_events,
          count(*) filter (where occurred_at >= now() - interval '24 hours')::int as events_last_24_hours,
          count(distinct actor_user_id) filter (where actor_user_id is not null)::int as unique_actors
        from public.audit_events
        where organization_id = ${organizationId}::uuid
      `,
      database<ActionRow[]>`
        select distinct action
        from public.audit_events
        where organization_id = ${organizationId}::uuid
        order by action
      `,
    ]);

    const organization = organizations[0];
    const summary = summaryRows[0];

    if (!organization || !summary) {
      return { allowed: false, reason: "access-check-failed" };
    }

    const totalItems = countRows[0]?.count ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / AUDIT_PAGE_SIZE));

    return {
      allowed: true,
      data: {
        organization: {
          id: organization.id,
          legalName: organization.legal_name,
        },
        events: eventRows.map(mapAuditEvent),
        availableActions: actionRows.map((row) => row.action),
        filters,
        pagination: {
          page: Math.min(filters.page, totalPages),
          pageSize: AUDIT_PAGE_SIZE,
          totalItems,
          totalPages,
        },
        summary: {
          totalEvents: summary.total_events,
          eventsLast24Hours: summary.events_last_24_hours,
          uniqueActors: summary.unique_actors,
        },
        canExport: authorization.context.permissions.has(auditPermissionKeys.export),
      },
    };
  } catch {
    return { allowed: false, reason: "access-check-failed" };
  }
}

export async function getAuditExportData(filters: AuditLogFilters): Promise<AuditExportResult> {
  const authorization = await getAuthorizedAuditContext(auditPermissionKeys.export);

  if (!authorization.allowed) {
    return authorization;
  }

  const database = getDatabaseClient();
  const organizationId = authorization.context.membership.organizationId;
  const { fromTimestamp, toTimestamp } = toDateBounds(filters);
  const searchPattern = `%${filters.q}%`;

  try {
    const rows = await database<AuditEventRow[]>`
      select
        event.id::text,
        event.action,
        event.entity_type,
        event.entity_id,
        event.actor_type,
        auth_user.email as actor_email,
        coalesce(
          profile.display_name,
          nullif(auth_user.raw_user_meta_data ->> 'full_name', ''),
          auth_user.email,
          initcap(event.actor_type)
        ) as actor_display_name,
        event.source,
        event.before_state,
        event.after_state,
        event.changed_fields,
        event.metadata,
        event.occurred_at
      from public.audit_events as event
      left join public.identity_accounts as auth_user
        on auth_user.id = event.actor_user_id
      left join public.profiles as profile
        on profile.id = event.actor_user_id
      where event.organization_id = ${organizationId}::uuid
        and (${filters.q} = '' or (
          event.action ilike ${searchPattern}
          or event.entity_type ilike ${searchPattern}
          or coalesce(event.entity_id, '') ilike ${searchPattern}
          or coalesce(auth_user.email, '') ilike ${searchPattern}
          or event.metadata::text ilike ${searchPattern}
        ))
        and (${filters.action} = '' or event.action = ${filters.action})
        and (${fromTimestamp}::timestamptz is null or event.occurred_at >= ${fromTimestamp}::timestamptz)
        and (${toTimestamp}::timestamptz is null or event.occurred_at < ${toTimestamp}::timestamptz)
      order by event.occurred_at desc, event.id desc
      limit ${AUDIT_EXPORT_LIMIT + 1}
    `;

    const events = rows.slice(0, AUDIT_EXPORT_LIMIT).map(mapAuditEvent);
    const truncated = rows.length > AUDIT_EXPORT_LIMIT;

    await database`
      insert into public.audit_events (
        organization_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        source,
        after_state,
        metadata
      )
      values (
        ${organizationId}::uuid,
        ${authorization.context.user.id}::uuid,
        'settings.audit.exported',
        'audit_export',
        null,
        'web',
        ${database.json({ exportedRows: events.length, truncated })},
        ${database.json({
          filters: {
            q: filters.q,
            action: filters.action,
            from: filters.from,
            to: filters.to,
          },
        })}
      )
    `;

    return {
      allowed: true,
      events,
      truncated,
    };
  } catch {
    return { allowed: false, reason: "access-check-failed" };
  }
}
