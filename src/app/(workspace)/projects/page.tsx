import { redirect } from "next/navigation";

import { AccessCheckRetry } from "@/components/feedback/access-check-retry";
import { ProjectsWorkspace } from "@/components/projects/projects-workspace";
import { projectFiltersSchema } from "@/modules/projects/schemas/projects";
import { getProjectsWorkspaceData } from "@/modules/projects/server/projects";

export const metadata = { title: "Projects" };

interface ProjectsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ProjectsPage({ searchParams }: ProjectsPageProps) {
  const raw = await searchParams;
  const filters = projectFiltersSchema.parse({
    q: firstValue(raw.q),
    status: firstValue(raw.status),
    owner: firstValue(raw.owner),
    project: firstValue(raw.project),
    archive: firstValue(raw.archive),
  });
  const result = await getProjectsWorkspaceData(filters);

  if (!result.allowed) {
    if (result.reason === "access-check-failed") return <AccessCheckRetry />;
    if (result.reason === "signed-out") redirect("/login?next=/projects");
    redirect(`/access-denied?reason=${result.reason}`);
  }

  return (
    <div className="module-page projects-page">
      <section className="page-heading module-page__heading">
        <div>
          <p className="page-heading__date">Delivery operations</p>
          <h1>Projects and tasks</h1>
          <p>
            Plan client and internal work, move tasks through a shared workflow, collaborate with
            comments, and record actual time without leaving the project.
          </p>
        </div>
      </section>
      <ProjectsWorkspace data={result.data} />
    </div>
  );
}
