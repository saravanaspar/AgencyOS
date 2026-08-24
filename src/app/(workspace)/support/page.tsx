import { PageAccessFailure } from "@/components/feedback/page-access-failure";
import { SupportWorkspace } from "@/components/support/support-workspace";
import { getSupportWorkspaceData } from "@/modules/support/server/support";
import {
  supportTicketPriorities,
  supportTicketPriorityLabels,
  supportTicketStatuses,
  supportTicketStatusLabels,
} from "@/modules/support/support";

export const metadata = { title: "Support" };

type SupportPageProps = {
  searchParams: Promise<{ q?: string; status?: string; priority?: string }>;
};

export default async function SupportPage({ searchParams }: SupportPageProps) {
  const filters = await searchParams;
  const result = await getSupportWorkspaceData(filters);
  if (!result.allowed) {
    return <PageAccessFailure reason={result.reason} nextPath="/support" />;
  }
  return (
    <div className="module-page">
      <section className="page-heading module-page__heading">
        <div>
          <p className="page-heading__date">Customer service operations</p>
          <h1>Support</h1>
          <p>
            Capture client issues, route ownership, separate public replies from internal notes,
            preserve immutable activity history, pause SLA clocks while waiting for customers, and
            connect tickets to CRM, Projects, and Documents.
          </p>
        </div>
      </section>
      <form className="support-filter-bar" method="get">
        <label>
          Search
          <input name="q" defaultValue={filters.q ?? ""} placeholder="Ticket, client, or issue" />
        </label>
        <label>
          Status
          <select name="status" defaultValue={filters.status ?? "all"}>
            <option value="all">All statuses</option>
            {supportTicketStatuses.map((status) => (
              <option key={status} value={status}>
                {supportTicketStatusLabels[status]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Priority
          <select name="priority" defaultValue={filters.priority ?? "all"}>
            <option value="all">All priorities</option>
            {supportTicketPriorities.map((priority) => (
              <option key={priority} value={priority}>
                {supportTicketPriorityLabels[priority]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="button button--secondary">
          Apply filters
        </button>
      </form>
      <SupportWorkspace data={result.data} />
    </div>
  );
}
