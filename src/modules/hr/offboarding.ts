export const hrOffboardingItemDefinitions = [
  { key: "separation_record", label: "Resignation or termination record", derived: true },
  { key: "last_working_date", label: "Last working date confirmed", derived: true },
  { key: "knowledge_transfer", label: "Knowledge transfer", derived: false },
  { key: "project_reassignment", label: "Project reassignment", derived: true },
  { key: "open_task_review", label: "Open-task review", derived: true },
  { key: "asset_return", label: "Asset return", derived: false },
  { key: "expense_settlement", label: "Expense settlement", derived: true },
  { key: "account_suspension", label: "Account suspension", derived: true },
  { key: "vault_access_removal", label: "Vault access removal", derived: false },
  { key: "document_generation", label: "Experience and relieving letters", derived: true },
  { key: "exit_interview", label: "Exit interview", derived: false },
  { key: "final_clearance", label: "Final clearance", derived: false },
  { key: "employee_archive", label: "Employee archive", derived: true },
] as const;

export const hrOffboardingItemKeys = hrOffboardingItemDefinitions.map((item) => item.key);
export const hrOffboardingPlanStatuses = [
  "draft",
  "in_progress",
  "ready",
  "completed",
  "cancelled",
] as const;
export const hrOffboardingItemStatuses = [
  "pending",
  "in_progress",
  "complete",
  "blocked",
  "not_applicable",
] as const;
export const hrSeparationTypes = [
  "resignation",
  "termination",
  "contract_end",
  "retirement",
  "redundancy",
  "other",
] as const;

export type HrOffboardingItemKey = (typeof hrOffboardingItemDefinitions)[number]["key"];
export type HrOffboardingPlanStatus = (typeof hrOffboardingPlanStatuses)[number];
export type HrOffboardingItemStatus = (typeof hrOffboardingItemStatuses)[number];
export type HrSeparationType = (typeof hrSeparationTypes)[number];

const terminalItemStatuses = new Set<HrOffboardingItemStatus>(["complete", "not_applicable"]);
const clearanceKeys = new Set<HrOffboardingItemKey>(["final_clearance", "employee_archive"]);

export function offboardingProgress(items: ReadonlyArray<{ status: HrOffboardingItemStatus }>): {
  completed: number;
  total: number;
  percent: number;
} {
  let completed = 0;
  for (const item of items) {
    if (terminalItemStatuses.has(item.status)) completed += 1;
  }
  const total = items.length;
  return { completed, total, percent: total === 0 ? 0 : Math.round((completed / total) * 100) };
}

export function deriveOffboardingPlanStatus(
  items: ReadonlyArray<{ key: HrOffboardingItemKey; status: HrOffboardingItemStatus }>,
): HrOffboardingPlanStatus {
  if (items.length === 0) return "draft";
  if (items.every((item) => terminalItemStatuses.has(item.status))) return "completed";
  const preClearance = items.filter((item) => !clearanceKeys.has(item.key));
  if (
    preClearance.length > 0 &&
    preClearance.every((item) => terminalItemStatuses.has(item.status))
  ) {
    return "ready";
  }
  if (items.some((item) => item.status !== "pending")) return "in_progress";
  return "draft";
}

export function humanizeOffboardingValue(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
