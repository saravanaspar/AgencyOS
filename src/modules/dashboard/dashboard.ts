export type DashboardMode = "owner" | "manager" | "employee";

export interface DashboardMetric {
  id: string;
  label: string;
  value: number;
  unit: "count" | "minor" | "bps" | "days" | "minutes";
  detail: string;
  href: string;
  tone?: "neutral" | "success" | "warning" | "danger";
}

export interface DashboardListItem {
  id: string;
  title: string;
  meta: string;
  href: string;
  dueAt?: string | null;
  status?: string | null;
  tone?: "neutral" | "success" | "warning" | "danger";
  reason?: string | null;
  amountMinor?: number | null;
  currency?: string | null;
}

export interface DashboardSection {
  id: string;
  title: string;
  description: string;
  href: string;
  items: DashboardListItem[];
}

export interface FounderAttentionItem extends DashboardListItem {
  bucket: "critical" | "today" | "this_week";
  reason: string;
  workState?: "active" | "delegated";
  delegatedToName?: string | null;
}

export interface FounderWorkDelegateOption {
  membershipId: string;
  name: string;
}

export interface DashboardWorkspaceData {
  mode: DashboardMode;
  locale: string;
  currency: string;
  generatedAt: string;
  greetingName: string;
  metrics: DashboardMetric[];
  sections: DashboardSection[];
  attention: FounderAttentionItem[];
  attentionDelegates: FounderWorkDelegateOption[];
  comparison: {
    periodLabel: string;
    revenueMinor: number | null;
    previousRevenueMinor: number | null;
  };
}
