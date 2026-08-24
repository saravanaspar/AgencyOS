import "server-only";

import type { Sql, TransactionSql } from "postgres";

import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";
import type { ProjectBillingMethod } from "@/modules/projects/projects";

export class ProjectBlueprintError extends Error {}
type QuerySql = Sql | TransactionSql;

export interface ProjectBlueprint {
  project: {
    description: string | null;
    projectType: "client" | "internal";
    status: "planned" | "active" | "on_hold" | "cancelled";
    priority: "low" | "normal" | "high" | "urgent";
    visibility: "organization" | "members" | "private";
    currency: string;
    billingMethod: ProjectBillingMethod;
    budgetMinor: number | null;
    hourlyRateMinor: number | null;
    fixedPriceMinor: number | null;
    retainerAmountMinor: number | null;
    durationDays: number | null;
    estimatedCompletionOffsetDays: number | null;
  };
  labels?: Array<{
    name: string;
    color: string;
  }>;
  phases: Array<{
    name: string;
    description: string | null;
    position: number;
    status: "planned" | "active" | "completed" | "cancelled";
    startOffsetDays: number | null;
    dueOffsetDays: number | null;
  }>;
  milestones: Array<{
    name: string;
    description: string | null;
    phaseName: string | null;
    dueOffsetDays: number | null;
    status: "open" | "completed" | "cancelled";
  }>;
  tasks: Array<{
    key?: string;
    title: string;
    description: string | null;
    statusSlug: string;
    priority: "low" | "normal" | "high" | "urgent";
    phaseName: string | null;
    milestoneName: string | null;
    startOffsetDays: number | null;
    dueOffsetDays: number | null;
    reminderOffsetMinutes: number | null;
    estimatedMinutes: number | null;
    labels?: string[];
    checklist?: Array<{
      label: string;
      position: number;
      isRequired: boolean;
    }>;
    recurrence?: {
      intervalUnit: "day" | "week" | "month";
      intervalCount: number;
      nextRunOffsetDays: number;
      endOffsetDays: number | null;
    } | null;
  }>;
  dependencies?: Array<{
    taskKey: string;
    relatedTaskKey: string;
    relationship: "blocks" | "related_to" | "duplicate_of" | "parent_of";
  }>;
}

export async function captureProjectBlueprint(
  sql: QuerySql,
  projectId: string,
  organizationId: string,
): Promise<ProjectBlueprint> {
  const rows = await sql<{ blueprint: ProjectBlueprint }[]>`
    select jsonb_build_object(
      'project', jsonb_build_object(
        'description', project.description,
        'projectType', project.project_type,
        'status', case when project.status = 'completed' then 'planned' else project.status end,
        'priority', project.priority,
        'visibility', project.visibility,
        'currency', project.currency,
        'billingMethod', project.billing_method,
        'budgetMinor', project.budget_minor,
        'hourlyRateMinor', project.hourly_rate_minor,
        'fixedPriceMinor', project.fixed_price_minor,
        'retainerAmountMinor', project.retainer_amount_minor,
        'durationDays', case when project.start_date is not null and project.due_date is not null then project.due_date - project.start_date else null end,
        'estimatedCompletionOffsetDays', case when project.start_date is not null and project.estimated_completion_date is not null then project.estimated_completion_date - project.start_date else null end
      ),
      'labels', coalesce((select jsonb_agg(jsonb_build_object(
        'name', label.name,
        'color', label.color
      ) order by lower(label.name), label.id) from public.project_labels as label
        where label.project_id = project.id), '[]'::jsonb),
      'phases', coalesce((select jsonb_agg(jsonb_build_object(
        'name', phase.name, 'description', phase.description, 'position', phase.position,
        'status', case when phase.status = 'completed' then 'planned' else phase.status end,
        'startOffsetDays', case when project.start_date is not null and phase.start_date is not null then phase.start_date - project.start_date else null end,
        'dueOffsetDays', case when project.start_date is not null and phase.due_date is not null then phase.due_date - project.start_date else null end
      ) order by phase.position) from public.project_phases phase where phase.project_id = project.id), '[]'::jsonb),
      'milestones', coalesce((select jsonb_agg(jsonb_build_object(
        'name', milestone.name, 'description', milestone.description, 'phaseName', phase.name,
        'dueOffsetDays', case when project.start_date is not null and milestone.due_date is not null then milestone.due_date - project.start_date else null end,
        'status', case when milestone.status = 'completed' then 'open' else milestone.status end
      ) order by milestone.created_at) from public.project_milestones milestone
        left join public.project_phases phase on phase.id = milestone.phase_id
        where milestone.project_id = project.id), '[]'::jsonb),
      'tasks', coalesce((select jsonb_agg(jsonb_build_object(
        'key', 'task-' || task.task_number::text,
        'title', task.title, 'description', task.description, 'statusSlug', status.slug,
        'priority', task.priority, 'phaseName', phase.name, 'milestoneName', milestone.name,
        'startOffsetDays', case when project.start_date is not null and task.start_date is not null then task.start_date - project.start_date else null end,
        'dueOffsetDays', case when project.start_date is not null and task.due_date is not null then task.due_date - project.start_date else null end,
        'reminderOffsetMinutes', case when task.reminder_at is not null and task.due_date is not null then extract(epoch from (task.reminder_at - task.due_date::timestamp))::int / 60 else null end,
        'estimatedMinutes', task.estimated_minutes,
        'labels', coalesce((
          select jsonb_agg(label.name order by lower(label.name), label.id)
          from public.project_task_labels as task_label
          join public.project_labels as label on label.id = task_label.label_id
          where task_label.task_id = task.id
        ), '[]'::jsonb),
        'checklist', coalesce((
          select jsonb_agg(jsonb_build_object(
            'label', item.label,
            'position', item.position,
            'isRequired', item.is_required
          ) order by item.position, item.id)
          from public.project_task_checklist_items as item
          where item.task_id = task.id
        ), '[]'::jsonb),
        'recurrence', (
          select jsonb_build_object(
            'intervalUnit', recurrence.interval_unit,
            'intervalCount', recurrence.interval_count,
            'nextRunOffsetDays', recurrence.next_run_on - coalesce(project.start_date, current_date),
            'endOffsetDays', case when recurrence.end_on is null then null else recurrence.end_on - coalesce(project.start_date, current_date) end
          )
          from public.project_task_recurrences as recurrence
          where recurrence.id = task.recurrence_id
            and recurrence.template_task_id = task.id
            and recurrence.is_active
          limit 1
        )
      ) order by task.task_number) from public.project_tasks task
        join public.project_task_statuses status on status.id = task.status_id
        left join public.project_phases phase on phase.id = task.phase_id
        left join public.project_milestones milestone on milestone.id = task.milestone_id
        where task.project_id = project.id and not status.is_cancelled), '[]'::jsonb),
      'dependencies', coalesce((
        select jsonb_agg(jsonb_build_object(
          'taskKey', 'task-' || task.task_number::text,
          'relatedTaskKey', 'task-' || related.task_number::text,
          'relationship', dependency.relationship
        ) order by task.task_number, related.task_number, dependency.relationship)
        from public.project_task_dependencies as dependency
        join public.project_tasks as task on task.id = dependency.task_id
        join public.project_tasks as related on related.id = dependency.related_task_id
        join public.project_task_statuses as task_status on task_status.id = task.status_id
        join public.project_task_statuses as related_status on related_status.id = related.status_id
        where task.project_id = project.id
          and related.project_id = project.id
          and not task_status.is_cancelled
          and not related_status.is_cancelled
      ), '[]'::jsonb)
    ) as blueprint
    from public.projects project
    where project.id = ${projectId}::uuid
      and project.organization_id = ${organizationId}::uuid
  `;
  const blueprint = rows[0]?.blueprint;
  if (
    !blueprint ||
    !blueprint.project ||
    !Array.isArray(blueprint.phases) ||
    !Array.isArray(blueprint.milestones) ||
    !Array.isArray(blueprint.tasks)
  ) {
    throw new ProjectBlueprintError("Project structure could not be captured.");
  }
  return blueprint;
}

const blueprintDependencyRelationships = new Set(["blocks", "related_to", "duplicate_of", "parent_of"]);
const blueprintRecurrenceUnits = new Set(["day", "week", "month"]);

function blueprintLabelKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function instantiateProjectBlueprint(
  sql: TransactionSql,
  context: CurrentPermissionContext,
  projectId: string,
  startDate: string | null,
  blueprint: ProjectBlueprint,
): Promise<void> {
  const labelIds = new Map<string, string>();
  for (const label of (Array.isArray(blueprint.labels) ? blueprint.labels : []).slice(0, 100)) {
    const name = typeof label?.name === "string" ? label.name.trim().slice(0, 80) : "";
    if (!name) continue;
    const color = typeof label.color === "string" && /^#[0-9A-Fa-f]{6}$/.test(label.color)
      ? label.color
      : "#2563eb";
    const labelRows = await sql<{ id: string }[]>`
      insert into public.project_labels (project_id, name, color, created_by_membership_id)
      values (${projectId}::uuid, ${name}, ${color}, ${context.membership.id}::uuid)
      returning id
    `;
    if (labelRows[0]) labelIds.set(blueprintLabelKey(name), labelRows[0].id);
  }

  const phaseIds = new Map<string, string>();
  for (const phase of blueprint.phases.slice(0, 100)) {
    const phaseRows = await sql<{ id: string }[]>`
      insert into public.project_phases (
        project_id, name, description, position, status, start_date, due_date, created_by_membership_id
      ) values (
        ${projectId}::uuid, ${phase.name.slice(0, 120)}, ${phase.description}, ${phase.position},
        ${phase.status === "completed" ? "planned" : phase.status},
        case when ${startDate}::date is null or ${phase.startOffsetDays}::int is null then null else ${startDate}::date + ${phase.startOffsetDays}::int end,
        case when ${startDate}::date is null or ${phase.dueOffsetDays}::int is null then null else ${startDate}::date + ${phase.dueOffsetDays}::int end,
        ${context.membership.id}::uuid
      ) returning id
    `;
    if (phaseRows[0]) phaseIds.set(phase.name, phaseRows[0].id);
  }

  const milestoneIds = new Map<string, string>();
  for (const milestone of blueprint.milestones.slice(0, 200)) {
    const milestoneRows = await sql<{ id: string }[]>`
      insert into public.project_milestones (
        project_id, phase_id, name, description, due_date, status, created_by_membership_id
      ) values (
        ${projectId}::uuid, ${milestone.phaseName ? (phaseIds.get(milestone.phaseName) ?? null) : null}::uuid,
        ${milestone.name.slice(0, 160)}, ${milestone.description},
        case when ${startDate}::date is null or ${milestone.dueOffsetDays}::int is null then null else ${startDate}::date + ${milestone.dueOffsetDays}::int end,
        ${milestone.status === "completed" ? "open" : milestone.status}, ${context.membership.id}::uuid
      ) returning id
    `;
    if (milestoneRows[0]) milestoneIds.set(milestone.name, milestoneRows[0].id);
  }

  const statusRows = await sql<{ id: string; slug: string }[]>`
    select id, slug from public.project_task_statuses where project_id = ${projectId}::uuid
  `;
  const statusIds = new Map(statusRows.map((row) => [row.slug, row.id]));
  const defaultStatusId = statusIds.get("backlog") ?? statusRows[0]?.id;
  if (!defaultStatusId) throw new ProjectBlueprintError("Template project has no task workflow.");

  const taskIds = new Map<string, string>();
  const tasks = blueprint.tasks.slice(0, 1000);
  for (const [taskIndex, task] of tasks.entries()) {
    const numberRows = await sql<{ task_number: number }[]>`
      update public.projects set next_task_number = next_task_number + 1
      where id = ${projectId}::uuid
        and organization_id = ${context.membership.organizationId}::uuid
      returning next_task_number - 1 as task_number
    `;
    const taskNumber = numberRows[0]?.task_number;
    if (!taskNumber) throw new ProjectBlueprintError("Template task number could not be allocated.");
    const taskRows = await sql<{ id: string }[]>`
      insert into public.project_tasks (
        organization_id, project_id, task_number, title, description, status_id, priority,
        phase_id, milestone_id, start_date, due_date, reminder_at, estimated_minutes,
        created_by_membership_id, created_by
      ) values (
        ${context.membership.organizationId}::uuid, ${projectId}::uuid, ${taskNumber},
        ${task.title.slice(0, 240)}, ${task.description}, ${statusIds.get(task.statusSlug) ?? defaultStatusId}::uuid,
        ${task.priority}, ${task.phaseName ? (phaseIds.get(task.phaseName) ?? null) : null}::uuid,
        ${task.milestoneName ? (milestoneIds.get(task.milestoneName) ?? null) : null}::uuid,
        case when ${startDate}::date is null or ${task.startOffsetDays}::int is null then null else ${startDate}::date + ${task.startOffsetDays}::int end,
        case when ${startDate}::date is null or ${task.dueOffsetDays}::int is null then null else ${startDate}::date + ${task.dueOffsetDays}::int end,
        case when ${startDate}::date is null or ${task.dueOffsetDays}::int is null or ${task.reminderOffsetMinutes}::int is null then null
          else (${startDate}::date + ${task.dueOffsetDays}::int)::timestamp + make_interval(mins => ${task.reminderOffsetMinutes}::int) end,
        ${task.estimatedMinutes}, ${context.membership.id}::uuid, ${context.user.id}::uuid
      )
      returning id
    `;
    const taskId = taskRows[0]?.id;
    if (!taskId) throw new ProjectBlueprintError("Template task could not be created.");
    const taskKey = typeof task.key === "string" && task.key.trim() ? task.key.trim() : `legacy-task-${taskIndex}`;
    taskIds.set(taskKey, taskId);

    const taskLabelNames = Array.isArray(task.labels) ? task.labels : [];
    for (const labelName of taskLabelNames.slice(0, 50)) {
      if (typeof labelName !== "string") continue;
      const labelId = labelIds.get(blueprintLabelKey(labelName));
      if (!labelId) continue;
      await sql`
        insert into public.project_task_labels (task_id, label_id, created_by_membership_id)
        values (${taskId}::uuid, ${labelId}::uuid, ${context.membership.id}::uuid)
        on conflict do nothing
      `;
    }

    const checklist = (Array.isArray(task.checklist) ? task.checklist : [])
      .filter((item) => item && typeof item.label === "string" && item.label.trim())
      .slice(0, 100)
      .sort((left, right) => (left.position ?? 0) - (right.position ?? 0));
    for (const [itemIndex, item] of checklist.entries()) {
      await sql`
        insert into public.project_task_checklist_items (
          task_id, label, position, is_required, created_by_membership_id
        ) values (
          ${taskId}::uuid, ${item.label.trim().slice(0, 240)}, ${itemIndex + 1},
          ${item.isRequired !== false}, ${context.membership.id}::uuid
        )
      `;
    }

    const recurrence = task.recurrence;
    if (
      recurrence &&
      blueprintRecurrenceUnits.has(recurrence.intervalUnit) &&
      Number.isInteger(recurrence.intervalCount) &&
      recurrence.intervalCount >= 1 &&
      recurrence.intervalCount <= 365 &&
      Number.isInteger(recurrence.nextRunOffsetDays) &&
      (recurrence.endOffsetDays === null || Number.isInteger(recurrence.endOffsetDays))
    ) {
      const recurrenceRows = await sql<{ id: string }[]>`
        insert into public.project_task_recurrences (
          project_id, template_task_id, interval_unit, interval_count,
          next_run_on, end_on, is_active, created_by_membership_id
        ) values (
          ${projectId}::uuid, ${taskId}::uuid, ${recurrence.intervalUnit}, ${recurrence.intervalCount},
          coalesce(${startDate}::date, current_date) + ${recurrence.nextRunOffsetDays}::int,
          case when ${recurrence.endOffsetDays}::int is null then null
            else coalesce(${startDate}::date, current_date) + ${recurrence.endOffsetDays}::int end,
          true, ${context.membership.id}::uuid
        )
        returning id
      `;
      if (recurrenceRows[0]) {
        await sql`
          update public.project_tasks
          set recurrence_id = ${recurrenceRows[0].id}::uuid, updated_at = now()
          where id = ${taskId}::uuid
            and organization_id = ${context.membership.organizationId}::uuid
        `;
      }
    }
  }

  const dependencies = Array.isArray(blueprint.dependencies) ? blueprint.dependencies : [];
  for (const dependency of dependencies.slice(0, 2000)) {
    if (!dependency || !blueprintDependencyRelationships.has(dependency.relationship)) continue;
    const taskId = taskIds.get(dependency.taskKey);
    const relatedTaskId = taskIds.get(dependency.relatedTaskKey);
    if (!taskId || !relatedTaskId || taskId === relatedTaskId) continue;
    await sql`
      insert into public.project_task_dependencies (
        task_id, related_task_id, relationship, created_by_membership_id
      ) values (
        ${taskId}::uuid, ${relatedTaskId}::uuid, ${dependency.relationship},
        ${context.membership.id}::uuid
      )
      on conflict do nothing
    `;
  }
}
