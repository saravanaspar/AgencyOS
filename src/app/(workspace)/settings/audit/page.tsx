import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Download,
  Filter,
  Search,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PageAccessFailure } from "@/components/feedback/page-access-failure";
import { PageNavigation } from "@/components/navigation/page-navigation";
import { StatusBadge } from "@/components/ui/status-badge";
import { buildAuditLogQuery, humanizeAuditAction } from "@/modules/audit/audit-log-utils";
import { auditLogFiltersSchema } from "@/modules/audit/schemas/audit-log";
import { getAuditLogData, type AuditLogEvent } from "@/modules/audit/server/audit-log";
import { getDateTimeFormatter } from "@/lib/intl-formatters";

export const metadata = { title: "Audit log" };

interface AuditLogPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function formatTimestamp(value: string): string {
  return getDateTimeFormatter("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function formatJson(value: Record<string, unknown> | null): string {
  return value ? JSON.stringify(value, null, 2) : "No data recorded.";
}

function EventDetails({ event }: { event: AuditLogEvent }) {
  return (
    <details className="audit-event-details">
      <summary>View recorded changes</summary>
      <div className="audit-event-details__grid">
        <section>
          <h3>Before</h3>
          <pre>{formatJson(event.beforeState)}</pre>
        </section>
        <section>
          <h3>After</h3>
          <pre>{formatJson(event.afterState)}</pre>
        </section>
        <section>
          <h3>Metadata</h3>
          <pre>{formatJson(event.metadata)}</pre>
        </section>
      </div>
    </details>
  );
}

export default async function AuditLogPage({ searchParams }: AuditLogPageProps) {
  const parsedFilters = auditLogFiltersSchema.safeParse(await searchParams);

  if (!parsedFilters.success) {
    redirect("/settings/audit");
  }

  const result = await getAuditLogData(parsedFilters.data);

  if (!result.allowed) {
    return <PageAccessFailure reason={result.reason} nextPath="/settings/audit" />;
  }

  const { data } = result;

  if (data.filters.page !== data.pagination.page) {
    redirect(`/settings/audit${buildAuditLogQuery(data.filters, { page: data.pagination.page })}`);
  }

  const hasFilters = Boolean(
    data.filters.q || data.filters.action || data.filters.from || data.filters.to,
  );
  const firstItem = data.pagination.totalItems
    ? (data.pagination.page - 1) * data.pagination.pageSize + 1
    : 0;
  const lastItem = Math.min(
    data.pagination.page * data.pagination.pageSize,
    data.pagination.totalItems,
  );

  return (
    <div className="module-page">
      <PageNavigation
        backHref="/settings"
        backLabel="Back to Settings"
        items={[{ label: "Settings", href: "/settings" }, { label: "Audit log" }]}
      />

      <section className="page-heading module-page__heading">
        <div>
          <h1>Organization audit trail</h1>
          <p>
            Review append-only security and administration events for {data.organization.legalName}.
          </p>
        </div>
        {data.canExport ? (
          <Link
            className="button button--secondary button--md"
            href={`/settings/audit/export${buildAuditLogQuery(data.filters, { page: 1 })}`}
          >
            <Download size={16} aria-hidden="true" />
            Export CSV
          </Link>
        ) : null}
      </section>

      <section className="audit-summary" aria-label="Audit summary">
        <div>
          <Activity size={20} aria-hidden="true" />
          <span>Total events</span>
          <strong>{data.summary.totalEvents}</strong>
        </div>
        <div>
          <ShieldCheck size={20} aria-hidden="true" />
          <span>Last 24 hours</span>
          <strong>{data.summary.eventsLast24Hours}</strong>
        </div>
        <div>
          <UserRound size={20} aria-hidden="true" />
          <span>Recorded actors</span>
          <strong>{data.summary.uniqueActors}</strong>
        </div>
      </section>

      <section className="settings-panel audit-filter-panel">
        <div className="settings-panel__heading">
          <span className="settings-panel__icon">
            <Filter size={20} aria-hidden="true" />
          </span>
          <div>
            <h2>Filter events</h2>
            <p>Search actor emails, actions, entities, identifiers, and recorded metadata.</p>
          </div>
        </div>

        <form className="audit-filter-form" method="get">
          <label className="field audit-filter-form__search">
            <span>Search</span>
            <span className="input-with-icon">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                name="q"
                defaultValue={data.filters.q}
                placeholder="Email, action, entity, or ID"
              />
            </span>
          </label>

          <label className="field">
            <span>Action</span>
            <select name="action" defaultValue={data.filters.action}>
              <option value="">All actions</option>
              {data.availableActions.map((action) => (
                <option value={action} key={action}>
                  {humanizeAuditAction(action)}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>From</span>
            <input type="date" name="from" defaultValue={data.filters.from} />
          </label>

          <label className="field">
            <span>To</span>
            <input type="date" name="to" defaultValue={data.filters.to} />
          </label>

          <div className="audit-filter-form__actions">
            {hasFilters ? (
              <Link className="button button--ghost button--md" href="/settings/audit">
                Clear
              </Link>
            ) : null}
            <button className="button button--primary button--md" type="submit">
              Apply filters
            </button>
          </div>
        </form>
      </section>

      <section className="settings-panel audit-log-panel">
        <div className="settings-panel__heading settings-panel__heading--spread">
          <div>
            <h2>Recorded events</h2>
            <p>
              {data.pagination.totalItems === 0
                ? "No events match the current filters."
                : `Showing ${firstItem}–${lastItem} of ${data.pagination.totalItems} matching events.`}
            </p>
          </div>
          <StatusBadge tone="neutral">Append-only</StatusBadge>
        </div>

        {data.events.length > 0 ? (
          <div className="audit-event-list">
            {data.events.map((event) => (
              <article className="audit-event" key={event.id}>
                <div className="audit-event__main">
                  <div>
                    <strong>{humanizeAuditAction(event.action)}</strong>
                    <code>{event.action}</code>
                  </div>
                  <StatusBadge tone={event.actorType === "user" ? "info" : "neutral"}>
                    {event.actorType}
                  </StatusBadge>
                </div>

                <dl className="audit-event__metadata">
                  <div>
                    <dt>Actor</dt>
                    <dd>
                      {event.actorDisplayName}
                      {event.actorEmail && event.actorEmail !== event.actorDisplayName ? (
                        <small>{event.actorEmail}</small>
                      ) : null}
                    </dd>
                  </div>
                  <div>
                    <dt>Entity</dt>
                    <dd>
                      {event.entityType}
                      {event.entityId ? <small>{event.entityId}</small> : null}
                    </dd>
                  </div>
                  <div>
                    <dt>Source</dt>
                    <dd>{event.source}</dd>
                  </div>
                  <div>
                    <dt>Occurred</dt>
                    <dd>{formatTimestamp(event.occurredAt)} UTC</dd>
                  </div>
                </dl>

                <EventDetails event={event} />
              </article>
            ))}
          </div>
        ) : (
          <div className="audit-empty-state">
            <ShieldCheck size={28} aria-hidden="true" />
            <strong>No audit events found</strong>
            <p>Clear the filters or perform an administrative action to create a new event.</p>
          </div>
        )}

        {data.pagination.totalPages > 1 ? (
          <nav className="audit-pagination" aria-label="Audit log pages">
            <Link
              className={`button button--secondary button--sm${
                data.pagination.page <= 1 ? " is-disabled" : ""
              }`}
              href={buildAuditLogQuery(data.filters, {
                page: Math.max(1, data.pagination.page - 1),
              })}
              aria-disabled={data.pagination.page <= 1}
              tabIndex={data.pagination.page <= 1 ? -1 : undefined}
            >
              <ArrowLeft size={15} aria-hidden="true" />
              Previous
            </Link>
            <span>
              Page {data.pagination.page} of {data.pagination.totalPages}
            </span>
            <Link
              className={`button button--secondary button--sm${
                data.pagination.page >= data.pagination.totalPages ? " is-disabled" : ""
              }`}
              href={buildAuditLogQuery(data.filters, {
                page: Math.min(data.pagination.totalPages, data.pagination.page + 1),
              })}
              aria-disabled={data.pagination.page >= data.pagination.totalPages}
              tabIndex={data.pagination.page >= data.pagination.totalPages ? -1 : undefined}
            >
              Next
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </nav>
        ) : null}
      </section>
    </div>
  );
}
