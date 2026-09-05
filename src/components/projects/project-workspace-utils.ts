import type { ProjectSummary, ProjectsWorkspaceData } from "@/modules/projects/server/projects";

export function projectGroupLabel(
  project: ProjectSummary,
  group: ProjectsWorkspaceData["filters"]["group"],
): string {
  if (group === "status") return project.status.replaceAll("_", " ");
  if (group === "owner") return project.ownerName;
  if (group === "client") return project.companyName ?? "Internal";
  if (group === "health") return project.health.replaceAll("_", " ");
  return "Projects";
}
