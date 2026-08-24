import "server-only";

import type { Sql } from "postgres";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { withInfrastructureRetry } from "@/lib/server/retry";
import { normalizeReportWidgets } from "@/modules/reports/report-builder";
import type {
  ReportDeliveryBatchSummary,
  ReportScheduleSummary,
  ReportSnapshotSummary,
  ReportStudioData,
  SavedReportView,
} from "@/modules/reports/report-studio";
import {
  reportPeriodModes,
  reportSections,
  reportViewVisibilities,
  reportsPermissionKeys,
  resolveReportPeriod,
  type ReportPeriodMode,
  type ReportSection,
  type ReportViewVisibility,
  type ReportsWorkspaceData,
} from "@/modules/reports/reports";
import { reportsFiltersSchema } from "@/modules/reports/schemas/reports";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

interface SavedViewRow {
  id: string;
  owner_membership_id: string;
  name: string;
  description: string | null;
  section: string;
  period_mode: string;
  visibility: string;
  visibility_department_id: string | null;
  named_recipient_ids: string[];
  filters: unknown;
  widget_keys: string[];
  organization_timezone: string;
  updated_at: Date;
}
interface ScheduleRow {
  id: string;
  saved_view_id: string;
  cadence: "daily" | "weekly" | "monthly";
  local_time: string;
  timezone: string;
  weekday: number | null;
  month_day: number | null;
  format: "csv" | "pdf";
  audience: "owner" | "named" | "view_access" | "section_access";
  delivery_channels: Array<"in_app" | "email">;
  recipient_ids: string[];
  grace_seconds: number;
  status: "active" | "paused";
  next_run_at: Date;
  last_run_at: Date | null;
  consecutive_failure_count: number;
}
interface SnapshotRow {
  id: string;
  saved_view_id: string;
  format: "csv" | "pdf";
  report_name: string;
  section: string;
  period_from: string;
  period_to: string;
  row_count: number;
  generated_at: Date;
}
interface RunRow {
  id: string;
  schedule_id: string;
  scheduled_for: Date;
  completed_at: Date | null;
  outcome:
    "running" | "queued" | "delivered" | "partially_failed" | "failed" | "paused" | "cancelled";
  error_code: string | null;
}
interface BatchRow {
  id: string;
  status: ReportDeliveryBatchSummary["status"];
  send_after: Date;
  undo_until: Date;
  recipient_count: number;
  delivered_count: number;
  failed_count: number;
  suppressed_count: number;
  completed_at: Date | null;
}

function isReportSection(value: string): value is ReportSection {
  return reportSections.includes(value as ReportSection);
}
function isPeriodMode(value: string): value is ReportPeriodMode {
  return reportPeriodModes.includes(value as ReportPeriodMode);
}
function isVisibility(value: string): value is ReportViewVisibility {
  return reportViewVisibilities.includes(value as ReportViewVisibility);
}

function mapSavedView(row: SavedViewRow): SavedReportView {
  const section = isReportSection(row.section) ? row.section : "overview";
  const periodMode = isPeriodMode(row.period_mode) ? row.period_mode : "custom";
  const parsed = reportsFiltersSchema.parse({
    ...(row.filters && typeof row.filters === "object" && !Array.isArray(row.filters)
      ? row.filters
      : {}),
    section,
  });
  const period = resolveReportPeriod({
    from: parsed.from,
    to: parsed.to,
    periodMode,
    timezone: row.organization_timezone,
  });
  const filters: ReportsWorkspaceData["filters"] = {
    from: period.from,
    to: period.to,
    comparison: parsed.comparison,
    section,
    owner: parsed.owner,
    team: parsed.team,
    department: parsed.department,
    project: parsed.project,
    client: parsed.client,
    status: parsed.status,
  };
  return {
    id: row.id,
    ownerMembershipId: row.owner_membership_id,
    name: row.name,
    description: row.description,
    section,
    periodMode,
    visibility: isVisibility(row.visibility) ? row.visibility : "private",
    visibilityDepartmentId: row.visibility_department_id,
    namedRecipientIds: row.named_recipient_ids ?? [],
    filters,
    widgetKeys: normalizeReportWidgets(section, row.widget_keys),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapSchedule(row: ScheduleRow): ReportScheduleSummary {
  return {
    id: row.id,
    savedViewId: row.saved_view_id,
    cadence: row.cadence,
    localTime: row.local_time.slice(0, 5),
    timezone: row.timezone,
    weekday: row.weekday,
    monthDay: row.month_day,
    format: row.format,
    audience: row.audience,
    deliveryChannels: row.delivery_channels,
    recipientIds: row.recipient_ids ?? [],
    graceSeconds: row.grace_seconds,
    status: row.status,
    nextRunAt: row.next_run_at.toISOString(),
    lastRunAt: row.last_run_at?.toISOString() ?? null,
    consecutiveFailureCount: row.consecutive_failure_count,
  };
}

function mapSnapshot(row: SnapshotRow): ReportSnapshotSummary {
  return {
    id: row.id,
    savedViewId: row.saved_view_id,
    format: row.format,
    reportName: row.report_name,
    section: isReportSection(row.section) ? row.section : "overview",
    periodFrom: row.period_from,
    periodTo: row.period_to,
    rowCount: row.row_count,
    generatedAt: row.generated_at.toISOString(),
  };
}

export async function getSavedReportViewForContext(
  sql: Sql,
  context: CurrentPermissionContext,
  viewId: string,
  options: { scheduleId?: string | null } = {},
): Promise<SavedReportView | null> {
  // Keep this query explicit instead of interpolating SQL fragments so postgres-js
  // continues to parameterize every dynamic value.
  const rows = await sql<SavedViewRow[]>`
    select view.id, view.owner_membership_id, view.name, view.description, view.section,
      view.period_mode, view.visibility, view.visibility_department_id, view.filters,
      view.widget_keys, organization.timezone as organization_timezone, view.updated_at,
      coalesce(array(
        select recipient.membership_id::text
        from public.report_saved_view_recipients recipient
        where recipient.saved_view_id = view.id
        order by recipient.created_at, recipient.membership_id
      ), array[]::text[]) as named_recipient_ids
    from public.report_saved_views view
    join public.organizations organization on organization.id = view.organization_id
    where view.id = ${viewId}::uuid
      and view.organization_id = ${context.membership.organizationId}::uuid
      and view.status = 'active'
      and (
        private.report_saved_view_access_allowed(view.id, ${context.membership.id}::uuid)
        or (
          ${options.scheduleId ?? null}::uuid is not null
          and exists (
            select 1 from public.report_schedules schedule
            where schedule.id = ${options.scheduleId ?? null}::uuid
              and schedule.saved_view_id = view.id
              and schedule.organization_id = view.organization_id
              and schedule.status = 'active'
          )
          and private.membership_has_permission(${context.membership.id}::uuid, 'reports.workspace.view')
          and private.membership_has_permission(
            ${context.membership.id}::uuid, private.report_section_permission(view.section)
          )
        )
      )
    limit 1
  `;
  return rows[0] ? mapSavedView(rows[0]) : null;
}

export async function getSavedReportView(
  viewId: string | null | undefined,
): Promise<SavedReportView | null> {
  if (!viewId) return null;
  const authorization = await authorizeCurrentUser([reportsPermissionKeys.workspace]);
  if (!authorization.allowed) return null;
  return getSavedReportViewForContext(getDatabaseClient(), authorization.context, viewId);
}

export async function getReportStudioData(
  selectedViewId: string | null,
): Promise<ReportStudioData | null> {
  const authorization = await authorizeCurrentUser([reportsPermissionKeys.workspace]);
  if (!authorization.allowed) return null;
  const context = authorization.context;
  const database = getDatabaseClient();
  return withInfrastructureRetry(
    async () => {
      const [viewRows, timezoneRows, recipientRows, departmentRows] = await Promise.all([
        database<SavedViewRow[]>`
          select view.id, view.owner_membership_id, view.name, view.description, view.section,
            view.period_mode, view.visibility, view.visibility_department_id, view.filters,
            view.widget_keys, organization.timezone as organization_timezone, view.updated_at,
            coalesce(array(
              select recipient.membership_id::text
              from public.report_saved_view_recipients recipient
              where recipient.saved_view_id = view.id
              order by recipient.created_at, recipient.membership_id
            ), array[]::text[]) as named_recipient_ids
          from public.report_saved_views view
          join public.organizations organization on organization.id = view.organization_id
          where view.organization_id = ${context.membership.organizationId}::uuid
            and view.status = 'active'
            and private.report_saved_view_access_allowed(view.id, ${context.membership.id}::uuid)
          order by (view.owner_membership_id = ${context.membership.id}::uuid) desc,
            view.updated_at desc, view.name
          limit 100
        `,
        database<Array<{ timezone: string }>>`
          select timezone from public.organizations
          where id = ${context.membership.organizationId}::uuid
          limit 1
        `,
        database<
          Array<{
            membership_id: string;
            display_name: string;
            email: string;
            department_id: string | null;
          }>
        >`
          select membership.id as membership_id,
            coalesce(
              profile.display_name,
              nullif(trim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
              nullif(auth_user.raw_user_meta_data ->> 'full_name', ''), auth_user.email, 'AgencyOS user'
            ) as display_name,
            coalesce(auth_user.email, '') as email,
            membership.department_id
          from public.memberships membership
          join public.identity_accounts auth_user on auth_user.id = membership.user_id
          left join public.profiles profile on profile.id = membership.user_id
          where membership.organization_id = ${context.membership.organizationId}::uuid
            and membership.status = 'active'
            and private.membership_has_permission(membership.id, 'reports.workspace.view')
          order by lower(coalesce(profile.display_name, auth_user.email, ''))
          limit 500
        `,
        database<Array<{ id: string; name: string }>>`
          select id, name from public.departments
          where organization_id = ${context.membership.organizationId}::uuid and status = 'active'
          order by lower(name)
        `,
      ]);
      const savedViews = viewRows.map(mapSavedView);
      const selectedView = savedViews.find((view) => view.id === selectedViewId) ?? null;
      const ownsSelected = selectedView?.ownerMembershipId === context.membership.id;
      const canSchedule =
        ownsSelected && context.permissions.has(reportsPermissionKeys.scheduleManage);
      const canDownloadSnapshot = context.permissions.has(reportsPermissionKeys.snapshotDownload);
      const [scheduleRows, snapshotRows, runRows, batchRows] = selectedView
        ? await Promise.all([
            canSchedule
              ? database<ScheduleRow[]>`
                  select schedule.id, schedule.saved_view_id, schedule.cadence, schedule.local_time::text,
                    schedule.timezone, schedule.weekday, schedule.month_day, schedule.format,
                    schedule.audience, schedule.delivery_channels, schedule.grace_seconds,
                    schedule.status, schedule.next_run_at, schedule.last_run_at,
                    schedule.consecutive_failure_count,
                    coalesce(array(
                      select recipient.membership_id::text
                      from public.report_schedule_recipients recipient
                      where recipient.schedule_id = schedule.id
                      order by recipient.created_at, recipient.membership_id
                    ), array[]::text[]) as recipient_ids
                  from public.report_schedules schedule
                  where schedule.organization_id = ${context.membership.organizationId}::uuid
                    and schedule.owner_membership_id = ${context.membership.id}::uuid
                    and schedule.saved_view_id = ${selectedView.id}::uuid
                  limit 1
                `
              : Promise.resolve([] as ScheduleRow[]),
            canDownloadSnapshot
              ? database<SnapshotRow[]>`
                  select id, saved_view_id, format, report_name, section,
                    period_from::text, period_to::text, row_count, generated_at
                  from public.report_snapshots
                  where organization_id = ${context.membership.organizationId}::uuid
                    and owner_membership_id = ${context.membership.id}::uuid
                    and saved_view_id = ${selectedView.id}::uuid
                  order by generated_at desc
                  limit 12
                `
              : Promise.resolve([] as SnapshotRow[]),
            canSchedule
              ? database<RunRow[]>`
                  select run.id, run.schedule_id, run.scheduled_for, run.completed_at,
                    run.outcome, run.error_code
                  from public.report_schedule_runs run
                  where run.organization_id = ${context.membership.organizationId}::uuid
                    and run.owner_membership_id = ${context.membership.id}::uuid
                    and run.saved_view_id = ${selectedView.id}::uuid
                  order by run.started_at desc
                  limit 12
                `
              : Promise.resolve([] as RunRow[]),
            canSchedule
              ? database<BatchRow[]>`
                  select batch.id, batch.status, batch.send_after, batch.undo_until,
                    batch.recipient_count, batch.delivered_count, batch.failed_count,
                    batch.suppressed_count, batch.completed_at
                  from public.report_delivery_batches batch
                  where batch.organization_id = ${context.membership.organizationId}::uuid
                    and batch.owner_membership_id = ${context.membership.id}::uuid
                    and batch.saved_view_id = ${selectedView.id}::uuid
                  order by batch.created_at desc
                  limit 12
                `
              : Promise.resolve([] as BatchRow[]),
          ])
        : [[], [], [], []];
      const now = Date.now();

      return {
        savedViews,
        selectedView,
        schedule: scheduleRows[0] ? mapSchedule(scheduleRows[0]) : null,
        snapshots: snapshotRows.map(mapSnapshot),
        runs: runRows.map((row) => ({
          id: row.id,
          scheduleId: row.schedule_id,
          scheduledFor: row.scheduled_for.toISOString(),
          completedAt: row.completed_at?.toISOString() ?? null,
          outcome: row.outcome,
          errorCode: row.error_code,
        })),
        deliveryBatches: batchRows.map((row) => ({
          id: row.id,
          status: row.status,
          sendAfter: row.send_after.toISOString(),
          undoUntil: row.undo_until.toISOString(),
          recipientCount: row.recipient_count,
          deliveredCount: row.delivered_count,
          failedCount: row.failed_count,
          suppressedCount: row.suppressed_count,
          completedAt: row.completed_at?.toISOString() ?? null,
          canUndo: row.status === "queued" && row.undo_until.getTime() > now,
        })),
        recipients: recipientRows.map((row) => ({
          membershipId: row.membership_id,
          displayName: row.display_name,
          email: row.email,
          departmentId: row.department_id,
        })),
        departments: departmentRows,
        organizationTimezone: timezoneRows[0]?.timezone ?? "UTC",
        capabilities: {
          canManageSavedViews: context.permissions.has(reportsPermissionKeys.savedViewManage),
          canEditSelected:
            Boolean(selectedView) &&
            ownsSelected &&
            context.permissions.has(reportsPermissionKeys.savedViewManage),
          canSchedule,
          canCreateSnapshot: context.permissions.has(reportsPermissionKeys.snapshotCreate),
          canDownloadSnapshot,
        },
      };
    },
    { attempts: 2, operationName: "Report studio loading" },
  );
}
