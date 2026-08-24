import { PageAccessFailure } from "@/components/feedback/page-access-failure";
import { HrWorkspace } from "@/components/hr/hr-workspace";
import { getHrWorkspaceData } from "@/modules/hr/server/hr";

export const metadata = { title: "People" };

export default async function HrPage() {
  const result = await getHrWorkspaceData();
  if (!result.allowed) {
    return <PageAccessFailure reason={result.reason} nextPath="/hr" />;
  }

  return (
    <div className="module-page">
      <section className="page-heading module-page__heading">
        <div>
          <p className="page-heading__date">HR foundation</p>
          <h1>People</h1>
          <p>
            Manage employee records, attendance, leave, effective-dated salary structures, private
            salary slips, swappable private employee-document templates, scanner-gated supporting
            documents, employee onboarding and offboarding workflows, organization designations, and
            personal self-service. Medical, banking, and disciplinary records remain outside this
            stage.
          </p>
        </div>
      </section>
      <HrWorkspace data={result.data} />
    </div>
  );
}
