import { redirect } from "next/navigation";

import { AccessCheckRetry } from "@/components/feedback/access-check-retry";
import { PageNavigation } from "@/components/navigation/page-navigation";
import { AccessManagementPanel } from "@/components/settings/access-management-panel";
import { getAccessManagementData } from "@/modules/identity/server/access-management";

export const metadata = { title: "User access" };

export default async function UserAccessPage() {
  const result = await getAccessManagementData();

  if (!result.allowed) {
    if (result.reason === "access-check-failed") {
      return (
        <AccessCheckRetry
          title="User access is temporarily unavailable"
          message="AgencyOS could not load organization members after a bounded retry. No access changes were made. Retry the request in a moment."
        />
      );
    }

    if (result.reason === "signed-out") {
      redirect("/login?next=/settings/users");
    }

    redirect(`/access-denied?reason=${result.reason}`);
  }

  return (
    <div className="module-page">
      <PageNavigation
        backHref="/settings"
        backLabel="Back to Settings"
        items={[{ label: "Settings", href: "/settings" }, { label: "User access" }]}
      />

      <section className="page-heading module-page__heading">
        <div>
          <h1>Manage account access</h1>
          <p>
            Approve confirmed signup accounts, assign roles, and immediately restrict organization
            access.
          </p>
        </div>
      </section>

      <AccessManagementPanel data={result.data} />
    </div>
  );
}
