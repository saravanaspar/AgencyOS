export const calendarPermissionKeys = {
  workspace: "calendar.workspace.view",
  view: "calendar.event.view",
  create: "calendar.event.create",
  manage: "calendar.event.manage",
} as const;

export const calendarViews = ["month", "week", "day", "agenda"] as const;
export const calendarScopes = ["personal", "team", "department", "project", "company"] as const;
export const customCalendarEventTypes = [
  "meeting",
  "holiday",
  "interview",
  "licence_expiration",
  "probation_review",
  "other",
] as const;
export const calendarEventTypes = [
  ...customCalendarEventTypes,
  "project_deadline",
  "task_deadline",
  "milestone",
  "invoice_due",
  "contract_renewal",
  "employee_leave",
  "asset_warranty",
  "asset_return",
  "purchase_request_due",
  "purchase_order_delivery",
] as const;
export const calendarRecurrenceFrequencies = ["none", "daily", "weekly", "monthly"] as const;
export const calendarVisibilityOptions = ["public", "private"] as const;

export type CalendarView = (typeof calendarViews)[number];
export type CalendarScope = (typeof calendarScopes)[number];
export type CustomCalendarEventType = (typeof customCalendarEventTypes)[number];
export type CalendarEventType = (typeof calendarEventTypes)[number];
export type CalendarRecurrenceFrequency = (typeof calendarRecurrenceFrequencies)[number];
export type CalendarVisibility = (typeof calendarVisibilityOptions)[number];

export const calendarViewLabels: Record<CalendarView, string> = {
  month: "Month",
  week: "Week",
  day: "Day",
  agenda: "Agenda",
};
export const calendarScopeLabels: Record<CalendarScope, string> = {
  personal: "Personal",
  team: "Team",
  department: "Department",
  project: "Project",
  company: "Company",
};
export const calendarEventTypeLabels: Record<CalendarEventType, string> = {
  meeting: "Meeting",
  project_deadline: "Project deadline",
  task_deadline: "Task deadline",
  milestone: "Milestone",
  invoice_due: "Invoice due",
  contract_renewal: "Contract renewal",
  licence_expiration: "Licence expiration",
  employee_leave: "Employee leave",
  holiday: "Holiday",
  interview: "Interview",
  probation_review: "Probation review",
  asset_warranty: "Asset warranty",
  asset_return: "Asset return",
  purchase_request_due: "Purchase request due",
  purchase_order_delivery: "Purchase-order delivery",
  other: "Other",
};
export const calendarRecurrenceLabels: Record<CalendarRecurrenceFrequency, string> = {
  none: "Does not repeat",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};
export const calendarVisibilityLabels: Record<CalendarVisibility, string> = {
  public: "Visible within selected scope",
  private: "Private to owner and attendees",
};

export function isCalendarView(value: unknown): value is CalendarView {
  return typeof value === "string" && calendarViews.includes(value as CalendarView);
}

export function isCalendarScope(value: unknown): value is CalendarScope {
  return typeof value === "string" && calendarScopes.includes(value as CalendarScope);
}

export function isCalendarEventType(value: unknown): value is CalendarEventType {
  return typeof value === "string" && calendarEventTypes.includes(value as CalendarEventType);
}

export function calendarScopesAllowedForPermission(
  permissionScope: string | null,
): CalendarScope[] {
  if (permissionScope === "organization") return [...calendarScopes];
  if (permissionScope === "team") return ["personal", "team"];
  if (permissionScope === "department") return ["personal", "department"];
  if (permissionScope === "selected_projects") return ["personal", "project"];
  return ["personal"];
}
