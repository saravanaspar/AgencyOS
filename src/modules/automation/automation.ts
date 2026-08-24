export const automationExecutionStatuses = ["started", "succeeded", "failed", "cancelled"] as const;
export type AutomationExecutionStatus = (typeof automationExecutionStatuses)[number];

export const automationDispatchStatuses = [
  "pending",
  "processing",
  "retry",
  "delivered",
  "dead_letter",
  "cancelled",
] as const;
export type AutomationDispatchStatus = (typeof automationDispatchStatuses)[number];

export const automationAiIntentStatuses = [
  "pending_approval",
  "executing",
  "executed",
  "failed",
  "cancelled",
] as const;
export type AutomationAiIntentStatus = (typeof automationAiIntentStatuses)[number];

export const automationTriggerKeys = [
  "crm.lead_converted",
  "projects.project_created",
  "finance.invoice_issued",
  "finance.invoice_overdue",
  "finance.payment_received",
  "hr.employee_onboarded",
  "hr.employee_offboarded",
  "hr.leave_approved",
  "legal.contract_expiring",
  "support.ticket_escalated",
  "assets.asset_assigned",
] as const;
export type AutomationTriggerKey = (typeof automationTriggerKeys)[number];

export const automationHandlers = [
  {
    key: "notification.owner",
    label: "Notify automation owner",
    description: "Creates an in-app notification for the automation owner.",
  },
  {
    key: "notification.event_actor",
    label: "Notify event actor",
    description: "Creates an in-app notification for the membership that caused the event.",
  },
] as const;

export const automationHandlerKeys = automationHandlers.map((handler) => handler.key) as [
  (typeof automationHandlers)[number]["key"],
  ...(typeof automationHandlers)[number]["key"][],
];
export type AutomationHandlerKey = (typeof automationHandlers)[number]["key"];

export function isAutomationHandlerKey(value: string): value is AutomationHandlerKey {
  return automationHandlers.some((handler) => handler.key === value);
}

export const vaultwardenEntityTypes = ["project", "client", "vendor"] as const;
export type VaultwardenEntityType = (typeof vaultwardenEntityTypes)[number];

export const vaultwardenVisibilityPermissions: Record<VaultwardenEntityType, string> = {
  project: "projects.project.view",
  client: "crm.company.view",
  vendor: "vendors.workspace.view",
};

export interface AutomationDefinitionSummary {
  id: string;
  name: string;
  triggerKey: string;
  handlerKey: string;
  enabled: boolean;
  allowedModules: string[];
  ownerName: string;
  lastExecutionAt: string | null;
  lastResult: AutomationExecutionStatus | null;
  errorCount: number;
  createdAt: string;
}

export interface AutomationExecutionSummary {
  id: string;
  automationId: string;
  automationName: string;
  executionId: string;
  handlerKey: string;
  sourceModule: string;
  status: AutomationExecutionStatus;
  resultSummary: string | null;
  occurredAt: string;
  completedAt: string;
}

export interface AutomationDispatchSummary {
  id: string;
  eventKey: string;
  sourceModule: string;
  entityType: string;
  entityId: string;
  automationName: string;
  handlerKey: string;
  status: AutomationDispatchStatus;
  attemptCount: number;
  maxAttempts: number;
  availableAt: string;
  deliveredAt: string | null;
  lastErrorCode: string | null;
  lastErrorSummary: string | null;
  createdAt: string;
}

export interface AutomationAiIntentSummary {
  id: string;
  requesterName: string;
  toolName: string;
  status: AutomationAiIntentStatus;
  approvalRequestId: string | null;
  approvalStatus: string | null;
  createdAt: string;
  executedAt: string | null;
  failureCode: string | null;
}

export interface AutomationAiExecutionSummary {
  id: string;
  actorName: string;
  toolName: string;
  operationMode: "read" | "mutation" | "sensitive_mutation";
  status: "started" | "approval_required" | "succeeded" | "failed";
  errorCode: string | null;
  startedAt: string;
  completedAt: string;
}

export interface VaultwardenLinkSummary {
  id: string;
  entityType: VaultwardenEntityType;
  entityId: string;
  entityLabel: string;
  itemReference: string;
  visibilityPermissionKey: string;
  openUrl: string | null;
  createdAt: string;
}

export interface AutomationEntityOption {
  entityType: "project" | "client";
  id: string;
  label: string;
}

export interface AutomationWorkspaceData {
  workerConfigured: boolean;
  vaultwardenConfigured: boolean;
  aiApprovalPolicyConfigured: boolean;
  handlers: typeof automationHandlers;
  definitions: AutomationDefinitionSummary[];
  executions: AutomationExecutionSummary[];
  dispatches: AutomationDispatchSummary[];
  aiIntents: AutomationAiIntentSummary[];
  aiExecutions: AutomationAiExecutionSummary[];
  vaultwardenLinks: VaultwardenLinkSummary[];
  entityOptions: AutomationEntityOption[];
  capabilities: {
    canManageDefinitions: boolean;
    canViewExecutions: boolean;
    canRetryDispatches: boolean;
    canViewAiExecutions: boolean;
    canManageVaultwardenLinks: boolean;
  };
}

export function automationRetryDelaySeconds(attemptNumber: number): number {
  const boundedAttempt = Math.min(Math.max(Math.trunc(attemptNumber), 1), 20);
  return Math.min(21_600, 30 * 2 ** (boundedAttempt - 1));
}
