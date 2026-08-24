const segmentLabels: Record<string, string> = {
  ai: "AI",
  approvals: "Approvals",
  assets: "Assets",
  automation: "Automation",
  calendar: "Calendar",
  crm: "CRM",
  dashboard: "Dashboard",
  documents: "Documents",
  finance: "Finance",
  hr: "HR",
  legal: "Legal",
  notifications: "Notifications",
  projects: "Projects",
  reports: "Reports",
  settings: "Settings",
  support: "Support",
  vendors: "Vendors",
  workspace: "workspace",
  audit: "audit log",
  user: "users",
  users: "users",
  role: "roles",
  permission: "permissions",
  permissions: "permissions",
  organization: "organization profile",
  structure: "organization structure",
  member: "members",
  members: "members",
  membership: "membership",
  notification: "notifications",
  preference: "notification preferences",
  request: "requests",
  company: "companies",
  contact: "contacts",
  lead: "leads",
};

const actionLabels: Record<string, string> = {
  view: "View",
  create: "Create",
  update: "Update",
  delete: "Delete",
  export: "Export",
  approve: "Approve",
  reject: "Reject",
  manage_access: "Manage access for",
  manage_settings: "Manage settings for",
};

function startCase(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function labelForSegment(segment: string): string {
  return segmentLabels[segment] ?? startCase(segment);
}

export function humanizeModuleName(moduleName: string): string {
  return labelForSegment(moduleName);
}

export function humanizePermissionKey(permissionKey: string): string {
  const [moduleName, resource, action, ...rest] = permissionKey.split(".");

  if (!moduleName) return permissionKey;
  if (!resource) return labelForSegment(moduleName);

  const actionKey = [action, ...rest].filter(Boolean).join("_");
  const actionLabel = actionKey ? (actionLabels[actionKey] ?? startCase(actionKey)) : "";
  const moduleLabel = labelForSegment(moduleName);
  const resourceLabel = labelForSegment(resource);

  if (resource === "workspace" && action === "view") {
    return `Open ${moduleLabel}`;
  }

  if (resource === "preference" && actionKey === "manage_settings") {
    return "Manage notification preferences";
  }

  if (actionKey === "manage_access") {
    return `${actionLabel} ${resourceLabel}`;
  }

  if (resource === "audit" && action === "export") {
    return "Export audit log";
  }

  if (!actionLabel) {
    return `${moduleLabel} — ${resourceLabel}`;
  }

  if (moduleName === resource) {
    return `${actionLabel} ${moduleLabel}`;
  }

  return `${actionLabel} ${resourceLabel}`;
}

export function summarizePermissionKey(permissionKey: string): string {
  const [moduleName, resource, action, ...rest] = permissionKey.split(".");
  const actionKey = [action, ...rest].filter(Boolean).join("_");
  const moduleLabel = labelForSegment(moduleName);
  const resourceLabel = resource ? labelForSegment(resource) : moduleLabel;

  if (resource === "workspace" && action === "view") {
    return `Allows the user to open the ${moduleLabel} module from navigation, search, and direct URLs.`;
  }

  if (actionKey === "manage_access") {
    return `Allows the user to grant, revoke, or adjust ${resourceLabel.toLowerCase()} access inside ${moduleLabel}.`;
  }

  if (actionKey === "manage_settings") {
    return `Allows the user to configure ${resourceLabel.toLowerCase()} in ${moduleLabel}.`;
  }

  if (action === "export") {
    return `Allows the user to export ${resourceLabel.toLowerCase()} data from ${moduleLabel}.`;
  }

  if (action === "view") {
    return `Allows the user to view ${resourceLabel.toLowerCase()} in ${moduleLabel}.`;
  }

  if (action === "create") {
    return `Allows the user to create new ${resourceLabel.toLowerCase()} items in ${moduleLabel}.`;
  }

  if (action === "update") {
    return `Allows the user to update ${resourceLabel.toLowerCase()} in ${moduleLabel}.`;
  }

  if (action === "delete") {
    return `Allows the user to delete ${resourceLabel.toLowerCase()} in ${moduleLabel}.`;
  }

  if (action === "approve") {
    return `Allows the user to approve ${resourceLabel.toLowerCase()} in ${moduleLabel}.`;
  }

  if (action === "reject") {
    return `Allows the user to reject ${resourceLabel.toLowerCase()} in ${moduleLabel}.`;
  }

  return `Permission key: ${permissionKey}`;
}
