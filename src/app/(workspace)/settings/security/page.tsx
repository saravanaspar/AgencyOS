import { ShieldCheck } from "lucide-react";

import { PageAccessFailure } from "@/components/feedback/page-access-failure";
import { SecurityWorkspace } from "@/components/security/security-workspace";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";
import { securityPermissionKeys } from "@/modules/security/security";
import { getSecurityWorkspaceData } from "@/modules/security/server/security";

export const metadata = { title: "Security controls" };

export default async function SecuritySettingsPage() {
  const access = await authorizeCurrentUser([securityPermissionKeys.view]);
  if (!access.allowed) {
    return <PageAccessFailure reason={access.reason} nextPath="/settings/security" />;
  }
  const result = await getSecurityWorkspaceData();
  if (!result.allowed) {
    return <PageAccessFailure reason={result.reason} nextPath="/settings/security" />;
  }

  return (
    <div className="module-page">
      <section className="page-heading module-page__heading">
        <div>
          <p className="page-heading__date">Identity and operational readiness</p>
          <h1>Security controls</h1>
          <p>Manage MFA policy, sessions, incident evidence, and tested recovery records.</p>
        </div>
        <span className="page-heading__icon">
          <ShieldCheck size={22} aria-hidden="true" />
        </span>
      </section>
      <SecurityWorkspace data={result.data} />
    </div>
  );
}
