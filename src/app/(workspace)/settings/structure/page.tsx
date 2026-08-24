import { PageAccessFailure } from "@/components/feedback/page-access-failure";
import { PageNavigation } from "@/components/navigation/page-navigation";
import { OrganizationStructurePanel } from "@/components/settings/organization-structure-panel";
import { getOrganizationStructureData } from "@/modules/organization-structure/server/organization-structure";

export const metadata = { title: "Departments and teams" };

export default async function OrganizationStructurePage() {
  const result = await getOrganizationStructureData();

  if (!result.allowed) {
    return <PageAccessFailure reason={result.reason} nextPath="/settings/structure" />;
  }

  return (
    <div className="module-page">
      <PageNavigation
        backHref="/settings"
        backLabel="Back to Settings"
        items={[{ label: "Settings", href: "/settings" }, { label: "Departments and teams" }]}
      />

      <section className="page-heading module-page__heading">
        <div>
          <p className="page-heading__date">Organization structure</p>
          <h1>Departments and teams</h1>
          <p>Maintain reporting units, cross-functional teams, managers, and team leads.</p>
        </div>
      </section>

      <OrganizationStructurePanel data={result.data} />
    </div>
  );
}
