import "server-only";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { enqueueNotification } from "@/modules/notifications/server/notifications";

const MAX_TIMER_ROWS = 40;
const MAX_REMINDERS = 3;

interface ExpiredStepRow {
  id: string;
  request_id: string;
  organization_id: string;
  requester_membership_id: string;
  request_title: string;
  request_deep_link: string | null;
}

interface EscalationStepRow {
  id: string;
  request_id: string;
  organization_id: string;
  approver_membership_id: string;
  requester_membership_id: string;
  request_title: string;
  request_deep_link: string | null;
  step_name: string;
  allow_self_approval: boolean;
  manager_membership_id: string | null;
}

interface ReminderStepRow {
  id: string;
  request_id: string;
  organization_id: string;
  approver_membership_id: string;
  request_title: string;
  request_deep_link: string | null;
  step_name: string;
  reminder_count: number;
}

export interface ApprovalWorkerSummary {
  expired: number;
  escalated: number;
  reminded: number;
  delegationsExpired: number;
}

export async function runApprovalTimerWorker(): Promise<ApprovalWorkerSummary> {
  const database = getDatabaseClient();
  const notifications: Array<Parameters<typeof enqueueNotification>[0]> = [];

  const summary = await database.begin(async (sql) => {
    const expiredDelegations = await sql<
      {
        id: string;
        organization_id: string;
        from_membership_id: string;
        to_membership_id: string;
        source_module: string | null;
      }[]
    >`
      with due as (
        select id
        from public.approval_delegations
        where status = 'active' and ends_at <= now()
        order by ends_at, id
        limit ${MAX_TIMER_ROWS}
        for update skip locked
      )
      update public.approval_delegations as delegation
      set status = 'expired'
      from due
      where delegation.id = due.id
      returning
        delegation.id,
        delegation.organization_id,
        delegation.from_membership_id,
        delegation.to_membership_id,
        delegation.source_module
    `;

    for (const delegation of expiredDelegations) {
      await sql`
        insert into public.audit_events (
          organization_id, actor_type, action, entity_type, entity_id,
          source, before_state, after_state, changed_fields, metadata
        ) values (
          ${delegation.organization_id}::uuid,
          'system',
          'approvals.delegation.expired',
          'approval_delegation',
          ${delegation.id},
          'approval_worker',
          ${sql.json({ status: "active" })},
          ${sql.json({ status: "expired" })},
          ${["status"]},
          ${sql.json({
            fromMembershipId: delegation.from_membership_id,
            toMembershipId: delegation.to_membership_id,
            sourceModule: delegation.source_module,
          })}
        )
      `;
    }

    const expiredSteps = await sql<ExpiredStepRow[]>`
      select
        step.id,
        step.request_id,
        step.organization_id,
        request.requester_membership_id,
        request.title as request_title,
        request.deep_link as request_deep_link
      from public.approval_request_steps as step
      join public.approval_requests as request on request.id = step.request_id
      join public.organizations as organization
        on organization.id = step.organization_id
       and organization.status = 'active'
      where step.status = 'pending'
        and step.due_at is not null
        and step.due_at <= now()
        and request.status = 'pending'
      order by step.due_at, step.id
      limit ${MAX_TIMER_ROWS}
      for update of request, step skip locked
    `;

    const expiredRequestIds = new Set<string>();
    for (const step of expiredSteps) {
      if (expiredRequestIds.has(step.request_id)) continue;
      expiredRequestIds.add(step.request_id);
      await sql`
        update public.approval_request_steps
        set status = case when id = ${step.id}::uuid then 'expired' else 'cancelled' end
        where request_id = ${step.request_id}::uuid
          and status in ('waiting', 'pending')
      `;
      await sql`
        update public.approval_requests
        set status = 'expired', current_stage = null, completed_at = now()
        where id = ${step.request_id}::uuid and status = 'pending'
      `;
      await sql`
        insert into public.approval_actions (
          organization_id, request_id, request_step_id, action, comment
        ) values (
          ${step.organization_id}::uuid,
          ${step.request_id}::uuid,
          ${step.id}::uuid,
          'expired',
          'The approval step reached its configured expiry time.'
        )
      `;
      await sql`
        insert into public.audit_events (
          organization_id, actor_type, action, entity_type, entity_id,
          source, after_state, changed_fields, metadata
        ) values (
          ${step.organization_id}::uuid,
          'system',
          'approvals.request.expired',
          'approval_request',
          ${step.request_id},
          'approval_worker',
          ${sql.json({ status: "expired" })},
          ${["status"]},
          ${sql.json({ requestStepId: step.id })}
        )
      `;
      notifications.push({
        organizationId: step.organization_id,
        recipientMembershipId: step.requester_membership_id,
        category: "approval_decision",
        severity: "warning",
        title: `Approval expired: ${step.request_title}`,
        message: "The approval request expired before all required decisions were completed.",
        deepLink: step.request_deep_link ?? `/approvals?view=submitted&q=${step.request_id}`,
        sourceModule: "approvals",
        sourceEntityType: "approval_request",
        sourceEntityId: step.request_id,
        dedupeKey: `approval:${step.request_id}:expired`,
      });
    }

    const escalations = await sql<EscalationStepRow[]>`
      select
        step.id,
        step.request_id,
        step.organization_id,
        step.approver_membership_id,
        request.requester_membership_id,
        request.title as request_title,
        request.deep_link as request_deep_link,
        step.step_name,
        definition.allow_self_approval,
        approver.manager_membership_id
      from public.approval_request_steps as step
      join public.approval_requests as request on request.id = step.request_id
      join public.approval_definitions as definition on definition.id = request.definition_id
      join public.memberships as approver
        on approver.id = step.approver_membership_id
       and approver.organization_id = step.organization_id
       and approver.status = 'active'
      join public.organizations as organization
        on organization.id = step.organization_id
       and organization.status = 'active'
      where step.status = 'pending'
        and private.membership_has_permission(
          step.approver_membership_id,
          'approvals.request.approve'
        )
        and step.escalation_at is not null
        and step.escalation_at <= now()
        and step.escalated_at is null
        and request.status = 'pending'
      order by step.escalation_at, step.id
      limit ${MAX_TIMER_ROWS}
      for update of request, step skip locked
    `;

    for (const step of escalations) {
      let targetMembershipId = step.approver_membership_id;
      if (step.manager_membership_id) {
        const managers = await sql<{ id: string }[]>`
          select id from public.memberships
          where id = ${step.manager_membership_id}::uuid
            and organization_id = ${step.organization_id}::uuid
            and status = 'active'
            and private.membership_has_permission(id, 'approvals.request.approve')
            and (${step.allow_self_approval}::boolean or id <> ${step.requester_membership_id}::uuid)
          limit 1
        `;
        if (managers[0]) targetMembershipId = managers[0].id;
      }

      await sql`
        update public.approval_request_steps
        set
          approver_membership_id = ${targetMembershipId}::uuid,
          delegated_from_membership_id = case
            when ${targetMembershipId}::uuid <> approver_membership_id then approver_membership_id
            else delegated_from_membership_id
          end,
          escalated_at = now(),
          reminder_at = case when reminder_count < ${MAX_REMINDERS} then now() + interval '24 hours' else null end
        where id = ${step.id}::uuid
      `;
      await sql`
        insert into public.approval_actions (
          organization_id, request_id, request_step_id, action, comment, metadata
        ) values (
          ${step.organization_id}::uuid,
          ${step.request_id}::uuid,
          ${step.id}::uuid,
          'escalated',
          'The approval step reached its configured escalation time.',
          ${sql.json({
            fromMembershipId: step.approver_membership_id,
            toMembershipId: targetMembershipId,
          })}
        )
      `;
      notifications.push({
        organizationId: step.organization_id,
        recipientMembershipId: targetMembershipId,
        category: "approval_requested",
        severity: "warning",
        title: `Escalated approval: ${step.request_title}`,
        message: `${step.step_name} requires attention after its escalation time.`,
        deepLink: step.request_deep_link ?? `/approvals?view=inbox&q=${step.request_id}`,
        sourceModule: "approvals",
        sourceEntityType: "approval_request",
        sourceEntityId: step.request_id,
        dedupeKey: `approval:${step.request_id}:step:${step.id}:escalated`,
      });
    }

    const reminders = await sql<ReminderStepRow[]>`
      select
        step.id,
        step.request_id,
        step.organization_id,
        step.approver_membership_id,
        request.title as request_title,
        request.deep_link as request_deep_link,
        step.step_name,
        step.reminder_count
      from public.approval_request_steps as step
      join public.approval_requests as request on request.id = step.request_id
      join public.memberships as approver
        on approver.id = step.approver_membership_id
       and approver.organization_id = step.organization_id
       and approver.status = 'active'
      join public.organizations as organization
        on organization.id = step.organization_id
       and organization.status = 'active'
      where step.status = 'pending'
        and private.membership_has_permission(
          step.approver_membership_id,
          'approvals.request.approve'
        )
        and step.reminder_at is not null
        and step.reminder_at <= now()
        and step.reminder_count < ${MAX_REMINDERS}
        and request.status = 'pending'
      order by step.reminder_at, step.id
      limit ${MAX_TIMER_ROWS}
      for update of request, step skip locked
    `;

    for (const step of reminders) {
      const nextCount = step.reminder_count + 1;
      await sql`
        update public.approval_request_steps
        set
          reminder_count = ${nextCount},
          last_reminded_at = now(),
          reminder_at = case
            when ${nextCount} < ${MAX_REMINDERS} then now() + interval '24 hours'
            else null
          end
        where id = ${step.id}::uuid
      `;
      await sql`
        insert into public.approval_actions (
          organization_id, request_id, request_step_id, action, comment, metadata
        ) values (
          ${step.organization_id}::uuid,
          ${step.request_id}::uuid,
          ${step.id}::uuid,
          'reminded',
          'A scheduled approval reminder was sent.',
          ${sql.json({ reminderNumber: nextCount })}
        )
      `;
      notifications.push({
        organizationId: step.organization_id,
        recipientMembershipId: step.approver_membership_id,
        category: "approval_requested",
        severity: "warning",
        title: `Approval reminder: ${step.request_title}`,
        message: `${step.step_name} is still waiting for your decision.`,
        deepLink: step.request_deep_link ?? `/approvals?view=inbox&q=${step.request_id}`,
        sourceModule: "approvals",
        sourceEntityType: "approval_request",
        sourceEntityId: step.request_id,
        dedupeKey: `approval:${step.request_id}:step:${step.id}:reminder:${nextCount}`,
      });
    }

    return {
      expired: expiredRequestIds.size,
      escalated: escalations.length,
      reminded: reminders.length,
      delegationsExpired: expiredDelegations.length,
    };
  });

  await Promise.allSettled(notifications.map((notification) => enqueueNotification(notification)));
  return summary;
}
