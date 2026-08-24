export const hrOnboardingItemDefinitions = [
  { key: "offer_accepted", label: "Offer accepted", derived: false, employeeOwned: true },
  {
    key: "employment_documents_collected",
    label: "Employment documents collected",
    derived: false,
    employeeOwned: false,
  },
  { key: "account_created", label: "Account created", derived: true, employeeOwned: false },
  {
    key: "department_assigned",
    label: "Department assigned",
    derived: true,
    employeeOwned: false,
  },
  { key: "manager_assigned", label: "Manager assigned", derived: true, employeeOwned: false },
  {
    key: "equipment_requested",
    label: "Equipment requested",
    derived: false,
    employeeOwned: false,
  },
  { key: "email_created", label: "Email created", derived: true, employeeOwned: false },
  {
    key: "policies_acknowledged",
    label: "Policies acknowledged",
    derived: false,
    employeeOwned: true,
  },
  { key: "nda_signed", label: "NDA signed", derived: false, employeeOwned: false },
  {
    key: "mandatory_training_assigned",
    label: "Mandatory training assigned",
    derived: false,
    employeeOwned: false,
  },
  {
    key: "first_day_meeting_scheduled",
    label: "First-day meeting scheduled",
    derived: true,
    employeeOwned: false,
  },
  {
    key: "probation_review_scheduled",
    label: "Probation review scheduled",
    derived: true,
    employeeOwned: false,
  },
] as const;

export const hrOnboardingItemKeys = hrOnboardingItemDefinitions.map((item) => item.key);
export const hrOnboardingPlanStatuses = [
  "draft",
  "in_progress",
  "ready",
  "completed",
  "cancelled",
] as const;
export const hrOnboardingItemStatuses = [
  "pending",
  "in_progress",
  "complete",
  "blocked",
  "not_applicable",
] as const;

export type HrOnboardingItemKey = (typeof hrOnboardingItemDefinitions)[number]["key"];
export type HrOnboardingPlanStatus = (typeof hrOnboardingPlanStatuses)[number];
export type HrOnboardingItemStatus = (typeof hrOnboardingItemStatuses)[number];

const terminalStatuses = new Set<HrOnboardingItemStatus>(["complete", "not_applicable"]);
const preStartKeys = new Set<HrOnboardingItemKey>(
  hrOnboardingItemKeys.filter(
    (key) => key !== "first_day_meeting_scheduled" && key !== "probation_review_scheduled",
  ),
);

export function onboardingProgress(items: ReadonlyArray<{ status: HrOnboardingItemStatus }>): {
  completed: number;
  total: number;
  percent: number;
} {
  const total = items.length;
  let completed = 0;
  for (const item of items) {
    if (terminalStatuses.has(item.status)) completed += 1;
  }
  return { completed, total, percent: total === 0 ? 0 : Math.round((completed / total) * 100) };
}

export function deriveOnboardingPlanStatus(
  items: ReadonlyArray<{ key: HrOnboardingItemKey; status: HrOnboardingItemStatus }>,
): HrOnboardingPlanStatus {
  if (items.length === 0) return "draft";
  if (items.every((item) => terminalStatuses.has(item.status))) return "completed";
  const preStart = items.filter((item) => preStartKeys.has(item.key));
  if (preStart.length > 0 && preStart.every((item) => terminalStatuses.has(item.status))) {
    return "ready";
  }
  if (items.some((item) => item.status !== "pending")) return "in_progress";
  return "draft";
}

export function humanizeOnboardingStatus(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
