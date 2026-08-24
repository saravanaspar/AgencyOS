import { KeyRound, LockKeyhole, ShieldCheck, ShieldX, UserRound } from "lucide-react";
import { redirect } from "next/navigation";

import { AccessCheckRetry } from "@/components/feedback/access-check-retry";
import { PageNavigation } from "@/components/navigation/page-navigation";
import { StatusBadge } from "@/components/ui/status-badge";
import { getPermissionViewerData } from "@/modules/permissions/server/permission-viewer";

export const metadata = { title: "Effective permissions" };

interface PermissionViewerPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function singleValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function formatModule(moduleName: string): string {
  return moduleName
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default async function PermissionViewerPage({ searchParams }: PermissionViewerPageProps) {
  const requestedMembershipId = singleValue((await searchParams).member);
  const result = await getPermissionViewerData(requestedMembershipId);

  if (!result.allowed) {
    if (result.reason === "access-check-failed") {
      return <AccessCheckRetry />;
    }

    if (result.reason === "signed-out") {
      redirect("/login?next=/settings/permissions");
    }

    if (result.reason === "membership-not-found") {
      redirect("/settings/permissions");
    }

    redirect(`/access-denied?reason=${result.reason}`);
  }

  const { data } = result;
  const permissionGroups = Map.groupBy(data.permissions, (permission) => permission.module);

  return (
    <div className="module-page">
      <PageNavigation
        backHref="/settings"
        backLabel="Back to Settings"
        items={[{ label: "Settings", href: "/settings" }, { label: "Permissions" }]}
      />

      <section className="page-heading module-page__heading">
        <div>
          <h1>Effective permissions</h1>
          <p>
            Inspect the exact role grants and active overrides that control access in{" "}
            {data.organization.legalName}.
          </p>
        </div>
      </section>

      <section className="permission-summary" aria-label="Permission summary">
        <div>
          <ShieldCheck size={20} aria-hidden="true" />
          <span>Allowed</span>
          <strong>{data.summary.allowed}</strong>
        </div>
        <div>
          <ShieldX size={20} aria-hidden="true" />
          <span>Not granted</span>
          <strong>{data.summary.denied}</strong>
        </div>
        <div>
          <LockKeyhole size={20} aria-hidden="true" />
          <span>Sensitive allowed</span>
          <strong>{data.summary.sensitiveAllowed}</strong>
        </div>
      </section>

      <section className="settings-panel permission-member-panel">
        <div className="settings-panel__heading">
          <span className="settings-panel__icon">
            <UserRound size={20} aria-hidden="true" />
          </span>
          <div>
            <h2>Inspect a member</h2>
            <p>Choose an organization member to resolve their current effective access.</p>
          </div>
        </div>

        <form className="permission-member-form" method="get">
          <label className="field">
            <span>Organization member</span>
            <select name="member" defaultValue={data.selectedMember.membershipId}>
              {data.members.map((member) => (
                <option value={member.membershipId} key={member.membershipId}>
                  {member.displayName} — {member.email}
                </option>
              ))}
            </select>
          </label>
          <button className="button button--primary button--md" type="submit">
            Inspect access
          </button>
        </form>

        <div className="permission-member-summary">
          <div>
            <strong>{data.selectedMember.displayName}</strong>
            <span>{data.selectedMember.email}</span>
          </div>
          <StatusBadge tone={data.selectedMember.status === "active" ? "success" : "warning"}>
            {data.selectedMember.status}
          </StatusBadge>
          <div className="permission-member-summary__roles">
            {data.selectedMember.roleNames.length > 0
              ? data.selectedMember.roleNames.map((role) => (
                  <StatusBadge tone="neutral" key={role}>
                    {role}
                  </StatusBadge>
                ))
              : "No active roles"}
          </div>
        </div>
      </section>

      <section className="permission-groups" aria-label="Effective permission catalogue">
        {[...permissionGroups.entries()].map(([moduleName, permissions]) => (
          <article className="permission-group" key={moduleName}>
            <header>
              <span className="settings-panel__icon">
                <KeyRound size={18} aria-hidden="true" />
              </span>
              <div>
                <h2>{formatModule(moduleName)}</h2>
                <p>
                  {permissions.filter((permission) => permission.allowed).length} of{" "}
                  {permissions.length} permissions allowed
                </p>
              </div>
            </header>

            <div className="permission-list">
              {permissions.map((permission) => (
                <div className="permission-row" key={permission.key}>
                  <div>
                    <div className="permission-row__title">
                      <code>{permission.key}</code>
                      {permission.isSensitive ? (
                        <StatusBadge tone="warning">Sensitive</StatusBadge>
                      ) : null}
                    </div>
                    <p>{permission.description}</p>
                    {permission.roleSources.length > 0 ? (
                      <small>Granted by {permission.roleSources.join(", ")}</small>
                    ) : null}
                    {permission.overrideEffect ? (
                      <small>
                        Override: {permission.overrideEffect}
                        {permission.overrideScope ? ` · ${permission.overrideScope}` : ""}
                        {permission.overrideReason ? ` · ${permission.overrideReason}` : ""}
                      </small>
                    ) : null}
                  </div>
                  <StatusBadge tone={permission.allowed ? "success" : "neutral"}>
                    {permission.allowed ? "Allowed" : "Not granted"}
                  </StatusBadge>
                </div>
              ))}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
