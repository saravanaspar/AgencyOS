import { redirect } from "next/navigation";

import { AutomationWorkspace } from "@/components/automation/automation-workspace";
import { AccessCheckRetry } from "@/components/feedback/access-check-retry";
import { getCurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";
import {
  automationPermissionKeys,
  getAutomationWorkspaceData,
} from "@/modules/automation/server/automation";

export const metadata = { title: "Automation" };

export default async function AutomationPage() {
  const access = await getCurrentPermissionContext();
  if (!access.allowed) {
    if (access.reason === "access-check-failed") return <AccessCheckRetry />;
    if (access.reason === "signed-out") redirect("/login?next=/automation");
    redirect(`/access-denied?reason=${access.reason}`);
  }
  if (!access.context.permissions.has(automationPermissionKeys.workspace)) {
    redirect("/access-denied?reason=insufficient-permission");
  }

  const data = await getAutomationWorkspaceData(access.context);
  return (
    <div className="module-page automation-page">
      <section className="page-heading module-page__heading">
        <div>
          <p className="page-heading__date">Internal workflow control</p>
          <h1>Automation and secure references</h1>
          <p>
            AgencyOS routes domain events to registered internal handlers with bounded retries and
            audit history. Vaultwarden references remain non-secret links to an independent vault
            session.
          </p>
        </div>
      </section>
      <AutomationWorkspace data={data} />
    </div>
  );
}
