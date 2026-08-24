export const modulePermissionKeys = {
  dashboard: "dashboard.workspace.view",
  crm: "crm.workspace.view",
  projects: "projects.workspace.view",
  calendar: "calendar.workspace.view",
  finance: "finance.workspace.view",
  hr: "hr.workspace.view",
  support: "support.workspace.view",
  documents: "documents.workspace.view",
  legal: "legal.workspace.view",
  assets: "assets.workspace.view",
  vendors: "vendors.workspace.view",
  approvals: "approvals.request.view",
  reports: "reports.workspace.view",
  automation: "automation.workspace.view",
  ai: "ai.workspace.view",
  settings: "settings.organization.view",
} as const;

export type ModuleKey = keyof typeof modulePermissionKeys;
export type ModulePermissionKey = (typeof modulePermissionKeys)[ModuleKey];

export function hasRequiredPermissions(
  permissions: ReadonlySet<string>,
  requiredPermissions: readonly string[],
): boolean {
  return requiredPermissions.every((permission) => permissions.has(permission));
}
