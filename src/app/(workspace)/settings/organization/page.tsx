import { PageAccessFailure } from "@/components/feedback/page-access-failure";
import { PageNavigation } from "@/components/navigation/page-navigation";
import { OrganizationProfilePanel } from "@/components/settings/organization-profile-panel";
import { getOrganizationProfileData } from "@/modules/organizations/server/organization-profile";

export const metadata = { title: "Organization profile" };

export default async function OrganizationProfilePage() {
  const result = await getOrganizationProfileData();

  if (!result.allowed) {
    return <PageAccessFailure reason={result.reason} nextPath="/settings/organization" />;
  }

  return (
    <div className="module-page">
      <PageNavigation
        backHref="/settings"
        backLabel="Back to Settings"
        items={[{ label: "Settings", href: "/settings" }, { label: "Organization profile" }]}
      />

      <section className="page-heading module-page__heading">
        <div>
          <h1>Organization profile</h1>
          <p>Maintain legal identity and the regional defaults used across AgencyOS.</p>
        </div>
      </section>

      <OrganizationProfilePanel data={result.data} />
    </div>
  );
}
