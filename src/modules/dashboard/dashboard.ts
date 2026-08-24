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
  amountMinor?: number | null;
  currency?: string | null;
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
  comparison: {
    periodLabel: string;
    revenueMinor: number | null;
    previousRevenueMinor: number | null;
  };
}
