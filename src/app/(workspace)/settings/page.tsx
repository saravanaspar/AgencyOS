import {
  ArrowRight,
  Building2,
  KeyRound,
  Network,
  PlugZap,
  ScrollText,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import Link from "next/link";

import { PageAccessFailure } from "@/components/feedback/page-access-failure";
import { StatusBadge } from "@/components/ui/status-badge";
import { auditPermissionKeys } from "@/modules/audit/server/audit-log";
import { accessManagementPermissionKeys } from "@/modules/identity/server/access-management";
import { organizationStructurePermissionKeys } from "@/modules/organization-structure/server/organization-structure";
import { organizationProfilePermissionKeys } from "@/modules/organizations/server/organization-profile";
import { modulePermissionKeys } from "@/modules/permissions/module-access";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";
import { permissionViewerPermissionKeys } from "@/modules/permissions/server/permission-viewer";
import { roleEditorPermissionKeys } from "@/modules/permissions/server/role-editor";
import { securityPermissionKeys } from "@/modules/security/security";
import { integrationSettingsPermissionKeys } from "@/modules/integrations/integration-settings";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const access = await authorizeCurrentUser([modulePermissionKeys.settings]);
  if (!access.allowed) {
    return <PageAccessFailure reason={access.reason} nextPath="/settings" />;
  }
  const permissions = access.context.permissions;
  const canViewUsers = permissions.has(accessManagementPermissionKeys.viewUsers);
  const canViewAudit = permissions.has(auditPermissionKeys.view);
  const canViewPermissions = permissions.has(permissionViewerPermissionKeys.view);
  const canViewRoles = permissions.has(roleEditorPermissionKeys.view);
  const canViewOrganization = permissions.has(organizationProfilePermissionKeys.view);
  const canViewSecurity = permissions.has(securityPermissionKeys.view);
  const canViewIntegrations = permissions.has(integrationSettingsPermissionKeys.view);
  const canViewStructure =
    permissions.has(organizationStructurePermissionKeys.departmentView) ||
    permissions.has(organizationStructurePermissionKeys.teamView);

  const settingsAreas = [
    {
      title: "User access",
      description: "Approve signup accounts, assign roles, and suspend organization memberships.",
      href: canViewUsers ? "/settings/users" : undefined,
      icon: UsersRound,
      status: canViewUsers ? "Available" : "Restricted",
    },
    {
      title: "Audit log",
      description:
        "Search append-only security and administration events and export authorized records.",
      href: canViewAudit ? "/settings/audit" : undefined,
      icon: ScrollText,
      status: canViewAudit ? "Available" : "Restricted",
    },
    {
      title: "Role editor",
      description: "Create custom roles, manage scoped grants, and apply member overrides.",
      href: canViewRoles ? "/settings/roles" : undefined,
      icon: KeyRound,
      status: canViewRoles ? "Available" : "Restricted",
    },
    {
      title: "Effective permissions",
      description: "Inspect a member’s resolved grants, sources, scopes, and active overrides.",
      href: canViewPermissions ? "/settings/permissions" : undefined,
      icon: ShieldCheck,
      status: canViewPermissions ? "Available" : "Restricted",
    },
    {
      title: "Organization profile",
      description: "Legal identity, regional defaults, and immutable organization identifiers.",
      href: canViewOrganization ? "/settings/organization" : undefined,
      icon: Building2,
      status: canViewOrganization ? "Available" : "Restricted",
    },
    {
      title: "Departments and teams",
      description: "Manage reporting units, managers, cross-functional teams, members, and leads.",
      href: canViewStructure ? "/settings/structure" : undefined,
      icon: Network,
      status: canViewStructure ? "Available" : "Restricted",
    },
    {
      title: "Integrations",
      description: "Configure AI, browser push, and Vaultwarden after deployment.",
      href: canViewIntegrations ? "/settings/integrations" : undefined,
      icon: PlugZap,
      status: canViewIntegrations ? "Available" : "Restricted",
    },
    {
      title: "Security controls",
      description:
        "Authentication policy, sessions, MFA enforcement, and emergency access actions.",
      href: canViewSecurity ? "/settings/security" : undefined,
      icon: ShieldCheck,
      status: canViewSecurity ? "Available" : "Restricted",
    },
  ];

  return (
    <div className="module-page">
      <section className="page-heading module-page__heading">
        <div>
          <p className="page-heading__date">Organization control center</p>
          <h1>Settings</h1>
          <p>Manage identity, organization policy, roles, and platform configuration.</p>
        </div>
      </section>

      <section className="settings-area-grid">
        {settingsAreas.map((area) => {
          const Icon = area.icon;
          const content = (
            <>
              <span className="settings-area-card__icon">
                <Icon size={22} aria-hidden="true" />
              </span>
              <div>
                <div className="settings-area-card__title">
                  <h2>{area.title}</h2>
                  <StatusBadge
                    tone={
                      area.status === "Available"
                        ? "success"
                        : area.status === "Restricted"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {area.status}
                  </StatusBadge>
                </div>
                <p>{area.description}</p>
              </div>
              {area.href ? <ArrowRight size={18} aria-hidden="true" /> : null}
            </>
          );

          return area.href ? (
            <Link className="settings-area-card" href={area.href} key={area.title}>
              {content}
            </Link>
          ) : (
            <article className="settings-area-card settings-area-card--disabled" key={area.title}>
              {content}
            </article>
          );
        })}
      </section>
    </div>
  );
}
