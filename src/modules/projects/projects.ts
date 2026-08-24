export const projectPermissionKeys = {
  workspaceView: "projects.workspace.view",
  projectView: "projects.project.view",
  projectCreate: "projects.project.create",
  projectUpdate: "projects.project.update",
  projectArchive: "projects.project.archive",
  projectAssign: "projects.project.assign",
  taskView: "projects.task.view",
  taskCreate: "projects.task.create",
  taskUpdate: "projects.task.update",
  taskAssign: "projects.task.assign",
  commentCreate: "projects.comment.create",
  timeView: "projects.time.view",
  timeCreate: "projects.time.create",
} as const;

export const projectStatuses = ["planned", "active", "on_hold", "completed", "cancelled"] as const;
export const projectPriorities = ["low", "normal", "high", "urgent"] as const;
export const projectVisibilities = ["organization", "members", "private"] as const;
export const projectMemberRoles = ["owner", "manager", "member", "viewer"] as const;
export const projectPhaseStatuses = ["planned", "active", "completed", "cancelled"] as const;
export const projectMilestoneStatuses = ["open", "completed", "cancelled"] as const;
export const projectTaskDependencyRelationships = [
  "blocks",
  "related_to",
  "duplicate_of",
  "parent_of",
] as const;
export const projectRecurrenceUnits = ["day", "week", "month"] as const;
export const projectArchiveFilters = ["active", "archived", "all"] as const;
export const projectBillingMethods = ["none", "hourly", "fixed", "retainer"] as const;
export const projectSortOptions = ["updated", "due", "name", "profitability"] as const;
export const projectGroupOptions = ["none", "status", "owner", "client", "health"] as const;

export type ProjectStatus = (typeof projectStatuses)[number];
export type ProjectPriority = (typeof projectPriorities)[number];
export type ProjectVisibility = (typeof projectVisibilities)[number];
export type ProjectMemberRole = (typeof projectMemberRoles)[number];
export type ProjectPhaseStatus = (typeof projectPhaseStatuses)[number];
export type ProjectMilestoneStatus = (typeof projectMilestoneStatuses)[number];
export type ProjectTaskDependencyRelationship = (typeof projectTaskDependencyRelationships)[number];
export type ProjectRecurrenceUnit = (typeof projectRecurrenceUnits)[number];
export type ProjectArchiveFilter = (typeof projectArchiveFilters)[number];
export type ProjectBillingMethod = (typeof projectBillingMethods)[number];
export type ProjectSortOption = (typeof projectSortOptions)[number];
export type ProjectGroupOption = (typeof projectGroupOptions)[number];

export function normalizeProjectCode(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
}

export function calculateProjectProgress(totalTasks: number, terminalTasks: number): number {
  if (totalTasks <= 0) return 0;
  return Math.round((Math.min(Math.max(terminalTasks, 0), totalTasks) / totalTasks) * 100);
}

export function projectHealth(input: {
  status: ProjectStatus;
  dueDate: string | null;
  progress: number;
  blockedTasks: number;
  now?: Date;
}): "healthy" | "attention" | "at_risk" | "complete" {
  if (input.status === "completed") return "complete";
  if (input.status === "cancelled") return "attention";
  if (input.blockedTasks > 0) return "at_risk";
  if (!input.dueDate) return input.progress >= 75 ? "healthy" : "attention";

  const now = input.now ?? new Date();
  const due = new Date(`${input.dueDate}T23:59:59.999Z`);
  const daysRemaining = Math.ceil((due.getTime() - now.getTime()) / 86_400_000);
  if (daysRemaining < 0 && input.progress < 100) return "at_risk";
  if (daysRemaining <= 7 && input.progress < 80) return "attention";
  return "healthy";
}
