"use server";

import { revalidatePath } from "next/cache";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { toJsonValue } from "@/lib/server/json-value";
import { writeAuditEvent } from "@/modules/audit/server/write-audit-event";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";
import { normalizeReportWidgets } from "@/modules/reports/report-builder";
import { reportsPermissionKeys, type ReportsWorkspaceData } from "@/modules/reports/reports";
import {
  reportDeliveryUndoSchema,
  reportScheduleSchema,
  reportSnapshotRequestSchema,
  reportViewIdSchema,
  savedReportViewSchema,
  type ReportActionState,
} from "@/modules/reports/schemas/reports";
import { generateReportSnapshot } from "@/modules/reports/server/report-snapshots";
import { getReportsWorkspaceDataForContext } from "@/modules/reports/server/reports";

const success = (message: string): ReportActionState => ({ status: "success", message });
const failure = (message: string, fieldErrors?: Record<string, string[]>): ReportActionState => ({
  status: "error",
  message,
  fieldErrors,
});
const value = (formData: FormData, key: string) => formData.get(key);
const values = (formData: FormData, key: string) => formData.getAll(key).map(String);
const refresh = () => revalidatePath("/reports");

function formFilters(formData: FormData): Record<string, unknown> {
  return {
    from: value(formData, "from"),
    to: value(formData, "to"),
    comparison: value(formData, "comparison"),
    section: value(formData, "section"),
    owner: value(formData, "owner"),
    team: value(formData, "team"),
    department: value(formData, "department"),
    project: value(formData, "project"),
    client: value(formData, "client"),
    status: value(formData, "status"),
  };
}

function storedFilters(
  filters: ReportsWorkspaceData["filters"],
  periodMode: string = "custom",
): Record<string, unknown> {
  return {
    ...(periodMode === "custom" ? { from: filters.from, to: filters.to } : {}),
    comparison: filters.comparison,
    section: filters.section,
    owner: filters.owner,
    team: filters.team,
    department: filters.department,
    project: filters.project,
    client: filters.client,
    status: filters.status,
  };
}

export async function saveReportViewAction(
  _previous: ReportActionState,
  formData: FormData,
): Promise<ReportActionState> {
  const saveMode = value(formData, "saveMode") === "update" ? "update" : "create";
  const parsed = savedReportViewSchema.safeParse({
    viewId: saveMode === "update" ? value(formData, "viewId") : null,
    name: value(formData, "name"),
    description: value(formData, "description"),
    periodMode: value(formData, "periodMode"),
    visibility: value(formData, "visibility"),
    visibilityDepartmentId: value(formData, "visibilityDepartmentId"),
    namedRecipientIds: values(formData, "namedRecipientIds"),
    filters: formFilters(formData),
    widgetKeys: values(formData, "widgetKeys"),
  });
  if (!parsed.success) {
    return failure("Check the saved-view fields.", parsed.error.flatten().fieldErrors);
  }
  const authorization = await authorizeCurrentUser([
    reportsPermissionKeys.workspace,
    reportsPermissionKeys.savedViewManage,
  ]);
  if (!authorization.allowed) return failure("You cannot save report views.");
  const context = authorization.context;
  const input = parsed.data;
  const section = input.filters.section;
  const widgetKeys = normalizeReportWidgets(section, input.widgetKeys);
  const sourceCheck = await getReportsWorkspaceDataForContext(context, input.filters, {
    widgetKeys,
  });
  if (!sourceCheck.allowed || !sourceCheck.data.capabilities.sections.includes(section)) {
    return failure("You cannot save a view for that report section.");
  }
  try {
    const viewId = await getDatabaseClient().begin(async (sql) => {
      if (input.viewId) {
        const rows = await sql<Array<{ id: string }>>`
          update public.report_saved_views
          set name = ${input.name}, description = ${input.description}, section = ${section},
              period_mode = ${input.periodMode}, visibility = ${input.visibility},
              visibility_department_id = ${input.visibility === "department" ? input.visibilityDepartmentId : null}::uuid,
              filters = ${sql.json(
                toJsonValue(
                  storedFilters(
                    {
                      from: input.filters.from ?? new Date().toISOString().slice(0, 10),
                      to: input.filters.to ?? new Date().toISOString().slice(0, 10),
                      comparison: input.filters.comparison,
                      section,
                      owner: input.filters.owner,
                      team: input.filters.team,
                      department: input.filters.department,
                      project: input.filters.project,
                      client: input.filters.client,
                      status: input.filters.status,
                    },
                    input.periodMode,
                  ),
                ),
              )},
              widget_keys = ${widgetKeys}
          where id = ${input.viewId}::uuid
            and organization_id = ${context.membership.organizationId}::uuid
            and owner_membership_id = ${context.membership.id}::uuid
            and status = 'active'
          returning id
        `;
        if (!rows[0]) throw new Error("report-view-not-found");
        await sql`delete from public.report_saved_view_recipients where saved_view_id = ${rows[0].id}::uuid`;
        if (input.visibility === "named") {
          await sql`
            insert into public.report_saved_view_recipients (
              saved_view_id, organization_id, membership_id, added_by_membership_id
            )
            select ${rows[0].id}::uuid, ${context.membership.organizationId}::uuid, membership.id,
              ${context.membership.id}::uuid
            from public.memberships membership
            where membership.organization_id = ${context.membership.organizationId}::uuid
              and membership.status = 'active'
              and membership.id = any(${input.namedRecipientIds}::uuid[])
              and private.membership_has_permission(membership.id, 'reports.workspace.view')
              and private.membership_has_permission(membership.id, private.report_section_permission(${section}))
          `;
        }
        await writeAuditEvent(sql, context, {
          action: "reports.saved_view.updated",
          entityType: "report_saved_view",
          entityId: rows[0].id,
          afterState: {
            name: input.name,
            section,
            periodMode: input.periodMode,
            visibility: input.visibility,
            widgetKeys,
          },
          changedFields: ["name", "description", "filters", "widget_keys"],
        });
        return rows[0].id;
      }
      const rows = await sql<Array<{ id: string }>>`
        insert into public.report_saved_views (
          organization_id, owner_membership_id, name, description, section, period_mode,
          visibility, visibility_department_id, filters, widget_keys
        ) values (
          ${context.membership.organizationId}::uuid, ${context.membership.id}::uuid,
          ${input.name}, ${input.description}, ${section}, ${input.periodMode}, ${input.visibility},
          ${input.visibility === "department" ? input.visibilityDepartmentId : null}::uuid,
          ${sql.json(
            toJsonValue(
              storedFilters(
                {
                  from: input.filters.from ?? new Date().toISOString().slice(0, 10),
                  to: input.filters.to ?? new Date().toISOString().slice(0, 10),
                  comparison: input.filters.comparison,
                  section,
                  owner: input.filters.owner,
                  team: input.filters.team,
                  department: input.filters.department,
                  project: input.filters.project,
                  client: input.filters.client,
                  status: input.filters.status,
                },
                input.periodMode,
              ),
            ),
          )},
          ${widgetKeys}
        ) returning id
      `;
      const createdId = rows[0]?.id;
      if (!createdId) throw new Error("report-view-create-failed");
      if (input.visibility === "named") {
        await sql`
          insert into public.report_saved_view_recipients (
            saved_view_id, organization_id, membership_id, added_by_membership_id
          )
          select ${createdId}::uuid, ${context.membership.organizationId}::uuid, membership.id,
            ${context.membership.id}::uuid
          from public.memberships membership
          where membership.organization_id = ${context.membership.organizationId}::uuid
            and membership.status = 'active'
            and membership.id = any(${input.namedRecipientIds}::uuid[])
            and private.membership_has_permission(membership.id, 'reports.workspace.view')
            and private.membership_has_permission(membership.id, private.report_section_permission(${section}))
        `;
      }
      await writeAuditEvent(sql, context, {
        action: "reports.saved_view.created",
        entityType: "report_saved_view",
        entityId: createdId,
        afterState: {
          name: input.name,
          section,
          periodMode: input.periodMode,
          visibility: input.visibility,
          widgetKeys,
        },
        changedFields: ["report_saved_view"],
      });
      return createdId;
    });
    refresh();
    return success(
      input.viewId ? "Saved view updated." : `Saved view created (${viewId.slice(0, 8)}).`,
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "unknown";
    if (/unique|duplicate/i.test(code)) return failure("A saved view already uses that name.");
    return failure("The report view could not be saved.");
  }
}

export async function archiveReportViewAction(
  _previous: ReportActionState,
  formData: FormData,
): Promise<ReportActionState> {
  const parsed = reportViewIdSchema.safeParse({ viewId: value(formData, "viewId") });
  if (!parsed.success) return failure("The saved view is invalid.");
  const authorization = await authorizeCurrentUser([
    reportsPermissionKeys.workspace,
    reportsPermissionKeys.savedViewManage,
  ]);
  if (!authorization.allowed) return failure("You cannot archive report views.");
  const context = authorization.context;
  try {
    await getDatabaseClient().begin(async (sql) => {
      const rows = await sql<Array<{ id: string }>>`
        update public.report_saved_views
        set status = 'archived', archived_at = now()
        where id = ${parsed.data.viewId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
          and owner_membership_id = ${context.membership.id}::uuid
          and status = 'active'
        returning id
      `;
      if (!rows[0]) throw new Error("report-view-not-found");
      await sql`
        update public.report_schedules
        set status = 'paused', locked_at = null, lock_token = null
        where saved_view_id = ${parsed.data.viewId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
      `;
      await writeAuditEvent(sql, context, {
        action: "reports.saved_view.archived",
        entityType: "report_saved_view",
        entityId: parsed.data.viewId,
        changedFields: ["status"],
      });
    });
    refresh();
    return success("Saved view archived.");
  } catch {
    return failure("The saved view could not be archived.");
  }
}

export async function saveReportScheduleAction(
  _previous: ReportActionState,
  formData: FormData,
): Promise<ReportActionState> {
  const parsed = reportScheduleSchema.safeParse({
    savedViewId: value(formData, "savedViewId"),
    cadence: value(formData, "cadence"),
    localTime: value(formData, "localTime"),
    timezone: value(formData, "timezone"),
    weekday: value(formData, "weekday"),
    monthDay: value(formData, "monthDay"),
    format: value(formData, "format"),
    audience: value(formData, "audience"),
    deliveryChannels: values(formData, "deliveryChannels"),
    recipientIds: values(formData, "recipientIds"),
    graceSeconds: value(formData, "graceSeconds"),
  });
  if (!parsed.success) {
    return failure("Check the delivery schedule.", parsed.error.flatten().fieldErrors);
  }
  const authorization = await authorizeCurrentUser([
    reportsPermissionKeys.workspace,
    reportsPermissionKeys.scheduleManage,
    reportsPermissionKeys.snapshotCreate,
  ]);
  if (!authorization.allowed) return failure("You cannot schedule report delivery.");
  const context = authorization.context;
  const input = parsed.data;
  try {
    await getDatabaseClient().begin(async (sql) => {
      const viewRows = await sql<Array<{ id: string }>>`
        select id from public.report_saved_views
        where id = ${input.savedViewId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
          and owner_membership_id = ${context.membership.id}::uuid
          and status = 'active'
        limit 1
      `;
      if (!viewRows[0]) throw new Error("report-view-not-found");
      const nextRows = await sql<Array<{ next_run_at: Date }>>`
        select private.report_schedule_next_run(
          ${input.cadence}, ${input.localTime}::time, ${input.timezone},
          ${input.cadence === "weekly" ? input.weekday : null}::smallint,
          ${input.cadence === "monthly" ? input.monthDay : null}::smallint,
          now()
        ) as next_run_at
      `;
      const nextRun = nextRows[0]?.next_run_at;
      if (!nextRun) throw new Error("schedule-next-run-failed");
      const rows = await sql<Array<{ id: string }>>`
        insert into public.report_schedules (
          organization_id, saved_view_id, owner_membership_id, cadence, local_time,
          timezone, weekday, month_day, format, audience, delivery_channels, grace_seconds, status, next_run_at
        ) values (
          ${context.membership.organizationId}::uuid, ${input.savedViewId}::uuid,
          ${context.membership.id}::uuid, ${input.cadence}, ${input.localTime}::time,
          ${input.timezone}, ${input.cadence === "weekly" ? input.weekday : null}::smallint,
          ${input.cadence === "monthly" ? input.monthDay : null}::smallint,
          ${input.format}, ${input.audience}, ${input.deliveryChannels}, ${input.graceSeconds},
          'active', ${nextRun}::timestamptz
        )
        on conflict (saved_view_id) do update set
          cadence = excluded.cadence,
          local_time = excluded.local_time,
          timezone = excluded.timezone,
          weekday = excluded.weekday,
          month_day = excluded.month_day,
          format = excluded.format,
          audience = excluded.audience,
          delivery_channels = excluded.delivery_channels,
          grace_seconds = excluded.grace_seconds,
          status = 'active',
          next_run_at = excluded.next_run_at,
          consecutive_failure_count = 0,
          locked_at = null,
          lock_token = null,
          updated_at = now()
        returning id
      `;
      const scheduleId = rows[0]?.id;
      if (!scheduleId) throw new Error("report-schedule-save-failed");
      await sql`delete from public.report_schedule_recipients where schedule_id = ${scheduleId}::uuid`;
      if (input.audience === "named") {
        await sql`
          insert into public.report_schedule_recipients (
            schedule_id, organization_id, membership_id, added_by_membership_id
          )
          select ${scheduleId}::uuid, ${context.membership.organizationId}::uuid, membership.id,
            ${context.membership.id}::uuid
          from public.memberships membership
          where membership.organization_id = ${context.membership.organizationId}::uuid
            and membership.status = 'active'
            and membership.id = any(${input.recipientIds}::uuid[])
            and private.report_saved_view_access_allowed(${input.savedViewId}::uuid, membership.id)
        `;
      }
      await writeAuditEvent(sql, context, {
        action: "reports.schedule.saved",
        entityType: "report_schedule",
        entityId: scheduleId,
        afterState: {
          savedViewId: input.savedViewId,
          cadence: input.cadence,
          localTime: input.localTime,
          timezone: input.timezone,
          format: input.format,
          audience: input.audience,
          deliveryChannels: input.deliveryChannels,
          graceSeconds: input.graceSeconds,
          nextRunAt: nextRun.toISOString(),
        },
        changedFields: ["report_schedule"],
      });
    });
    refresh();
    return success("Delivery schedule saved.");
  } catch {
    return failure("The delivery schedule could not be saved.");
  }
}

export async function pauseReportScheduleAction(
  _previous: ReportActionState,
  formData: FormData,
): Promise<ReportActionState> {
  const parsed = reportViewIdSchema.safeParse({ viewId: value(formData, "savedViewId") });
  if (!parsed.success) return failure("The saved view is invalid.");
  const authorization = await authorizeCurrentUser([
    reportsPermissionKeys.workspace,
    reportsPermissionKeys.scheduleManage,
  ]);
  if (!authorization.allowed) return failure("You cannot pause report delivery.");
  const context = authorization.context;
  try {
    await getDatabaseClient().begin(async (sql) => {
      const rows = await sql<Array<{ id: string }>>`
        update public.report_schedules
        set status = 'paused', locked_at = null, lock_token = null
        where saved_view_id = ${parsed.data.viewId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
          and owner_membership_id = ${context.membership.id}::uuid
        returning id
      `;
      if (!rows[0]) throw new Error("report-schedule-not-found");
      await writeAuditEvent(sql, context, {
        action: "reports.schedule.paused",
        entityType: "report_schedule",
        entityId: rows[0].id,
        changedFields: ["status"],
      });
    });
    refresh();
    return success("Delivery schedule paused.");
  } catch {
    return failure("The delivery schedule could not be paused.");
  }
}

export async function undoReportDeliveryAction(
  _previous: ReportActionState,
  formData: FormData,
): Promise<ReportActionState> {
  const parsed = reportDeliveryUndoSchema.safeParse({ batchId: value(formData, "batchId") });
  if (!parsed.success) return failure("The delivery batch is invalid.");
  const authorization = await authorizeCurrentUser([
    reportsPermissionKeys.workspace,
    reportsPermissionKeys.scheduleManage,
  ]);
  if (!authorization.allowed) return failure("You cannot cancel report delivery.");
  const context = authorization.context;
  try {
    await getDatabaseClient().begin(async (sql) => {
      const rows = await sql<
        Array<{ id: string; schedule_id: string; saved_view_id: string; scheduled_for: Date }>
      >`
        update public.report_delivery_batches
        set status = 'cancelled', cancelled_at = now(),
          cancelled_by_membership_id = ${context.membership.id}::uuid, completed_at = now()
        where id = ${parsed.data.batchId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
          and owner_membership_id = ${context.membership.id}::uuid
          and status = 'queued' and undo_until > now()
        returning id, schedule_id, saved_view_id, scheduled_for
      `;
      const batch = rows[0];
      if (!batch) throw new Error("report-delivery-undo-window-expired");
      await sql`
        update public.report_delivery_recipients
        set status = 'cancelled', error_code = 'cancelled_by_owner'
        where batch_id = ${batch.id}::uuid and status in ('queued', 'failed')
      `;
      await sql`
        insert into public.report_schedule_runs (
          organization_id, schedule_id, saved_view_id, owner_membership_id,
          scheduled_for, completed_at, outcome, error_code, evidence
        ) values (
          ${context.membership.organizationId}::uuid, ${batch.schedule_id}::uuid,
          ${batch.saved_view_id}::uuid, ${context.membership.id}::uuid,
          ${batch.scheduled_for}::timestamptz, now(), 'cancelled', 'cancelled_by_owner',
          ${sql.json(toJsonValue({ batchId: batch.id }))}
        ) on conflict (schedule_id, scheduled_for) do nothing
      `;
      await writeAuditEvent(sql, context, {
        action: "reports.delivery.cancelled",
        entityType: "report_delivery_batch",
        entityId: batch.id,
        changedFields: ["status"],
      });
    });
    refresh();
    return success("Delivery cancelled before external send.");
  } catch {
    return failure("The undo window has expired or the report is already sending.");
  }
}

export async function generateReportSnapshotAction(
  _previous: ReportActionState,
  formData: FormData,
): Promise<ReportActionState> {
  const parsed = reportSnapshotRequestSchema.safeParse({
    savedViewId: value(formData, "savedViewId"),
    format: value(formData, "format"),
  });
  if (!parsed.success) return failure("The snapshot request is invalid.");
  const authorization = await authorizeCurrentUser([
    reportsPermissionKeys.workspace,
    reportsPermissionKeys.snapshotCreate,
  ]);
  if (!authorization.allowed) return failure("You cannot generate report snapshots.");
  try {
    await generateReportSnapshot(authorization.context, parsed.data);
    refresh();
    return success(`${parsed.data.format.toUpperCase()} snapshot generated.`);
  } catch {
    return failure("The report snapshot could not be generated.");
  }
}
