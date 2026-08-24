"use server";

import { revalidatePath } from "next/cache";
import type { Sql, TransactionSql } from "postgres";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { enqueueNotification } from "@/modules/notifications/server/notifications";
import { parseMoneyToMinor } from "@/modules/finance/calculations";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";
import type { PermissionScope } from "@/modules/permissions/permission-scopes";
import { projectPermissionKeys, type ProjectBillingMethod } from "@/modules/projects/projects";
import { writeProjectAuditEvent } from "@/modules/projects/server/project-audit";
import {
  captureProjectBlueprint,
  instantiateProjectBlueprint,
  ProjectBlueprintError,
  type ProjectBlueprint,
} from "@/modules/projects/server/project-blueprints";
import {
  projectArchiveSchema,
  projectBulkTaskUpdateSchema,
  projectChecklistCreateSchema,
  projectChecklistToggleSchema,
  projectClosureCompleteSchema,
  projectClosureItemToggleSchema,
  projectClosureRequestSchema,
  projectCommentCreateSchema,
  projectCreateSchema,
  projectDependencySchema,
  projectDuplicateSchema,
  projectLabelCreateSchema,
  projectMemberAddSchema,
  projectMilestoneCreateSchema,
  projectMilestoneStatusSchema,
  projectPhaseCreateSchema,
  projectPhaseStatusSchema,
  projectRecurrenceSchema,
  projectSavedFilterDeleteSchema,
  projectSavedFilterSchema,
  projectTaskAssigneeSchema,
  projectTaskCreateSchema,
  projectTaskLabelSchema,
  projectTaskMoveSchema,
  projectTaskWatcherSchema,
  projectTemplateCreateSchema,
  projectTemplateSaveSchema,
  projectTimeCreateSchema,
  projectUpdateSchema,
  type ProjectActionState,
} from "@/modules/projects/schemas/projects";

class ProjectActionError extends Error {}
type QuerySql = Sql | TransactionSql;

function values(formData: FormData): Record<string, FormDataEntryValue> {
  return Object.fromEntries(formData.entries());
}

function errorState(message: string, fieldErrors?: Record<string, string[]>): ProjectActionState {
  return { status: "error", message, fieldErrors };
}

function successState(message: string): ProjectActionState {
  return { status: "success", message };
}

function refreshProjects() {
  revalidatePath("/projects");
  revalidatePath("/dashboard");
}

async function authorize(
  requiredPermissions: readonly string[],
): Promise<CurrentPermissionContext> {
  const result = await authorizeCurrentUser(requiredPermissions);
  if (!result.allowed) {
    throw new ProjectActionError(
      result.reason === "insufficient-permission"
        ? "You do not have permission to perform this project action."
        : "Your session or organization access is no longer active.",
    );
  }
  return result.context;
}

function scopeFor(context: CurrentPermissionContext, key: string): PermissionScope {
  return context.permissionScopes.get(key) ?? "own";
}

async function validateMembership(
  sql: QuerySql,
  organizationId: string,
  membershipId: string,
): Promise<void> {
  const rows = await sql<{ id: string }[]>`
    select id from public.memberships
    where id = ${membershipId}::uuid
      and organization_id = ${organizationId}::uuid
      and status = 'active'
    limit 1
  `;
  if (!rows[0]) throw new ProjectActionError("Choose an active member in this organization.");
}

async function validateCompany(
  sql: QuerySql,
  context: CurrentPermissionContext,
  companyId: string | null,
): Promise<void> {
  if (!companyId) return;
  if (!context.permissions.has("crm.company.view")) {
    throw new ProjectActionError("You cannot link a company that your role cannot view.");
  }
  const rows = await sql<{ id: string }[]>`
    select company.id from public.crm_companies as company
    where company.id = ${companyId}::uuid
      and company.organization_id = ${context.membership.organizationId}::uuid
      and private.crm_scope_allows_membership(
        ${context.membership.id}::uuid,
        ${scopeFor(context, "crm.company.view")},
        company.account_owner_membership_id,
        company.created_by_membership_id
      )
    limit 1
  `;
  if (!rows[0]) throw new ProjectActionError("CRM company was not found or is outside your scope.");
}

interface ProjectInsertInput {
  name: string;
  description: string | null;
  projectType: "client" | "internal";
  companyId: string | null;
  status: "planned" | "active" | "on_hold" | "cancelled";
  priority: "low" | "normal" | "high" | "urgent";
  visibility: "organization" | "members" | "private";
  ownerMembershipId: string;
  startDate: string | null;
  dueDate: string | null;
  currency: string;
  billingMethod: ProjectBillingMethod;
  budgetMinor: number | null;
  hourlyRateMinor: number | null;
  fixedPriceMinor: number | null;
  retainerAmountMinor: number | null;
  estimatedCompletionDate: string | null;
}

async function insertProjectRecord(
  sql: TransactionSql,
  context: CurrentPermissionContext,
  input: ProjectInsertInput,
): Promise<{ id: string; code: string }> {
  await validateMembership(sql, context.membership.organizationId, input.ownerMembershipId);
  await validateCompany(sql, context, input.companyId);
  if (input.projectType === "client" && !input.companyId) {
    throw new ProjectActionError("Choose a CRM company for a client project.");
  }

  const projectIdentity = [
    context.membership.organizationId,
    input.projectType,
    input.companyId ?? "internal",
    input.name.trim().toLowerCase().replace(/\s+/g, " "),
  ].join(":");
  await sql`select pg_advisory_xact_lock(hashtextextended(${`project:${projectIdentity}`}, 0))`;
  const duplicateProjects = await sql<{ id: string; code: string }[]>`
    select id, code
    from public.projects
    where organization_id = ${context.membership.organizationId}::uuid
      and archived_at is null
      and status <> 'cancelled'
      and project_type = ${input.projectType}
      and company_id is not distinct from ${input.companyId}::uuid
      and lower(regexp_replace(btrim(name), '\\s+', ' ', 'g')) =
          lower(regexp_replace(btrim(${input.name}), '\\s+', ' ', 'g'))
    limit 1
  `;
  if (duplicateProjects[0]) {
    throw new ProjectActionError(
      `A matching active project already exists (${duplicateProjects[0].code}).`,
    );
  }

  const codeRows = await sql<{ code: string }[]>`
    select private.next_project_code(${context.membership.organizationId}::uuid) as code
  `;
  const code = codeRows[0]?.code;
  if (!code) throw new ProjectActionError("A project code could not be allocated.");
  const rows = await sql<{ id: string }[]>`
    insert into public.projects (
      organization_id, code, name, description, project_type, company_id, status, priority,
      visibility, owner_membership_id, start_date, due_date, currency, billing_method,
      budget_minor, hourly_rate_minor, fixed_price_minor, retainer_amount_minor,
      estimated_completion_date, created_by_membership_id, created_by
    ) values (
      ${context.membership.organizationId}::uuid, ${code}, ${input.name}, ${input.description},
      ${input.projectType}, ${input.companyId}::uuid, ${input.status}, ${input.priority},
      ${input.visibility}, ${input.ownerMembershipId}::uuid, ${input.startDate}::date,
      ${input.dueDate}::date, ${input.currency}, ${input.billingMethod}, ${input.budgetMinor},
      ${input.hourlyRateMinor}, ${input.fixedPriceMinor}, ${input.retainerAmountMinor},
      ${input.estimatedCompletionDate}::date, ${context.membership.id}::uuid, ${context.user.id}::uuid
    ) returning id
  `;
  const id = rows[0]?.id;
  if (!id) throw new ProjectActionError("Project could not be created.");
  return { id, code };
}


interface ProjectMutationRow {
  id: string;
  code: string;
  name: string;
  status: string;
  priority: string;
  visibility: string;
  owner_membership_id: string;
  company_id: string | null;
  project_type: string;
  description: string | null;
  start_date: string | null;
  due_date: string | null;
  currency: string;
  billing_method: "none" | "hourly" | "fixed" | "retainer";
  budget_minor: number | null;
  hourly_rate_minor: number | null;
  fixed_price_minor: number | null;
  retainer_amount_minor: number | null;
  estimated_completion_date: string | null;
  archived_at: string | null;
  closure_status: "open" | "requested" | "closed";
}

async function getProjectForMutation(
  sql: QuerySql,
  context: CurrentPermissionContext,
  projectId: string,
  permissionKey: string,
  lock = false,
): Promise<ProjectMutationRow> {
  const query = lock
    ? sql<ProjectMutationRow[]>`
        select id, code, name, status, priority, visibility, owner_membership_id, company_id,
          project_type, description, start_date::text, due_date::text, currency, billing_method,
          budget_minor, hourly_rate_minor, fixed_price_minor, retainer_amount_minor,
          estimated_completion_date::text, archived_at::text, closure_status
        from public.projects as project
        where project.id = ${projectId}::uuid
          and project.organization_id = ${context.membership.organizationId}::uuid
          and private.project_is_visible(
            project.id, ${context.membership.id}::uuid, ${scopeFor(context, permissionKey)}
          )
        for update
      `
    : sql<ProjectMutationRow[]>`
        select id, code, name, status, priority, visibility, owner_membership_id, company_id,
          project_type, description, start_date::text, due_date::text, currency, billing_method,
          budget_minor, hourly_rate_minor, fixed_price_minor, retainer_amount_minor,
          estimated_completion_date::text, archived_at::text, closure_status
        from public.projects as project
        where project.id = ${projectId}::uuid
          and project.organization_id = ${context.membership.organizationId}::uuid
          and private.project_is_visible(
            project.id, ${context.membership.id}::uuid, ${scopeFor(context, permissionKey)}
          )
      `;
  const rows = await query;
  if (!rows[0]) throw new ProjectActionError("Project was not found or is outside your scope.");
  return rows[0];
}

interface TaskMutationRow {
  id: string;
  project_id: string;
  project_archived_at: string | null;
  project_closure_status: "open" | "requested" | "closed";
  task_number: number;
  title: string;
  description: string | null;
  status_id: string;
  status_slug: string;
  is_terminal: boolean;
  priority: string;
  parent_task_id: string | null;
  phase_id: string | null;
  milestone_id: string | null;
  recurrence_id: string | null;
  start_date: string | null;
  due_date: string | null;
  estimated_minutes: number | null;
}

async function getTaskForMutation(
  sql: QuerySql,
  context: CurrentPermissionContext,
  taskId: string,
  permissionKey: string,
  lock = false,
): Promise<TaskMutationRow> {
  const query = lock
    ? sql<TaskMutationRow[]>`
        select task.id, task.project_id, task.task_number, task.title, task.description,
          task.status_id, status.slug as status_slug, status.is_terminal, task.priority,
          project.archived_at::text as project_archived_at,
          project.closure_status as project_closure_status, task.parent_task_id, task.phase_id, task.milestone_id, task.recurrence_id,
          task.start_date::text, task.due_date::text, task.estimated_minutes
        from public.project_tasks as task
        join public.projects as project on project.id = task.project_id
        join public.project_task_statuses as status on status.id = task.status_id
        where task.id = ${taskId}::uuid
          and task.organization_id = ${context.membership.organizationId}::uuid
          and private.project_is_visible(
            task.project_id, ${context.membership.id}::uuid, ${scopeFor(context, permissionKey)}
          )
        for update of task
      `
    : sql<TaskMutationRow[]>`
        select task.id, task.project_id, task.task_number, task.title, task.description,
          task.status_id, status.slug as status_slug, status.is_terminal, task.priority,
          project.archived_at::text as project_archived_at,
          project.closure_status as project_closure_status, task.parent_task_id, task.phase_id, task.milestone_id, task.recurrence_id,
          task.start_date::text, task.due_date::text, task.estimated_minutes
        from public.project_tasks as task
        join public.projects as project on project.id = task.project_id
        join public.project_task_statuses as status on status.id = task.status_id
        where task.id = ${taskId}::uuid
          and task.organization_id = ${context.membership.organizationId}::uuid
          and private.project_is_visible(
            task.project_id, ${context.membership.id}::uuid, ${scopeFor(context, permissionKey)}
          )
      `;
  const rows = await query;
  if (!rows[0]) throw new ProjectActionError("Task was not found or is outside your scope.");
  if (rows[0].project_archived_at) {
    throw new ProjectActionError("Restore the project before changing its tasks.");
  }
  if (rows[0].project_closure_status === "closed") {
    throw new ProjectActionError("Closed projects are read-only.");
  }
  return rows[0];
}

function assertProjectWritable(project: ProjectMutationRow): void {
  if (project.archived_at) {
    throw new ProjectActionError("Restore the project before changing it.");
  }
  if (project.closure_status === "closed") {
    throw new ProjectActionError("Closed projects are read-only.");
  }
}

function actionFailure(error: unknown, fallback: string): ProjectActionState {
  if (error instanceof ProjectActionError || error instanceof ProjectBlueprintError) {
    return errorState(error.message);
  }

  const databaseError = error && typeof error === "object" ? error : null;
  const detail = (key: string): string | null => {
    if (!databaseError || !(key in databaseError)) return null;
    const value = Reflect.get(databaseError, key);
    return value === undefined || value === null ? null : String(value);
  };
  const code = detail("code");
  console.warn("[AgencyOS] Project action failed.", {
    code,
    table: detail("table_name"),
    column: detail("column_name"),
    routine: detail("routine"),
    fallback,
  });

  if (code === "42703") {
    return errorState(
      "The project database contract is out of date. Apply the pending database migration, then retry.",
    );
  }
  return errorState(fallback);
}

interface RecurrenceMutationRow {
  id: string;
  interval_unit: "day" | "week" | "month";
  interval_count: number;
  next_run_on: string;
  end_on: string | null;
  is_active: boolean;
}

async function generateNextRecurringTask(
  sql: TransactionSql,
  context: CurrentPermissionContext,
  task: TaskMutationRow,
): Promise<string | null> {
  if (!task.recurrence_id) return null;

  const recurrenceRows = await sql<RecurrenceMutationRow[]>`
    select id, interval_unit, interval_count, next_run_on::text, end_on::text, is_active
    from public.project_task_recurrences
    where id = ${task.recurrence_id}::uuid and project_id = ${task.project_id}::uuid
    for update
  `;
  const recurrence = recurrenceRows[0];
  if (!recurrence?.is_active) return null;
  if (recurrence.end_on && recurrence.next_run_on > recurrence.end_on) {
    await sql`
      update public.project_task_recurrences set is_active = false
      where id = ${recurrence.id}::uuid
    `;
    return null;
  }

  const existingRows = await sql<{ id: string }[]>`
    select recurring_task.id
    from public.project_tasks as recurring_task
    join public.project_task_statuses as recurring_status on recurring_status.id = recurring_task.status_id
    where recurring_task.recurrence_id = ${recurrence.id}::uuid
      and recurring_task.id <> ${task.id}::uuid
      and not recurring_status.is_terminal
    limit 1
  `;
  if (existingRows[0]) return null;

  const statusRows = await sql<{ id: string }[]>`
    select id from public.project_task_statuses
    where project_id = ${task.project_id}::uuid and not is_terminal
    order by position
    limit 1
  `;
  const statusId = statusRows[0]?.id;
  if (!statusId)
    throw new ProjectActionError("This project has no open task status for recurrence.");

  const numberRows = await sql<{ task_number: number }[]>`
    update public.projects
    set next_task_number = next_task_number + 1
    where id = ${task.project_id}::uuid
    returning next_task_number - 1 as task_number
  `;
  const taskNumber = numberRows[0]?.task_number;
  if (!taskNumber) throw new ProjectActionError("A recurring task number could not be allocated.");

  const createdRows = await sql<{ id: string }[]>`
    insert into public.project_tasks (
      organization_id, project_id, task_number, title, description, status_id, priority,
      phase_id, milestone_id, recurrence_id, start_date, due_date, estimated_minutes,
      created_by_membership_id, created_by
    ) values (
      ${context.membership.organizationId}::uuid, ${task.project_id}::uuid, ${taskNumber},
      ${task.title}, ${task.description}, ${statusId}::uuid, ${task.priority},
      ${task.phase_id}::uuid, ${task.milestone_id}::uuid, ${recurrence.id}::uuid,
      ${recurrence.next_run_on}::date,
      case
        when ${task.start_date}::date is not null and ${task.due_date}::date is not null
          then ${recurrence.next_run_on}::date + (${task.due_date}::date - ${task.start_date}::date)
        else ${recurrence.next_run_on}::date
      end,
      ${task.estimated_minutes}, ${context.membership.id}::uuid, ${context.user.id}::uuid
    )
    returning id
  `;
  const nextTaskId = createdRows[0]?.id;
  if (!nextTaskId) throw new ProjectActionError("The next recurring task could not be created.");

  await sql`
    insert into public.project_task_assignees (task_id, membership_id, assigned_by_membership_id)
    select ${nextTaskId}::uuid, assignee.membership_id, ${context.membership.id}::uuid
    from public.project_task_assignees as assignee
    where assignee.task_id = ${task.id}::uuid
    on conflict do nothing
  `;
  await sql`
    insert into public.project_task_labels (task_id, label_id, created_by_membership_id)
    select ${nextTaskId}::uuid, task_label.label_id, ${context.membership.id}::uuid
    from public.project_task_labels as task_label
    where task_label.task_id = ${task.id}::uuid
    on conflict do nothing
  `;
  await sql`
    insert into public.project_task_watchers (task_id, membership_id, created_by_membership_id)
    select ${nextTaskId}::uuid, watcher.membership_id, ${context.membership.id}::uuid
    from public.project_task_watchers as watcher
    where watcher.task_id = ${task.id}::uuid
    on conflict do nothing
  `;
  await sql`
    insert into public.project_task_checklist_items (
      task_id, label, position, is_required, created_by_membership_id
    )
    select ${nextTaskId}::uuid, item.label, item.position, item.is_required,
      ${context.membership.id}::uuid
    from public.project_task_checklist_items as item
    where item.task_id = ${task.id}::uuid
    order by item.position
  `;

  await sql`
    update public.project_task_recurrences
    set next_run_on = case interval_unit
          when 'day' then next_run_on + interval_count
          when 'week' then next_run_on + (interval_count * 7)
          else (next_run_on + make_interval(months => interval_count))::date
        end,
        is_active = case
          when end_on is null then true
          else case interval_unit
            when 'day' then next_run_on + interval_count <= end_on
            when 'week' then next_run_on + (interval_count * 7) <= end_on
            else (next_run_on + make_interval(months => interval_count))::date <= end_on
          end
        end
    where id = ${recurrence.id}::uuid
  `;

  await writeProjectAuditEvent(sql, context, {
    action: "project.task.recurrence.generated",
    entityType: "project_task",
    entityId: nextTaskId,
    afterState: { sourceTaskId: task.id, recurrenceId: recurrence.id, taskNumber },
  });

  return nextTaskId;
}

export async function createProjectAction(
  _previousState: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const parsed = projectCreateSchema.safeParse(values(formData));
  if (!parsed.success) {
    return errorState("Review the project details.", parsed.error.flatten().fieldErrors);
  }

  try {
    const context = await authorize([projectPermissionKeys.projectCreate]);
    const ownerMembershipId = parsed.data.ownerMembershipId ?? context.membership.id;
    if (
      ownerMembershipId !== context.membership.id &&
      !context.permissions.has(projectPermissionKeys.projectAssign)
    ) {
      throw new ProjectActionError("You cannot assign project ownership to another member.");
    }
    const input: ProjectInsertInput = {
      name: parsed.data.name,
      description: parsed.data.description,
      projectType: parsed.data.projectType,
      companyId: parsed.data.companyId,
      status: parsed.data.status as ProjectInsertInput["status"],
      priority: parsed.data.priority,
      visibility: parsed.data.visibility,
      ownerMembershipId,
      startDate: parsed.data.startDate,
      dueDate: parsed.data.dueDate,
      currency: parsed.data.currency,
      billingMethod: parsed.data.billingMethod,
      budgetMinor:
        parsed.data.budgetAmount === null
          ? null
          : parseMoneyToMinor(parsed.data.budgetAmount, parsed.data.currency),
      hourlyRateMinor:
        parsed.data.hourlyRate === null
          ? null
          : parseMoneyToMinor(parsed.data.hourlyRate, parsed.data.currency),
      fixedPriceMinor:
        parsed.data.fixedPrice === null
          ? null
          : parseMoneyToMinor(parsed.data.fixedPrice, parsed.data.currency),
      retainerAmountMinor:
        parsed.data.retainerAmount === null
          ? null
          : parseMoneyToMinor(parsed.data.retainerAmount, parsed.data.currency),
      estimatedCompletionDate: parsed.data.estimatedCompletionDate,
    };
    const database = getDatabaseClient();
    const created = await database.begin(async (sql) => {
      const result = await insertProjectRecord(sql, context, input);
      await writeProjectAuditEvent(sql, context, {
        action: "project.created",
        entityType: "project",
        entityId: result.id,
        afterState: { code: result.code, ...parsed.data, ownerMembershipId },
      });
      return result;
    });
    refreshProjects();
    return { ...successState("Project created."), projectId: created.id };
  } catch (error) {
    return actionFailure(error, "Project could not be created.");
  }
}

export async function updateProjectAction(
  _previousState: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const parsed = projectUpdateSchema.safeParse(values(formData));
  if (!parsed.success)
    return errorState("Review the project details.", parsed.error.flatten().fieldErrors);
  try {
    const context = await authorize([projectPermissionKeys.projectUpdate]);
    const budgetMinor =
      parsed.data.budgetAmount === null
        ? null
        : parseMoneyToMinor(parsed.data.budgetAmount, parsed.data.currency);
    const hourlyRateMinor =
      parsed.data.hourlyRate === null
        ? null
        : parseMoneyToMinor(parsed.data.hourlyRate, parsed.data.currency);
    const fixedPriceMinor =
      parsed.data.fixedPrice === null
        ? null
        : parseMoneyToMinor(parsed.data.fixedPrice, parsed.data.currency);
    const retainerAmountMinor =
      parsed.data.retainerAmount === null
        ? null
        : parseMoneyToMinor(parsed.data.retainerAmount, parsed.data.currency);
    const database = getDatabaseClient();
    await database.begin(async (sql) => {
      const before = await getProjectForMutation(
        sql,
        context,
        parsed.data.projectId,
        projectPermissionKeys.projectUpdate,
        true,
      );
      assertProjectWritable(before);
      const ownerMembershipId = parsed.data.ownerMembershipId ?? before.owner_membership_id;
      if (
        ownerMembershipId !== before.owner_membership_id &&
        !context.permissions.has(projectPermissionKeys.projectAssign)
      ) {
        throw new ProjectActionError("You cannot change project ownership.");
      }
      await validateMembership(sql, context.membership.organizationId, ownerMembershipId);
      await validateCompany(sql, context, parsed.data.companyId);
      const projectIdentity = [
        context.membership.organizationId,
        parsed.data.projectType,
        parsed.data.companyId ?? "internal",
        parsed.data.name.trim().toLowerCase().replace(/\s+/g, " "),
      ].join(":");
      await sql`
        select pg_advisory_xact_lock(hashtextextended(${`project:${projectIdentity}`}, 0))
      `;
      const duplicateProjects = await sql<{ id: string; code: string }[]>`
        select id, code
        from public.projects
        where organization_id = ${context.membership.organizationId}::uuid
          and id <> ${before.id}::uuid
          and archived_at is null
          and status <> 'cancelled'
          and project_type = ${parsed.data.projectType}
          and company_id is not distinct from ${parsed.data.companyId}::uuid
          and lower(regexp_replace(btrim(name), '\\s+', ' ', 'g')) =
              lower(regexp_replace(btrim(${parsed.data.name}), '\\s+', ' ', 'g'))
        limit 1
      `;
      if (duplicateProjects[0]) {
        throw new ProjectActionError(
          `A matching active project already exists (${duplicateProjects[0].code}).`,
        );
      }
      const completedAt =
        parsed.data.status === "completed" ? sql`coalesce(completed_at, now())` : sql`null`;
      await sql`
        update public.projects
        set name = ${parsed.data.name}, description = ${parsed.data.description},
          project_type = ${parsed.data.projectType}, company_id = ${parsed.data.companyId}::uuid,
          status = ${parsed.data.status}, priority = ${parsed.data.priority},
          visibility = ${parsed.data.visibility}, owner_membership_id = ${ownerMembershipId}::uuid,
          start_date = ${parsed.data.startDate}::date, due_date = ${parsed.data.dueDate}::date,
          currency = ${parsed.data.currency}, billing_method = ${parsed.data.billingMethod},
          budget_minor = ${budgetMinor}, hourly_rate_minor = ${hourlyRateMinor},
          fixed_price_minor = ${fixedPriceMinor}, retainer_amount_minor = ${retainerAmountMinor},
          estimated_completion_date = ${parsed.data.estimatedCompletionDate}::date,
          completed_at = ${completedAt}
        where id = ${parsed.data.projectId}::uuid
      `;
      await writeProjectAuditEvent(sql, context, {
        action: "project.updated",
        entityType: "project",
        entityId: parsed.data.projectId,
        beforeState: { ...before },
        afterState: { ...parsed.data, ownerMembershipId },
      });
    });
    refreshProjects();
    return successState("Project updated.");
  } catch (error) {
    return actionFailure(error, "Project could not be updated.");
  }
}

export async function addProjectMemberAction(
  _previousState: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const parsed = projectMemberAddSchema.safeParse(values(formData));
  if (!parsed.success)
    return errorState("Review the member assignment.", parsed.error.flatten().fieldErrors);
  try {
    const context = await authorize([projectPermissionKeys.projectAssign]);
    const database = getDatabaseClient();
    await database.begin(async (sql) => {
      const project = await getProjectForMutation(
        sql,
        context,
        parsed.data.projectId,
        projectPermissionKeys.projectAssign,
        true,
      );
      assertProjectWritable(project);
      await validateMembership(sql, context.membership.organizationId, parsed.data.membershipId);
      await sql`
        insert into public.project_members (project_id, membership_id, role, hourly_cost_rate_minor, added_by_membership_id)
        values (
          ${parsed.data.projectId}::uuid, ${parsed.data.membershipId}::uuid, ${parsed.data.role},
          ${parsed.data.hourlyCostRate === null ? 0 : parseMoneyToMinor(parsed.data.hourlyCostRate, project.currency)},
          ${context.membership.id}::uuid
        )
        on conflict (project_id, membership_id) do update
        set role = excluded.role, hourly_cost_rate_minor = excluded.hourly_cost_rate_minor
      `;
      await writeProjectAuditEvent(sql, context, {
        action: "project.member.assigned",
        entityType: "project",
        entityId: parsed.data.projectId,
        metadata: { membershipId: parsed.data.membershipId, role: parsed.data.role },
      });
    });
    refreshProjects();
    return successState("Project member saved.");
  } catch (error) {
    return actionFailure(error, "Project member could not be saved.");
  }
}

export async function createProjectTaskAction(
  _previousState: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const parsed = projectTaskCreateSchema.safeParse(values(formData));
  if (!parsed.success)
    return errorState("Review the task details.", parsed.error.flatten().fieldErrors);
  try {
    const context = await authorize([projectPermissionKeys.taskCreate]);
    const database = getDatabaseClient();
    await database.begin(async (sql) => {
      const project = await getProjectForMutation(
        sql,
        context,
        parsed.data.projectId,
        projectPermissionKeys.taskCreate,
        true,
      );
      assertProjectWritable(project);
      const statusRows = await sql<{ id: string; is_terminal: boolean }[]>`
        select id, is_terminal from public.project_task_statuses
        where id = ${parsed.data.statusId}::uuid and project_id = ${project.id}::uuid
        limit 1
      `;
      if (!statusRows[0]) throw new ProjectActionError("Choose a status from this project.");
      if (statusRows[0].is_terminal) {
        throw new ProjectActionError(
          "Create the task in an open status, then complete it through the workflow.",
        );
      }

      const linkRows = await sql<
        Array<{
          parent_valid: boolean;
          phase_valid: boolean;
          milestone_valid: boolean;
          milestone_phase_id: string | null;
        }>
      >`
        select
          (${parsed.data.parentTaskId}::uuid is null or exists(
            select 1 from public.project_tasks as parent
            where parent.id = ${parsed.data.parentTaskId}::uuid and parent.project_id = ${project.id}::uuid
          )) as parent_valid,
          (${parsed.data.phaseId}::uuid is null or exists(
            select 1 from public.project_phases as phase
            where phase.id = ${parsed.data.phaseId}::uuid and phase.project_id = ${project.id}::uuid
          )) as phase_valid,
          (${parsed.data.milestoneId}::uuid is null or exists(
            select 1 from public.project_milestones as milestone
            where milestone.id = ${parsed.data.milestoneId}::uuid and milestone.project_id = ${project.id}::uuid
          )) as milestone_valid,
          (select milestone.phase_id from public.project_milestones as milestone
            where milestone.id = ${parsed.data.milestoneId}::uuid) as milestone_phase_id
      `;
      const links = linkRows[0];
      if (!links?.parent_valid)
        throw new ProjectActionError("Choose a parent task from this project.");
      if (!links?.phase_valid) throw new ProjectActionError("Choose a phase from this project.");
      if (!links?.milestone_valid)
        throw new ProjectActionError("Choose a milestone from this project.");
      if (
        parsed.data.phaseId &&
        links.milestone_phase_id &&
        links.milestone_phase_id !== parsed.data.phaseId
      ) {
        throw new ProjectActionError("The selected milestone belongs to a different phase.");
      }

      const duplicateTasks = await sql<{ id: string; task_number: number }[]>`
        select task.id, task.task_number
        from public.project_tasks as task
        join public.project_task_statuses as status on status.id = task.status_id
        where task.project_id = ${project.id}::uuid
          and not status.is_terminal
          and lower(regexp_replace(btrim(task.title), '\\s+', ' ', 'g')) =
              lower(regexp_replace(btrim(${parsed.data.title}), '\\s+', ' ', 'g'))
        limit 1
      `;
      if (duplicateTasks[0]) {
        throw new ProjectActionError(
          `A matching open task already exists (${project.code}-${duplicateTasks[0].task_number}).`,
        );
      }

      const assigneeId = parsed.data.assigneeMembershipId;
      if (assigneeId) {
        if (
          assigneeId !== context.membership.id &&
          !context.permissions.has(projectPermissionKeys.taskAssign)
        ) {
          throw new ProjectActionError("You cannot assign tasks to another member.");
        }
        await validateMembership(sql, context.membership.organizationId, assigneeId);
        const projectMembers = await sql<{ membership_id: string }[]>`
          select membership_id from public.project_members
          where project_id = ${project.id}::uuid and membership_id = ${assigneeId}::uuid
          limit 1
        `;
        if (!projectMembers[0])
          throw new ProjectActionError("Task assignees must be project members.");
      }

      const numberRows = await sql<{ task_number: number }[]>`
        update public.projects
        set next_task_number = next_task_number + 1
        where id = ${project.id}::uuid
        returning next_task_number - 1 as task_number
      `;
      const taskNumber = numberRows[0]?.task_number;
      if (!taskNumber) throw new ProjectActionError("A task number could not be allocated.");
      const taskRows = await sql<{ id: string }[]>`
        insert into public.project_tasks (
          organization_id, project_id, task_number, title, description, status_id, priority,
          parent_task_id, phase_id, milestone_id, start_date, due_date, reminder_at, estimated_minutes,
          created_by_membership_id, created_by
        ) values (
          ${context.membership.organizationId}::uuid, ${project.id}::uuid, ${taskNumber},
          ${parsed.data.title}, ${parsed.data.description}, ${parsed.data.statusId}::uuid,
          ${parsed.data.priority}, ${parsed.data.parentTaskId}::uuid, ${parsed.data.phaseId}::uuid,
          ${parsed.data.milestoneId}::uuid, ${parsed.data.startDate}::date,
          ${parsed.data.dueDate}::date,
          case when ${parsed.data.reminderAt}::text is null then null else (
            ${parsed.data.reminderAt}::timestamp at time zone (
              select organization.timezone from public.organizations organization
              where organization.id = ${context.membership.organizationId}::uuid
            )
          ) end,
          ${parsed.data.estimatedMinutes},
          ${context.membership.id}::uuid, ${context.user.id}::uuid
        ) returning id
      `;
      const taskId = taskRows[0]?.id;
      if (!taskId) throw new ProjectActionError("Task could not be created.");
      if (assigneeId) {
        await sql`
          insert into public.project_task_assignees (task_id, membership_id, assigned_by_membership_id)
          values (${taskId}::uuid, ${assigneeId}::uuid, ${context.membership.id}::uuid)
        `;
      }
      await writeProjectAuditEvent(sql, context, {
        action: "project.task.created",
        entityType: "project_task",
        entityId: taskId,
        afterState: { ...parsed.data, taskNumber },
      });
    });
    refreshProjects();
    return successState("Task created.");
  } catch (error) {
    return actionFailure(error, "Task could not be created.");
  }
}

export async function moveProjectTaskAction(
  _previousState: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const parsed = projectTaskMoveSchema.safeParse(values(formData));
  if (!parsed.success)
    return errorState("Choose a valid task status.", parsed.error.flatten().fieldErrors);
  try {
    const context = await authorize([projectPermissionKeys.taskUpdate]);
    const database = getDatabaseClient();
    await database.begin(async (sql) => {
      const task = await getTaskForMutation(
        sql,
        context,
        parsed.data.taskId,
        projectPermissionKeys.taskUpdate,
        true,
      );
      const statuses = await sql<
        { id: string; slug: string; is_terminal: boolean; is_cancelled: boolean }[]
      >`
        select id, slug, is_terminal, is_cancelled from public.project_task_statuses
        where id = ${parsed.data.statusId}::uuid and project_id = ${task.project_id}::uuid
        limit 1
      `;
      const status = statuses[0];
      if (!status) throw new ProjectActionError("Choose a status from this project.");
      if (status.is_terminal && !status.is_cancelled) {
        const incomplete = await sql<{ count: number }[]>`
          select count(*)::int as count
          from public.project_tasks as child
          join public.project_task_statuses as child_status on child_status.id = child.status_id
          where child.parent_task_id = ${task.id}::uuid and not child_status.is_terminal
        `;
        if ((incomplete[0]?.count ?? 0) > 0) {
          throw new ProjectActionError(
            "Complete or cancel all subtasks before completing this task.",
          );
        }
      }
      await sql`
        update public.project_tasks
        set status_id = ${status.id}::uuid,
          completed_at = case when ${status.is_terminal} then coalesce(completed_at, now()) else null end
        where id = ${task.id}::uuid
      `;
      if (status.is_terminal && !status.is_cancelled) {
        await generateNextRecurringTask(sql, context, task);
      }
      await writeProjectAuditEvent(sql, context, {
        action: "project.task.moved",
        entityType: "project_task",
        entityId: task.id,
        beforeState: { statusId: task.status_id, status: task.status_slug },
        afterState: { statusId: status.id, status: status.slug },
        changedFields: ["status_id"],
      });
    });
    refreshProjects();
    return successState("Task status updated.");
  } catch (error) {
    return actionFailure(error, "Task status could not be updated.");
  }
}

export async function createProjectCommentAction(
  _previousState: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const parsed = projectCommentCreateSchema.safeParse(values(formData));
  if (!parsed.success) return errorState("Review the comment.", parsed.error.flatten().fieldErrors);
  try {
    const context = await authorize([projectPermissionKeys.commentCreate]);
    const database = getDatabaseClient();
    await database.begin(async (sql) => {
      const task = await getTaskForMutation(
        sql,
        context,
        parsed.data.taskId,
        projectPermissionKeys.commentCreate,
      );
      const rows = await sql<{ id: string }[]>`
        insert into public.project_task_comments (
          organization_id, task_id, body, is_internal, created_by_membership_id, created_by
        ) values (
          ${context.membership.organizationId}::uuid, ${task.id}::uuid, ${parsed.data.body},
          ${parsed.data.isInternal}, ${context.membership.id}::uuid, ${context.user.id}::uuid
        ) returning id
      `;
      const commentId = rows[0]?.id;
      if (!commentId) throw new ProjectActionError("Comment could not be added.");
      await writeProjectAuditEvent(sql, context, {
        action: "project.task.comment.created",
        entityType: "project_task_comment",
        entityId: commentId,
        metadata: {
          taskId: task.id,
          projectId: task.project_id,
          isInternal: parsed.data.isInternal,
        },
      });
    });
    refreshProjects();
    return successState("Comment added.");
  } catch (error) {
    return actionFailure(error, "Comment could not be added.");
  }
}

export async function createProjectTimeEntryAction(
  _previousState: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const parsed = projectTimeCreateSchema.safeParse(values(formData));
  if (!parsed.success)
    return errorState("Review the time entry.", parsed.error.flatten().fieldErrors);
  try {
    const context = await authorize([projectPermissionKeys.timeCreate]);
    const database = getDatabaseClient();
    await database.begin(async (sql) => {
      const project = await getProjectForMutation(
        sql,
        context,
        parsed.data.projectId,
        projectPermissionKeys.timeCreate,
      );
      assertProjectWritable(project);
      if (parsed.data.taskId) {
        const tasks = await sql<{ id: string }[]>`
          select id from public.project_tasks
          where id = ${parsed.data.taskId}::uuid and project_id = ${project.id}::uuid
          limit 1
        `;
        if (!tasks[0]) throw new ProjectActionError("Choose a task from this project.");
      }
      const rows = await sql<{ id: string }[]>`
        insert into public.project_time_entries (
          organization_id, project_id, task_id, membership_id, work_date, minutes, notes,
          submission_status, created_by
        ) values (
          ${context.membership.organizationId}::uuid, ${project.id}::uuid,
          ${parsed.data.taskId}::uuid, ${context.membership.id}::uuid,
          ${parsed.data.workDate}::date, ${parsed.data.minutes}, ${parsed.data.notes},
          ${parsed.data.submissionStatus}, ${context.user.id}::uuid
        ) returning id
      `;
      const entryId = rows[0]?.id;
      if (!entryId) throw new ProjectActionError("Time entry could not be created.");
      await writeProjectAuditEvent(sql, context, {
        action: "project.time.created",
        entityType: "project_time_entry",
        entityId: entryId,
        afterState: { ...parsed.data, membershipId: context.membership.id },
      });
    });
    refreshProjects();
    return successState("Time logged.");
  } catch (error) {
    return actionFailure(error, "Time could not be logged.");
  }
}

export async function saveProjectTaskAssigneeAction(
  _previousState: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const parsed = projectTaskAssigneeSchema.safeParse(values(formData));
  if (!parsed.success)
    return errorState("Review the task assignment.", parsed.error.flatten().fieldErrors);

  try {
    const context = await authorize([projectPermissionKeys.taskAssign]);
    const database = getDatabaseClient();
    const assignmentNotification = await database.begin(async (sql) => {
      let notification: {
        taskId: string;
        projectId: string;
        taskNumber: number;
        title: string;
      } | null = null;
      const task = await getTaskForMutation(
        sql,
        context,
        parsed.data.taskId,
        projectPermissionKeys.taskAssign,
        true,
      );
      await validateMembership(sql, context.membership.organizationId, parsed.data.membershipId);
      const projectMembers = await sql<{ membership_id: string }[]>`
        select membership_id from public.project_members
        where project_id = ${task.project_id}::uuid
          and membership_id = ${parsed.data.membershipId}::uuid
        limit 1
      `;
      if (!projectMembers[0]) {
        throw new ProjectActionError("Task assignees must be active project members.");
      }

      if (parsed.data.operation === "add") {
        const inserted = await sql<{ task_id: string }[]>`
          insert into public.project_task_assignees (
            task_id, membership_id, assigned_by_membership_id
          ) values (
            ${task.id}::uuid, ${parsed.data.membershipId}::uuid,
            ${context.membership.id}::uuid
          )
          on conflict do nothing
          returning task_id
        `;
        if (inserted[0] && parsed.data.membershipId !== context.membership.id) {
          notification = {
            taskId: task.id,
            projectId: task.project_id,
            taskNumber: task.task_number,
            title: task.title,
          };
        }
      } else {
        await sql`
          delete from public.project_task_assignees
          where task_id = ${task.id}::uuid
            and membership_id = ${parsed.data.membershipId}::uuid
        `;
      }

      await writeProjectAuditEvent(sql, context, {
        action: `project.task.assignee.${parsed.data.operation === "add" ? "added" : "removed"}`,
        entityType: "project_task",
        entityId: task.id,
        metadata: { membershipId: parsed.data.membershipId },
      });
      return notification;
    });
    if (assignmentNotification) {
      await enqueueNotification({
        organizationId: context.membership.organizationId,
        recipientMembershipId: parsed.data.membershipId,
        category: "assignment",
        severity: "info",
        title: `Task assigned: #${assignmentNotification.taskNumber} ${assignmentNotification.title}`.slice(0, 160),
        message: "A project task has been assigned to you.",
        deepLink: `/projects?project=${assignmentNotification.projectId}`,
        sourceModule: "projects",
        sourceEntityType: "project_task",
        sourceEntityId: assignmentNotification.taskId,
        dedupeKey: `project-task-assignment:${assignmentNotification.taskId}:${parsed.data.membershipId}`,
        metadata: {
          projectId: assignmentNotification.projectId,
          taskNumber: assignmentNotification.taskNumber,
        },
        createdByMembershipId: context.membership.id,
      });
    }
    refreshProjects();
    return successState(parsed.data.operation === "add" ? "Assignee added." : "Assignee removed.");
  } catch (error) {
    return actionFailure(error, "Task assignment could not be updated.");
  }
}

export async function createProjectLabelAction(
  _previousState: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const parsed = projectLabelCreateSchema.safeParse(values(formData));
  if (!parsed.success) return errorState("Review the label.", parsed.error.flatten().fieldErrors);

  try {
    const context = await authorize([projectPermissionKeys.taskUpdate]);
    const database = getDatabaseClient();
    let duplicate = false;
    await database.begin(async (sql) => {
      const project = await getProjectForMutation(
        sql,
        context,
        parsed.data.projectId,
        projectPermissionKeys.taskUpdate,
        true,
      );
      assertProjectWritable(project);
      const normalizedName = parsed.data.name.toLowerCase().replace(/\s+/g, " ");
      await sql`
        select pg_advisory_xact_lock(
          hashtextextended(${`project-label:${project.id}:${normalizedName}`}, 0)
        )
      `;
      const existing = await sql<{ id: string }[]>`
        select id from public.project_labels
        where project_id = ${project.id}::uuid
          and lower(regexp_replace(btrim(name), '\\s+', ' ', 'g')) = ${normalizedName}
        limit 1
      `;
      if (existing[0]) {
        duplicate = true;
        return;
      }
      const rows = await sql<{ id: string }[]>`
        insert into public.project_labels (
          project_id, name, color, created_by_membership_id
        ) values (
          ${project.id}::uuid, ${parsed.data.name}, ${parsed.data.color},
          ${context.membership.id}::uuid
        ) returning id
      `;
      const labelId = rows[0]?.id;
      if (!labelId) throw new ProjectActionError("Label could not be created.");
      await writeProjectAuditEvent(sql, context, {
        action: "project.label.created",
        entityType: "project_label",
        entityId: labelId,
        afterState: parsed.data,
      });
    });
    refreshProjects();
    return successState(
      duplicate ? "That label already exists; no duplicate was created." : "Label created.",
    );
  } catch (error) {
    return actionFailure(error, "Label could not be created.");
  }
}

export async function saveProjectTaskLabelAction(
  _previousState: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const parsed = projectTaskLabelSchema.safeParse(values(formData));
  if (!parsed.success)
    return errorState("Review the task label.", parsed.error.flatten().fieldErrors);

  try {
    const context = await authorize([projectPermissionKeys.taskUpdate]);
    const database = getDatabaseClient();
    await database.begin(async (sql) => {
      const task = await getTaskForMutation(
        sql,
        context,
        parsed.data.taskId,
        projectPermissionKeys.taskUpdate,
        true,
      );
      const labels = await sql<{ id: string }[]>`
        select id from public.project_labels
        where id = ${parsed.data.labelId}::uuid and project_id = ${task.project_id}::uuid
        limit 1
      `;
      if (!labels[0]) throw new ProjectActionError("Choose a label from this project.");

      if (parsed.data.operation === "add") {
        await sql`
          insert into public.project_task_labels (task_id, label_id, created_by_membership_id)
          values (
            ${task.id}::uuid, ${parsed.data.labelId}::uuid, ${context.membership.id}::uuid
          )
          on conflict do nothing
        `;
      } else {
        await sql`
          delete from public.project_task_labels
          where task_id = ${task.id}::uuid and label_id = ${parsed.data.labelId}::uuid
        `;
      }
      await writeProjectAuditEvent(sql, context, {
        action: `project.task.label.${parsed.data.operation === "add" ? "added" : "removed"}`,
        entityType: "project_task",
        entityId: task.id,
        metadata: { labelId: parsed.data.labelId },
      });
    });
    refreshProjects();
    return successState(parsed.data.operation === "add" ? "Label added." : "Label removed.");
  } catch (error) {
    return actionFailure(error, "Task label could not be updated.");
  }
}

export async function saveProjectTaskWatcherAction(
  _previousState: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const parsed = projectTaskWatcherSchema.safeParse(values(formData));
  if (!parsed.success) return errorState("Review the watcher.", parsed.error.flatten().fieldErrors);

  try {
    const context = await authorize([projectPermissionKeys.taskView]);
    const membershipId = parsed.data.membershipId ?? context.membership.id;
    if (
      membershipId !== context.membership.id &&
      !context.permissions.has(projectPermissionKeys.taskAssign)
    ) {
      throw new ProjectActionError("You cannot manage watchers for another member.");
    }
    const database = getDatabaseClient();
    await database.begin(async (sql) => {
      const task = await getTaskForMutation(
        sql,
        context,
        parsed.data.taskId,
        projectPermissionKeys.taskView,
        true,
      );
      await validateMembership(sql, context.membership.organizationId, membershipId);
      const projectMembers = await sql<{ membership_id: string }[]>`
        select membership_id from public.project_members
        where project_id = ${task.project_id}::uuid and membership_id = ${membershipId}::uuid
        limit 1
      `;
      if (!projectMembers[0]) throw new ProjectActionError("Watchers must be project members.");

      if (parsed.data.operation === "add") {
        await sql`
          insert into public.project_task_watchers (
            task_id, membership_id, created_by_membership_id
          ) values (
            ${task.id}::uuid, ${membershipId}::uuid, ${context.membership.id}::uuid
          )
          on conflict do nothing
        `;
      } else {
        await sql`
          delete from public.project_task_watchers
          where task_id = ${task.id}::uuid and membership_id = ${membershipId}::uuid
        `;
      }
      await writeProjectAuditEvent(sql, context, {
        action: `project.task.watcher.${parsed.data.operation === "add" ? "added" : "removed"}`,
        entityType: "project_task",
        entityId: task.id,
        metadata: { membershipId },
      });
    });
    refreshProjects();
    return successState(parsed.data.operation === "add" ? "Watcher added." : "Watcher removed.");
  } catch (error) {
    return actionFailure(error, "Task watcher could not be updated.");
  }
}

export async function createProjectChecklistItemAction(
  _previousState: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const parsed = projectChecklistCreateSchema.safeParse(values(formData));
  if (!parsed.success)
    return errorState("Review the checklist item.", parsed.error.flatten().fieldErrors);

  try {
    const context = await authorize([projectPermissionKeys.taskUpdate]);
    const database = getDatabaseClient();
    let duplicate = false;
    await database.begin(async (sql) => {
      const task = await getTaskForMutation(
        sql,
        context,
        parsed.data.taskId,
        projectPermissionKeys.taskUpdate,
        true,
      );
      const summary = await sql<
        { count: number; next_position: number; duplicate_count: number }[]
      >`
        select
          count(*)::integer as count,
          coalesce(max(position), 0)::integer + 1 as next_position,
          count(*) filter (
            where lower(regexp_replace(btrim(label), '\\s+', ' ', 'g')) =
              lower(regexp_replace(btrim(${parsed.data.label}), '\\s+', ' ', 'g'))
          )::integer as duplicate_count
        from public.project_task_checklist_items
        where task_id = ${task.id}::uuid
      `;
      if ((summary[0]?.count ?? 0) >= 100) {
        throw new ProjectActionError("A task checklist can contain at most 100 items.");
      }
      if ((summary[0]?.duplicate_count ?? 0) > 0) {
        duplicate = true;
        return;
      }
      const rows = await sql<{ id: string }[]>`
        insert into public.project_task_checklist_items (
          task_id, label, position, is_required, created_by_membership_id
        ) values (
          ${task.id}::uuid, ${parsed.data.label}, ${summary[0]?.next_position ?? 1},
          ${parsed.data.isRequired}, ${context.membership.id}::uuid
        ) returning id
      `;
      const itemId = rows[0]?.id;
      if (!itemId) throw new ProjectActionError("Checklist item could not be created.");
      await writeProjectAuditEvent(sql, context, {
        action: "project.task.checklist.created",
        entityType: "project_task_checklist_item",
        entityId: itemId,
        metadata: { taskId: task.id, required: parsed.data.isRequired },
      });
    });
    refreshProjects();
    return successState(
      duplicate
        ? "That checklist item already exists; no duplicate was created."
        : "Checklist item added.",
    );
  } catch (error) {
    return actionFailure(error, "Checklist item could not be added.");
  }
}

export async function toggleProjectChecklistItemAction(
  _previousState: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const parsed = projectChecklistToggleSchema.safeParse(values(formData));
  if (!parsed.success)
    return errorState("Review the checklist update.", parsed.error.flatten().fieldErrors);

  try {
    const context = await authorize([projectPermissionKeys.taskUpdate]);
    const database = getDatabaseClient();
    await database.begin(async (sql) => {
      const rows = await sql<{ id: string; task_id: string; project_id: string }[]>`
        select item.id, item.task_id, task.project_id
        from public.project_task_checklist_items as item
        join public.project_tasks as task on task.id = item.task_id
        where item.id = ${parsed.data.checklistItemId}::uuid
          and task.organization_id = ${context.membership.organizationId}::uuid
          and private.project_is_visible(
            task.project_id, ${context.membership.id}::uuid,
            ${scopeFor(context, projectPermissionKeys.taskUpdate)}
          )
        for update of item
      `;
      const item = rows[0];
      if (!item)
        throw new ProjectActionError("Checklist item was not found or is outside your scope.");
      await sql`
        update public.project_task_checklist_items
        set is_completed = ${parsed.data.completed},
          completed_at = case when ${parsed.data.completed} then now() else null end,
          completed_by_membership_id = case
            when ${parsed.data.completed} then ${context.membership.id}::uuid else null
          end
        where id = ${item.id}::uuid
      `;
      await writeProjectAuditEvent(sql, context, {
        action: "project.task.checklist.updated",
        entityType: "project_task_checklist_item",
        entityId: item.id,
        afterState: { completed: parsed.data.completed },
        metadata: { taskId: item.task_id, projectId: item.project_id },
      });
    });
    refreshProjects();
    return successState(
      parsed.data.completed ? "Checklist item completed." : "Checklist item reopened.",
    );
  } catch (error) {
    return actionFailure(error, "Checklist item could not be updated.");
  }
}

export async function saveProjectTaskDependencyAction(
  _previousState: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const parsed = projectDependencySchema.safeParse(values(formData));
  if (!parsed.success)
    return errorState("Review the dependency.", parsed.error.flatten().fieldErrors);

  try {
    const context = await authorize([projectPermissionKeys.taskUpdate]);
    const database = getDatabaseClient();
    await database.begin(async (sql) => {
      const task = await getTaskForMutation(
        sql,
        context,
        parsed.data.taskId,
        projectPermissionKeys.taskUpdate,
        true,
      );
      if (task.id === parsed.data.relatedTaskId) {
        throw new ProjectActionError("A task cannot depend on itself.");
      }
      const relatedRows = await sql<{ id: string }[]>`
        select id from public.project_tasks
        where id = ${parsed.data.relatedTaskId}::uuid and project_id = ${task.project_id}::uuid
        limit 1
      `;
      if (!relatedRows[0]) throw new ProjectActionError("Choose another task from this project.");

      if (parsed.data.operation === "add") {
        if (parsed.data.relationship === "blocks") {
          const cycles = await sql<{ cycle: boolean }[]>`
            with recursive downstream(task_id) as (
              select dependency.related_task_id
              from public.project_task_dependencies as dependency
              where dependency.task_id = ${parsed.data.relatedTaskId}::uuid
                and dependency.relationship = 'blocks'
              union
              select dependency.related_task_id
              from public.project_task_dependencies as dependency
              join downstream on downstream.task_id = dependency.task_id
              where dependency.relationship = 'blocks'
            )
            select exists(
              select 1 from downstream where task_id = ${task.id}::uuid
            ) as cycle
          `;
          if (cycles[0]?.cycle) {
            throw new ProjectActionError("That dependency would create a blocking cycle.");
          }
        }
        await sql`
          insert into public.project_task_dependencies (
            task_id, related_task_id, relationship, created_by_membership_id
          ) values (
            ${task.id}::uuid, ${parsed.data.relatedTaskId}::uuid,
            ${parsed.data.relationship}, ${context.membership.id}::uuid
          )
          on conflict do nothing
        `;
      } else {
        await sql`
          delete from public.project_task_dependencies
          where task_id = ${task.id}::uuid
            and related_task_id = ${parsed.data.relatedTaskId}::uuid
            and relationship = ${parsed.data.relationship}
        `;
      }
      await writeProjectAuditEvent(sql, context, {
        action: `project.task.dependency.${parsed.data.operation === "add" ? "added" : "removed"}`,
        entityType: "project_task",
        entityId: task.id,
        metadata: {
          relatedTaskId: parsed.data.relatedTaskId,
          relationship: parsed.data.relationship,
        },
      });
    });
    refreshProjects();
    return successState(
      parsed.data.operation === "add" ? "Dependency added." : "Dependency removed.",
    );
  } catch (error) {
    return actionFailure(error, "Task dependency could not be updated.");
  }
}

export async function saveProjectTaskRecurrenceAction(
  _previousState: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const parsed = projectRecurrenceSchema.safeParse(values(formData));
  if (!parsed.success)
    return errorState("Review the recurrence.", parsed.error.flatten().fieldErrors);

  try {
    const context = await authorize([projectPermissionKeys.taskUpdate]);
    const database = getDatabaseClient();
    await database.begin(async (sql) => {
      const task = await getTaskForMutation(
        sql,
        context,
        parsed.data.taskId,
        projectPermissionKeys.taskUpdate,
        true,
      );
      const rows = await sql<{ id: string }[]>`
        insert into public.project_task_recurrences (
          project_id, template_task_id, interval_unit, interval_count, next_run_on,
          end_on, is_active, created_by_membership_id
        ) values (
          ${task.project_id}::uuid, ${task.id}::uuid, ${parsed.data.intervalUnit},
          ${parsed.data.intervalCount}, ${parsed.data.nextRunOn}::date, ${parsed.data.endOn}::date,
          ${parsed.data.active}, ${context.membership.id}::uuid
        )
        on conflict (template_task_id) do update
        set interval_unit = excluded.interval_unit,
            interval_count = excluded.interval_count,
            next_run_on = excluded.next_run_on,
            end_on = excluded.end_on,
            is_active = excluded.is_active
        returning id
      `;
      const recurrenceId = rows[0]?.id;
      if (!recurrenceId) throw new ProjectActionError("Recurrence could not be saved.");
      await sql`
        update public.project_tasks set recurrence_id = ${recurrenceId}::uuid
        where id = ${task.id}::uuid
      `;
      await writeProjectAuditEvent(sql, context, {
        action: "project.task.recurrence.saved",
        entityType: "project_task_recurrence",
        entityId: recurrenceId,
        afterState: parsed.data,
        metadata: { taskId: task.id, projectId: task.project_id },
      });
    });
    refreshProjects();
    return successState(parsed.data.active ? "Recurrence saved." : "Recurrence paused.");
  } catch (error) {
    return actionFailure(error, "Task recurrence could not be saved.");
  }
}

export async function createProjectPhaseAction(
  _previousState: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const parsed = projectPhaseCreateSchema.safeParse(values(formData));
  if (!parsed.success) return errorState("Review the phase.", parsed.error.flatten().fieldErrors);

  try {
    const context = await authorize([projectPermissionKeys.projectUpdate]);
    const database = getDatabaseClient();
    await database.begin(async (sql) => {
      const project = await getProjectForMutation(
        sql,
        context,
        parsed.data.projectId,
        projectPermissionKeys.projectUpdate,
        true,
      );
      assertProjectWritable(project);
      const normalizedName = parsed.data.name.toLowerCase().replace(/\s+/g, " ");
      await sql`
        select pg_advisory_xact_lock(
          hashtextextended(${`project-phase:${project.id}:${normalizedName}`}, 0)
        )
      `;
      const existing = await sql<{ id: string }[]>`
        select id from public.project_phases
        where project_id = ${project.id}::uuid
          and lower(regexp_replace(btrim(name), '\\s+', ' ', 'g')) = ${normalizedName}
        limit 1
      `;
      if (existing[0]) throw new ProjectActionError("A phase with that name already exists.");
      const positions = await sql<{ next_position: number }[]>`
        select coalesce(max(position), 0)::integer + 1 as next_position
        from public.project_phases where project_id = ${project.id}::uuid
      `;
      const rows = await sql<{ id: string }[]>`
        insert into public.project_phases (
          project_id, name, description, position, status, start_date, due_date,
          completed_at, created_by_membership_id
        ) values (
          ${project.id}::uuid, ${parsed.data.name}, ${parsed.data.description},
          ${positions[0]?.next_position ?? 1}, ${parsed.data.status},
          ${parsed.data.startDate}::date, ${parsed.data.dueDate}::date,
          case when ${parsed.data.status} = 'completed' then now() else null end,
          ${context.membership.id}::uuid
        ) returning id
      `;
      const phaseId = rows[0]?.id;
      if (!phaseId) throw new ProjectActionError("Phase could not be created.");
      await writeProjectAuditEvent(sql, context, {
        action: "project.phase.created",
        entityType: "project_phase",
        entityId: phaseId,
        afterState: parsed.data,
      });
    });
    refreshProjects();
    return successState("Phase created.");
  } catch (error) {
    return actionFailure(error, "Phase could not be created.");
  }
}

export async function createProjectMilestoneAction(
  _previousState: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const parsed = projectMilestoneCreateSchema.safeParse(values(formData));
  if (!parsed.success)
    return errorState("Review the milestone.", parsed.error.flatten().fieldErrors);

  try {
    const context = await authorize([projectPermissionKeys.projectUpdate]);
    const database = getDatabaseClient();
    await database.begin(async (sql) => {
      const project = await getProjectForMutation(
        sql,
        context,
        parsed.data.projectId,
        projectPermissionKeys.projectUpdate,
        true,
      );
      assertProjectWritable(project);
      if (parsed.data.phaseId) {
        const phases = await sql<{ id: string }[]>`
          select id from public.project_phases
          where id = ${parsed.data.phaseId}::uuid and project_id = ${project.id}::uuid
          limit 1
        `;
        if (!phases[0]) throw new ProjectActionError("Choose a phase from this project.");
      }
      const normalizedName = parsed.data.name.toLowerCase().replace(/\s+/g, " ");
      await sql`
        select pg_advisory_xact_lock(
          hashtextextended(${`project-milestone:${project.id}:${normalizedName}`}, 0)
        )
      `;
      const existing = await sql<{ id: string }[]>`
        select id from public.project_milestones
        where project_id = ${project.id}::uuid and status <> 'cancelled'
          and lower(regexp_replace(btrim(name), '\\s+', ' ', 'g')) = ${normalizedName}
        limit 1
      `;
      if (existing[0])
        throw new ProjectActionError("An open milestone with that name already exists.");
      const rows = await sql<{ id: string }[]>`
        insert into public.project_milestones (
          project_id, phase_id, name, description, due_date, status, completed_at,
          created_by_membership_id
        ) values (
          ${project.id}::uuid, ${parsed.data.phaseId}::uuid, ${parsed.data.name},
          ${parsed.data.description}, ${parsed.data.dueDate}::date, ${parsed.data.status},
          case when ${parsed.data.status} = 'completed' then now() else null end,
          ${context.membership.id}::uuid
        ) returning id
      `;
      const milestoneId = rows[0]?.id;
      if (!milestoneId) throw new ProjectActionError("Milestone could not be created.");
      await writeProjectAuditEvent(sql, context, {
        action: "project.milestone.created",
        entityType: "project_milestone",
        entityId: milestoneId,
        afterState: parsed.data,
      });
    });
    refreshProjects();
    return successState("Milestone created.");
  } catch (error) {
    return actionFailure(error, "Milestone could not be created.");
  }
}

export async function updateProjectPhaseStatusAction(
  _previousState: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const parsed = projectPhaseStatusSchema.safeParse(values(formData));
  if (!parsed.success)
    return errorState("Review the phase status.", parsed.error.flatten().fieldErrors);

  try {
    const context = await authorize([projectPermissionKeys.projectUpdate]);
    const database = getDatabaseClient();
    await database.begin(async (sql) => {
      const rows = await sql<
        {
          id: string;
          project_id: string;
          status: string;
          archived_at: string | null;
          closure_status: "open" | "requested" | "closed";
        }[]
      >`
        select phase.id, phase.project_id, phase.status, project.archived_at::text,
          project.closure_status
        from public.project_phases as phase
        join public.projects as project on project.id = phase.project_id
        where phase.id = ${parsed.data.phaseId}::uuid
          and project.organization_id = ${context.membership.organizationId}::uuid
          and private.project_is_visible(
            project.id, ${context.membership.id}::uuid,
            ${scopeFor(context, projectPermissionKeys.projectUpdate)}
          )
        for update of phase
      `;
      const phase = rows[0];
      if (!phase) throw new ProjectActionError("Phase was not found or is outside your scope.");
      if (phase.archived_at)
        throw new ProjectActionError("Restore the project before changing it.");
      if (phase.closure_status === "closed") {
        throw new ProjectActionError("Closed projects are read-only.");
      }

      await sql`
        update public.project_phases
        set status = ${parsed.data.status},
          completed_at = case when ${parsed.data.status} = 'completed' then coalesce(completed_at, now()) else null end
        where id = ${phase.id}::uuid
      `;
      await writeProjectAuditEvent(sql, context, {
        action: "project.phase.status.updated",
        entityType: "project_phase",
        entityId: phase.id,
        beforeState: { status: phase.status },
        afterState: { status: parsed.data.status },
        changedFields: ["status", "completed_at"],
        metadata: { projectId: phase.project_id },
      });
    });
    refreshProjects();
    return successState("Phase status updated.");
  } catch (error) {
    return actionFailure(error, "Phase status could not be updated.");
  }
}

export async function updateProjectMilestoneStatusAction(
  _previousState: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const parsed = projectMilestoneStatusSchema.safeParse(values(formData));
  if (!parsed.success)
    return errorState("Review the milestone status.", parsed.error.flatten().fieldErrors);

  try {
    const context = await authorize([projectPermissionKeys.projectUpdate]);
    const database = getDatabaseClient();
    await database.begin(async (sql) => {
      const rows = await sql<
        {
          id: string;
          project_id: string;
          status: string;
          archived_at: string | null;
          closure_status: "open" | "requested" | "closed";
        }[]
      >`
        select milestone.id, milestone.project_id, milestone.status, project.archived_at::text,
          project.closure_status
        from public.project_milestones as milestone
        join public.projects as project on project.id = milestone.project_id
        where milestone.id = ${parsed.data.milestoneId}::uuid
          and project.organization_id = ${context.membership.organizationId}::uuid
          and private.project_is_visible(
            project.id, ${context.membership.id}::uuid,
            ${scopeFor(context, projectPermissionKeys.projectUpdate)}
          )
        for update of milestone
      `;
      const milestone = rows[0];
      if (!milestone) {
        throw new ProjectActionError("Milestone was not found or is outside your scope.");
      }
      if (milestone.archived_at) {
        throw new ProjectActionError("Restore the project before changing it.");
      }
      if (milestone.closure_status === "closed") {
        throw new ProjectActionError("Closed projects are read-only.");
      }

      await sql`
        update public.project_milestones
        set status = ${parsed.data.status},
          completed_at = case when ${parsed.data.status} = 'completed' then coalesce(completed_at, now()) else null end
        where id = ${milestone.id}::uuid
      `;
      await writeProjectAuditEvent(sql, context, {
        action: "project.milestone.status.updated",
        entityType: "project_milestone",
        entityId: milestone.id,
        beforeState: { status: milestone.status },
        afterState: { status: parsed.data.status },
        changedFields: ["status", "completed_at"],
        metadata: { projectId: milestone.project_id },
      });
    });
    refreshProjects();
    return successState("Milestone status updated.");
  } catch (error) {
    return actionFailure(error, "Milestone status could not be updated.");
  }
}

export async function saveProjectFilterAction(
  _previousState: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const parsed = projectSavedFilterSchema.safeParse(values(formData));
  if (!parsed.success) {
    return errorState("Review the saved filter.", parsed.error.flatten().fieldErrors);
  }
  try {
    const context = await authorize([projectPermissionKeys.projectView]);
    const database = getDatabaseClient();
    const filterPayload = {
      q: parsed.data.q,
      status: parsed.data.status,
      owner: parsed.data.owner,
      archive: parsed.data.archive,
      mine: parsed.data.mine,
      sort: parsed.data.sort,
      group: parsed.data.group,
    };
    await database`
      insert into public.project_saved_filters (
        organization_id, owner_membership_id, name, filters
      ) values (
        ${context.membership.organizationId}::uuid, ${context.membership.id}::uuid,
        ${parsed.data.name}, ${JSON.stringify(filterPayload)}::jsonb
      )
      on conflict (organization_id, owner_membership_id, name)
      do update set filters = excluded.filters, updated_at = now()
    `;
    refreshProjects();
    return successState("Project filter saved.");
  } catch (error) {
    return actionFailure(error, "Project filter could not be saved.");
  }
}

export async function deleteProjectSavedFilterAction(
  _previousState: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const parsed = projectSavedFilterDeleteSchema.safeParse(values(formData));
  if (!parsed.success) return errorState("Choose a saved filter.");
  try {
    const context = await authorize([projectPermissionKeys.projectView]);
    const database = getDatabaseClient();
    await database`
      delete from public.project_saved_filters
      where id = ${parsed.data.filterId}::uuid
        and organization_id = ${context.membership.organizationId}::uuid
        and owner_membership_id = ${context.membership.id}::uuid
    `;
    refreshProjects();
    return successState("Saved project filter deleted.");
  } catch (error) {
    return actionFailure(error, "Saved filter could not be deleted.");
  }
}

export async function bulkUpdateProjectTasksAction(
  _previousState: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const parsed = projectBulkTaskUpdateSchema.safeParse({
    ...values(formData),
    taskIds: formData.getAll("taskIds").map(String),
  });
  if (!parsed.success) {
    return errorState("Review the bulk task changes.", parsed.error.flatten().fieldErrors);
  }

  try {
    const permissions: string[] = [projectPermissionKeys.taskUpdate];
    if (parsed.data.assigneeMembershipId) permissions.push(projectPermissionKeys.taskAssign);
    const context = await authorize(permissions);
    const database = getDatabaseClient();
    await database.begin(async (sql) => {
      const project = await getProjectForMutation(
        sql,
        context,
        parsed.data.projectId,
        projectPermissionKeys.taskUpdate,
        true,
      );
      assertProjectWritable(project);
      const selectedRows = await sql<{ id: string }[]>`
        select task.id
        from public.project_tasks task
        where task.project_id = ${project.id}::uuid
          and task.organization_id = ${context.membership.organizationId}::uuid
          and task.id = any(${parsed.data.taskIds}::uuid[])
        for update
      `;
      if (selectedRows.length !== parsed.data.taskIds.length) {
        throw new ProjectActionError("One or more selected tasks are no longer available.");
      }

      let terminal = false;
      if (parsed.data.statusId) {
        const statusRows = await sql<{ id: string; is_terminal: boolean }[]>`
          select id, is_terminal from public.project_task_statuses
          where id = ${parsed.data.statusId}::uuid and project_id = ${project.id}::uuid
        `;
        if (!statusRows[0]) throw new ProjectActionError("Choose a task status from this project.");
        terminal = statusRows[0].is_terminal;
      }
      if (parsed.data.assigneeMembershipId) {
        await validateMembership(
          sql,
          context.membership.organizationId,
          parsed.data.assigneeMembershipId,
        );
        const memberRows = await sql<{ membership_id: string }[]>`
          select membership_id from public.project_members
          where project_id = ${project.id}::uuid and membership_id = ${parsed.data.assigneeMembershipId}::uuid
        `;
        if (!memberRows[0])
          throw new ProjectActionError("Bulk assignee must already be a project member.");
      }

      await sql`
        update public.project_tasks
        set status_id = case when ${parsed.data.statusId}::uuid is null then status_id else ${parsed.data.statusId}::uuid end,
            priority = case when ${parsed.data.priority}::text is null then priority else ${parsed.data.priority}::text end,
            due_date = case when ${parsed.data.dueDate}::date is null then due_date else ${parsed.data.dueDate}::date end,
            completed_at = case
              when ${parsed.data.statusId}::uuid is null then completed_at
              when ${terminal} then coalesce(completed_at, now())
              else null
            end
        where project_id = ${project.id}::uuid and id = any(${parsed.data.taskIds}::uuid[])
      `;
      if (parsed.data.assigneeMembershipId) {
        await sql`
          insert into public.project_task_assignees (task_id, membership_id, assigned_by_membership_id)
          select task.id, ${parsed.data.assigneeMembershipId}::uuid, ${context.membership.id}::uuid
          from public.project_tasks task
          where task.project_id = ${project.id}::uuid and task.id = any(${parsed.data.taskIds}::uuid[])
          on conflict do nothing
        `;
      }
      await writeProjectAuditEvent(sql, context, {
        action: "project.tasks.bulk_updated",
        entityType: "project",
        entityId: project.id,
        afterState: {
          taskIds: parsed.data.taskIds,
          statusId: parsed.data.statusId,
          priority: parsed.data.priority,
          dueDate: parsed.data.dueDate,
          assigneeMembershipId: parsed.data.assigneeMembershipId,
        },
        metadata: { affectedCount: selectedRows.length },
      });
    });
    refreshProjects();
    return successState(
      `${parsed.data.taskIds.length} task${parsed.data.taskIds.length === 1 ? "" : "s"} updated.`,
    );
  } catch (error) {
    return actionFailure(error, "Selected tasks could not be updated.");
  }
}

export async function saveProjectTemplateAction(
  _previousState: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const parsed = projectTemplateSaveSchema.safeParse(values(formData));
  if (!parsed.success) {
    return errorState("Review the project template.", parsed.error.flatten().fieldErrors);
  }
  try {
    const context = await authorize([
      projectPermissionKeys.projectCreate,
      projectPermissionKeys.projectView,
    ]);
    const database = getDatabaseClient();
    await database.begin(async (sql) => {
      const project = await getProjectForMutation(
        sql,
        context,
        parsed.data.projectId,
        projectPermissionKeys.projectView,
      );
      const blueprint = await captureProjectBlueprint(sql, project.id, context.membership.organizationId);
      await sql`
        insert into public.project_templates (
          organization_id, name, description, blueprint, created_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${parsed.data.name}, ${parsed.data.description},
          ${JSON.stringify(blueprint)}::jsonb, ${context.membership.id}::uuid
        )
        on conflict (organization_id, name)
        do update set description = excluded.description, blueprint = excluded.blueprint,
          status = 'active', updated_at = now()
      `;
      await writeProjectAuditEvent(sql, context, {
        action: "project.template.saved",
        entityType: "project",
        entityId: project.id,
        afterState: { name: parsed.data.name, description: parsed.data.description },
      });
    });
    refreshProjects();
    return successState("Project template saved from the current project structure.");
  } catch (error) {
    return actionFailure(error, "Project template could not be saved.");
  }
}

export async function createProjectFromTemplateAction(
  _previousState: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const parsed = projectTemplateCreateSchema.safeParse(values(formData));
  if (!parsed.success) {
    return errorState("Review the template project details.", parsed.error.flatten().fieldErrors);
  }
  try {
    const context = await authorize([projectPermissionKeys.projectCreate]);
    const ownerMembershipId = parsed.data.ownerMembershipId ?? context.membership.id;
    if (
      ownerMembershipId !== context.membership.id &&
      !context.permissions.has(projectPermissionKeys.projectAssign)
    ) {
      throw new ProjectActionError("You cannot assign project ownership to another member.");
    }
    const database = getDatabaseClient();
    const created = await database.begin(async (sql) => {
      const templateRows = await sql<{ blueprint: ProjectBlueprint; name: string }[]>`
        select blueprint, name from public.project_templates
        where id = ${parsed.data.templateId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
          and status = 'active'
        for share
      `;
      const template = templateRows[0];
      if (!template?.blueprint?.project)
        throw new ProjectActionError("Project template was not found.");
      const blueprint = template.blueprint;
      if (blueprint.project.projectType === "client" && !parsed.data.companyId) {
        throw new ProjectActionError("Choose a CRM company for this client-project template.");
      }
      const addDays = (date: string | null, offset: number | null): string | null => {
        if (!date || offset === null || !Number.isFinite(offset)) return null;
        const value = new Date(`${date}T00:00:00.000Z`);
        value.setUTCDate(value.getUTCDate() + offset);
        return value.toISOString().slice(0, 10);
      };
      const dueDate =
        parsed.data.dueDate ?? addDays(parsed.data.startDate, blueprint.project.durationDays);
      const estimatedCompletionDate = addDays(
        parsed.data.startDate,
        blueprint.project.estimatedCompletionOffsetDays,
      );
      const result = await insertProjectRecord(sql, context, {
        name: parsed.data.name,
        description: blueprint.project.description,
        projectType: blueprint.project.projectType,
        companyId: parsed.data.companyId,
        status: "planned",
        priority: blueprint.project.priority,
        visibility: blueprint.project.visibility,
        ownerMembershipId,
        startDate: parsed.data.startDate,
        dueDate,
        currency: blueprint.project.currency,
        billingMethod: blueprint.project.billingMethod,
        budgetMinor: blueprint.project.budgetMinor,
        hourlyRateMinor: blueprint.project.hourlyRateMinor,
        fixedPriceMinor: blueprint.project.fixedPriceMinor,
        retainerAmountMinor: blueprint.project.retainerAmountMinor,
        estimatedCompletionDate,
      });
      await instantiateProjectBlueprint(sql, context, result.id, parsed.data.startDate, blueprint);
      await writeProjectAuditEvent(sql, context, {
        action: "project.created_from_template",
        entityType: "project",
        entityId: result.id,
        afterState: {
          code: result.code,
          templateId: parsed.data.templateId,
          templateName: template.name,
        },
      });
      return result;
    });
    refreshProjects();
    return { ...successState("Project created from template."), projectId: created.id };
  } catch (error) {
    return actionFailure(error, "Project could not be created from the template.");
  }
}

export async function duplicateProjectAction(
  _previousState: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const parsed = projectDuplicateSchema.safeParse(values(formData));
  if (!parsed.success) {
    return errorState("Review the duplicate project details.", parsed.error.flatten().fieldErrors);
  }
  try {
    const context = await authorize([
      projectPermissionKeys.projectCreate,
      projectPermissionKeys.projectView,
    ]);
    const database = getDatabaseClient();
    const created = await database.begin(async (sql) => {
      const source = await getProjectForMutation(
        sql,
        context,
        parsed.data.projectId,
        projectPermissionKeys.projectView,
      );
      const blueprint = await captureProjectBlueprint(sql, source.id, context.membership.organizationId);
      const ownerMembershipId = context.permissions.has(projectPermissionKeys.projectAssign)
        ? source.owner_membership_id
        : context.membership.id;
      const result = await insertProjectRecord(sql, context, {
        name: parsed.data.name,
        description: source.description,
        projectType: source.project_type as ProjectInsertInput["projectType"],
        companyId: source.company_id,
        status: "planned",
        priority: source.priority as ProjectInsertInput["priority"],
        visibility: source.visibility as ProjectInsertInput["visibility"],
        ownerMembershipId,
        startDate: source.start_date,
        dueDate: source.due_date,
        currency: source.currency,
        billingMethod: source.billing_method,
        budgetMinor: source.budget_minor === null ? null : Number(source.budget_minor),
        hourlyRateMinor:
          source.hourly_rate_minor === null ? null : Number(source.hourly_rate_minor),
        fixedPriceMinor:
          source.fixed_price_minor === null ? null : Number(source.fixed_price_minor),
        retainerAmountMinor:
          source.retainer_amount_minor === null ? null : Number(source.retainer_amount_minor),
        estimatedCompletionDate: source.estimated_completion_date,
      });
      await instantiateProjectBlueprint(sql, context, result.id, source.start_date, blueprint);
      if (parsed.data.includeMembers) {
        if (!context.permissions.has(projectPermissionKeys.projectAssign)) {
          throw new ProjectActionError("You cannot copy project members with your current role.");
        }
        await sql`
          insert into public.project_members (
            project_id, membership_id, role, hourly_cost_rate_minor, added_by_membership_id
          )
          select ${result.id}::uuid, member.membership_id,
            case when member.membership_id = ${ownerMembershipId}::uuid then 'owner' when member.role = 'owner' then 'manager' else member.role end,
            member.hourly_cost_rate_minor, ${context.membership.id}::uuid
          from public.project_members member
          join public.memberships membership on membership.id = member.membership_id and membership.status = 'active'
          where member.project_id = ${source.id}::uuid
          on conflict (project_id, membership_id) do update
            set role = excluded.role, hourly_cost_rate_minor = excluded.hourly_cost_rate_minor
        `;
      }
      await writeProjectAuditEvent(sql, context, {
        action: "project.duplicated",
        entityType: "project",
        entityId: result.id,
        afterState: {
          code: result.code,
          sourceProjectId: source.id,
          includeMembers: parsed.data.includeMembers,
        },
      });
      return result;
    });
    refreshProjects();
    return { ...successState("Project duplicated."), projectId: created.id };
  } catch (error) {
    return actionFailure(error, "Project could not be duplicated.");
  }
}

export async function toggleProjectClosureItemAction(
  _previousState: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const parsed = projectClosureItemToggleSchema.safeParse(values(formData));
  if (!parsed.success)
    return errorState("Review the closure check.", parsed.error.flatten().fieldErrors);

  try {
    const context = await authorize([projectPermissionKeys.projectUpdate]);
    const database = getDatabaseClient();
    await database.begin(async (sql) => {
      const rows = await sql<
        {
          id: string;
          project_id: string;
          check_key: string;
          archived_at: string | null;
          closure_status: "open" | "requested" | "closed";
        }[]
      >`
        select item.id, item.project_id, item.check_key, project.archived_at::text, project.closure_status
        from public.project_closure_items as item
        join public.projects as project on project.id = item.project_id
        where item.id = ${parsed.data.closureItemId}::uuid
          and project.organization_id = ${context.membership.organizationId}::uuid
          and private.project_is_visible(
            project.id, ${context.membership.id}::uuid,
            ${scopeFor(context, projectPermissionKeys.projectUpdate)}
          )
        for update of item
      `;
      const item = rows[0];
      if (!item)
        throw new ProjectActionError("Closure check was not found or is outside your scope.");
      if (item.archived_at) throw new ProjectActionError("Restore the project before changing it.");
      if (item.closure_status === "closed") {
        throw new ProjectActionError("Closed projects are read-only.");
      }
      if (
        !["deliverables_confirmed", "followups_recorded", "assets_returned"].includes(
          item.check_key,
        )
      ) {
        throw new ProjectActionError(
          "This closure check is verified automatically from project records.",
        );
      }
      await sql`
        update public.project_closure_items
        set is_completed = ${parsed.data.completed},
          completed_at = case when ${parsed.data.completed} then now() else null end,
          completed_by_membership_id = case
            when ${parsed.data.completed} then ${context.membership.id}::uuid else null
          end
        where id = ${item.id}::uuid
      `;
      await writeProjectAuditEvent(sql, context, {
        action: "project.closure.check.updated",
        entityType: "project_closure_item",
        entityId: item.id,
        afterState: { completed: parsed.data.completed },
        metadata: { projectId: item.project_id },
      });
    });
    refreshProjects();
    return successState(
      parsed.data.completed ? "Closure check completed." : "Closure check reopened.",
    );
  } catch (error) {
    return actionFailure(error, "Closure check could not be updated.");
  }
}

export async function requestProjectClosureAction(
  _previousState: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const parsed = projectClosureRequestSchema.safeParse(values(formData));
  if (!parsed.success)
    return errorState("Review the closure request.", parsed.error.flatten().fieldErrors);

  try {
    const context = await authorize([projectPermissionKeys.projectUpdate]);
    const database = getDatabaseClient();
    await database.begin(async (sql) => {
      const project = await getProjectForMutation(
        sql,
        context,
        parsed.data.projectId,
        projectPermissionKeys.projectUpdate,
        true,
      );
      assertProjectWritable(project);
      if (project.archived_at)
        throw new ProjectActionError("Restore the project before requesting closure.");
      if (project.closure_status === "closed")
        throw new ProjectActionError("This project is already closed.");
      await sql`
        update public.projects
        set closure_status = 'requested', closure_notes = ${parsed.data.notes},
          closure_requested_at = now(),
          closure_requested_by_membership_id = ${context.membership.id}::uuid
        where id = ${project.id}::uuid
      `;
      await writeProjectAuditEvent(sql, context, {
        action: "project.closure.requested",
        entityType: "project",
        entityId: project.id,
        afterState: { closureStatus: "requested", notes: parsed.data.notes },
      });
    });
    refreshProjects();
    return successState("Project closure requested.");
  } catch (error) {
    return actionFailure(error, "Project closure could not be requested.");
  }
}

export async function closeProjectAction(
  _previousState: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const parsed = projectClosureCompleteSchema.safeParse(values(formData));
  if (!parsed.success) {
    return errorState("Review the closure details.", parsed.error.flatten().fieldErrors);
  }

  try {
    const context = await authorize([projectPermissionKeys.projectUpdate]);
    const database = getDatabaseClient();
    await database.begin(async (sql) => {
      const project = await getProjectForMutation(
        sql,
        context,
        parsed.data.projectId,
        projectPermissionKeys.projectUpdate,
        true,
      );
      assertProjectWritable(project);
      if (project.archived_at) {
        throw new ProjectActionError("Restore the project before closing it.");
      }
      if (project.closure_status !== "requested") {
        throw new ProjectActionError("Request project closure before completing the final close.");
      }

      const checks = await sql<
        {
          open_tasks: number;
          unsubmitted_time_entries: number;
          outstanding_expenses: number;
          open_support_tickets: number;
          manual_checks_remaining: number;
          unbilled_minor: string | number | null;
        }[]
      >`
        select
          (select count(*)::int from public.project_tasks task
            join public.project_task_statuses status on status.id = task.status_id
            where task.project_id = ${project.id}::uuid and not status.is_terminal) as open_tasks,
          (select count(*)::int from public.project_time_entries entry
            where entry.project_id = ${project.id}::uuid and entry.submission_status <> 'submitted') as unsubmitted_time_entries,
          (select count(*)::int from public.finance_expense_project_allocations allocation
            join public.finance_expenses expense on expense.id = allocation.expense_id
            where allocation.project_id = ${project.id}::uuid
              and (expense.approval_status = 'pending' or expense.payment_status in ('unpaid','scheduled'))) as outstanding_expenses,
          (select count(*)::int from public.support_tickets ticket
            where ticket.project_id = ${project.id}::uuid and ticket.status not in ('resolved','closed')) as open_support_tickets,
          (select count(*)::int from public.project_closure_items item
            where item.project_id = ${project.id}::uuid
              and item.is_required and not item.is_completed
              and item.check_key in ('deliverables_confirmed','followups_recorded','assets_returned')) as manual_checks_remaining,
          private.project_unbilled_minor(${project.id}::uuid) as unbilled_minor
      `;
      const readiness = checks[0];
      if (!readiness)
        throw new ProjectActionError("Project closure readiness could not be verified.");
      if (readiness.open_tasks > 0) {
        throw new ProjectActionError("Complete or cancel every open task before project closure.");
      }
      if (readiness.unsubmitted_time_entries > 0) {
        throw new ProjectActionError("Submit every draft time entry before project closure.");
      }
      if (readiness.outstanding_expenses > 0) {
        throw new ProjectActionError(
          "Resolve pending or unpaid project expenses before project closure.",
        );
      }
      if (readiness.open_support_tickets > 0) {
        throw new ProjectActionError(
          "Resolve or close every project support ticket before project closure.",
        );
      }
      if (readiness.manual_checks_remaining > 0) {
        throw new ProjectActionError(
          "Confirm deliverables, follow-ups, and asset/access return before project closure.",
        );
      }
      if (Number(readiness.unbilled_minor ?? 0) !== 0) {
        throw new ProjectActionError(
          "Final billing is incomplete. Invoice the remaining billable value before project closure.",
        );
      }

      await sql`
        update public.projects
        set status = 'completed', closure_status = 'closed',
          closure_notes = ${parsed.data.notes},
          closure_requested_at = coalesce(closure_requested_at, now()),
          closure_requested_by_membership_id = coalesce(
            closure_requested_by_membership_id, ${context.membership.id}::uuid
          ),
          completed_at = coalesce(completed_at, now()),
          actual_completion_date = coalesce(actual_completion_date, current_date),
          closed_at = now(), closed_by_membership_id = ${context.membership.id}::uuid
        where id = ${project.id}::uuid
      `;
      await writeProjectAuditEvent(sql, context, {
        action: "project.closed",
        entityType: "project",
        entityId: project.id,
        beforeState: { status: project.status, closureStatus: project.closure_status },
        afterState: {
          status: "completed",
          closureStatus: "closed",
          notes: parsed.data.notes,
          actualCompletionDate: "today",
        },
        changedFields: [
          "status",
          "closure_status",
          "closure_notes",
          "completed_at",
          "actual_completion_date",
          "closed_at",
        ],
      });
    });
    refreshProjects();
    return successState("Project closed, final billing verified, and actual completion recorded.");
  } catch (error) {
    return actionFailure(error, "Project could not be closed.");
  }
}

export async function archiveProjectAction(
  _previousState: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const parsed = projectArchiveSchema.safeParse(values(formData));
  if (!parsed.success)
    return errorState("Review the archive action.", parsed.error.flatten().fieldErrors);

  try {
    const context = await authorize([projectPermissionKeys.projectArchive]);
    const database = getDatabaseClient();
    await database.begin(async (sql) => {
      const project = await getProjectForMutation(
        sql,
        context,
        parsed.data.projectId,
        projectPermissionKeys.projectArchive,
        true,
      );
      const shouldArchive = parsed.data.operation === "archive";
      if (shouldArchive && project.archived_at) {
        throw new ProjectActionError("This project is already archived.");
      }
      if (!shouldArchive && !project.archived_at) {
        throw new ProjectActionError("This project is already active.");
      }
      await sql`
        update public.projects set archived_at = case when ${shouldArchive} then now() else null end
        where id = ${project.id}::uuid
      `;
      await writeProjectAuditEvent(sql, context, {
        action: shouldArchive ? "project.archived" : "project.restored",
        entityType: "project",
        entityId: project.id,
        beforeState: { archivedAt: project.archived_at },
        afterState: { archivedAt: shouldArchive ? "now" : null },
        changedFields: ["archived_at"],
      });
    });
    refreshProjects();
    return successState(
      parsed.data.operation === "archive" ? "Project archived." : "Project restored.",
    );
  } catch (error) {
    return actionFailure(error, "Project archive state could not be updated.");
  }
}
