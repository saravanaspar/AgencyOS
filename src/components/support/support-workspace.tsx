"use client";

import { useActionState } from "react";

import {
  addSupportTicketMessageAction,
  attachSupportTicketDocumentAction,
  changeSupportTicketLifecycleAction,
  createSupportCategoryAction,
  createSupportRoutingRuleAction,
  createSupportTicketAction,
  submitSupportTicketSatisfactionAction,
  updateSupportTicketAction,
  updateSupportTicketWatcherAction,
} from "@/modules/support/actions/support";
import type { SupportActionState } from "@/modules/support/schemas/support";
import type { SupportTicketSummary, SupportWorkspaceData } from "@/modules/support/server/support";
import {
  supportTicketPriorities,
  supportTicketPriorityLabels,
  supportTicketStatuses,
  supportTicketStatusLabels,
} from "@/modules/support/support";
import { SupportActionMessage } from "@/components/support/support-action-message";
import { toDateTimeLocalValue } from "@/lib/date-time-local";
import { getDateTimeFormatter } from "@/lib/intl-formatters";

const initialState: SupportActionState = { status: "idle", message: "" };
const supportDateTimeFormatter = getDateTimeFormatter("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function formatDateTime(value: string | null): string {
  return value ? supportDateTimeFormatter.format(new Date(value)) : "—";
}

function CreateTicketForm({ data }: { data: SupportWorkspaceData }) {
  const [state, action, pending] = useActionState(createSupportTicketAction, initialState);
  return (
    <form action={action} className="support-form support-form--create">
      <label>
        Subject
        <input name="subject" required minLength={2} maxLength={180} />
      </label>
      <label className="support-form__wide">
        Description
        <textarea name="description" required minLength={2} maxLength={10000} rows={4} />
      </label>
      <label>
        Client
        <select name="clientCompanyId" defaultValue="">
          <option value="">No client link</option>
          {data.companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Contact
        <select name="contactId" defaultValue="">
          <option value="">No contact link</option>
          {data.contacts.map((contact) => (
            <option key={contact.id} value={contact.id}>
              {contact.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Project
        <select name="projectId" defaultValue="">
          <option value="">No project link</option>
          {data.projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Category
        <select name="categoryId" defaultValue="">
          <option value="">Automatic routing</option>
          {data.categories.map((category) =>
            category.status === "active" ? (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ) : null,
          )}
        </select>
      </label>
      <label>
        Priority
        <select name="priority" defaultValue="normal">
          {supportTicketPriorities.map((priority) => (
            <option key={priority} value={priority}>
              {supportTicketPriorityLabels[priority]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Due date
        <input type="datetime-local" name="dueAt" />
      </label>
      <div className="support-form__wide support-form__actions">
        <button type="submit" className="button button--primary" disabled={pending}>
          Create ticket
        </button>
        <SupportActionMessage state={state} />
      </div>
    </form>
  );
}

function CategoryForm() {
  const [state, action, pending] = useActionState(createSupportCategoryAction, initialState);
  return (
    <form action={action} className="support-form support-form--category">
      <label>
        Category name
        <input name="name" required minLength={2} maxLength={80} />
      </label>
      <label>
        Default priority
        <select name="defaultPriority" defaultValue="normal">
          {supportTicketPriorities.map((priority) => (
            <option key={priority} value={priority}>
              {supportTicketPriorityLabels[priority]}
            </option>
          ))}
        </select>
      </label>
      <label className="support-form__wide">
        Description
        <textarea name="description" minLength={2} maxLength={500} rows={2} />
      </label>
      <div className="support-form__wide support-form__actions">
        <button type="submit" className="button button--secondary" disabled={pending}>
          Add category
        </button>
        <SupportActionMessage state={state} />
      </div>
    </form>
  );
}

function RoutingRuleForm({ data }: { data: SupportWorkspaceData }) {
  const [state, action, pending] = useActionState(createSupportRoutingRuleAction, initialState);
  return (
    <form action={action} className="support-form support-form--category">
      <label>
        Rule name
        <input name="name" required minLength={2} maxLength={100} />
      </label>
      <label>
        Order
        <input name="position" type="number" min={1} max={10000} defaultValue={100} required />
      </label>
      <label>
        Category
        <select name="categoryId" required defaultValue="">
          <option value="" disabled>
            Select category
          </option>
          {data.categories.map((category) =>
            category.status === "active" ? (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ) : null,
          )}
        </select>
      </label>
      <label>
        Priority
        <select name="priority" defaultValue="normal">
          {supportTicketPriorities.map((priority) => (
            <option key={priority} value={priority}>
              {supportTicketPriorityLabels[priority]}
            </option>
          ))}
        </select>
      </label>
      <label className="support-form__wide">
        Keywords
        <textarea
          name="keywords"
          required
          minLength={2}
          maxLength={1000}
          rows={3}
          placeholder="Comma-separated phrases, for example outage, service down, production error"
        />
      </label>
      <div className="support-form__wide support-form__actions">
        <button type="submit" className="button button--secondary" disabled={pending}>
          Add routing rule
        </button>
        <SupportActionMessage state={state} />
      </div>
      {data.routingRules.length ? (
        <ul className="support-routing-rules">
          {data.routingRules.map((rule) => (
            <li key={rule.id}>
              <strong>{rule.name}</strong>
              <span>
                {rule.categoryName} · {supportTicketPriorityLabels[rule.priority]} · order{" "}
                {rule.position}
              </span>
              <small>{rule.keywords.join(", ")}</small>
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}

function TicketTriage({
  ticket,
  data,
}: {
  ticket: SupportTicketSummary;
  data: SupportWorkspaceData;
}) {
  const [state, action, pending] = useActionState(updateSupportTicketAction, initialState);
  return (
    <form action={action} className="support-form support-form--compact">
      <input type="hidden" name="ticketId" value={ticket.id} />
      <label>
        Status
        <select name="status" defaultValue={ticket.status}>
          {supportTicketStatuses.map((status) =>
            !["resolved", "closed"].includes(status) ? (
              <option key={status} value={status}>
                {supportTicketStatusLabels[status]}
              </option>
            ) : null,
          )}
        </select>
      </label>
      <label>
        Priority
        <select name="priority" defaultValue={ticket.priority}>
          {supportTicketPriorities.map((priority) => (
            <option key={priority} value={priority}>
              {supportTicketPriorityLabels[priority]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Category
        <select name="categoryId" defaultValue={ticket.categoryId ?? ""}>
          <option value="">Uncategorized</option>
          {data.categories.map((category) =>
            category.status === "active" ? (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ) : null,
          )}
        </select>
      </label>
      <label>
        Agent
        <select
          name="assignedAgentMembershipId"
          defaultValue={ticket.assignedAgentMembershipId ?? ""}
        >
          <option value="">Unassigned</option>
          {data.members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Team
        <select name="assignedTeamId" defaultValue={ticket.assignedTeamId ?? ""}>
          <option value="">No team</option>
          {data.teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Due date
        <input
          type="datetime-local"
          name="dueAt"
          defaultValue={toDateTimeLocalValue(ticket.dueAt)}
        />
      </label>
      <div className="support-form__wide support-form__actions">
        <button type="submit" className="button button--secondary" disabled={pending}>
          Save triage
        </button>
        <SupportActionMessage state={state} />
      </div>
    </form>
  );
}

function TicketMessageForm({
  ticket,
  type,
}: {
  ticket: SupportTicketSummary;
  type: "public_reply" | "internal_note";
}) {
  const [state, action, pending] = useActionState(addSupportTicketMessageAction, initialState);
  return (
    <form action={action} className="support-message-form">
      <input type="hidden" name="ticketId" value={ticket.id} />
      <input type="hidden" name="messageType" value={type} />
      <textarea
        name="body"
        rows={3}
        maxLength={10000}
        required
        placeholder={
          type === "internal_note" ? "Internal note — never shown to clients" : "Public reply"
        }
      />
      <button type="submit" className="button button--secondary" disabled={pending}>
        {type === "internal_note" ? "Add internal note" : "Send reply"}
      </button>
      <SupportActionMessage state={state} />
    </form>
  );
}

function TicketLifecycle({ ticket }: { ticket: SupportTicketSummary }) {
  const [state, action, pending] = useActionState(changeSupportTicketLifecycleAction, initialState);
  if (ticket.status === "resolved" || ticket.status === "closed") {
    return ticket.canReopen ? (
      <form action={action} className="support-inline-form">
        <input type="hidden" name="ticketId" value={ticket.id} />
        <input type="hidden" name="action" value="reopen" />
        <input type="hidden" name="resolutionSummary" value="" />
        <button type="submit" className="button button--secondary" disabled={pending}>
          Reopen ticket
        </button>
        <SupportActionMessage state={state} />
      </form>
    ) : null;
  }
  if (!ticket.canResolve) return null;
  return (
    <form action={action} className="support-message-form">
      <input type="hidden" name="ticketId" value={ticket.id} />
      <input type="hidden" name="action" value="resolve" />
      <textarea
        name="resolutionSummary"
        rows={3}
        minLength={2}
        maxLength={4000}
        required
        placeholder="Resolution summary"
      />
      <button type="submit" className="button button--primary" disabled={pending}>
        Resolve ticket
      </button>
      <SupportActionMessage state={state} />
    </form>
  );
}

function CloseForm({ ticket }: { ticket: SupportTicketSummary }) {
  const [state, action, pending] = useActionState(changeSupportTicketLifecycleAction, initialState);
  if (ticket.status !== "resolved" || !ticket.canClose) return null;
  return (
    <form action={action} className="support-inline-form">
      <input type="hidden" name="ticketId" value={ticket.id} />
      <input type="hidden" name="action" value="close" />
      <input type="hidden" name="resolutionSummary" value="" />
      <button type="submit" className="button button--secondary" disabled={pending}>
        Confirm and close
      </button>
      <SupportActionMessage state={state} />
    </form>
  );
}

function SatisfactionForm({ ticket }: { ticket: SupportTicketSummary }) {
  const [state, action, pending] = useActionState(
    submitSupportTicketSatisfactionAction,
    initialState,
  );
  if (!ticket.canRate) return null;
  return (
    <form action={action} className="support-form support-form--compact">
      <input type="hidden" name="ticketId" value={ticket.id} />
      <label>
        Satisfaction
        <select name="score" defaultValue="5">
          <option value="5">5 — Excellent</option>
          <option value="4">4 — Good</option>
          <option value="3">3 — Acceptable</option>
          <option value="2">2 — Poor</option>
          <option value="1">1 — Very poor</option>
        </select>
      </label>
      <label className="support-form__wide">
        Comment
        <textarea name="comment" rows={2} maxLength={1000} />
      </label>
      <div className="support-form__wide support-form__actions">
        <button type="submit" className="button button--secondary" disabled={pending}>
          Submit rating
        </button>
        <SupportActionMessage state={state} />
      </div>
    </form>
  );
}

function AttachDocumentForm({
  ticket,
  data,
}: {
  ticket: SupportTicketSummary;
  data: SupportWorkspaceData;
}) {
  const [state, action, pending] = useActionState(attachSupportTicketDocumentAction, initialState);
  if (!ticket.canReply || data.documents.length === 0) return null;
  return (
    <form action={action} className="support-inline-form">
      <input type="hidden" name="ticketId" value={ticket.id} />
      <select name="documentId" required defaultValue="" aria-label="Document to link">
        <option value="" disabled>
          Choose document
        </option>
        {data.documents.map((document) => (
          <option key={document.id} value={document.id}>
            {document.title}
          </option>
        ))}
      </select>
      <button type="submit" className="button button--secondary" disabled={pending}>
        Link document
      </button>
      <SupportActionMessage state={state} />
    </form>
  );
}

function WatcherControls({
  ticket,
  data,
}: {
  ticket: SupportTicketSummary;
  data: SupportWorkspaceData;
}) {
  if (!ticket.canManageWatchers) return null;
  const watcherIds = new Set(ticket.watchers.map((watcher) => watcher.membershipId));
  return (
    <div className="support-watchers">
      <strong>Watchers</strong>
      <div className="support-watchers__chips">
        {ticket.watchers.map((watcher) => (
          <form action={updateSupportTicketWatcherAction} key={watcher.membershipId}>
            <input type="hidden" name="ticketId" value={ticket.id} />
            <input type="hidden" name="membershipId" value={watcher.membershipId} />
            <input type="hidden" name="operation" value="remove" />
            <button type="submit" className="tag" title="Remove watcher">
              {watcher.name} ×
            </button>
          </form>
        ))}
      </div>
      <form action={updateSupportTicketWatcherAction} className="support-inline-form">
        <input type="hidden" name="ticketId" value={ticket.id} />
        <input type="hidden" name="operation" value="add" />
        <select name="membershipId" defaultValue="" required aria-label="Watcher to add">
          <option value="" disabled>
            Add watcher
          </option>
          {data.members.map((member) =>
            watcherIds.has(member.id) ? null : (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ),
          )}
        </select>
        <button type="submit" className="button button--ghost">
          Add
        </button>
      </form>
    </div>
  );
}

function TicketCard({
  ticket,
  data,
}: {
  ticket: SupportTicketSummary;
  data: SupportWorkspaceData;
}) {
  return (
    <article className="support-ticket-card">
      <header className="support-ticket-card__header">
        <div>
          <div className="support-ticket-card__eyebrow">
            <strong>{ticket.ticketKey}</strong>
            <span className={`status-badge status-badge--${ticket.status}`}>
              {ticket.statusLabel}
            </span>
            <span className={`priority-badge priority-badge--${ticket.priority}`}>
              {ticket.priorityLabel}
            </span>
            <span className={`support-sla support-sla--${ticket.slaState}`}>
              {ticket.slaState.replaceAll("_", " ")}
            </span>
          </div>
          <h2>{ticket.subject}</h2>
          <p>{ticket.description}</p>
        </div>
        <div className="support-ticket-card__meta">
          <span>Client: {ticket.clientName ?? "Not linked"}</span>
          <span>Contact: {ticket.contactName ?? "Not linked"}</span>
          <span>Project: {ticket.projectName ?? "Not linked"}</span>
          <span>Owner: {ticket.assignedAgentName ?? "Unassigned"}</span>
          <span>
            Triage: {ticket.triageSource.replaceAll("_", " ")}
            {ticket.triageRuleName ? ` · ${ticket.triageRuleName}` : ""}
          </span>
        </div>
      </header>

      <div className="support-ticket-card__sla-grid">
        <span>
          <strong>First response</strong>
          {formatDateTime(ticket.firstResponseDueAt)}
        </span>
        <span>
          <strong>Resolution</strong>
          {formatDateTime(ticket.resolutionDueAt)}
        </span>
        <span>
          <strong>Due</strong>
          {formatDateTime(ticket.dueAt)}
        </span>
        <span>
          <strong>Last activity</strong>
          {formatDateTime(ticket.lastActivityAt)}
        </span>
      </div>

      {ticket.canUpdate || ticket.canAssign ? (
        <details className="support-ticket-card__section">
          <summary>Triage and assignment</summary>
          {ticket.triageExplanation ? (
            <p className="support-triage-note">
              {ticket.triageExplanation}
              {ticket.triagedAt ? ` · ${formatDateTime(ticket.triagedAt)}` : ""}
            </p>
          ) : null}
          <TicketTriage ticket={ticket} data={data} />
        </details>
      ) : null}

      <section className="support-ticket-card__section">
        <h3>Conversation</h3>
        <div className="support-thread">
          {ticket.messages.length === 0 ? <p className="empty-copy">No replies yet.</p> : null}
          {ticket.messages.map((message) => (
            <article
              key={message.id}
              className={`support-message support-message--${message.messageType}`}
            >
              <header>
                <strong>{message.authorName}</strong>
                <span>
                  {message.messageType === "internal_note" ? "Internal note" : "Public reply"} ·{" "}
                  {formatDateTime(message.createdAt)}
                </span>
              </header>
              <p>{message.body}</p>
            </article>
          ))}
        </div>
        <div className="support-ticket-card__message-grid">
          {ticket.canReply && ticket.status !== "closed" ? (
            <TicketMessageForm ticket={ticket} type="public_reply" />
          ) : null}
          {ticket.canInternalNote && ticket.status !== "closed" ? (
            <TicketMessageForm ticket={ticket} type="internal_note" />
          ) : null}
        </div>
      </section>

      <section className="support-ticket-card__section support-ticket-card__controls">
        <WatcherControls ticket={ticket} data={data} />
        <div>
          <strong>Documents</strong>
          <div className="support-document-list">
            {ticket.documents.map((document) =>
              document.canOpen && document.currentVersionId ? (
                <a
                  key={document.id}
                  href={`/api/documents/${document.id}/versions/${document.currentVersionId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {document.title}
                </a>
              ) : (
                <span key={document.id}>{document.title}</span>
              ),
            )}
          </div>
          <AttachDocumentForm ticket={ticket} data={data} />
        </div>
      </section>

      {ticket.resolutionSummary ? (
        <section className="support-ticket-card__resolution">
          <strong>Resolution</strong>
          <p>{ticket.resolutionSummary}</p>
        </section>
      ) : null}
      <div className="support-ticket-card__lifecycle">
        <TicketLifecycle ticket={ticket} />
        <CloseForm ticket={ticket} />
        <SatisfactionForm ticket={ticket} />
        {ticket.satisfactionScore ? (
          <p>Customer satisfaction: {ticket.satisfactionScore}/5</p>
        ) : null}
      </div>

      <details className="support-ticket-card__section">
        <summary>Activity history ({ticket.events.length})</summary>
        <ol className="support-event-list">
          {ticket.events.map((event) => (
            <li key={event.id}>
              <span>{event.eventType.replaceAll("_", " ")}</span>
              <small>
                {event.actorName ?? "System"} · {formatDateTime(event.createdAt)}
              </small>
            </li>
          ))}
        </ol>
      </details>
    </article>
  );
}

export function SupportWorkspace({ data }: { data: SupportWorkspaceData }) {
  return (
    <div className="support-workspace">
      <section className="support-summary-grid" aria-label="Support summary">
        <article>
          <strong>{data.summary.total}</strong>
          <span>Total</span>
        </article>
        <article>
          <strong>{data.summary.open}</strong>
          <span>Open</span>
        </article>
        <article>
          <strong>{data.summary.waiting}</strong>
          <span>Waiting</span>
        </article>
        <article>
          <strong>{data.summary.breached}</strong>
          <span>SLA breached</span>
        </article>
        <article>
          <strong>{data.summary.resolved}</strong>
          <span>Resolved</span>
        </article>
        <article>
          <strong>{data.summary.unassigned}</strong>
          <span>Unassigned</span>
        </article>
      </section>

      <section className="settings-panel support-create-panel" id="create-ticket">
        <header>
          <div>
            <h2>Create support ticket</h2>
            <p>Link the customer and project, then let Support own the conversation and SLA.</p>
          </div>
        </header>
        {data.capabilities.canCreate ? (
          <CreateTicketForm data={data} />
        ) : (
          <p className="empty-copy">You can view support tickets but cannot create them.</p>
        )}
        {data.capabilities.canManageCategories ? (
          <details className="support-category-panel">
            <summary>Manage categories</summary>
            <CategoryForm />
          </details>
        ) : null}
        {data.capabilities.canManageRoutingRules ? (
          <details className="support-category-panel">
            <summary>Manage automatic routing</summary>
            <RoutingRuleForm data={data} />
          </details>
        ) : null}
      </section>

      <section className="support-ticket-list">
        {data.tickets.length === 0 ? (
          <div className="empty-state">
            <h2>No tickets match these filters</h2>
            <p>Create a ticket or change the search filters.</p>
          </div>
        ) : (
          data.tickets.map((ticket) => <TicketCard key={ticket.id} ticket={ticket} data={data} />)
        )}
      </section>
    </div>
  );
}
