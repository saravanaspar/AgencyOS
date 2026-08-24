export const permissionScopes = [
  "own",
  "assigned",
  "assigned_or_created",
  "team",
  "department",
  "managed_employees",
  "selected_projects",
  "organization",
] as const;

export type PermissionScope = (typeof permissionScopes)[number];

export const permissionScopeLabels: Record<PermissionScope, string> = {
  own: "Own records only",
  assigned: "Assigned records only",
  assigned_or_created: "Assigned or created",
  team: "Current team",
  department: "Current department",
  managed_employees: "Managed employees",
  selected_projects: "Specific projects only",
  organization: "Entire organization",
};

export const permissionScopeDescriptions: Record<PermissionScope, string> = {
  own: "Only items created by the user or explicitly owned by the user.",
  assigned: "Only items actively assigned to the user.",
  assigned_or_created: "Items assigned to the user plus items the user created.",
  team: "Items belonging to people in the user’s current team.",
  department: "Items inside the user’s current department.",
  managed_employees: "Items for employees who report to this user directly or indirectly.",
  selected_projects:
    "Use this for project-based roles. Access is limited to a named set of projects that must be assigned separately.",
  organization: "No scope restriction. The permission applies across the whole organization.",
};
