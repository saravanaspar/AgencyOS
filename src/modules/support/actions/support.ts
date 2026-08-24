"use server";

import { revalidatePath } from "next/cache";
import type { TransactionSql } from "postgres";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { toJsonValue } from "@/lib/server/json-value";
import { writeAuditEvent } from "@/modules/audit/server/write-audit-event";
import {
  requireDocumentAccess,
  requireDocumentEntityAccess,
} from "@/modules/documents/server/documents";
import { documentPermissionKeys } from "@/modules/documents/documents";
import { enqueueNotification } from "@/modules/notifications/server/notifications";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";
import {
  supportCategorySchema,
  supportRoutingRuleSchema,
  supportTicketCreateSchema,
  supportTicketDocumentSchema,
  supportTicketMessageSchema,
  supportTicketResolutionSchema,
  supportTicketSatisfactionSchema,
  supportTicketUpdateSchema,
  supportTicketWatcherSchema,
  type SupportActionState,
} from "@/modules/support/schemas/support";
import { SupportAccessError, requireSupportTicketAccess } from "@/modules/support/server/support";
import { supportPermissionKeys, supportTicketKey } from "@/modules/support/support";

const success = (message: string): SupportActionState => ({ status: "success", message });
const failure = (message: string, fieldErrors?: Record<string, string[]>): SupportActionState => ({
  status: "error",
  message,
  fieldErrors,
});
const value = (formData: FormData, key: string) => formData.get(key);
const refresh = () => revalidatePath("/support");
const isUniqueViolation = (error: unknown) =>
  Boolean(
    error && typeof error === "object" && "code" in error && Reflect.get(error, "code") === "23505",
  );

async function recordSupportEvent(
  sql: TransactionSql,
  input: {
    organizationId: string;
    ticketId: string;
    actorMembershipId: string;
    eventType: string;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await sql`
    insert into public.support_ticket_events (
      organization_id, ticket_id, event_type, actor_membership_id, details
    ) values (
      ${input.organizationId}::uuid, ${input.ticketId}::uuid, ${input.eventType},
      ${input.actorMembershipId}::uuid, ${sql.json(toJsonValue(input.details ?? {}))}
    )
  `;
}

export async function createSupportTicketAction(
  _previous: SupportActionState,
  formData: FormData,
): Promise<SupportActionState> {
  const parsed = supportTicketCreateSchema.safeParse({
    subject: value(formData, "subject"),
    description: value(formData, "description"),
    clientCompanyId: value(formData, "clientCompanyId"),
    contactId: value(formData, "contactId"),
    projectId: value(formData, "projectId"),
    categoryId: value(formData, "categoryId"),
    priority: value(formData, "priority"),
    dueAt: value(formData, "dueAt"),
  });
  if (!parsed.success)
    return failure("Check the ticket fields.", parsed.error.flatten().fieldErrors);
  const authorization = await authorizeCurrentUser([
    supportPermissionKeys.workspace,
    supportPermissionKeys.create,
  ]);
  if (!authorization.allowed) return failure("You cannot create support tickets.");
  const context = authorization.context;

  try {
    const created = await getDatabaseClient().begin(async (sql) => {
      if (parsed.data.clientCompanyId) {
        await requireDocumentEntityAccess(context, "client", parsed.data.clientCompanyId, sql);
      }
      if (parsed.data.contactId) {
        await requireDocumentEntityAccess(context, "contact", parsed.data.contactId, sql);
      }
      if (parsed.data.projectId) {
        await requireDocumentEntityAccess(context, "project", parsed.data.projectId, sql);
      }
      if (parsed.data.categoryId) {
        const category = await sql<Array<{ default_priority: string }>>`
          select default_priority from public.support_ticket_categories
          where id = ${parsed.data.categoryId}::uuid
            and organization_id = ${context.membership.organizationId}::uuid
            and status = 'active'
        `;
        if (!category[0]) throw new Error("category-invalid");
      }
      const numberRows = await sql<Array<{ ticket_number: string | number }>>`
        insert into public.support_ticket_counters (organization_id, next_number)
        values (${context.membership.organizationId}::uuid, 2)
        on conflict (organization_id) do update
          set next_number = public.support_ticket_counters.next_number + 1, updated_at = now()
        returning next_number - 1 as ticket_number
      `;
      const ticketNumber = Number(numberRows[0]?.ticket_number);
      if (!Number.isSafeInteger(ticketNumber) || ticketNumber <= 0)
        throw new Error("number-failed");
      const rows = await sql<Array<{ id: string; priority: string; triage_source: string }>>`
        insert into public.support_tickets (
          organization_id, ticket_number, subject, description, client_company_id,
          contact_id, project_id, category_id, priority, due_at,
          first_response_due_at, resolution_due_at, created_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${ticketNumber}, ${parsed.data.subject},
          ${parsed.data.description}, ${parsed.data.clientCompanyId}::uuid,
          ${parsed.data.contactId}::uuid, ${parsed.data.projectId}::uuid,
          ${parsed.data.categoryId}::uuid, ${parsed.data.priority}, ${parsed.data.dueAt}::timestamptz,
          now() + private.support_ticket_sla_minutes(${parsed.data.priority}, 'first_response') * interval '1 minute',
          now() + private.support_ticket_sla_minutes(${parsed.data.priority}, 'resolution') * interval '1 minute',
          ${context.membership.id}::uuid
        ) returning id, priority, triage_source
      `;
      const ticketId = rows[0]?.id;
      if (!ticketId) throw new Error("create-failed");
      await sql`
        insert into public.support_ticket_watchers (
          organization_id, ticket_id, membership_id, created_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${ticketId}::uuid,
          ${context.membership.id}::uuid, ${context.membership.id}::uuid
        ) on conflict do nothing
      `;
      await recordSupportEvent(sql, {
        organizationId: context.membership.organizationId,
        ticketId,
        actorMembershipId: context.membership.id,
        eventType: "support.ticket_created",
        details: {
          ticketNumber,
          priority: rows[0]?.priority,
          triageSource: rows[0]?.triage_source,
        },
      });
      await writeAuditEvent(sql, context, {
        action: "support.ticket.created",
        entityType: "support_ticket",
        entityId: ticketId,
        afterState: {
          ticketKey: supportTicketKey(ticketNumber),
          priority: rows[0]?.priority,
          triageSource: rows[0]?.triage_source,
          status: "new",
        },
        changedFields: ["ticket"],
      });
      return { ticketId, ticketNumber };
    });
    refresh();
    return success(`${supportTicketKey(created.ticketNumber)} created.`);
  } catch (error) {
    return failure(
      error instanceof SupportAccessError ? error.message : "Ticket could not be created.",
    );
  }
}

export async function updateSupportTicketAction(
  _previous: SupportActionState,
  formData: FormData,
): Promise<SupportActionState> {
  const parsed = supportTicketUpdateSchema.safeParse({
    ticketId: value(formData, "ticketId"),
    categoryId: value(formData, "categoryId"),
    priority: value(formData, "priority"),
    assignedAgentMembershipId: value(formData, "assignedAgentMembershipId"),
    assignedTeamId: value(formData, "assignedTeamId"),
    dueAt: value(formData, "dueAt"),
    status: value(formData, "status"),
  });
  if (!parsed.success)
    return failure("Check the triage fields.", parsed.error.flatten().fieldErrors);
  if (["resolved", "closed"].includes(parsed.data.status)) {
    return failure("Use the resolution controls for terminal ticket states.");
  }
  const authorization = await authorizeCurrentUser([supportPermissionKeys.workspace]);
  if (!authorization.allowed) return failure("You cannot update support tickets.");
  const context = authorization.context;

  let notifyMembershipId: string | null = null;
  let ticketLabel = "Ticket";
  try {
    await getDatabaseClient().begin(async (sql) => {
      const rows = await sql<
        Array<{
          ticket_number: string | number;
          status: string;
          priority: string;
          assigned_agent_membership_id: string | null;
          assigned_team_id: string | null;
          waiting_started_at: Date | null;
        }>
      >`
        select ticket_number, status, priority, assigned_agent_membership_id,
          assigned_team_id, waiting_started_at
        from public.support_tickets
        where id = ${parsed.data.ticketId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      const before = rows[0];
      if (!before) throw new SupportAccessError("Ticket was not found.");
      const assignmentChanged =
        before.assigned_agent_membership_id !== parsed.data.assignedAgentMembershipId ||
        before.assigned_team_id !== parsed.data.assignedTeamId;
      if (assignmentChanged) {
        await requireSupportTicketAccess(
          context,
          parsed.data.ticketId,
          supportPermissionKeys.assign,
          sql,
        );
      } else {
        await requireSupportTicketAccess(
          context,
          parsed.data.ticketId,
          supportPermissionKeys.update,
          sql,
        );
      }
      if (parsed.data.assignedAgentMembershipId) {
        const agents = await sql<Array<{ id: string }>>`
          select membership.id from public.memberships membership
          where membership.id = ${parsed.data.assignedAgentMembershipId}::uuid
            and membership.organization_id = ${context.membership.organizationId}::uuid
            and membership.status = 'active'
            and private.membership_has_permission(membership.id, ${supportPermissionKeys.view})
        `;
        if (!agents[0]) throw new Error("agent-invalid");
      }
      if (parsed.data.assignedTeamId) {
        const teams = await sql<Array<{ id: string }>>`
          select id from public.teams where id = ${parsed.data.assignedTeamId}::uuid
            and organization_id = ${context.membership.organizationId}::uuid and status = 'active'
        `;
        if (!teams[0]) throw new Error("team-invalid");
      }
      if (parsed.data.categoryId) {
        const categories = await sql<Array<{ id: string }>>`
          select id from public.support_ticket_categories
          where id = ${parsed.data.categoryId}::uuid
            and organization_id = ${context.membership.organizationId}::uuid and status = 'active'
        `;
        if (!categories[0]) throw new Error("category-invalid");
      }
      const leavingWaiting =
        before.status === "pending_customer" && parsed.data.status !== "pending_customer";
      const enteringWaiting =
        before.status !== "pending_customer" && parsed.data.status === "pending_customer";
      await sql`
        update public.support_tickets set
          category_id = ${parsed.data.categoryId}::uuid,
          priority = ${parsed.data.priority},
          assigned_agent_membership_id = ${parsed.data.assignedAgentMembershipId}::uuid,
          assigned_team_id = ${parsed.data.assignedTeamId}::uuid,
          due_at = ${parsed.data.dueAt}::timestamptz,
          status = ${parsed.data.status},
          waiting_total_seconds = waiting_total_seconds + case
            when ${leavingWaiting} and waiting_started_at is not null
              then extract(epoch from (now() - waiting_started_at))::bigint else 0 end,
          first_response_due_at = case
            when priority is distinct from ${parsed.data.priority}
              then created_at + private.support_ticket_sla_minutes(${parsed.data.priority}, 'first_response') * interval '1 minute'
                + waiting_total_seconds * interval '1 second'
            when ${leavingWaiting} and waiting_started_at is not null
              then first_response_due_at + (now() - waiting_started_at)
            else first_response_due_at end,
          resolution_due_at = case
            when priority is distinct from ${parsed.data.priority}
              then created_at + private.support_ticket_sla_minutes(${parsed.data.priority}, 'resolution') * interval '1 minute'
                + waiting_total_seconds * interval '1 second'
            when ${leavingWaiting} and waiting_started_at is not null
              then resolution_due_at + (now() - waiting_started_at)
            else resolution_due_at end,
          waiting_started_at = case when ${enteringWaiting} then now()
            when ${leavingWaiting} then null else waiting_started_at end,
          last_activity_at = now()
        where id = ${parsed.data.ticketId}::uuid
      `;
      ticketLabel = supportTicketKey(Number(before.ticket_number));
      notifyMembershipId = assignmentChanged ? parsed.data.assignedAgentMembershipId : null;
      await recordSupportEvent(sql, {
        organizationId: context.membership.organizationId,
        ticketId: parsed.data.ticketId,
        actorMembershipId: context.membership.id,
        eventType: assignmentChanged ? "support.ticket_assigned" : "support.ticket_updated",
        details: {
          status: parsed.data.status,
          priority: parsed.data.priority,
          assignedAgentMembershipId: parsed.data.assignedAgentMembershipId,
          assignedTeamId: parsed.data.assignedTeamId,
        },
      });
      await writeAuditEvent(sql, context, {
        action: assignmentChanged ? "support.ticket.assigned" : "support.ticket.updated",
        entityType: "support_ticket",
        entityId: parsed.data.ticketId,
        afterState: { status: parsed.data.status, priority: parsed.data.priority },
        changedFields: ["triage"],
      });
    });
    if (notifyMembershipId && notifyMembershipId !== context.membership.id) {
      await enqueueNotification({
        organizationId: context.membership.organizationId,
        recipientMembershipId: notifyMembershipId,
        category: "support_reply",
        severity: parsed.data.priority === "urgent" ? "error" : "info",
        title: `${ticketLabel} assigned to you`,
        message: "Open the Support workspace to review the ticket.",
        deepLink: "/support",
        sourceModule: "support",
        sourceEntityType: "ticket",
        sourceEntityId: parsed.data.ticketId,
        dedupeKey: `support-assigned:${parsed.data.ticketId}:${notifyMembershipId}`,
        createdByMembershipId: context.membership.id,
      });
    }
    refresh();
    return success("Ticket triage updated.");
  } catch (error) {
    return failure(
      error instanceof SupportAccessError ? error.message : "Ticket could not be updated.",
    );
  }
}

export async function addSupportTicketMessageAction(
  _previous: SupportActionState,
  formData: FormData,
): Promise<SupportActionState> {
  const parsed = supportTicketMessageSchema.safeParse({
    ticketId: value(formData, "ticketId"),
    messageType: value(formData, "messageType"),
    body: value(formData, "body"),
  });
  if (!parsed.success) return failure("Write a message.", parsed.error.flatten().fieldErrors);
  const permissionKey =
    parsed.data.messageType === "internal_note"
      ? supportPermissionKeys.internalNote
      : supportPermissionKeys.reply;
  const authorization = await authorizeCurrentUser([
    supportPermissionKeys.workspace,
    permissionKey,
  ]);
  if (!authorization.allowed) return failure("You cannot add this message.");
  const context = authorization.context;
  let notificationRecipients: string[] = [];
  let ticketKey = "Ticket";
  try {
    await getDatabaseClient().begin(async (sql) => {
      await requireSupportTicketAccess(context, parsed.data.ticketId, permissionKey, sql);
      const tickets = await sql<
        Array<{
          ticket_number: string | number;
          status: string;
          created_by_membership_id: string;
          assigned_agent_membership_id: string | null;
          waiting_started_at: Date | null;
        }>
      >`
        select ticket_number, status, created_by_membership_id, assigned_agent_membership_id,
          waiting_started_at
        from public.support_tickets
        where id = ${parsed.data.ticketId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      const ticket = tickets[0];
      if (!ticket) throw new SupportAccessError("Ticket was not found.");
      if (ticket.status === "closed") throw new Error("ticket-closed");
      await sql`
        insert into public.support_ticket_messages (
          organization_id, ticket_id, message_type, body, created_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${parsed.data.ticketId}::uuid,
          ${parsed.data.messageType}, ${parsed.data.body}, ${context.membership.id}::uuid
        )
      `;
      const publicReply = parsed.data.messageType === "public_reply";
      const leavingWaiting = publicReply && ticket.status === "pending_customer";
      const isAgentReply = publicReply && context.membership.id !== ticket.created_by_membership_id;
      await sql`
        update public.support_tickets set
          first_responded_at = case when ${isAgentReply} and first_responded_at is null then now() else first_responded_at end,
          status = case when ${publicReply} and status in ('new', 'pending_customer', 'pending_internal') then 'open' else status end,
          waiting_total_seconds = waiting_total_seconds + case
            when ${leavingWaiting} and waiting_started_at is not null
              then extract(epoch from (now() - waiting_started_at))::bigint else 0 end,
          first_response_due_at = case when ${leavingWaiting} and waiting_started_at is not null
            then first_response_due_at + (now() - waiting_started_at) else first_response_due_at end,
          resolution_due_at = case when ${leavingWaiting} and waiting_started_at is not null
            then resolution_due_at + (now() - waiting_started_at) else resolution_due_at end,
          waiting_started_at = case when ${leavingWaiting} then null else waiting_started_at end,
          last_activity_at = now()
        where id = ${parsed.data.ticketId}::uuid
      `;
      ticketKey = supportTicketKey(Number(ticket.ticket_number));
      const recipients = await sql<Array<{ membership_id: string }>>`
        select distinct membership_id from (
          select ${ticket.created_by_membership_id}::uuid as membership_id
          union all select ${ticket.assigned_agent_membership_id}::uuid
          union all select watcher.membership_id from public.support_ticket_watchers watcher
            where watcher.ticket_id = ${parsed.data.ticketId}::uuid
        ) recipients
        where membership_id is not null and membership_id <> ${context.membership.id}::uuid
      `;
      notificationRecipients = recipients.map((row) => row.membership_id);
      await recordSupportEvent(sql, {
        organizationId: context.membership.organizationId,
        ticketId: parsed.data.ticketId,
        actorMembershipId: context.membership.id,
        eventType:
          parsed.data.messageType === "internal_note"
            ? "support.internal_note_added"
            : "support.public_reply_added",
      });
      await writeAuditEvent(sql, context, {
        action:
          parsed.data.messageType === "internal_note"
            ? "support.ticket.internal_note_added"
            : "support.ticket.replied",
        entityType: "support_ticket",
        entityId: parsed.data.ticketId,
        changedFields: ["message"],
      });
    });
    if (parsed.data.messageType === "public_reply") {
      await Promise.allSettled(
        notificationRecipients.map((recipientMembershipId) =>
          enqueueNotification({
            organizationId: context.membership.organizationId,
            recipientMembershipId,
            category: "support_reply",
            severity: "info",
            title: `${ticketKey} has a new reply`,
            message: "Open the Support workspace to read the public reply.",
            deepLink: "/support",
            sourceModule: "support",
            sourceEntityType: "ticket",
            sourceEntityId: parsed.data.ticketId,
            dedupeKey: `support-reply:${parsed.data.ticketId}:${recipientMembershipId}`,
            createdByMembershipId: context.membership.id,
          }),
        ),
      );
    }
    refresh();
    return success(
      parsed.data.messageType === "internal_note" ? "Internal note added." : "Reply added.",
    );
  } catch (error) {
    return failure(
      error instanceof SupportAccessError ? error.message : "Message could not be added.",
    );
  }
}

export async function changeSupportTicketLifecycleAction(
  _previous: SupportActionState,
  formData: FormData,
): Promise<SupportActionState> {
  const parsed = supportTicketResolutionSchema.safeParse({
    ticketId: value(formData, "ticketId"),
    action: value(formData, "action"),
    resolutionSummary: value(formData, "resolutionSummary"),
  });
  if (!parsed.success)
    return failure("Check the lifecycle fields.", parsed.error.flatten().fieldErrors);
  if (parsed.data.action === "resolve" && !parsed.data.resolutionSummary) {
    return failure("Record a resolution before resolving the ticket.");
  }
  const permissionKey =
    parsed.data.action === "resolve"
      ? supportPermissionKeys.resolve
      : parsed.data.action === "close"
        ? supportPermissionKeys.close
        : supportPermissionKeys.reopen;
  const authorization = await authorizeCurrentUser([
    supportPermissionKeys.workspace,
    permissionKey,
  ]);
  if (!authorization.allowed) return failure("You cannot change this ticket state.");
  const context = authorization.context;
  try {
    await getDatabaseClient().begin(async (sql) => {
      await requireSupportTicketAccess(context, parsed.data.ticketId, permissionKey, sql);
      const rows = await sql<Array<{ status: string; created_by_membership_id: string }>>`
        select status, created_by_membership_id from public.support_tickets
        where id = ${parsed.data.ticketId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      const before = rows[0];
      if (!before) throw new SupportAccessError("Ticket was not found.");
      if (parsed.data.action === "resolve" && ["resolved", "closed"].includes(before.status)) {
        throw new Error("already-terminal");
      }
      if (parsed.data.action === "close" && before.status !== "resolved") {
        throw new Error("not-resolved");
      }
      if (
        parsed.data.action === "close" &&
        context.membership.id !== before.created_by_membership_id &&
        !context.permissions.has(supportPermissionKeys.resolve)
      ) {
        throw new SupportAccessError("Only the requester or Support team can close this ticket.");
      }
      if (parsed.data.action === "reopen" && !["resolved", "closed"].includes(before.status)) {
        throw new Error("not-terminal");
      }
      if (parsed.data.action === "resolve") {
        await sql`
          update public.support_tickets set status = 'resolved', resolved_at = now(), closed_at = null,
            resolution_summary = ${parsed.data.resolutionSummary},
            waiting_total_seconds = waiting_total_seconds + case
              when waiting_started_at is null then 0
              else greatest(0, extract(epoch from (now() - waiting_started_at))::bigint)
            end,
            waiting_started_at = null, last_activity_at = now()
          where id = ${parsed.data.ticketId}::uuid
        `;
      } else if (parsed.data.action === "close") {
        await sql`
          update public.support_tickets set status = 'closed', closed_at = now(), last_activity_at = now()
          where id = ${parsed.data.ticketId}::uuid
        `;
      } else {
        await sql`
          update public.support_tickets set status = 'open', closed_at = null,
            reopened_count = reopened_count + 1, last_activity_at = now()
          where id = ${parsed.data.ticketId}::uuid
        `;
      }
      const lifecyclePastTense = {
        resolve: "resolved",
        close: "closed",
        reopen: "reopened",
      } as const;
      await recordSupportEvent(sql, {
        organizationId: context.membership.organizationId,
        ticketId: parsed.data.ticketId,
        actorMembershipId: context.membership.id,
        eventType: `support.ticket_${lifecyclePastTense[parsed.data.action]}`,
        details: parsed.data.resolutionSummary
          ? { resolutionSummary: parsed.data.resolutionSummary }
          : undefined,
      });
      await writeAuditEvent(sql, context, {
        action: `support.ticket.${lifecyclePastTense[parsed.data.action]}`,
        entityType: "support_ticket",
        entityId: parsed.data.ticketId,
        afterState: { status: parsed.data.action === "reopen" ? "open" : `${parsed.data.action}d` },
        changedFields: ["status"],
      });
    });
    refresh();
    return success(
      `Ticket ${{ resolve: "resolved", close: "closed", reopen: "reopened" }[parsed.data.action]}.`,
    );
  } catch (error) {
    return failure(
      error instanceof SupportAccessError ? error.message : "Ticket state could not be changed.",
    );
  }
}

export async function updateSupportTicketWatcherAction(formData: FormData): Promise<void> {
  const parsed = supportTicketWatcherSchema.safeParse({
    ticketId: value(formData, "ticketId"),
    membershipId: value(formData, "membershipId"),
    operation: value(formData, "operation"),
  });
  const authorization = await authorizeCurrentUser([
    supportPermissionKeys.workspace,
    supportPermissionKeys.manageWatchers,
  ]);
  if (!parsed.success || !authorization.allowed) return;
  const context = authorization.context;
  await getDatabaseClient().begin(async (sql) => {
    await requireSupportTicketAccess(
      context,
      parsed.data.ticketId,
      supportPermissionKeys.manageWatchers,
      sql,
    );
    if (parsed.data.operation === "add") {
      await sql`
        insert into public.support_ticket_watchers (
          organization_id, ticket_id, membership_id, created_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${parsed.data.ticketId}::uuid,
          ${parsed.data.membershipId}::uuid, ${context.membership.id}::uuid
        ) on conflict do nothing
      `;
    } else {
      await sql`
        delete from public.support_ticket_watchers
        where ticket_id = ${parsed.data.ticketId}::uuid
          and membership_id = ${parsed.data.membershipId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
      `;
    }
    await recordSupportEvent(sql, {
      organizationId: context.membership.organizationId,
      ticketId: parsed.data.ticketId,
      actorMembershipId: context.membership.id,
      eventType: `support.watcher_${parsed.data.operation === "add" ? "added" : "removed"}`,
      details: { membershipId: parsed.data.membershipId },
    });
  });
  refresh();
}

export async function attachSupportTicketDocumentAction(
  _previous: SupportActionState,
  formData: FormData,
): Promise<SupportActionState> {
  const parsed = supportTicketDocumentSchema.safeParse({
    ticketId: value(formData, "ticketId"),
    documentId: value(formData, "documentId"),
  });
  if (!parsed.success) return failure("Choose a document.", parsed.error.flatten().fieldErrors);
  const authorization = await authorizeCurrentUser([
    supportPermissionKeys.workspace,
    supportPermissionKeys.reply,
    documentPermissionKeys.workspace,
    documentPermissionKeys.update,
  ]);
  if (!authorization.allowed) return failure("You cannot attach documents to this ticket.");
  const context = authorization.context;
  try {
    await getDatabaseClient().begin(async (sql) => {
      await requireSupportTicketAccess(
        context,
        parsed.data.ticketId,
        supportPermissionKeys.reply,
        sql,
      );
      await requireDocumentAccess(context, parsed.data.documentId, "edit", sql);
      await sql`
        insert into public.document_entity_links (
          organization_id, document_id, entity_type, entity_id, created_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${parsed.data.documentId}::uuid,
          'ticket', ${parsed.data.ticketId}::uuid, ${context.membership.id}::uuid
        ) on conflict do nothing
      `;
      await recordSupportEvent(sql, {
        organizationId: context.membership.organizationId,
        ticketId: parsed.data.ticketId,
        actorMembershipId: context.membership.id,
        eventType: "support.document_attached",
        details: { documentId: parsed.data.documentId },
      });
    });
    refresh();
    return success("Document linked to ticket.");
  } catch (error) {
    return failure(
      error instanceof SupportAccessError ? error.message : "Document could not be linked.",
    );
  }
}

export async function submitSupportTicketSatisfactionAction(
  _previous: SupportActionState,
  formData: FormData,
): Promise<SupportActionState> {
  const parsed = supportTicketSatisfactionSchema.safeParse({
    ticketId: value(formData, "ticketId"),
    score: value(formData, "score"),
    comment: value(formData, "comment"),
  });
  if (!parsed.success)
    return failure("Check the satisfaction response.", parsed.error.flatten().fieldErrors);
  const authorization = await authorizeCurrentUser([
    supportPermissionKeys.workspace,
    supportPermissionKeys.view,
  ]);
  if (!authorization.allowed) return failure("You cannot rate this ticket.");
  const context = authorization.context;
  try {
    await getDatabaseClient().begin(async (sql) => {
      const rows = await sql<Array<{ created_by_membership_id: string; status: string }>>`
        select created_by_membership_id, status from public.support_tickets
        where id = ${parsed.data.ticketId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      if (!rows[0] || rows[0].created_by_membership_id !== context.membership.id) {
        throw new SupportAccessError("Only the ticket requester can submit satisfaction.");
      }
      if (!["resolved", "closed"].includes(rows[0].status)) throw new Error("ticket-not-complete");
      await sql`
        update public.support_tickets set satisfaction_score = ${parsed.data.score},
          satisfaction_comment = ${parsed.data.comment}, last_activity_at = now()
        where id = ${parsed.data.ticketId}::uuid
      `;
      await recordSupportEvent(sql, {
        organizationId: context.membership.organizationId,
        ticketId: parsed.data.ticketId,
        actorMembershipId: context.membership.id,
        eventType: "support.satisfaction_recorded",
        details: { score: parsed.data.score },
      });
      await writeAuditEvent(sql, context, {
        action: "support.ticket.satisfaction_recorded",
        entityType: "support_ticket",
        entityId: parsed.data.ticketId,
        afterState: { score: parsed.data.score },
        changedFields: ["satisfactionScore"],
      });
    });
    refresh();
    return success("Satisfaction recorded.");
  } catch (error) {
    return failure(
      error instanceof SupportAccessError ? error.message : "Satisfaction could not be recorded.",
    );
  }
}

export async function createSupportCategoryAction(
  _previous: SupportActionState,
  formData: FormData,
): Promise<SupportActionState> {
  const parsed = supportCategorySchema.safeParse({
    name: value(formData, "name"),
    description: value(formData, "description"),
    defaultPriority: value(formData, "defaultPriority"),
  });
  if (!parsed.success)
    return failure("Check the category fields.", parsed.error.flatten().fieldErrors);
  const authorization = await authorizeCurrentUser([
    supportPermissionKeys.workspace,
    supportPermissionKeys.manageCategories,
  ]);
  if (!authorization.allowed) return failure("You cannot manage support categories.");
  const context = authorization.context;
  try {
    await getDatabaseClient().begin(async (sql) => {
      const rows = await sql<Array<{ id: string }>>`
        insert into public.support_ticket_categories (
          organization_id, name, description, default_priority, created_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${parsed.data.name}, ${parsed.data.description},
          ${parsed.data.defaultPriority}, ${context.membership.id}::uuid
        ) returning id
      `;
      await writeAuditEvent(sql, context, {
        action: "support.category.created",
        entityType: "support_ticket_category",
        entityId: rows[0]?.id ?? null,
        afterState: { name: parsed.data.name, defaultPriority: parsed.data.defaultPriority },
        changedFields: ["category"],
      });
    });
    refresh();
    return success("Support category created.");
  } catch (error) {
    return failure(
      isUniqueViolation(error)
        ? "A category with this name already exists."
        : "Category could not be created.",
    );
  }
}

export async function createSupportRoutingRuleAction(
  _previous: SupportActionState,
  formData: FormData,
): Promise<SupportActionState> {
  const parsed = supportRoutingRuleSchema.safeParse({
    name: value(formData, "name"),
    position: value(formData, "position"),
    keywords: value(formData, "keywords"),
    categoryId: value(formData, "categoryId"),
    priority: value(formData, "priority"),
  });
  if (!parsed.success)
    return failure("Check the routing-rule fields.", parsed.error.flatten().fieldErrors);
  const authorization = await authorizeCurrentUser([
    supportPermissionKeys.workspace,
    supportPermissionKeys.manageRoutingRules,
  ]);
  if (!authorization.allowed) return failure("You cannot manage Support routing rules.");
  const context = authorization.context;
  try {
    await getDatabaseClient().begin(async (sql) => {
      const categories = await sql<Array<{ id: string }>>`
        select id from public.support_ticket_categories
        where id = ${parsed.data.categoryId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
          and status = 'active'
      `;
      if (!categories[0]) throw new Error("category-invalid");
      const rows = await sql<Array<{ id: string }>>`
        insert into public.support_ticket_routing_rules (
          organization_id, name, position, keywords, category_id, priority,
          created_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${parsed.data.name},
          ${parsed.data.position}, ${parsed.data.keywords}::text[],
          ${parsed.data.categoryId}::uuid, ${parsed.data.priority},
          ${context.membership.id}::uuid
        ) returning id
      `;
      await writeAuditEvent(sql, context, {
        action: "support.routing_rule.created",
        entityType: "support_routing_rule",
        entityId: rows[0]?.id ?? null,
        afterState: {
          name: parsed.data.name,
          position: parsed.data.position,
          keywordCount: parsed.data.keywords.length,
          categoryId: parsed.data.categoryId,
          priority: parsed.data.priority,
        },
        changedFields: ["routing_rule"],
      });
    });
    refresh();
    return success("Support routing rule created.");
  } catch (error) {
    return failure(
      isUniqueViolation(error)
        ? "A routing rule with this name already exists."
        : error instanceof Error && error.message === "category-invalid"
          ? "Choose an active Support category."
          : "Routing rule could not be created.",
    );
  }
}
