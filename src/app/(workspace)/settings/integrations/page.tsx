import { PlugZap } from "lucide-react";

import { PageAccessFailure } from "@/components/feedback/page-access-failure";
import { IntegrationSettingsPanel } from "@/components/settings/integration-settings-panel";
import { PageNavigation } from "@/components/navigation/page-navigation";
import { getIntegrationSettingsData } from "@/modules/integrations/server/integration-settings";

export const metadata = { title: "Integration settings" };

export default async function IntegrationSettingsPage() {
  const result = await getIntegrationSettingsData();
  if (!result.allowed) {
    return <PageAccessFailure reason={result.reason} nextPath="/settings/integrations" />;
  }
  return (
    <div className="module-page">
      <PageNavigation
        backHref="/settings"
        backLabel="Settings"
        items={[{ label: "Settings", href: "/settings" }, { label: "Integrations" }]}
      />
      <section className="page-heading module-page__heading">
        <div>
          <p className="page-heading__date">Organization provider configuration</p>
          <h1>Integrations</h1>
          <p>Configure optional providers after deployment without editing environment files.</p>
        </div>
        <span className="page-heading__icon">
          <PlugZap size={22} aria-hidden="true" />
        </span>
      </section>
      <IntegrationSettingsPanel data={result.data} />
    </div>
  );
}
