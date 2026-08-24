import "server-only";

import { randomUUID } from "node:crypto";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { enqueueNotification } from "@/modules/notifications/server/notifications";

interface ReminderClaimRow {
  id: string;
  organization_id: string;
  project_id: string;
  task_number: number;
  title: string;
  reminder_at: Date;
  project_code: string;
  project_name: string;
  recipient_ids: string[];
}

export interface ProjectReminderWorkerResult {
  claimed: number;
  delivered: number;
  retried: number;
}

export async function runProjectReminderWorker(): Promise<ProjectReminderWorkerResult> {
  const database = getDatabaseClient();
  const claimToken = randomUUID();
  const rows = await database<ReminderClaimRow[]>`
    with due as (
      select task.id
      from public.project_tasks task
      join public.projects project on project.id = task.project_id
      join public.project_task_statuses status on status.id = task.status_id
      where task.reminder_at is not null
        and task.reminder_at <= now()
        and task.reminder_sent_at is null
        and (task.reminder_claimed_at is null or task.reminder_claimed_at < now() - interval '10 minutes')
        and not status.is_terminal
        and project.archived_at is null
        and project.closure_status <> 'closed'
      order by task.reminder_at, task.id
      for update of task skip locked
      limit 100
    ), claimed as (
      update public.project_tasks task
      set reminder_claimed_at = now(), reminder_claim_token = ${claimToken}::uuid
      from due
      where task.id = due.id
      returning task.*
    )
    select claimed.id, claimed.organization_id, claimed.project_id, claimed.task_number,
      claimed.title, claimed.reminder_at, project.code as project_code, project.name as project_name,
      coalesce((
        select array_agg(distinct recipient.membership_id)
        from (
          select assignee.membership_id
          from public.project_task_assignees assignee
          where assignee.task_id = claimed.id
          union
          select watcher.membership_id
          from public.project_task_watchers watcher
          where watcher.task_id = claimed.id
        ) recipient
        join public.memberships membership on membership.id = recipient.membership_id
        where membership.status = 'active'
          and membership.organization_id = claimed.organization_id
          and private.membership_has_permission(membership.id, 'notifications.notification.view')
          and private.membership_has_permission(membership.id, 'projects.task.view')
      ), array[]::uuid[]) as recipient_ids
    from claimed
    join public.projects project on project.id = claimed.project_id
  `;

  let delivered = 0;
  let retried = 0;
  for (const task of rows) {
    let failed = false;
    for (const membershipId of task.recipient_ids) {
      try {
        await enqueueNotification({
          organizationId: task.organization_id,
          recipientMembershipId: membershipId,
          category: "task_due",
          severity: "warning",
          title: `Task reminder: ${task.project_code}-${task.task_number}`,
          message: `${task.title} in ${task.project_name} needs your attention.`,
          deepLink: `/projects?project=${task.project_id}`,
          sourceModule: "projects",
          sourceEntityType: "project_task",
          sourceEntityId: task.id,
          dedupeKey: `project-task-reminder:${task.id}:${task.reminder_at.toISOString()}`,
          metadata: { projectId: task.project_id, reminderAt: task.reminder_at.toISOString() },
        });
      } catch {
        failed = true;
      }
    }
    if (failed) {
      retried += 1;
      await database`
        update public.project_tasks
        set reminder_claimed_at = null, reminder_claim_token = null
        where id = ${task.id}::uuid and reminder_claim_token = ${claimToken}::uuid
      `;
    } else {
      delivered += 1;
      await database`
        update public.project_tasks
        set reminder_sent_at = now(), reminder_claimed_at = null, reminder_claim_token = null
        where id = ${task.id}::uuid and reminder_claim_token = ${claimToken}::uuid
      `;
    }
  }
  return { claimed: rows.length, delivered, retried };
}
