import { PageAccessFailure } from "@/components/feedback/page-access-failure";
import { ReportStudio } from "@/components/reports/report-studio";
import { ReportsWorkspace } from "@/components/reports/reports-workspace";
import { parseReportsFilters } from "@/modules/reports/schemas/reports";
import { getReportStudioData, getSavedReportView } from "@/modules/reports/server/report-studio";
import { getReportsWorkspaceData } from "@/modules/reports/server/reports";

export const metadata = { title: "Reports" };

type ReportsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const raw = await searchParams;
  const requestedViewId = first(raw.view) ?? null;
  const selectedView = await getSavedReportView(requestedViewId);
  const filters = selectedView
    ? selectedView.filters
    : parseReportsFilters({
        from: first(raw.from),
        to: first(raw.to),
        comparison: first(raw.comparison),
        section: first(raw.section),
        owner: first(raw.owner),
        team: first(raw.team),
        department: first(raw.department),
        project: first(raw.project),
        client: first(raw.client),
        status: first(raw.status),
      });
  const [result, studio] = await Promise.all([
    getReportsWorkspaceData(filters, {
      widgetKeys: selectedView?.widgetKeys,
      savedViewId: selectedView?.id ?? null,
    }),
    getReportStudioData(selectedView?.id ?? null),
  ]);
  if (!result.allowed) {
    return <PageAccessFailure reason={result.reason} nextPath="/reports" />;
  }

  return (
    <div className="module-page reports-page">
      <section className="page-heading module-page__heading">
        <div>
          <p className="page-heading__date">Permission-aware operational analysis</p>
          <h1>Reports</h1>
          <p>
            Review canonical records, save bounded report layouts, generate private snapshots, and
            schedule delivery without bypassing source-module permissions.
          </p>
        </div>
      </section>
      {studio ? <ReportStudio studio={studio} report={result.data} /> : null}
      <ReportsWorkspace data={result.data} />
    </div>
  );
}
