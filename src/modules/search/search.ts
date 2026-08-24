export const globalSearchPermissionKey = "search.records.view";

export const globalSearchKinds = [
  "lead",
  "company",
  "contact",
  "project",
  "task",
  "employee",
  "ticket",
  "document",
  "contract",
  "asset",
  "vendor",
  "purchase_request",
  "purchase_order",
  "calendar_event",
  "estimate",
  "invoice",
] as const;

export type GlobalSearchKind = (typeof globalSearchKinds)[number];

export const globalSearchKindLabels: Record<GlobalSearchKind, string> = {
  lead: "Lead",
  company: "Company / client",
  contact: "Contact",
  project: "Project",
  task: "Task",
  employee: "Employee",
  ticket: "Support ticket",
  document: "Document",
  contract: "Contract",
  asset: "Asset",
  vendor: "Vendor",
  purchase_request: "Purchase request",
  purchase_order: "Purchase order",
  calendar_event: "Calendar event",
  estimate: "Estimate",
  invoice: "Invoice",
};

export interface GlobalSearchResultItem {
  id: string;
  kind: GlobalSearchKind;
  module: string;
  title: string;
  subtitle: string | null;
  badge: string | null;
  href: string;
}

export interface GlobalSearchResponse {
  query: string;
  items: GlobalSearchResultItem[];
  truncated: boolean;
}

export function normalizeGlobalSearchQuery(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 120) : "";
}
