import "server-only";

import type { TransactionSql } from "postgres";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { crmPermissionKeys } from "@/modules/crm/crm";
import { documentPermissionKeys } from "@/modules/documents/documents";
import type { AuthorizationFailureReason } from "@/modules/permissions/server/authorization";
import {
  getCurrentPermissionContext,
  type CurrentPermissionContext,
} from "@/modules/permissions/server/effective-permissions";
import { projectPermissionKeys } from "@/modules/projects/projects";
import {
  supportPermissionKeys,
  supportSlaState,
  supportTicketKey,
  supportTicketPriorityLabels,
  supportTicketStatusLabels,
  type SupportMessageType,
  type SupportTicketPriority,
  type SupportTicketStatus,
  type SupportTriageSource,
} from "@/modules/support/support";

export interface SupportTicketSummary {
  id: string;
  ticketNumber: number;
  ticketKey: string;
  subject: string;
  description: string;
  clientCompanyId: string | null;
  clientName: string | null;
  contactId: string | null;
  contactName: string | null;
  projectId: string | null;
  projectName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  triageSource: SupportTriageSource;
  triageRuleName: string | null;
  triagedAt: string | null;
  triageExplanation: string | null;
  priority: SupportTicketPriority;
  priorityLabel: string;
  status: SupportTicketStatus;
  statusLabel: string;
  assignedAgentMembershipId: string | null;
  assignedAgentName: string | null;
  assignedTeamId: string | null;
  assignedTeamName: string | null;
  creatorMembershipId: string;
  creatorName: string;
  dueAt: string | null;
  firstResponseDueAt: string;
  resolutionDueAt: string;
  firstRespondedAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  waitingTotalSeconds: number;
  resolutionSummary: string | null;
  satisfactionScore: number | null;
  satisfactionComment: string | null;
  reopenedCount: number;
  lastActivityAt: string;
  slaState: ReturnType<typeof supportSlaState>;
  messages: Array<{
    id: string;
    messageType: SupportMessageType;
    body: string;
    authorName: string;
    createdAt: string;
  }>;
  watchers: Array<{ membershipId: string; name: string }>;
  documents: Array<{
    id: string;
    title: string;
    currentVersionId: string | null;
    canOpen: boolean;
  }>;
  events: Array<{ id: string; eventType: string; actorName: string | null; createdAt: string }>;
  canUpdate: boolean;
  canAssign: boolean;
  canReply: boolean;
  canInternalNote: boolean;
  canManageWatchers: boolean;
  canResolve: boolean;
  canClose: boolean;
  canReopen: boolean;
  canRate: boolean;
}

export interface SupportWorkspaceData {
  tickets: SupportTicketSummary[];
  routingRules: Array<{
    id: string;
    name: string;
    position: number;
    keywords: string[];
    categoryId: string;
    categoryName: string;
    priority: SupportTicketPriority;
    status: "active" | "inactive";
  }>;
  categories: Array<{
    id: string;
    name: string;
    description: string | null;
    defaultPriority: SupportTicketPriority;
    status: "active" | "inactive";
  }>;
  members: Array<{ id: string; name: string }>;
  teams: Array<{ id: string; name: string }>;
  companies: Array<{ id: string; name: string }>;
  contacts: Array<{ id: string; companyId: string | null; name: string }>;
  projects: Array<{ id: string; companyId: string | null; name: string }>;
  documents: Array<{ id: string; title: string }>;
  summary: {
    total: number;
    open: number;
    waiting: number;
    breached: number;
    resolved: number;
    unassigned: number;
  };
  capabilities: {
    canCreate: boolean;
    canAssign: boolean;
    canManageCategories: boolean;
    canManageRoutingRules: boolean;
  };
}

export type SupportWorkspaceResult =
  | { allowed: true; data: SupportWorkspaceData }
  | { allowed: false; reason: AuthorizationFailureReason };

export class SupportAccessError extends Error {}

export async function requireSupportTicketAccess(
  context: CurrentPermissionContext,
  ticketId: string,
  permissionKey: string,
  sql: TransactionSql,
): Promise<void> {
  const rows = await sql<Array<{ allowed: boolean }>>`
    select private.support_ticket_membership_access_allowed(
      ${ticketId}::uuid, ${context.membership.id}::uuid, ${permissionKey}
    ) as allowed
  `;
  if (!rows[0]?.allowed) throw new SupportAccessError("Ticket is outside your permission scope.");
}

type TicketRow = {
  id: string;
  ticket_number: string | number;
  subject: string;
  description: string;
  client_company_id: string | null;
  client_name: string | null;
  contact_id: string | null;
  contact_name: string | null;
  project_id: string | null;
  project_name: string | null;
  category_id: string | null;
  category_name: string | null;
  triage_source: SupportTriageSource;
  triage_rule_name: string | null;
  triaged_at: string | null;
  triage_explanation: string | null;
  priority: SupportTicketPriority;
  status: SupportTicketStatus;
  assigned_agent_membership_id: string | null;
  assigned_agent_name: string | null;
  assigned_team_id: string | null;
  assigned_team_name: string | null;
  created_by_membership_id: string;
  creator_name: string;
  due_at: string | null;
  first_response_due_at: string;
  resolution_due_at: string;
  first_responded_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  waiting_total_seconds: string | number;
  resolution_summary: string | null;
  satisfaction_score: number | null;
  satisfaction_comment: string | null;
  reopened_count: number;
  last_activity_at: string;
  can_update: boolean;
  can_assign: boolean;
  can_reply: boolean;
  can_internal_note: boolean;
  can_manage_watchers: boolean;
  can_resolve: boolean;
  can_close: boolean;
  can_reopen: boolean;
};

type MessageRow = {
  id: string;
  ticket_id: string;
  message_type: SupportMessageType;
  body: string;
  author_name: string;
  created_at: string;
};
type WatcherRow = { ticket_id: string; membership_id: string; name: string };
type DocumentRow = {
  ticket_id: string;
  id: string;
  title: string;
  current_version_id: string | null;
  can_open: boolean;
};
type EventRow = {
  id: string;
  ticket_id: string;
  event_type: string;
  actor_name: string | null;
  created_at: string;
};

function groupByTicket<T extends { ticket_id: string }>(rows: T[]): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const row of rows) {
    const values = result.get(row.ticket_id) ?? [];
    values.push(row);
    result.set(row.ticket_id, values);
  }
  return result;
}

export async function getSupportWorkspaceData(filters?: {
  query?: string;
  status?: string;
  priority?: string;
}): Promise<SupportWorkspaceResult> {
  const permissionResult = await getCurrentPermissionContext();
  if (!permissionResult.allowed) return permissionResult;
  const context = permissionResult.context;
  if (
    !context.permissions.has(supportPermissionKeys.workspace) ||
    !context.permissions.has(supportPermissionKeys.view)
  ) {
    return { allowed: false, reason: "insufficient-permission" };
  }

  const database = getDatabaseClient();
  const organizationId = context.membership.organizationId;
  const membershipId = context.membership.id;
  const query = filters?.query?.trim() ?? "";
  const search = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const status = filters?.status ?? "all";
  const priority = filters?.priority ?? "all";
  const hasInternalNotes = context.permissions.has(supportPermissionKeys.internalNote);

  const ticketRows = await database<TicketRow[]>`
    select ticket.id, ticket.ticket_number, ticket.subject, ticket.description,
      ticket.client_company_id, company.display_name as client_name,
      ticket.contact_id, concat_ws(' ', contact.first_name, contact.last_name) as contact_name,
      ticket.project_id, case when project.id is null then null else concat(project.code, ' — ', project.name) end as project_name,
      ticket.category_id, category.name as category_name, ticket.triage_source,
      routing_rule.name as triage_rule_name, ticket.triaged_at::text, ticket.triage_explanation,
      ticket.priority, ticket.status,
      ticket.assigned_agent_membership_id,
      case when ticket.assigned_agent_membership_id is null then null
        else private.membership_display_name(ticket.assigned_agent_membership_id) end as assigned_agent_name,
      ticket.assigned_team_id, team.name as assigned_team_name,
      ticket.created_by_membership_id,
      private.membership_display_name(ticket.created_by_membership_id) as creator_name,
      ticket.due_at::text, ticket.first_response_due_at::text, ticket.resolution_due_at::text,
      ticket.first_responded_at::text, ticket.resolved_at::text, ticket.closed_at::text,
      ticket.waiting_total_seconds, ticket.resolution_summary, ticket.satisfaction_score,
      ticket.satisfaction_comment, ticket.reopened_count, ticket.last_activity_at::text,
      private.support_ticket_membership_access_allowed(ticket.id, ${membershipId}::uuid, ${supportPermissionKeys.update}) as can_update,
      private.support_ticket_membership_access_allowed(ticket.id, ${membershipId}::uuid, ${supportPermissionKeys.assign}) as can_assign,
      private.support_ticket_membership_access_allowed(ticket.id, ${membershipId}::uuid, ${supportPermissionKeys.reply}) as can_reply,
      private.support_ticket_membership_access_allowed(ticket.id, ${membershipId}::uuid, ${supportPermissionKeys.internalNote}) as can_internal_note,
      private.support_ticket_membership_access_allowed(ticket.id, ${membershipId}::uuid, ${supportPermissionKeys.manageWatchers}) as can_manage_watchers,
      private.support_ticket_membership_access_allowed(ticket.id, ${membershipId}::uuid, ${supportPermissionKeys.resolve}) as can_resolve,
      private.support_ticket_membership_access_allowed(ticket.id, ${membershipId}::uuid, ${supportPermissionKeys.close}) as can_close,
      private.support_ticket_membership_access_allowed(ticket.id, ${membershipId}::uuid, ${supportPermissionKeys.reopen}) as can_reopen
    from public.support_tickets ticket
    left join public.crm_companies company on company.id = ticket.client_company_id
    left join public.crm_contacts contact on contact.id = ticket.contact_id
    left join public.projects project on project.id = ticket.project_id
    left join public.support_ticket_categories category on category.id = ticket.category_id
    left join public.support_ticket_routing_rules routing_rule on routing_rule.id = ticket.triage_rule_id
    left join public.teams team on team.id = ticket.assigned_team_id
    where ticket.organization_id = ${organizationId}::uuid
      and private.support_ticket_membership_access_allowed(
        ticket.id, ${membershipId}::uuid, ${supportPermissionKeys.view}
      )
      and (${status} = 'all' or ticket.status = ${status})
      and (${priority} = 'all' or ticket.priority = ${priority})
      and (${query} = '' or ticket.subject ilike ${search} escape '\\'
        or ticket.description ilike ${search} escape '\\'
        or coalesce(company.display_name, '') ilike ${search} escape '\\'
        or concat('SUP-', lpad(ticket.ticket_number::text, 6, '0')) ilike ${search} escape '\\')
    order by case ticket.priority when 'urgent' then 4 when 'high' then 3 when 'normal' then 2 else 1 end desc,
      ticket.last_activity_at desc, ticket.id desc
    limit 200
  `;
  const ticketIds = ticketRows.map((ticket) => ticket.id);

  const [
    messageRows,
    watcherRows,
    documentRows,
    eventRows,
    categoryRows,
    memberRows,
    teamRows,
    routingRows,
  ] = await Promise.all([
    ticketIds.length
      ? database<MessageRow[]>`
            select message.id, message.ticket_id, message.message_type, message.body,
              private.membership_display_name(message.created_by_membership_id) as author_name,
              message.created_at::text
            from public.support_ticket_messages message
            where message.ticket_id = any(${ticketIds}::uuid[])
              and (${hasInternalNotes} or message.message_type = 'public_reply')
            order by message.created_at, message.id
          `
      : Promise.resolve([]),
    ticketIds.length
      ? database<WatcherRow[]>`
            select watcher.ticket_id, watcher.membership_id,
              private.membership_display_name(watcher.membership_id) as name
            from public.support_ticket_watchers watcher
            where watcher.ticket_id = any(${ticketIds}::uuid[])
            order by name
          `
      : Promise.resolve([]),
    ticketIds.length
      ? database<DocumentRow[]>`
            select link.entity_id as ticket_id, document.id, document.title,
              document.current_version_id,
              private.document_membership_access_allowed(
                document.id, ${membershipId}::uuid, 'download'
              ) as can_open
            from public.document_entity_links link
            join public.documents document on document.id = link.document_id
            where link.organization_id = ${organizationId}::uuid
              and link.entity_type = 'ticket' and link.entity_id = any(${ticketIds}::uuid[])
              and private.document_membership_access_allowed(
                document.id, ${membershipId}::uuid, 'view'
              )
            order by document.title
          `
      : Promise.resolve([]),
    ticketIds.length
      ? database<EventRow[]>`
            select event.id, event.ticket_id, event.event_type,
              case when event.actor_membership_id is null then null
                else private.membership_display_name(event.actor_membership_id) end as actor_name,
              event.created_at::text
            from public.support_ticket_events event
            where event.ticket_id = any(${ticketIds}::uuid[])
            order by event.created_at desc, event.id desc
          `
      : Promise.resolve([]),
    database<
      Array<{
        id: string;
        name: string;
        description: string | null;
        default_priority: SupportTicketPriority;
        status: "active" | "inactive";
      }>
    >`
        select id, name, description, default_priority, status
        from public.support_ticket_categories
        where organization_id = ${organizationId}::uuid
        order by status, name
      `,
    context.permissions.has(supportPermissionKeys.assign) ||
    context.permissions.has(supportPermissionKeys.manageWatchers)
      ? database<Array<{ id: string; name: string }>>`
            select membership.id, private.membership_display_name(membership.id) as name
            from public.memberships membership
            where membership.organization_id = ${organizationId}::uuid
              and membership.status = 'active'
              and private.membership_has_permission(membership.id, ${supportPermissionKeys.view})
            order by name
          `
      : Promise.resolve([]),
    context.permissions.has(supportPermissionKeys.assign)
      ? database<Array<{ id: string; name: string }>>`
            select id, name from public.teams
            where organization_id = ${organizationId}::uuid and status = 'active'
            order by name
          `
      : Promise.resolve([]),
    database<
      Array<{
        id: string;
        name: string;
        position: number;
        keywords: string[];
        category_id: string;
        category_name: string;
        priority: SupportTicketPriority;
        status: "active" | "inactive";
      }>
    >`
        select rule.id, rule.name, rule.position, rule.keywords, rule.category_id,
          category.name as category_name, rule.priority, rule.status
        from public.support_ticket_routing_rules rule
        join public.support_ticket_categories category on category.id = rule.category_id
        where rule.organization_id = ${organizationId}::uuid
        order by rule.status, rule.position, rule.name
      `,
  ]);

  const [companies, contacts, projects, documents] = await Promise.all([
    context.permissions.has(crmPermissionKeys.companyView)
      ? database<Array<{ id: string; name: string }>>`
        select company.id, company.display_name as name
        from public.crm_companies company
        where company.organization_id = ${organizationId}::uuid
          and private.crm_scope_allows_membership(
            ${membershipId}::uuid,
            ${context.permissionScopes.get(crmPermissionKeys.companyView) ?? "own"},
            company.account_owner_membership_id, company.created_by_membership_id
          )
        order by company.display_name limit 500
      `
      : Promise.resolve([]),
    context.permissions.has(crmPermissionKeys.contactView)
      ? database<Array<{ id: string; companyId: string | null; name: string }>>`
        select contact.id, contact.company_id as "companyId",
          concat_ws(' ', contact.first_name, contact.last_name) as name
        from public.crm_contacts contact
        where contact.organization_id = ${organizationId}::uuid
          and private.crm_scope_allows_membership(
            ${membershipId}::uuid,
            ${context.permissionScopes.get(crmPermissionKeys.contactView) ?? "own"},
            contact.owner_membership_id, contact.created_by_membership_id
          )
        order by name limit 1000
      `
      : Promise.resolve([]),
    context.permissions.has(projectPermissionKeys.projectView)
      ? database<Array<{ id: string; companyId: string | null; name: string }>>`
        select project.id, project.crm_company_id as "companyId",
          concat(project.code, ' — ', project.name) as name
        from public.projects project
        where project.organization_id = ${organizationId}::uuid
          and private.project_is_visible(
            project.id, ${membershipId}::uuid,
            ${context.permissionScopes.get(projectPermissionKeys.projectView) ?? "own"}
          )
        order by project.updated_at desc limit 500
      `
      : Promise.resolve([]),
    context.permissions.has(documentPermissionKeys.update)
      ? database<Array<{ id: string; title: string }>>`
        select document.id, document.title
        from public.documents document
        where document.organization_id = ${organizationId}::uuid
          and document.status = 'active'
          and private.document_membership_access_allowed(
            document.id, ${membershipId}::uuid, 'edit'
          )
        order by document.updated_at desc limit 500
      `
      : Promise.resolve([]),
  ]);

  const messages = groupByTicket(messageRows);
  const watchers = groupByTicket(watcherRows);
  const linkedDocuments = groupByTicket(documentRows);
  const events = groupByTicket(eventRows);
  const tickets: SupportTicketSummary[] = ticketRows.map((ticket) => {
    const ticketNumber = Number(ticket.ticket_number);
    return {
      id: ticket.id,
      ticketNumber,
      ticketKey: supportTicketKey(ticketNumber),
      subject: ticket.subject,
      description: ticket.description,
      clientCompanyId: ticket.client_company_id,
      clientName: ticket.client_name,
      contactId: ticket.contact_id,
      contactName: ticket.contact_name,
      projectId: ticket.project_id,
      projectName: ticket.project_name,
      categoryId: ticket.category_id,
      categoryName: ticket.category_name,
      triageSource: ticket.triage_source,
      triageRuleName: ticket.triage_rule_name,
      triagedAt: ticket.triaged_at,
      triageExplanation: ticket.triage_explanation,
      priority: ticket.priority,
      priorityLabel: supportTicketPriorityLabels[ticket.priority],
      status: ticket.status,
      statusLabel: supportTicketStatusLabels[ticket.status],
      assignedAgentMembershipId: ticket.assigned_agent_membership_id,
      assignedAgentName: ticket.assigned_agent_name,
      assignedTeamId: ticket.assigned_team_id,
      assignedTeamName: ticket.assigned_team_name,
      creatorMembershipId: ticket.created_by_membership_id,
      creatorName: ticket.creator_name,
      dueAt: ticket.due_at,
      firstResponseDueAt: ticket.first_response_due_at,
      resolutionDueAt: ticket.resolution_due_at,
      firstRespondedAt: ticket.first_responded_at,
      resolvedAt: ticket.resolved_at,
      closedAt: ticket.closed_at,
      waitingTotalSeconds: Number(ticket.waiting_total_seconds),
      resolutionSummary: ticket.resolution_summary,
      satisfactionScore: ticket.satisfaction_score,
      satisfactionComment: ticket.satisfaction_comment,
      reopenedCount: ticket.reopened_count,
      lastActivityAt: ticket.last_activity_at,
      slaState: supportSlaState({
        status: ticket.status,
        firstRespondedAt: ticket.first_responded_at,
        firstResponseDueAt: ticket.first_response_due_at,
        resolutionDueAt: ticket.resolution_due_at,
      }),
      messages: (messages.get(ticket.id) ?? []).map((message) => ({
        id: message.id,
        messageType: message.message_type,
        body: message.body,
        authorName: message.author_name,
        createdAt: message.created_at,
      })),
      watchers: (watchers.get(ticket.id) ?? []).map((watcher) => ({
        membershipId: watcher.membership_id,
        name: watcher.name,
      })),
      documents: (linkedDocuments.get(ticket.id) ?? []).map((document) => ({
        id: document.id,
        title: document.title,
        currentVersionId: document.current_version_id,
        canOpen: document.can_open,
      })),
      events: (events.get(ticket.id) ?? []).slice(0, 30).map((event) => ({
        id: event.id,
        eventType: event.event_type,
        actorName: event.actor_name,
        createdAt: event.created_at,
      })),
      canUpdate: ticket.can_update,
      canAssign: ticket.can_assign,
      canReply: ticket.can_reply,
      canInternalNote: ticket.can_internal_note,
      canManageWatchers: ticket.can_manage_watchers,
      canResolve: ticket.can_resolve,
      canClose: ticket.can_close,
      canReopen: ticket.can_reopen,
      canRate:
        ticket.created_by_membership_id === membershipId &&
        ["resolved", "closed"].includes(ticket.status) &&
        ticket.satisfaction_score === null,
    };
  });

  const breachedStates = new Set(["first_response_breached", "resolution_breached"]);
  return {
    allowed: true,
    data: {
      tickets,
      routingRules: routingRows.map((rule) => ({
        id: rule.id,
        name: rule.name,
        position: rule.position,
        keywords: rule.keywords,
        categoryId: rule.category_id,
        categoryName: rule.category_name,
        priority: rule.priority,
        status: rule.status,
      })),
      categories: categoryRows.map((category) => ({
        id: category.id,
        name: category.name,
        description: category.description,
        defaultPriority: category.default_priority,
        status: category.status,
      })),
      members: memberRows,
      teams: teamRows,
      companies,
      contacts,
      projects,
      documents,
      summary: {
        total: tickets.length,
        open: tickets.filter((ticket) =>
          ["new", "open", "pending_internal"].includes(ticket.status),
        ).length,
        waiting: tickets.filter((ticket) => ticket.status === "pending_customer").length,
        breached: tickets.filter((ticket) => breachedStates.has(ticket.slaState)).length,
        resolved: tickets.filter((ticket) => ["resolved", "closed"].includes(ticket.status)).length,
        unassigned: tickets.filter(
          (ticket) =>
            !ticket.assignedAgentMembershipId && !["resolved", "closed"].includes(ticket.status),
        ).length,
      },
      capabilities: {
        canCreate: context.permissions.has(supportPermissionKeys.create),
        canAssign: context.permissions.has(supportPermissionKeys.assign),
        canManageCategories: context.permissions.has(supportPermissionKeys.manageCategories),
        canManageRoutingRules: context.permissions.has(supportPermissionKeys.manageRoutingRules),
      },
    },
  };
}
