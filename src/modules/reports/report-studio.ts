import type {
  ReportPeriodMode,
  ReportScheduleCadence,
  ReportSection,
  ReportSnapshotFormat,
  ReportViewVisibility,
  ReportsWorkspaceData,
} from "@/modules/reports/reports";
import type { ReportWidgetKey } from "@/modules/reports/report-builder";

export type ReportDeliveryChannel = "in_app" | "email";
export type ReportDeliveryAudience = "owner" | "named" | "view_access" | "section_access";

export interface SavedReportView {
  id: string;
  ownerMembershipId: string;
  name: string;
  description: string | null;
  section: ReportSection;
  periodMode: ReportPeriodMode;
  visibility: ReportViewVisibility;
  visibilityDepartmentId: string | null;
  namedRecipientIds: string[];
  filters: ReportsWorkspaceData["filters"];
  widgetKeys: ReportWidgetKey[];
  updatedAt: string;
}

export interface ReportScheduleSummary {
  id: string;
  savedViewId: string;
  cadence: ReportScheduleCadence;
  localTime: string;
  timezone: string;
  weekday: number | null;
  monthDay: number | null;
  format: ReportSnapshotFormat;
  audience: ReportDeliveryAudience;
  deliveryChannels: ReportDeliveryChannel[];
  recipientIds: string[];
  graceSeconds: number;
  status: "active" | "paused";
  nextRunAt: string;
  lastRunAt: string | null;
  consecutiveFailureCount: number;
}

export interface ReportSnapshotSummary {
  id: string;
  savedViewId: string;
  format: ReportSnapshotFormat;
  reportName: string;
  section: ReportSection;
  periodFrom: string;
  periodTo: string;
  rowCount: number;
  generatedAt: string;
}

export interface ReportScheduleRunSummary {
  id: string;
  scheduleId: string;
  scheduledFor: string;
  completedAt: string | null;
  outcome:
    "running" | "queued" | "delivered" | "partially_failed" | "failed" | "paused" | "cancelled";
  errorCode: string | null;
}

export interface ReportDeliveryBatchSummary {
  id: string;
  status: "queued" | "delivering" | "delivered" | "partially_failed" | "failed" | "cancelled";
  sendAfter: string;
  undoUntil: string;
  recipientCount: number;
  deliveredCount: number;
  failedCount: number;
  suppressedCount: number;
  completedAt: string | null;
  canUndo: boolean;
}

export interface ReportRecipientOption {
  membershipId: string;
  displayName: string;
  email: string;
  departmentId: string | null;
}

export interface ReportDepartmentOption {
  id: string;
  name: string;
}

export interface ReportStudioData {
  savedViews: SavedReportView[];
  selectedView: SavedReportView | null;
  schedule: ReportScheduleSummary | null;
  snapshots: ReportSnapshotSummary[];
  runs: ReportScheduleRunSummary[];
  deliveryBatches: ReportDeliveryBatchSummary[];
  recipients: ReportRecipientOption[];
  departments: ReportDepartmentOption[];
  organizationTimezone: string;
  capabilities: {
    canManageSavedViews: boolean;
    canEditSelected: boolean;
    canSchedule: boolean;
    canCreateSnapshot: boolean;
    canDownloadSnapshot: boolean;
  };
}
