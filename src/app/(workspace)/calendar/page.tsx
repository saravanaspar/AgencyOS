import { CalendarWorkspace } from "@/components/calendar/calendar-workspace";
import { PageAccessFailure } from "@/components/feedback/page-access-failure";
import { calendarFiltersSchema } from "@/modules/calendar/schemas/calendar";
import { getCalendarWorkspaceData } from "@/modules/calendar/server/calendar";

export const metadata = { title: "Calendar" };

type CalendarPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CalendarPage({ searchParams }: CalendarPageProps) {
  const raw = await searchParams;
  const filters = calendarFiltersSchema.parse({
    anchor: first(raw.anchor),
    view: first(raw.view),
    scope: first(raw.scope),
    type: first(raw.type),
    project: first(raw.project),
  });
  const result = await getCalendarWorkspaceData(filters);
  if (!result.allowed) {
    return <PageAccessFailure reason={result.reason} nextPath="/calendar" />;
  }

  return (
    <div className="module-page calendar-page">
      <section className="page-heading module-page__heading">
        <div>
          <p className="page-heading__date">Permission-aware operational schedule</p>
          <h1>Unified calendar</h1>
          <p>
            See authorized deadlines, leave, renewals, warranties, returns, procurement dates,
            meetings, interviews, holidays, and recurring agency events without duplicating source
            records.
          </p>
        </div>
      </section>
      <CalendarWorkspace data={result.data} />
    </div>
  );
}
