import "server-only";

import { runApprovalTimerWorker } from "@/modules/approvals/server/approval-worker";
import { runAuditPipelineHealthWorker } from "@/modules/audit/server/audit-pipeline-health";
import { runAutomationDispatchWorker } from "@/modules/automation/server/event-dispatch-worker";
import { runDueCrmConnectionSyncs } from "@/modules/crm/server/imports";
import { runFinanceOverdueWorker } from "@/modules/finance/server/overdue-worker";
import { runLegalAccessReviewWorker } from "@/modules/legal/server/access-review-worker";
import { runNotificationDeliveryWorker } from "@/modules/notifications/server/delivery-worker";
import { getPrivateFileScanConfiguration } from "@/modules/private-files/server/scan-config";
import { runPrivateFileScanWorker } from "@/modules/private-files/server/scan-worker";
import { runProjectReminderWorker } from "@/modules/projects/server/reminder-worker";
import { runReportDeliveryWorker } from "@/modules/reports/server/delivery-worker";

export const internalWorkerJobKeys = [
  "notifications",
  "automation",
  "private-files",
  "approvals",
  "crm-sync",
  "finance-overdue",
  "project-reminders",
  "legal-access-reviews",
  "audit-pipeline",
  "reports",
] as const;

export type InternalWorkerJobKey = (typeof internalWorkerJobKeys)[number];

export interface InternalWorkerDefinition {
  key: InternalWorkerJobKey;
  leaseName: string;
  execute: () => Promise<unknown>;
  ready: boolean;
  notConfiguredMessage: string;
  notReadyMessage?: string;
  unavailableMessage: string;
}

export function getInternalWorkerDefinition(key: InternalWorkerJobKey): InternalWorkerDefinition {
  if (key === "notifications") {
    return {
      key,
      leaseName: "notification-delivery",
      execute: runNotificationDeliveryWorker,
      ready: true,
      notConfiguredMessage: "Internal workers are not configured.",
      unavailableMessage: "Notification delivery could not run.",
    };
  }
  if (key === "automation") {
    return {
      key,
      leaseName: "automation-dispatch",
      execute: runAutomationDispatchWorker,
      ready: true,
      notConfiguredMessage: "Internal workers are not configured.",
      unavailableMessage: "Automation dispatch could not run.",
    };
  }
  if (key === "private-files") {
    const configuration = getPrivateFileScanConfiguration();
    return {
      key,
      leaseName: "private-file-scan",
      execute: runPrivateFileScanWorker,
      ready: configuration.configured,
      notConfiguredMessage: "Internal workers are not configured.",
      notReadyMessage: "The malware scanner provider is not configured.",
      unavailableMessage: "Private-file scanning could not run.",
    };
  }
  if (key === "approvals") {
    return {
      key,
      leaseName: "approval-timer",
      execute: runApprovalTimerWorker,
      ready: true,
      notConfiguredMessage: "Internal workers are not configured.",
      unavailableMessage: "Approval timer processing could not run.",
    };
  }
  if (key === "crm-sync") {
    return {
      key,
      leaseName: "crm-sync",
      execute: () => runDueCrmConnectionSyncs(2),
      ready: true,
      notConfiguredMessage: "Internal workers are not configured.",
      unavailableMessage: "Scheduled CRM sync could not run.",
    };
  }
  if (key === "finance-overdue") {
    return {
      key,
      leaseName: "finance-overdue",
      execute: runFinanceOverdueWorker,
      ready: true,
      notConfiguredMessage: "Internal workers are not configured.",
      unavailableMessage: "Finance overdue processing could not run.",
    };
  }
  if (key === "project-reminders") {
    return {
      key,
      leaseName: "project-reminders",
      execute: runProjectReminderWorker,
      ready: true,
      notConfiguredMessage: "Internal workers are not configured.",
      unavailableMessage: "Project task reminders could not run.",
    };
  }
  if (key === "legal-access-reviews") {
    return {
      key,
      leaseName: "legal-access-reviews",
      execute: runLegalAccessReviewWorker,
      ready: true,
      notConfiguredMessage: "Internal workers are not configured.",
      unavailableMessage: "Legal access-review scheduling could not run.",
    };
  }
  if (key === "audit-pipeline") {
    return {
      key,
      leaseName: "audit-pipeline-health",
      execute: runAuditPipelineHealthWorker,
      ready: true,
      notConfiguredMessage: "Internal workers are not configured.",
      unavailableMessage: "Audit-pipeline health check could not run.",
    };
  }
  return {
    key,
    leaseName: "reports-delivery",
    execute: runReportDeliveryWorker,
    ready: true,
    notConfiguredMessage: "Internal workers are not configured.",
    unavailableMessage: "Report delivery could not run.",
  };
}
