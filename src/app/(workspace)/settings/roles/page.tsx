import { redirect } from "next/navigation";

import { AccessCheckRetry } from "@/components/feedback/access-check-retry";
import { PageNavigation } from "@/components/navigation/page-navigation";
import { RoleEditorPanel } from "@/components/settings/role-editor-panel";
import { getRoleEditorData } from "@/modules/permissions/server/role-editor";

export const metadata = { title: "Roles and permissions" };

export default async function RoleEditorPage() {
  const result = await getRoleEditorData();

  if (!result.allowed) {
    if (result.reason === "access-check-failed") {
      return <AccessCheckRetry />;
    }

    if (result.reason === "signed-out") {
      redirect("/login?next=/settings/roles");
    }

    redirect(`/access-denied?reason=${result.reason}`);
  }

  return (
    <div className="module-page">
      <PageNavigation
        backHref="/settings"
        backLabel="Back to Settings"
        items={[{ label: "Settings", href: "/settings" }, { label: "Roles" }]}
      />

      <section className="page-heading module-page__heading">
        <div>
          <p className="page-heading__date">Authorization administration</p>
          <h1>Roles and permission editor</h1>
          <p>
            Create organization roles, define scoped permission grants, and manage explicit member
            overrides.
          </p>
        </div>
      </section>

      <RoleEditorPanel data={result.data} />
    </div>
  );
}
