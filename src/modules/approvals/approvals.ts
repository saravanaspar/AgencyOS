export const approvalStatuses = [
  "pending",
  "approved",
  "rejected",
  "revision_requested",
  "cancelled",
  "expired",
  "invalidated",
] as const;

export type ApprovalStatus = (typeof approvalStatuses)[number];
export type ApprovalStatusFilter = "all" | ApprovalStatus;
export type ApprovalView = "inbox" | "submitted" | "all";
export type ApprovalSelectorType = "manager" | "role" | "membership";
export type ApprovalDecisionMode = "any" | "all";
export type ApprovalStepStatus =
  | "waiting"
  | "pending"
  | "approved"
  | "rejected"
  | "revision_requested"
  | "skipped"
  | "cancelled"
  | "expired";

export const approvalStatusLabels: Record<ApprovalStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  revision_requested: "Revision requested",
  cancelled: "Cancelled",
  expired: "Expired",
  invalidated: "Invalidated",
};

export const approvalStepStatusLabels: Record<ApprovalStepStatus, string> = {
  waiting: "Waiting",
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  revision_requested: "Revision requested",
  skipped: "Skipped",
  cancelled: "Cancelled",
  expired: "Expired",
};

export const approvalSelectorLabels: Record<ApprovalSelectorType, string> = {
  manager: "Requester manager",
  role: "Organization role",
  membership: "Named member",
};

export const approvalDecisionModeLabels: Record<ApprovalDecisionMode, string> = {
  any: "Any assigned approver",
  all: "Every assigned approver",
};

export interface ApprovalDefinitionStepInput {
  name: string;
  stageOrder: number;
  sortOrder: number;
  selectorType: ApprovalSelectorType;
  selectorRoleKey: string | null;
  selectorMembershipId: string | null;
  decisionMode: ApprovalDecisionMode;
  conditions: {
    minimumAmount?: number;
    maximumAmount?: number;
    departmentId?: string;
  };
  commentRequired: boolean;
  reminderAfterHours: number | null;
  escalationAfterHours: number | null;
  expiresAfterHours: number | null;
}

export interface ApprovalDefinitionSummary {
  id: string;
  key: string;
  name: string;
  description: string | null;
  sourceModule: string;
  entityType: string;
  version: number;
  status: "active" | "inactive";
  allowSelfApproval: boolean;
  allowReassignment: boolean;
  steps: Array<{
    id: string;
    name: string;
    stageOrder: number;
    sortOrder: number;
    selectorType: ApprovalSelectorType;
    selectorRoleKey: string | null;
    selectorMembershipId: string | null;
    selectorDisplayName: string | null;
    decisionMode: ApprovalDecisionMode;
    conditions: ApprovalDefinitionStepInput["conditions"];
    commentRequired: boolean;
    reminderAfterHours: number | null;
    escalationAfterHours: number | null;
    expiresAfterHours: number | null;
  }>;
}

export interface ApprovalRequestListItem {
  id: string;
  title: string;
  sourceModule: string;
  entityType: string;
  entityId: string | null;
  deepLink: string | null;
  status: ApprovalStatus;
  currentStage: number | null;
  amount: number | null;
  currency: string | null;
  requesterMembershipId: string;
  requesterDisplayName: string;
  submittedAt: string;
  dueAt: string | null;
  completedAt: string | null;
  definitionName: string;
  snapshot: Record<string, unknown>;
  pendingSteps: Array<{
    id: string;
    stepName: string;
    stageOrder: number;
    status: ApprovalStepStatus;
    approverMembershipId: string;
    approverDisplayName: string;
    delegatedFromDisplayName: string | null;
    commentRequired: boolean;
    dueAt: string | null;
    reminderCount: number;
    escalatedAt: string | null;
    canAct: boolean;
    canReassign: boolean;
  }>;
  actions: Array<{
    id: string;
    action: string;
    actorDisplayName: string;
    comment: string | null;
    createdAt: string;
  }>;
}

export interface ApprovalDirectoryMember {
  id: string;
  displayName: string;
  email: string;
  departmentId: string | null;
  managerMembershipId: string | null;
  canApprove: boolean;
}

export interface ApprovalRoleOption {
  key: string;
  name: string;
}

export interface ApprovalDelegationItem {
  id: string;
  fromMembershipId: string;
  fromDisplayName: string;
  toMembershipId: string;
  toDisplayName: string;
  sourceModule: string | null;
  startsAt: string;
  endsAt: string;
  status: "active" | "revoked" | "expired";
  reason: string | null;
  canRevoke: boolean;
}

export interface ApprovalWorkspaceData {
  definitions: ApprovalDefinitionSummary[];
  requests: ApprovalRequestListItem[];
  members: ApprovalDirectoryMember[];
  roles: ApprovalRoleOption[];
  departments: Array<{ id: string; name: string }>;
  delegations: ApprovalDelegationItem[];
  filters: {
    view: ApprovalView;
    status: ApprovalStatusFilter;
    q: string;
    page: number;
  };
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
  summary: {
    assignedPending: number;
    submittedPending: number;
    decidedThisMonth: number;
    overdue: number;
  };
  capabilities: {
    canCreateRequest: boolean;
    canManageDefinitions: boolean;
    canManageDelegations: boolean;
    canApprove: boolean;
    canReject: boolean;
    canReassign: boolean;
    canViewAllRequests: boolean;
  };
  currentMembershipId: string;
}

export function safeApprovalDeepLink(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim();
  if (
    !normalized.startsWith("/") ||
    normalized.startsWith("//") ||
    normalized.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return null;
  }
  return normalized.slice(0, 500);
}

export function approvalStatusTone(
  status: ApprovalStatus | ApprovalStepStatus,
): "success" | "warning" | "error" | "info" | "neutral" {
  if (status === "approved") return "success";
  if (status === "rejected" || status === "expired" || status === "invalidated") return "error";
  if (status === "revision_requested") return "warning";
  if (status === "pending") return "info";
  return "neutral";
}
