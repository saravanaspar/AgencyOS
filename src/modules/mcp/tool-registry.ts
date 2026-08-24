import "server-only";

import { getAuditLogData } from "@/modules/audit/server/audit-log";
import {
  bumpRedisCacheVersion,
  getRedisCacheVersion,
  readThroughRedisJsonCache,
} from "@/integrations/redis/cache";
import {
  cancelCalendarEventAction,
  createCalendarEventAction,
} from "@/modules/calendar/actions/calendar";
import {
  calendarPermissionKeys,
  calendarRecurrenceFrequencies,
  calendarScopes,
  calendarViews,
  calendarVisibilityOptions,
  customCalendarEventTypes,
} from "@/modules/calendar/calendar";
import { calendarFiltersSchema } from "@/modules/calendar/schemas/calendar";
import { getCalendarWorkspaceData } from "@/modules/calendar/server/calendar";
import { getDashboardWorkspaceData } from "@/modules/dashboard/server/dashboard";
import { modulePermissionKeys } from "@/modules/permissions/module-access";
import {
  reportsPermissionKeys,
  reportComparisons,
  reportSections,
} from "@/modules/reports/reports";
import { parseReportsFilters } from "@/modules/reports/schemas/reports";
import { getReportsWorkspaceData } from "@/modules/reports/server/reports";
import {
  createAutomationDefinitionAction,
  retryAutomationDispatchAction,
  setAutomationEnabledAction,
} from "@/modules/automation/actions/automation";
import {
  automationPermissionKeys,
  getAutomationWorkspaceData,
} from "@/modules/automation/server/automation";
import { globalSearchPermissionKey } from "@/modules/search/search";
import { searchAuthorizedRecords } from "@/modules/search/server/search";
import {
  cancelApprovalRequestAction,
  createApprovalRequestAction,
  decideApprovalStepAction,
  reassignApprovalStepAction,
} from "@/modules/approvals/actions/approvals";
import { approvalFiltersSchema } from "@/modules/approvals/schemas/approvals";
import {
  approvalPermissionKeys,
  getApprovalWorkspaceData,
} from "@/modules/approvals/server/approvals";
import {
  convertLeadAction,
  createActivityAction,
  createCompanyAction,
  createContactAction,
  createLeadAction,
  createPipelineStageAction,
  deleteLeadAction,
  qualifyLeadAction,
  setCompanyPrimaryContactAction,
  updateCompanyAction,
  updateContactAction,
  updateLeadAction,
  updateLeadStageAction,
} from "@/modules/crm/actions/crm";
import { getCrmWorkspaceData } from "@/modules/crm/server/crm";
import {
  createCatalogItemAction,
  createCreditNoteAction,
  createEstimateAction,
  createInvoiceAction,
  createRevisedInvoiceAction,
  createPaymentAction,
  decideFinanceApprovalAction,
  generateFinanceDocumentSnapshotAction,
  issueCreditNoteAction,
  issueInvoiceAction,
  reconcilePaymentAction,
  recordPaymentRefundAction,
  updateInvoiceStatusAction,
  voidCreditNoteAction,
  voidInvoiceAction,
} from "@/modules/finance/actions/finance";
import { financePermissionKeys } from "@/modules/finance/finance";
import { documentPermissionKeys } from "@/modules/documents/documents";
import { getDocumentWorkspaceData } from "@/modules/documents/server/documents";
import { getFinanceWorkspaceData } from "@/modules/finance/server/finance";
import { hrPermissionKeys } from "@/modules/hr/hr";
import { getHrWorkspaceData } from "@/modules/hr/server/hr";
import { legalCompliancePermissionKeys } from "@/modules/legal/compliance";
import { legalPermissionKeys } from "@/modules/legal/legal";
import { getLegalComplianceWorkspaceData } from "@/modules/legal/server/compliance";
import { getLegalWorkspaceData } from "@/modules/legal/server/legal";
import {
  checkCrmConnectionHealthAction,
  deleteCrmConnectionAction,
  setCrmConnectionStatusAction,
  syncCrmConnectionAction,
  updateCrmConnectionScheduleAction,
} from "@/modules/crm/actions/imports";
import { parseAuditLogFilters } from "@/modules/audit/schemas/audit-log";
import {
  changeMemberRoleAction,
  changeMemberStatusAction,
  grantUserAccessAction,
} from "@/modules/identity/actions/access-management";
import { getAccessManagementData } from "@/modules/identity/server/access-management";
import {
  assignTeamMemberAction,
  changeDepartmentStatusAction,
  changeTeamStatusAction,
  createDepartmentAction,
  createTeamAction,
  deleteDepartmentAction,
  deleteTeamAction,
  removeTeamMemberAction,
  updateDepartmentAction,
  updateMemberStructureAction,
  updateTeamAction,
} from "@/modules/organization-structure/actions/organization-structure";
import { getOrganizationStructureData } from "@/modules/organization-structure/server/organization-structure";
import { updateOrganizationProfileAction } from "@/modules/organizations/actions/organization-profile";
import { getOrganizationProfileData } from "@/modules/organizations/server/organization-profile";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/modules/notifications/actions/notifications";
import { notificationFiltersSchema } from "@/modules/notifications/schemas/notifications";
import {
  getNotificationCenterData,
  notificationPermissionKeys,
} from "@/modules/notifications/server/notifications";
import {
  changeRoleStatusAction,
  createRoleAction,
  deleteMemberOverrideAction,
  deleteRoleAction,
  saveMemberOverrideAction,
  saveRolePermissionsAction,
  updateRoleAction,
} from "@/modules/permissions/actions/role-editor";
import type { PermissionScope } from "@/modules/permissions/permission-scopes";
import {
  authorizeCurrentUser,
  type AuthorizationFailureReason,
} from "@/modules/permissions/server/authorization";
import { getCurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";
import { getAssetWorkspaceData } from "@/modules/assets/server/assets";
import { assetPermissionKeys } from "@/modules/assets/assets";
import { getVendorWorkspaceData } from "@/modules/vendors/server/vendors";
import { vendorPermissionKeys } from "@/modules/vendors/vendors";
import { getPermissionViewerData } from "@/modules/permissions/server/permission-viewer";
import { getRoleEditorData } from "@/modules/permissions/server/role-editor";
import {
  addProjectMemberAction,
  archiveProjectAction,
  closeProjectAction,
  createProjectAction,
  createProjectChecklistItemAction,
  createProjectCommentAction,
  createProjectLabelAction,
  createProjectMilestoneAction,
  createProjectPhaseAction,
  createProjectTaskAction,
  createProjectTimeEntryAction,
  moveProjectTaskAction,
  requestProjectClosureAction,
  saveProjectTaskAssigneeAction,
  saveProjectTaskDependencyAction,
  saveProjectTaskLabelAction,
  saveProjectTaskRecurrenceAction,
  saveProjectTaskWatcherAction,
  toggleProjectChecklistItemAction,
  toggleProjectClosureItemAction,
  updateProjectMilestoneStatusAction,
  updateProjectPhaseStatusAction,
  updateProjectAction,
} from "@/modules/projects/actions/projects";
import { getProjectsWorkspaceData } from "@/modules/projects/server/projects";
import { getSupportWorkspaceData } from "@/modules/support/server/support";
import { supportPermissionKeys } from "@/modules/support/support";
import {
  AI_APPROVAL_ARGUMENT_NAME,
  beginApprovedMcpMutation,
  completeApprovedMcpMutation,
  ensureBoundedMcpOutput,
  getAiOperationMode,
  prepareMcpInput,
  recordAiExecutionEvent,
  requestSensitiveMcpApproval,
  toolRequiresAiApproval,
} from "@/modules/mcp/ai-governance";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

export const AGENCYOS_MCP_PROTOCOL_VERSION = "2025-11-25";

export class McpToolError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "ACTION_FAILED"
      | "INVALID_ARGUMENTS"
      | "NOT_FOUND"
      | "UNAUTHORIZED"
      | "UNAVAILABLE" = "ACTION_FAILED",
  ) {
    super(message);
    this.name = "McpToolError";
  }
}

type JsonSchema = Record<string, unknown>;

type ToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

export interface AgencyOsMcpToolDescriptor {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: ToolAnnotations;
}

interface AgencyOsMcpToolDefinition extends AgencyOsMcpToolDescriptor {
  requiredPermissions: readonly string[];
  requiredAnyPermissions?: readonly string[];
  execute: (input: Record<string, unknown>) => Promise<unknown>;
}

interface ActionState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string[]>;
  conflict?: boolean;
}

type ActionFunction = (
  previousState: { status: "idle" },
  formData: FormData,
) => Promise<ActionState>;

const emptyObjectSchema: JsonSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

const uuidSchema = { type: "string", format: "uuid" } as const;
const nullableUuidSchema = { anyOf: [uuidSchema, { type: "null" }] } as const;

function objectSchema(
  properties: Record<string, unknown>,
  required: readonly string[] = [],
): JsonSchema {
  return {
    type: "object",
    properties,
    required: [...required],
    additionalProperties: false,
  };
}

const financeDocumentLineSchema: JsonSchema = objectSchema(
  {
    catalogItemId: nullableUuidSchema,
    description: { type: "string", minLength: 1, maxLength: 500 },
    quantity: { type: "string", pattern: "^\\d+(?:\\.\\d+)?$" },
    unitRate: { type: "string", pattern: "^\\d+(?:\\.\\d+)?$" },
    discountPercent: { type: "string", pattern: "^\\d+(?:\\.\\d+)?$", default: "0" },
    taxPercent: { type: "string", pattern: "^\\d+(?:\\.\\d+)?$", default: "0" },
  },
  ["description", "quantity", "unitRate", "discountPercent", "taxPercent"],
);

function toFormData(input: Record<string, unknown>): FormData {
  const formData = new FormData();

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (value === null) {
      formData.set(key, "");
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        formData.append(key, typeof item === "object" ? JSON.stringify(item) : String(item));
      }
      continue;
    }
    if (typeof value === "object") {
      formData.set(key, JSON.stringify(value));
      continue;
    }
    formData.set(key, String(value));
  }

  return formData;
}

async function runAction(
  action: ActionFunction,
  input: Record<string, unknown>,
): Promise<{ message: string }> {
  const result = await action({ status: "idle" }, toFormData(input));

  if (result.status !== "success") {
    const fieldSummary = result.fieldErrors
      ? Object.entries(result.fieldErrors)
          .flatMap(([field, messages]) => messages.map((message) => `${field}: ${message}`))
          .join("; ")
      : "";
    throw new McpToolError(
      [result.message ?? "The operation could not be completed.", fieldSummary]
        .filter(Boolean)
        .join(" "),
      result.conflict ? "UNAVAILABLE" : "ACTION_FAILED",
    );
  }

  return { message: result.message ?? "Operation completed." };
}

function unwrapResult<T>(
  result: { allowed: true; data: T } | { allowed: false; reason: string },
): T {
  if (result.allowed) return result.data;
  throw new McpToolError(
    result.reason === "access-check-failed"
      ? "AgencyOS could not verify access because a required service is temporarily unavailable."
      : `AgencyOS denied this operation: ${result.reason}.`,
    result.reason === "access-check-failed" ? "UNAVAILABLE" : "UNAUTHORIZED",
  );
}

function hasAllPermissions(
  permissions: ReadonlySet<string>,
  requiredPermissions: readonly string[],
): boolean {
  return requiredPermissions.every((permission) => permissions.has(permission));
}

function hasAnyPermission(
  permissions: ReadonlySet<string>,
  requiredAnyPermissions?: readonly string[],
): boolean {
  return (
    !requiredAnyPermissions?.length ||
    requiredAnyPermissions.some((permission) => permissions.has(permission))
  );
}

const scopeSchema = {
  type: "string",
  enum: [
    "own",
    "assigned",
    "assigned_or_created",
    "team",
    "department",
    "managed_employees",
    "selected_projects",
    "organization",
  ],
} as const;

export const AGENCYOS_MCP_TOOLS: readonly AgencyOsMcpToolDefinition[] = [
  {
    name: "agencyos.access.get_current",
    title: "Get current AgencyOS access",
    description:
      "Returns the signed-in user's organization membership and effective permission keys. The user and organization are always derived from the active session.",
    inputSchema: emptyObjectSchema,
    requiredPermissions: [],
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute() {
      const context = await getCurrentPermissionContext();
      if (!context.allowed) {
        throw new McpToolError(`Access unavailable: ${context.reason}.`, "UNAUTHORIZED");
      }
      return {
        user: { id: context.context.user.id, email: context.context.user.email },
        membership: context.context.membership,
        permissions: [...context.context.permissions].sort(),
      };
    },
  },
  {
    name: "agencyos.dashboard.get_workspace",
    title: "Read dashboard workspace",
    description:
      "Reads the current user's permission-filtered dashboard metrics and operational sections.",
    inputSchema: emptyObjectSchema,
    requiredPermissions: [modulePermissionKeys.dashboard],
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute() {
      return unwrapResult(await getDashboardWorkspaceData());
    },
  },
  {
    name: "agencyos.calendar.get_workspace",
    title: "Read calendar workspace",
    description:
      "Reads permission-filtered calendar events for a date, view, scope, type, and optional project.",
    inputSchema: objectSchema({
      anchor: { type: "string", format: "date" },
      view: { type: "string", enum: [...calendarViews] },
      scope: { type: "string", enum: ["all", ...calendarScopes] },
      type: { type: "string", maxLength: 80 },
      project: { type: "string", maxLength: 80 },
    }),
    requiredPermissions: [calendarPermissionKeys.workspace, calendarPermissionKeys.view],
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute(input) {
      const parsed = calendarFiltersSchema.parse(input);
      return unwrapResult(await getCalendarWorkspaceData(parsed));
    },
  },
  {
    name: "agencyos.calendar.create_event",
    title: "Create calendar event",
    description:
      "Creates a calendar event in an allowed personal, team, department, project, or company scope.",
    inputSchema: objectSchema(
      {
        title: { type: "string", minLength: 2, maxLength: 180 },
        description: { anyOf: [{ type: "string", maxLength: 4000 }, { type: "null" }] },
        eventType: { type: "string", enum: [...customCalendarEventTypes] },
        scope: { type: "string", enum: [...calendarScopes] },
        visibility: { type: "string", enum: [...calendarVisibilityOptions] },
        ownerMembershipId: nullableUuidSchema,
        teamId: nullableUuidSchema,
        departmentId: nullableUuidSchema,
        projectId: nullableUuidSchema,
        startsAt: { type: "string", format: "date-time" },
        endsAt: { type: "string", format: "date-time" },
        allDay: { type: "boolean" },
        timezone: { type: "string", minLength: 1, maxLength: 80 },
        recurrenceFrequency: { type: "string", enum: [...calendarRecurrenceFrequencies] },
        recurrenceInterval: { type: "integer", minimum: 1, maximum: 52 },
        recurrenceUntil: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
        location: { anyOf: [{ type: "string", maxLength: 300 }, { type: "null" }] },
        meetingUrl: {
          anyOf: [{ type: "string", format: "uri", maxLength: 1000 }, { type: "null" }],
        },
        attendeeMembershipIds: { type: "array", items: uuidSchema, maxItems: 100 },
      },
      [
        "title",
        "eventType",
        "scope",
        "visibility",
        "startsAt",
        "endsAt",
        "allDay",
        "timezone",
        "recurrenceFrequency",
        "recurrenceInterval",
        "attendeeMembershipIds",
      ],
    ),
    requiredPermissions: [calendarPermissionKeys.workspace, calendarPermissionKeys.create],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: (input) => runAction(createCalendarEventAction as ActionFunction, input),
  },
  {
    name: "agencyos.calendar.cancel_event",
    title: "Cancel calendar event",
    description: "Cancels a managed custom calendar event by identifier.",
    inputSchema: objectSchema({ eventId: uuidSchema }, ["eventId"]),
    requiredPermissions: [calendarPermissionKeys.workspace, calendarPermissionKeys.manage],
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(cancelCalendarEventAction as ActionFunction, input),
  },
  {
    name: "agencyos.reports.get_workspace",
    title: "Read reports workspace",
    description:
      "Reads permission-filtered operational report metrics and sections for the selected date range and filters.",
    inputSchema: objectSchema({
      from: { type: "string", format: "date" },
      to: { type: "string", format: "date" },
      comparison: { type: "string", enum: [...reportComparisons] },
      section: { type: "string", enum: [...reportSections] },
      owner: nullableUuidSchema,
      team: nullableUuidSchema,
      department: nullableUuidSchema,
      project: nullableUuidSchema,
      client: nullableUuidSchema,
      status: { anyOf: [{ type: "string", maxLength: 60 }, { type: "null" }] },
    }),
    requiredPermissions: [reportsPermissionKeys.workspace],
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute(input) {
      return unwrapResult(await getReportsWorkspaceData(parseReportsFilters(input)));
    },
  },
  {
    name: "agencyos.automation.get_workspace",
    title: "Read automation workspace",
    description:
      "Reads automation definitions, executions, AI operations, approval policies, and vault references allowed for the current user.",
    inputSchema: emptyObjectSchema,
    requiredPermissions: [automationPermissionKeys.workspace],
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute() {
      const context = await getCurrentPermissionContext();
      if (!context.allowed) throw mapAuthorizationFailureToMcpError(context.reason);
      return getAutomationWorkspaceData(context.context);
    },
  },
  {
    name: "agencyos.automation.create_definition",
    title: "Create automation definition",
    description:
      "Creates a bounded internal automation definition with a registered handler, explicit module allow-list, and conditions.",
    inputSchema: objectSchema(
      {
        name: { type: "string", minLength: 2, maxLength: 160 },
        triggerKey: { type: "string", pattern: "^[a-z][a-z0-9._-]{2,119}$" },
        handlerKey: {
          type: "string",
          enum: ["notification.owner", "notification.event_actor"],
        },
        allowedModules: {
          type: "array",
          items: { type: "string", pattern: "^[a-z][a-z0-9_-]{1,39}$" },
          minItems: 1,
          maxItems: 32,
        },
        conditions: { type: "object", additionalProperties: false },
      },
      ["name", "triggerKey", "handlerKey", "allowedModules", "conditions"],
    ),
    requiredPermissions: [
      automationPermissionKeys.workspace,
      automationPermissionKeys.manageDefinitions,
    ],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: (input) => runAction(createAutomationDefinitionAction as ActionFunction, input),
  },
  {
    name: "agencyos.automation.set_enabled",
    title: "Enable or disable automation",
    description: "Enables or disables an existing automation definition.",
    inputSchema: objectSchema({ automationId: uuidSchema, enabled: { type: "boolean" } }, [
      "automationId",
      "enabled",
    ]),
    requiredPermissions: [
      automationPermissionKeys.workspace,
      automationPermissionKeys.manageDefinitions,
    ],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    execute: (input) => runAction(setAutomationEnabledAction as ActionFunction, input),
  },
  {
    name: "agencyos.automation.retry_dispatch",
    title: "Retry automation dispatch",
    description: "Queues a failed or retryable automation dispatch for another delivery attempt.",
    inputSchema: objectSchema({ dispatchId: uuidSchema }, ["dispatchId"]),
    requiredPermissions: [
      automationPermissionKeys.workspace,
      automationPermissionKeys.retryExecutions,
    ],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    execute: (input) => runAction(retryAutomationDispatchAction as ActionFunction, input),
  },
  {
    name: "agencyos.search.records",
    title: "Search authorized records",
    description:
      "Searches across AgencyOS records and returns only entities visible under the current user's permissions and scopes.",
    inputSchema: objectSchema(
      {
        query: { type: "string", minLength: 2, maxLength: 200 },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      ["query"],
    ),
    requiredPermissions: [globalSearchPermissionKey],
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute(input) {
      return unwrapResult(await searchAuthorizedRecords(input.query, Number(input.limit ?? 30)));
    },
  },
  {
    name: "agencyos.organization.get_profile",
    title: "Get organization profile",
    description: "Reads the current organization identity and operating defaults.",
    inputSchema: emptyObjectSchema,
    requiredPermissions: ["settings.organization.view"],
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute() {
      return unwrapResult(await getOrganizationProfileData());
    },
  },
  {
    name: "agencyos.organization.update_profile",
    title: "Update organization profile",
    description:
      "Updates organization identity and regional defaults. The immutable organization identifier cannot be changed.",
    inputSchema: objectSchema(
      {
        legalName: { type: "string", minLength: 2, maxLength: 160 },
        displayName: {
          anyOf: [{ type: "string", minLength: 2, maxLength: 160 }, { type: "null" }],
        },
        countryCode: { anyOf: [{ type: "string", pattern: "^[A-Z]{2}$" }, { type: "null" }] },
        timezone: { type: "string", minLength: 1, maxLength: 100 },
        defaultCurrency: { type: "string", pattern: "^[A-Z]{3}$" },
        financialYearStartMonth: { type: "integer", minimum: 1, maximum: 12 },
        expectedUpdatedAt: { type: "string", format: "date-time" },
      },
      [
        "legalName",
        "displayName",
        "countryCode",
        "timezone",
        "defaultCurrency",
        "financialYearStartMonth",
        "expectedUpdatedAt",
      ],
    ),
    requiredPermissions: ["settings.organization.update"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(updateOrganizationProfileAction as ActionFunction, input),
  },
  {
    name: "agencyos.users.list",
    title: "List organization users",
    description: "Lists members, roles, and membership status for the current organization.",
    inputSchema: emptyObjectSchema,
    requiredPermissions: ["settings.user.view"],
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute() {
      return unwrapResult(await getAccessManagementData());
    },
  },
  {
    name: "agencyos.users.grant_access",
    title: "Grant organization access",
    description:
      "Grants a confirmed signup account access to the current organization with an initial role.",
    inputSchema: objectSchema({ email: { type: "string", format: "email" }, roleId: uuidSchema }, [
      "email",
      "roleId",
    ]),
    requiredPermissions: ["settings.user.create", "settings.role.manage_access"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(grantUserAccessAction as ActionFunction, input),
  },
  {
    name: "agencyos.users.change_role",
    title: "Change a member role",
    description:
      "Replaces an organization member's assigned role while preserving last-owner safeguards.",
    inputSchema: objectSchema({ membershipId: uuidSchema, roleId: uuidSchema }, [
      "membershipId",
      "roleId",
    ]),
    requiredPermissions: ["settings.role.manage_access"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(changeMemberRoleAction as ActionFunction, input),
  },
  {
    name: "agencyos.users.change_status",
    title: "Change member access status",
    description: "Activates, suspends, or deactivates an organization membership.",
    inputSchema: objectSchema(
      {
        membershipId: uuidSchema,
        status: { type: "string", enum: ["active", "suspended", "deactivated"] },
      },
      ["membershipId", "status"],
    ),
    requiredPermissions: ["settings.user.update", "settings.user.manage_access"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(changeMemberStatusAction as ActionFunction, input),
  },
  {
    name: "agencyos.audit.search",
    title: "Search organization audit events",
    description: "Searches permission-protected audit events for the current organization.",
    inputSchema: objectSchema({
      q: { type: "string", maxLength: 120, default: "" },
      action: { type: "string", maxLength: 120, default: "" },
      from: { type: "string", format: "date", default: "" },
      to: { type: "string", format: "date", default: "" },
      page: { type: "integer", minimum: 1, maximum: 10000, default: 1 },
    }),
    requiredPermissions: ["settings.audit.view"],
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute(input) {
      const filters = parseAuditLogFilters(input);
      return unwrapResult(await getAuditLogData(filters));
    },
  },
  {
    name: "agencyos.permissions.inspect_member",
    title: "Inspect effective member permissions",
    description:
      "Resolves role grants and active overrides for one member in the current organization.",
    inputSchema: objectSchema({ membershipId: nullableUuidSchema }),
    requiredPermissions: ["settings.permission.view"],
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute(input) {
      const membershipId = typeof input.membershipId === "string" ? input.membershipId : undefined;
      return unwrapResult(await getPermissionViewerData(membershipId));
    },
  },
  {
    name: "agencyos.roles.get_editor_data",
    title: "List roles and permission grants",
    description:
      "Lists organization roles, grants, permission catalogue, members, and active overrides.",
    inputSchema: emptyObjectSchema,
    requiredPermissions: ["settings.role.view"],
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute() {
      return unwrapResult(await getRoleEditorData());
    },
  },
  {
    name: "agencyos.roles.create",
    title: "Create a custom role",
    description: "Creates a non-system organization role with no initial permissions.",
    inputSchema: objectSchema(
      {
        name: { type: "string", minLength: 2, maxLength: 80 },
        description: { anyOf: [{ type: "string", maxLength: 500 }, { type: "null" }] },
      },
      ["name"],
    ),
    requiredPermissions: ["settings.role.create"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: (input) => runAction(createRoleAction as ActionFunction, input),
  },
  {
    name: "agencyos.roles.update",
    title: "Update a custom role",
    description: "Renames or changes the description of a non-system role.",
    inputSchema: objectSchema(
      {
        roleId: uuidSchema,
        name: { type: "string", minLength: 2, maxLength: 80 },
        description: { anyOf: [{ type: "string", maxLength: 500 }, { type: "null" }] },
      },
      ["roleId", "name"],
    ),
    requiredPermissions: ["settings.role.update"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(updateRoleAction as ActionFunction, input),
  },
  {
    name: "agencyos.roles.change_status",
    title: "Activate or deactivate a custom role",
    description:
      "Changes a non-system role's active status with administrator coverage safeguards.",
    inputSchema: objectSchema(
      { roleId: uuidSchema, status: { type: "string", enum: ["active", "inactive"] } },
      ["roleId", "status"],
    ),
    requiredPermissions: ["settings.role.update"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(changeRoleStatusAction as ActionFunction, input),
  },
  {
    name: "agencyos.roles.delete",
    title: "Delete an unused custom role",
    description: "Permanently deletes an inactive, unassigned custom role.",
    inputSchema: objectSchema({ roleId: uuidSchema }, ["roleId"]),
    requiredPermissions: ["settings.role.delete"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: (input) => runAction(deleteRoleAction as ActionFunction, input),
  },
  {
    name: "agencyos.roles.set_permissions",
    title: "Replace custom role permissions",
    description: "Replaces the complete permission grant set for a custom role.",
    inputSchema: objectSchema(
      {
        roleId: uuidSchema,
        grants: {
          type: "array",
          maxItems: 500,
          items: objectSchema({ permissionId: uuidSchema, scope: scopeSchema }, [
            "permissionId",
            "scope",
          ]),
        },
      },
      ["roleId", "grants"],
    ),
    requiredPermissions: ["settings.role.manage_access"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(saveRolePermissionsAction as ActionFunction, input),
  },
  {
    name: "agencyos.permissions.set_member_override",
    title: "Set a member permission override",
    description:
      "Creates or updates an explicit allow or deny override for one organization member.",
    inputSchema: objectSchema(
      {
        membershipId: uuidSchema,
        permissionId: uuidSchema,
        effect: { type: "string", enum: ["allow", "deny"] },
        scope: { anyOf: [scopeSchema, { type: "null" }] },
        reason: { type: "string", minLength: 3, maxLength: 300 },
        expiresAt: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
      },
      ["membershipId", "permissionId", "effect", "reason"],
    ),
    requiredPermissions: ["settings.permission.manage_access"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(saveMemberOverrideAction as ActionFunction, input),
  },
  {
    name: "agencyos.permissions.delete_member_override",
    title: "Delete a member permission override",
    description: "Removes an explicit permission override from an organization member.",
    inputSchema: objectSchema({ membershipId: uuidSchema, permissionId: uuidSchema }, [
      "membershipId",
      "permissionId",
    ]),
    requiredPermissions: ["settings.permission.manage_access"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(deleteMemberOverrideAction as ActionFunction, input),
  },
  {
    name: "agencyos.structure.get",
    title: "Get departments, teams, and reporting structure",
    description:
      "Reads the visible organization structure according to the current user's permissions.",
    inputSchema: emptyObjectSchema,
    requiredPermissions: [],
    requiredAnyPermissions: [
      "settings.department.view",
      "settings.team.view",
      "settings.user.view",
    ],
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute() {
      return unwrapResult(await getOrganizationStructureData());
    },
  },
  {
    name: "agencyos.structure.create_department",
    title: "Create a department",
    description: "Creates an active department in the current organization.",
    inputSchema: objectSchema(
      {
        name: { type: "string", minLength: 2, maxLength: 100 },
        code: { anyOf: [{ type: "string", minLength: 2, maxLength: 12 }, { type: "null" }] },
      },
      ["name"],
    ),
    requiredPermissions: ["settings.department.create"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: (input) => runAction(createDepartmentAction as ActionFunction, input),
  },
  {
    name: "agencyos.structure.update_department",
    title: "Update a department",
    description: "Renames a department or updates its code.",
    inputSchema: objectSchema(
      {
        departmentId: uuidSchema,
        name: { type: "string", minLength: 2, maxLength: 100 },
        code: { anyOf: [{ type: "string", minLength: 2, maxLength: 12 }, { type: "null" }] },
      },
      ["departmentId", "name"],
    ),
    requiredPermissions: ["settings.department.update"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(updateDepartmentAction as ActionFunction, input),
  },
  {
    name: "agencyos.structure.change_department_status",
    title: "Activate or deactivate a department",
    description: "Changes department status. Active assignments prevent deactivation.",
    inputSchema: objectSchema(
      { departmentId: uuidSchema, status: { type: "string", enum: ["active", "inactive"] } },
      ["departmentId", "status"],
    ),
    requiredPermissions: ["settings.department.delete"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(changeDepartmentStatusAction as ActionFunction, input),
  },
  {
    name: "agencyos.structure.delete_department",
    title: "Delete an inactive department",
    description: "Permanently deletes an inactive department with no active member assignments.",
    inputSchema: objectSchema({ departmentId: uuidSchema }, ["departmentId"]),
    requiredPermissions: ["settings.department.delete"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: (input) => runAction(deleteDepartmentAction as ActionFunction, input),
  },
  {
    name: "agencyos.structure.create_team",
    title: "Create a team",
    description: "Creates an active team in the current organization.",
    inputSchema: objectSchema(
      {
        name: { type: "string", minLength: 2, maxLength: 100 },
        description: { anyOf: [{ type: "string", maxLength: 500 }, { type: "null" }] },
      },
      ["name"],
    ),
    requiredPermissions: ["settings.team.create"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: (input) => runAction(createTeamAction as ActionFunction, input),
  },
  {
    name: "agencyos.structure.update_team",
    title: "Update a team",
    description: "Renames a team or updates its description.",
    inputSchema: objectSchema(
      {
        teamId: uuidSchema,
        name: { type: "string", minLength: 2, maxLength: 100 },
        description: { anyOf: [{ type: "string", maxLength: 500 }, { type: "null" }] },
      },
      ["teamId", "name"],
    ),
    requiredPermissions: ["settings.team.update"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(updateTeamAction as ActionFunction, input),
  },
  {
    name: "agencyos.structure.change_team_status",
    title: "Activate or deactivate a team",
    description: "Changes team status. Active assignments prevent deactivation.",
    inputSchema: objectSchema(
      { teamId: uuidSchema, status: { type: "string", enum: ["active", "inactive"] } },
      ["teamId", "status"],
    ),
    requiredPermissions: ["settings.team.delete"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(changeTeamStatusAction as ActionFunction, input),
  },
  {
    name: "agencyos.structure.delete_team",
    title: "Delete an inactive team",
    description: "Permanently deletes an inactive team with no assigned members.",
    inputSchema: objectSchema({ teamId: uuidSchema }, ["teamId"]),
    requiredPermissions: ["settings.team.delete"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: (input) => runAction(deleteTeamAction as ActionFunction, input),
  },
  {
    name: "agencyos.structure.update_member_reporting",
    title: "Update member department and manager",
    description: "Assigns a member to a department and reporting manager with cycle prevention.",
    inputSchema: objectSchema(
      {
        membershipId: uuidSchema,
        departmentId: nullableUuidSchema,
        managerMembershipId: nullableUuidSchema,
      },
      ["membershipId"],
    ),
    requiredPermissions: ["settings.department.update", "settings.user.update"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(updateMemberStructureAction as ActionFunction, input),
  },
  {
    name: "agencyos.structure.assign_team_member",
    title: "Assign a member to a team",
    description: "Adds or updates a team assignment and can designate the member as a team lead.",
    inputSchema: objectSchema(
      { teamId: uuidSchema, membershipId: uuidSchema, isLead: { type: "boolean", default: false } },
      ["teamId", "membershipId"],
    ),
    requiredPermissions: ["settings.team.assign"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(assignTeamMemberAction as ActionFunction, input),
  },
  {
    name: "agencyos.structure.remove_team_member",
    title: "Remove a member from a team",
    description: "Removes a member and any lead designation from a team.",
    inputSchema: objectSchema({ teamId: uuidSchema, membershipId: uuidSchema }, [
      "teamId",
      "membershipId",
    ]),
    requiredPermissions: ["settings.team.assign"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(removeTeamMemberAction as ActionFunction, input),
  },

  {
    name: "agencyos.crm.get_workspace",
    title: "Get CRM workspace",
    description:
      "Returns permission-scoped CRM pipeline, company, contact and activity data for the signed-in organization.",
    inputSchema: objectSchema({
      q: { type: "string", maxLength: 120, default: "" },
      stage: nullableUuidSchema,
      owner: nullableUuidSchema,
      status: {
        anyOf: [
          { type: "string", enum: ["new", "qualified", "unqualified", "converted", "lost"] },
          { type: "null" },
        ],
      },
      page: { type: "integer", minimum: 1, default: 1 },
    }),
    requiredPermissions: ["crm.workspace.view"],
    requiredAnyPermissions: ["crm.lead.view", "crm.company.view", "crm.contact.view"],
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute(input) {
      return unwrapResult(
        await getCrmWorkspaceData({
          q: typeof input.q === "string" ? input.q : "",
          stage: typeof input.stage === "string" ? input.stage : null,
          owner: typeof input.owner === "string" ? input.owner : null,
          status:
            typeof input.status === "string"
              ? (input.status as "new" | "qualified" | "unqualified" | "converted" | "lost")
              : null,
          page: typeof input.page === "number" ? input.page : 1,
        }),
      );
    },
  },
  {
    name: "agencyos.crm.create_company",
    title: "Create CRM company",
    description: "Creates a tenant-isolated CRM company owned by an active organization member.",
    inputSchema: objectSchema(
      {
        legalName: { type: "string", minLength: 2, maxLength: 180 },
        displayName: { anyOf: [{ type: "string", maxLength: 180 }, { type: "null" }] },
        industry: { anyOf: [{ type: "string", maxLength: 100 }, { type: "null" }] },
        website: { anyOf: [{ type: "string", format: "uri" }, { type: "null" }] },
        email: { anyOf: [{ type: "string", format: "email" }, { type: "null" }] },
        phone: { anyOf: [{ type: "string", maxLength: 40 }, { type: "null" }] },
        ownerMembershipId: nullableUuidSchema,
        currency: { type: "string", pattern: "^[A-Z]{3}$", default: "USD" },
        paymentTermsDays: { type: "integer", minimum: 0, maximum: 365, default: 30 },
        notes: { anyOf: [{ type: "string", maxLength: 4000 }, { type: "null" }] },
      },
      ["legalName"],
    ),
    requiredPermissions: ["crm.company.create"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: (input) => runAction(createCompanyAction as ActionFunction, input),
  },
  {
    name: "agencyos.crm.update_company",
    title: "Update CRM company",
    description: "Updates a CRM company when it is inside the caller's effective scope.",
    inputSchema: objectSchema(
      {
        companyId: uuidSchema,
        legalName: { type: "string", minLength: 2, maxLength: 180 },
        displayName: { anyOf: [{ type: "string", maxLength: 180 }, { type: "null" }] },
        industry: { anyOf: [{ type: "string", maxLength: 100 }, { type: "null" }] },
        website: { anyOf: [{ type: "string", format: "uri" }, { type: "null" }] },
        email: { anyOf: [{ type: "string", format: "email" }, { type: "null" }] },
        phone: { anyOf: [{ type: "string", maxLength: 40 }, { type: "null" }] },
        ownerMembershipId: nullableUuidSchema,
        currency: { type: "string", pattern: "^[A-Z]{3}$" },
        paymentTermsDays: { type: "integer", minimum: 0, maximum: 365 },
        notes: { anyOf: [{ type: "string", maxLength: 4000 }, { type: "null" }] },
      },
      ["companyId", "legalName", "currency", "paymentTermsDays"],
    ),
    requiredPermissions: ["crm.company.update"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(updateCompanyAction as ActionFunction, input),
  },
  {
    name: "agencyos.crm.set_company_primary_contact",
    title: "Set company primary contact",
    description:
      "Selects or clears an active visible contact as the company primary contact without exposing contact notes or document contents.",
    inputSchema: objectSchema(
      {
        companyId: uuidSchema,
        primaryContactId: nullableUuidSchema,
      },
      ["companyId"],
    ),
    requiredPermissions: ["crm.company.update"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(setCompanyPrimaryContactAction as ActionFunction, input),
  },
  {
    name: "agencyos.crm.create_contact",
    title: "Create CRM contact",
    description: "Creates a contact and optionally links it to a CRM company.",
    inputSchema: objectSchema(
      {
        companyId: nullableUuidSchema,
        firstName: { type: "string", minLength: 1, maxLength: 100 },
        lastName: { type: "string", minLength: 1, maxLength: 100 },
        jobTitle: { anyOf: [{ type: "string", maxLength: 120 }, { type: "null" }] },
        email: { anyOf: [{ type: "string", format: "email" }, { type: "null" }] },
        phone: { anyOf: [{ type: "string", maxLength: 40 }, { type: "null" }] },
        preferredCommunication: {
          type: "string",
          enum: ["email", "phone", "meeting", "none"],
          default: "email",
        },
        isBillingContact: { type: "boolean", default: false },
        isDecisionMaker: { type: "boolean", default: false },
        consentStatus: {
          type: "string",
          enum: ["unknown", "granted", "revoked"],
          default: "unknown",
        },
        ownerMembershipId: nullableUuidSchema,
        notes: { anyOf: [{ type: "string", maxLength: 4000 }, { type: "null" }] },
      },
      ["firstName", "lastName"],
    ),
    requiredPermissions: ["crm.contact.create"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: (input) => runAction(createContactAction as ActionFunction, input),
  },
  {
    name: "agencyos.crm.update_contact",
    title: "Update CRM contact",
    description: "Updates a CRM contact inside the caller's effective scope.",
    inputSchema: objectSchema(
      {
        contactId: uuidSchema,
        companyId: nullableUuidSchema,
        firstName: { type: "string", minLength: 1, maxLength: 100 },
        lastName: { type: "string", minLength: 1, maxLength: 100 },
        jobTitle: { anyOf: [{ type: "string", maxLength: 120 }, { type: "null" }] },
        email: { anyOf: [{ type: "string", format: "email" }, { type: "null" }] },
        phone: { anyOf: [{ type: "string", maxLength: 40 }, { type: "null" }] },
        preferredCommunication: { type: "string", enum: ["email", "phone", "meeting", "none"] },
        isBillingContact: { type: "boolean" },
        isDecisionMaker: { type: "boolean" },
        consentStatus: { type: "string", enum: ["unknown", "granted", "revoked"] },
        ownerMembershipId: nullableUuidSchema,
        notes: { anyOf: [{ type: "string", maxLength: 4000 }, { type: "null" }] },
      },
      ["contactId", "firstName", "lastName", "preferredCommunication", "consentStatus"],
    ),
    requiredPermissions: ["crm.contact.update"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(updateContactAction as ActionFunction, input),
  },
  {
    name: "agencyos.crm.create_lead",
    title: "Create CRM lead",
    description: "Creates a lead after duplicate checks and calculates a qualification score.",
    inputSchema: objectSchema(
      {
        name: { type: "string", minLength: 2, maxLength: 180 },
        leadType: { type: "string", enum: ["person", "company"], default: "company" },
        source: { anyOf: [{ type: "string", maxLength: 100 }, { type: "null" }] },
        stageId: uuidSchema,
        estimatedValue: { anyOf: [{ type: "number", minimum: 0 }, { type: "null" }] },
        currency: { type: "string", pattern: "^[A-Z]{3}$", default: "USD" },
        probability: { type: "integer", minimum: 0, maximum: 100, default: 0 },
        expectedCloseDate: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
        ownerMembershipId: nullableUuidSchema,
        email: { anyOf: [{ type: "string", format: "email" }, { type: "null" }] },
        phone: { anyOf: [{ type: "string", maxLength: 40 }, { type: "null" }] },
        companyName: { anyOf: [{ type: "string", maxLength: 180 }, { type: "null" }] },
        followUpAt: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
        notes: { anyOf: [{ type: "string", maxLength: 4000 }, { type: "null" }] },
      },
      ["name", "stageId"],
    ),
    requiredPermissions: ["crm.lead.create"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: (input) => runAction(createLeadAction as ActionFunction, input),
  },
  {
    name: "agencyos.crm.update_lead",
    title: "Update CRM lead",
    description:
      "Updates lead details, ownership, qualification inputs and status inside the effective scope.",
    inputSchema: objectSchema(
      {
        leadId: uuidSchema,
        name: { type: "string", minLength: 2, maxLength: 180 },
        leadType: { type: "string", enum: ["person", "company"] },
        source: { anyOf: [{ type: "string", maxLength: 100 }, { type: "null" }] },
        stageId: uuidSchema,
        status: { type: "string", enum: ["new", "qualified", "unqualified", "lost"] },
        estimatedValue: { anyOf: [{ type: "number", minimum: 0 }, { type: "null" }] },
        currency: { type: "string", pattern: "^[A-Z]{3}$" },
        probability: { type: "integer", minimum: 0, maximum: 100 },
        expectedCloseDate: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
        ownerMembershipId: nullableUuidSchema,
        email: { anyOf: [{ type: "string", format: "email" }, { type: "null" }] },
        phone: { anyOf: [{ type: "string", maxLength: 40 }, { type: "null" }] },
        companyName: { anyOf: [{ type: "string", maxLength: 180 }, { type: "null" }] },
        followUpAt: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
        notes: { anyOf: [{ type: "string", maxLength: 4000 }, { type: "null" }] },
        lostReason: { anyOf: [{ type: "string", maxLength: 500 }, { type: "null" }] },
      },
      ["leadId", "name", "leadType", "stageId", "status", "currency", "probability"],
    ),
    requiredPermissions: ["crm.lead.update"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(updateLeadAction as ActionFunction, input),
  },
  {
    name: "agencyos.crm.move_lead",
    title: "Move CRM lead",
    description: "Moves a lead to another configured pipeline stage and records the transition.",
    inputSchema: objectSchema({ leadId: uuidSchema, stageId: uuidSchema }, ["leadId", "stageId"]),
    requiredPermissions: ["crm.lead.update"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(updateLeadStageAction as ActionFunction, input),
  },
  {
    name: "agencyos.crm.qualify_lead",
    title: "Qualify CRM lead",
    description: "Marks a lead qualified or unqualified and adds an activity record.",
    inputSchema: objectSchema(
      {
        leadId: uuidSchema,
        status: { type: "string", enum: ["qualified", "unqualified"] },
        reason: { anyOf: [{ type: "string", maxLength: 500 }, { type: "null" }] },
      },
      ["leadId", "status"],
    ),
    requiredPermissions: ["crm.lead.update"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(qualifyLeadAction as ActionFunction, input),
  },
  {
    name: "agencyos.crm.add_activity",
    title: "Add CRM activity",
    description:
      "Adds a call, email, meeting, note or follow-up to exactly one visible CRM record.",
    inputSchema: objectSchema(
      {
        leadId: nullableUuidSchema,
        companyId: nullableUuidSchema,
        contactId: nullableUuidSchema,
        activityType: {
          type: "string",
          enum: [
            "call",
            "email",
            "meeting",
            "note",
            "follow_up",
            "proposal_sent",
            "contract_sent",
            "client_response",
            "status_change",
          ],
        },
        subject: { type: "string", minLength: 2, maxLength: 180 },
        details: { anyOf: [{ type: "string", maxLength: 4000 }, { type: "null" }] },
        dueAt: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
      },
      ["activityType", "subject"],
    ),
    requiredPermissions: ["crm.activity.create"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: (input) => runAction(createActivityAction as ActionFunction, input),
  },
  {
    name: "agencyos.crm.convert_lead",
    title: "Convert CRM lead",
    description:
      "Converts a qualified lead into a linked client company and optional contact while retaining the original lead.",
    inputSchema: objectSchema(
      { leadId: uuidSchema, createContact: { type: "boolean", default: true } },
      ["leadId"],
    ),
    requiredPermissions: ["crm.lead.update", "crm.company.create", "crm.contact.create"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: (input) => runAction(convertLeadAction as ActionFunction, input),
  },
  {
    name: "agencyos.crm.delete_lead",
    title: "Delete CRM lead",
    description: "Permanently deletes an unconverted lead inside the caller's effective scope.",
    inputSchema: objectSchema({ leadId: uuidSchema }, ["leadId"]),
    requiredPermissions: ["crm.lead.delete"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: (input) => runAction(deleteLeadAction as ActionFunction, input),
  },
  {
    name: "agencyos.crm.create_pipeline_stage",
    title: "Create CRM pipeline stage",
    description: "Adds a configurable pipeline stage with probability and won/lost state.",
    inputSchema: objectSchema(
      {
        name: { type: "string", minLength: 2, maxLength: 100 },
        probability: { type: "integer", minimum: 0, maximum: 100 },
        state: { type: "string", enum: ["open", "won", "lost"], default: "open" },
      },
      ["name", "probability"],
    ),
    requiredPermissions: ["crm.pipeline.manage"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: (input) => runAction(createPipelineStageAction as ActionFunction, input),
  },

  {
    name: "agencyos.crm.sync_connection",
    title: "Sync CRM connection",
    description:
      "Pulls leads from an active HubSpot, Salesforce, Zoho CRM, or Pipedrive connection and applies mandatory duplicate handling.",
    inputSchema: objectSchema({ connectionId: uuidSchema }, ["connectionId"]),
    requiredPermissions: ["crm.import.execute"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    execute: (input) => runAction(syncCrmConnectionAction as ActionFunction, input),
  },
  {
    name: "agencyos.crm.check_connection_health",
    title: "Check CRM connection health",
    description:
      "Runs a bounded provider health check using the encrypted stored credentials without returning credential material.",
    inputSchema: objectSchema({ connectionId: uuidSchema }, ["connectionId"]),
    requiredPermissions: ["crm.connection.manage"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    execute: (input) => runAction(checkCrmConnectionHealthAction as ActionFunction, input),
  },
  {
    name: "agencyos.crm.update_connection_schedule",
    title: "Update CRM connection schedule",
    description:
      "Enables or disables a pull connection schedule and selects a bounded supported interval.",
    inputSchema: objectSchema(
      {
        connectionId: uuidSchema,
        syncEnabled: { type: "boolean" },
        syncIntervalMinutes: { type: "integer", enum: [15, 30, 60, 360, 720, 1440] },
      },
      ["connectionId", "syncEnabled", "syncIntervalMinutes"],
    ),
    requiredPermissions: ["crm.connection.manage"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(updateCrmConnectionScheduleAction as ActionFunction, input),
  },
  {
    name: "agencyos.crm.set_connection_status",
    title: "Pause or activate CRM connection",
    description: "Pauses or activates a configured CRM lead-source connection.",
    inputSchema: objectSchema(
      { connectionId: uuidSchema, status: { type: "string", enum: ["active", "paused"] } },
      ["connectionId", "status"],
    ),
    requiredPermissions: ["crm.connection.manage"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(setCrmConnectionStatusAction as ActionFunction, input),
  },
  {
    name: "agencyos.crm.delete_connection",
    title: "Delete CRM connection",
    description:
      "Removes a lead-source connection while retaining leads and audit history already imported from it.",
    inputSchema: objectSchema({ connectionId: uuidSchema }, ["connectionId"]),
    requiredPermissions: ["crm.connection.manage"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: (input) => runAction(deleteCrmConnectionAction as ActionFunction, input),
  },
  {
    name: "agencyos.approvals.get_workspace",
    title: "Get approval workspace",
    description:
      "Returns approval requests visible to the current member, active policy summaries, pending steps, and append-only decision history.",
    inputSchema: objectSchema({
      view: { type: "string", enum: ["inbox", "submitted", "all"], default: "inbox" },
      status: {
        type: "string",
        enum: [
          "all",
          "pending",
          "approved",
          "rejected",
          "revision_requested",
          "cancelled",
          "expired",
          "invalidated",
        ],
        default: "all",
      },
      q: { type: "string", maxLength: 120, default: "" },
      page: { type: "integer", minimum: 1, maximum: 10000, default: 1 },
    }),
    requiredPermissions: [approvalPermissionKeys.viewRequests],
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: async (input) => {
      const parsed = approvalFiltersSchema.safeParse(input);
      if (!parsed.success) {
        throw new McpToolError("Approval filters are invalid.", "INVALID_ARGUMENTS");
      }
      return unwrapResult(await getApprovalWorkspaceData(parsed.data));
    },
  },
  {
    name: "agencyos.approvals.submit_request",
    title: "Submit approval request",
    description:
      "Submits an immutable JSON snapshot to an active approval policy. Credentials and secrets must not be included in the snapshot.",
    inputSchema: objectSchema(
      {
        definitionId: uuidSchema,
        title: { type: "string", minLength: 2, maxLength: 160 },
        entityId: { anyOf: [{ type: "string", maxLength: 200 }, { type: "null" }] },
        deepLink: { type: "string", maxLength: 500, default: "" },
        departmentId: nullableUuidSchema,
        amount: { anyOf: [{ type: "number", minimum: 0 }, { type: "null" }] },
        currency: {
          anyOf: [{ type: "string", pattern: "^[A-Z]{3}$" }, { type: "null" }],
        },
        snapshot: { type: "object", additionalProperties: true },
        dueAt: {
          anyOf: [{ type: "string", format: "date-time" }, { type: "null" }],
        },
      },
      ["definitionId", "title", "snapshot"],
    ),
    requiredPermissions: [approvalPermissionKeys.createRequest],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: (input) => runAction(createApprovalRequestAction as ActionFunction, input),
  },
  {
    name: "agencyos.approvals.decide_step",
    title: "Decide approval step",
    description:
      "Approves, rejects, or requests revision on one pending step assigned to the current member. The server revalidates assignment and policy rules.",
    inputSchema: objectSchema(
      {
        requestStepId: uuidSchema,
        decision: {
          type: "string",
          enum: ["approved", "rejected", "revision_requested"],
        },
        comment: { anyOf: [{ type: "string", maxLength: 2000 }, { type: "null" }] },
      },
      ["requestStepId", "decision"],
    ),
    requiredPermissions: [],
    requiredAnyPermissions: [
      approvalPermissionKeys.approveRequest,
      approvalPermissionKeys.rejectRequest,
    ],
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: (input) => runAction(decideApprovalStepAction as ActionFunction, input),
  },
  {
    name: "agencyos.approvals.reassign_step",
    title: "Reassign approval step",
    description:
      "Reassigns a pending approval step to another active member who has approval permission, when the policy allows reassignment.",
    inputSchema: objectSchema(
      {
        requestStepId: uuidSchema,
        approverMembershipId: uuidSchema,
        comment: { type: "string", minLength: 3, maxLength: 2000 },
      },
      ["requestStepId", "approverMembershipId", "comment"],
    ),
    requiredPermissions: [approvalPermissionKeys.reassignRequest],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: (input) => runAction(reassignApprovalStepAction as ActionFunction, input),
  },
  {
    name: "agencyos.approvals.cancel_request",
    title: "Cancel approval request",
    description:
      "Cancels one pending request submitted by the current member and records an append-only reason.",
    inputSchema: objectSchema(
      {
        requestId: uuidSchema,
        comment: { type: "string", minLength: 3, maxLength: 2000 },
      },
      ["requestId", "comment"],
    ),
    requiredPermissions: [approvalPermissionKeys.createRequest],
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: (input) => runAction(cancelApprovalRequestAction as ActionFunction, input),
  },

  {
    name: "agencyos.notifications.get_center",
    title: "Get notification center",
    description:
      "Returns the current member's private in-app notifications, unread summary, and safe internal deep links.",
    inputSchema: objectSchema({
      status: { type: "string", enum: ["all", "unread", "read"], default: "all" },
      category: {
        type: "string",
        enum: [
          "",
          "assignment",
          "mention",
          "approval_requested",
          "approval_decision",
          "task_due",
          "invoice_overdue",
          "leave_status",
          "contract_expiry",
          "licence_expiry",
          "asset_return",
          "support_reply",
          "security_alert",
          "integration_failure",
        ],
        default: "",
      },
      page: { type: "integer", minimum: 1, maximum: 10000, default: 1 },
    }),
    requiredPermissions: [notificationPermissionKeys.view],
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: async (input) => {
      const parsed = notificationFiltersSchema.safeParse(input);
      if (!parsed.success) {
        throw new McpToolError("Notification filters are invalid.", "INVALID_ARGUMENTS");
      }
      return unwrapResult(await getNotificationCenterData(parsed.data));
    },
  },
  {
    name: "agencyos.notifications.mark_read",
    title: "Mark notification read",
    description: "Marks one notification addressed to the current member as read.",
    inputSchema: objectSchema({ notificationId: uuidSchema }, ["notificationId"]),
    requiredPermissions: [notificationPermissionKeys.update],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(markNotificationReadAction as ActionFunction, input),
  },
  {
    name: "agencyos.notifications.mark_all_read",
    title: "Mark all notifications read",
    description: "Marks all enabled unread notifications for the current member as read.",
    inputSchema: emptyObjectSchema,
    requiredPermissions: [notificationPermissionKeys.update],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(markAllNotificationsReadAction as ActionFunction, input),
  },

  {
    name: "agencyos.projects.get_workspace",
    title: "Get projects workspace",
    description:
      "Returns visible projects, the selected project task board, members, comments, and time entries according to effective permission scope.",
    inputSchema: objectSchema({
      q: { type: "string", maxLength: 120, default: "" },
      status: {
        anyOf: [
          { type: "string", enum: ["planned", "active", "on_hold", "completed", "cancelled"] },
          { type: "null" },
        ],
      },
      owner: nullableUuidSchema,
      project: nullableUuidSchema,
      archive: { type: "string", enum: ["active", "archived", "all"], default: "active" },
    }),
    requiredPermissions: ["projects.workspace.view", "projects.project.view"],
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute(input) {
      return unwrapResult(
        await getProjectsWorkspaceData({
          q: typeof input.q === "string" ? input.q : "",
          status:
            typeof input.status === "string"
              ? (input.status as "planned" | "active" | "on_hold" | "completed" | "cancelled")
              : null,
          owner: typeof input.owner === "string" ? input.owner : null,
          project: typeof input.project === "string" ? input.project : null,
          archive:
            input.archive === "archived" || input.archive === "all" ? input.archive : "active",
          mine: false,
          sort: "updated",
          group: "none",
        }),
      );
    },
  },
  {
    name: "agencyos.projects.create_project",
    title: "Create project",
    description:
      "Creates a client or internal project with a transactionally allocated project code and seeded task workflow.",
    inputSchema: objectSchema(
      {
        name: { type: "string", minLength: 2, maxLength: 180 },
        description: { anyOf: [{ type: "string", maxLength: 4000 }, { type: "null" }] },
        projectType: { type: "string", enum: ["client", "internal"] },
        companyId: nullableUuidSchema,
        status: {
          type: "string",
          enum: ["planned", "active", "on_hold", "cancelled"],
        },
        priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
        visibility: { type: "string", enum: ["organization", "members", "private"] },
        ownerMembershipId: nullableUuidSchema,
        startDate: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
        dueDate: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
      },
      ["name", "projectType", "status", "priority", "visibility"],
    ),
    requiredPermissions: ["projects.project.create"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: (input) => runAction(createProjectAction as ActionFunction, input),
  },
  {
    name: "agencyos.projects.update_project",
    title: "Update project",
    description:
      "Updates a visible project's identity, client link, owner, dates, status, and visibility.",
    inputSchema: objectSchema(
      {
        projectId: uuidSchema,
        name: { type: "string", minLength: 2, maxLength: 180 },
        description: { anyOf: [{ type: "string", maxLength: 4000 }, { type: "null" }] },
        projectType: { type: "string", enum: ["client", "internal"] },
        companyId: nullableUuidSchema,
        status: {
          type: "string",
          enum: ["planned", "active", "on_hold", "cancelled"],
        },
        priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
        visibility: { type: "string", enum: ["organization", "members", "private"] },
        ownerMembershipId: nullableUuidSchema,
        startDate: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
        dueDate: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
      },
      ["projectId", "name", "projectType", "status", "priority", "visibility"],
    ),
    requiredPermissions: ["projects.project.update"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(updateProjectAction as ActionFunction, input),
  },
  {
    name: "agencyos.projects.add_member",
    title: "Add project member",
    description:
      "Adds an active organization member to a visible project or updates their project role.",
    inputSchema: objectSchema(
      {
        projectId: uuidSchema,
        membershipId: uuidSchema,
        role: { type: "string", enum: ["owner", "manager", "member", "viewer"] },
      },
      ["projectId", "membershipId", "role"],
    ),
    requiredPermissions: ["projects.project.assign"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(addProjectMemberAction as ActionFunction, input),
  },
  {
    name: "agencyos.projects.create_task",
    title: "Create project task",
    description:
      "Creates a numbered task in a visible project and optionally assigns a project member.",
    inputSchema: objectSchema(
      {
        projectId: uuidSchema,
        title: { type: "string", minLength: 2, maxLength: 240 },
        description: { anyOf: [{ type: "string", maxLength: 10000 }, { type: "null" }] },
        statusId: uuidSchema,
        priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
        assigneeMembershipId: nullableUuidSchema,
        parentTaskId: nullableUuidSchema,
        phaseId: nullableUuidSchema,
        milestoneId: nullableUuidSchema,
        startDate: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
        dueDate: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
        estimatedMinutes: {
          anyOf: [{ type: "integer", minimum: 1, maximum: 100000 }, { type: "null" }],
        },
      },
      ["projectId", "title", "statusId", "priority"],
    ),
    requiredPermissions: ["projects.task.create"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: (input) => runAction(createProjectTaskAction as ActionFunction, input),
  },
  {
    name: "agencyos.projects.move_task",
    title: "Move project task",
    description:
      "Moves a visible task to another project status and prevents completion while mandatory subtasks remain open.",
    inputSchema: objectSchema({ taskId: uuidSchema, statusId: uuidSchema }, ["taskId", "statusId"]),
    requiredPermissions: ["projects.task.update"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(moveProjectTaskAction as ActionFunction, input),
  },
  {
    name: "agencyos.projects.add_comment",
    title: "Add project task comment",
    description: "Adds an internal comment to a visible project task.",
    inputSchema: objectSchema(
      {
        taskId: uuidSchema,
        body: { type: "string", minLength: 1, maxLength: 8000 },
        isInternal: { type: "boolean", default: true },
      },
      ["taskId", "body"],
    ),
    requiredPermissions: ["projects.comment.create"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: (input) => runAction(createProjectCommentAction as ActionFunction, input),
  },
  {
    name: "agencyos.projects.log_time",
    title: "Log project time",
    description: "Logs the signed-in member's work time against a visible project or task.",
    inputSchema: objectSchema(
      {
        projectId: uuidSchema,
        taskId: nullableUuidSchema,
        workDate: { type: "string", format: "date" },
        minutes: { type: "integer", minimum: 1, maximum: 1440 },
        notes: { anyOf: [{ type: "string", maxLength: 1000 }, { type: "null" }] },
      },
      ["projectId", "workDate", "minutes"],
    ),
    requiredPermissions: ["projects.time.create"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: (input) => runAction(createProjectTimeEntryAction as ActionFunction, input),
  },
  {
    name: "agencyos.projects.set_task_assignee",
    title: "Set project task assignee",
    description:
      "Adds or removes an active project member as a task assignee after rechecking task scope.",
    inputSchema: objectSchema(
      {
        taskId: uuidSchema,
        membershipId: uuidSchema,
        operation: { type: "string", enum: ["add", "remove"] },
      },
      ["taskId", "membershipId", "operation"],
    ),
    requiredPermissions: ["projects.task.assign"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(saveProjectTaskAssigneeAction as ActionFunction, input),
  },
  {
    name: "agencyos.projects.create_label",
    title: "Create project label",
    description: "Creates a normalized, duplicate-safe label for a visible writable project.",
    inputSchema: objectSchema(
      {
        projectId: uuidSchema,
        name: { type: "string", minLength: 1, maxLength: 60 },
        color: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
      },
      ["projectId", "name", "color"],
    ),
    requiredPermissions: ["projects.task.update"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(createProjectLabelAction as ActionFunction, input),
  },
  {
    name: "agencyos.projects.set_task_label",
    title: "Set project task label",
    description: "Adds or removes a project-owned label on a visible task.",
    inputSchema: objectSchema(
      {
        taskId: uuidSchema,
        labelId: uuidSchema,
        operation: { type: "string", enum: ["add", "remove"] },
      },
      ["taskId", "labelId", "operation"],
    ),
    requiredPermissions: ["projects.task.update"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(saveProjectTaskLabelAction as ActionFunction, input),
  },
  {
    name: "agencyos.projects.set_task_watcher",
    title: "Set project task watcher",
    description:
      "Watches or unwatches a visible task for the signed-in member; assigning another watcher requires task assignment permission.",
    inputSchema: objectSchema(
      {
        taskId: uuidSchema,
        membershipId: nullableUuidSchema,
        operation: { type: "string", enum: ["add", "remove"] },
      },
      ["taskId", "operation"],
    ),
    requiredPermissions: ["projects.task.view"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(saveProjectTaskWatcherAction as ActionFunction, input),
  },
  {
    name: "agencyos.projects.add_checklist_item",
    title: "Add project task checklist item",
    description: "Adds a normalized, duplicate-safe checklist item to a visible writable task.",
    inputSchema: objectSchema(
      {
        taskId: uuidSchema,
        label: { type: "string", minLength: 1, maxLength: 240 },
        isRequired: { type: "boolean", default: false },
      },
      ["taskId", "label"],
    ),
    requiredPermissions: ["projects.task.update"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(createProjectChecklistItemAction as ActionFunction, input),
  },
  {
    name: "agencyos.projects.set_checklist_item",
    title: "Set project task checklist item",
    description: "Completes or reopens a checklist item after visible-task authorization.",
    inputSchema: objectSchema({ checklistItemId: uuidSchema, completed: { type: "boolean" } }, [
      "checklistItemId",
      "completed",
    ]),
    requiredPermissions: ["projects.task.update"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(toggleProjectChecklistItemAction as ActionFunction, input),
  },
  {
    name: "agencyos.projects.set_task_dependency",
    title: "Set project task dependency",
    description:
      "Adds or removes a same-project task relationship and rejects self-links and blocking cycles.",
    inputSchema: objectSchema(
      {
        taskId: uuidSchema,
        relatedTaskId: uuidSchema,
        relationship: {
          type: "string",
          enum: ["blocks", "related_to", "duplicate_of", "parent_of"],
        },
        operation: { type: "string", enum: ["add", "remove"] },
      },
      ["taskId", "relatedTaskId", "relationship", "operation"],
    ),
    requiredPermissions: ["projects.task.update"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(saveProjectTaskDependencyAction as ActionFunction, input),
  },
  {
    name: "agencyos.projects.set_task_recurrence",
    title: "Set project task recurrence",
    description:
      "Creates or updates a bounded day, week, or month recurrence for a visible task template.",
    inputSchema: objectSchema(
      {
        taskId: uuidSchema,
        intervalUnit: { type: "string", enum: ["day", "week", "month"] },
        intervalCount: { type: "integer", minimum: 1, maximum: 365 },
        nextRunOn: { type: "string", format: "date" },
        endOn: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
        active: { type: "boolean", default: true },
      },
      ["taskId", "intervalUnit", "intervalCount", "nextRunOn"],
    ),
    requiredPermissions: ["projects.task.update"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(saveProjectTaskRecurrenceAction as ActionFunction, input),
  },
  {
    name: "agencyos.projects.create_phase",
    title: "Create project phase",
    description: "Creates a duplicate-safe planning phase for a visible writable project.",
    inputSchema: objectSchema(
      {
        projectId: uuidSchema,
        name: { type: "string", minLength: 1, maxLength: 120 },
        description: { anyOf: [{ type: "string", maxLength: 1000 }, { type: "null" }] },
        status: { type: "string", enum: ["planned", "active", "completed", "cancelled"] },
        startDate: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
        dueDate: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
      },
      ["projectId", "name", "status"],
    ),
    requiredPermissions: ["projects.project.update"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(createProjectPhaseAction as ActionFunction, input),
  },
  {
    name: "agencyos.projects.create_milestone",
    title: "Create project milestone",
    description: "Creates a duplicate-safe milestone, optionally linked to a same-project phase.",
    inputSchema: objectSchema(
      {
        projectId: uuidSchema,
        phaseId: nullableUuidSchema,
        name: { type: "string", minLength: 1, maxLength: 160 },
        description: { anyOf: [{ type: "string", maxLength: 1000 }, { type: "null" }] },
        dueDate: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
        status: { type: "string", enum: ["open", "completed", "cancelled"] },
      },
      ["projectId", "name", "status"],
    ),
    requiredPermissions: ["projects.project.update"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(createProjectMilestoneAction as ActionFunction, input),
  },
  {
    name: "agencyos.projects.set_phase_status",
    title: "Set project phase status",
    description:
      "Updates the status of a visible project phase while preserving closure and archive safeguards.",
    inputSchema: objectSchema(
      {
        phaseId: uuidSchema,
        status: { type: "string", enum: ["planned", "active", "completed", "cancelled"] },
      },
      ["phaseId", "status"],
    ),
    requiredPermissions: ["projects.project.update"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(updateProjectPhaseStatusAction as ActionFunction, input),
  },
  {
    name: "agencyos.projects.set_milestone_status",
    title: "Set project milestone status",
    description:
      "Updates the status of a visible project milestone while preserving closure and archive safeguards.",
    inputSchema: objectSchema(
      {
        milestoneId: uuidSchema,
        status: { type: "string", enum: ["open", "completed", "cancelled"] },
      },
      ["milestoneId", "status"],
    ),
    requiredPermissions: ["projects.project.update"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(updateProjectMilestoneStatusAction as ActionFunction, input),
  },
  {
    name: "agencyos.projects.set_closure_item",
    title: "Set project closure check",
    description: "Completes or reopens an authorized project closure checklist item.",
    inputSchema: objectSchema({ closureItemId: uuidSchema, completed: { type: "boolean" } }, [
      "closureItemId",
      "completed",
    ]),
    requiredPermissions: ["projects.project.update"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(toggleProjectClosureItemAction as ActionFunction, input),
  },
  {
    name: "agencyos.projects.request_closure",
    title: "Request project closure",
    description: "Requests closure for a visible active project and stores bounded review notes.",
    inputSchema: objectSchema(
      {
        projectId: uuidSchema,
        notes: { anyOf: [{ type: "string", maxLength: 4000 }, { type: "null" }] },
      },
      ["projectId"],
    ),
    requiredPermissions: ["projects.project.update"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(requestProjectClosureAction as ActionFunction, input),
  },
  {
    name: "agencyos.projects.close_project",
    title: "Close project",
    description:
      "Closes a project only after every open task and required closure check is complete.",
    inputSchema: objectSchema(
      {
        projectId: uuidSchema,
        notes: { anyOf: [{ type: "string", maxLength: 4000 }, { type: "null" }] },
      },
      ["projectId"],
    ),
    requiredPermissions: ["projects.project.update"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: (input) => runAction(closeProjectAction as ActionFunction, input),
  },
  {
    name: "agencyos.projects.set_archive_state",
    title: "Set project archive state",
    description: "Archives or restores a visible project without deleting its history.",
    inputSchema: objectSchema(
      {
        projectId: uuidSchema,
        operation: { type: "string", enum: ["archive", "restore"] },
      },
      ["projectId", "operation"],
    ),
    requiredPermissions: ["projects.project.archive"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: (input) => runAction(archiveProjectAction as ActionFunction, input),
  },
  {
    name: "agencyos.hr.get_workspace",
    title: "Get People workspace",
    description:
      "Returns visible non-sensitive employee directory, designation, aggregate attendance, leave, onboarding, and offboarding data according to the active HR permission scope. Personal contact details, birth dates, individual attendance timestamps, leave reasons, onboarding or offboarding notes, separation reasons, salary structures, salary slips, and attachments are excluded.",
    inputSchema: emptyObjectSchema,
    requiredPermissions: [hrPermissionKeys.workspace, hrPermissionKeys.employeeView],
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute() {
      const data = unwrapResult(await getHrWorkspaceData());
      const selfLeaveBalances: Array<{
        leaveType: string;
        availableDays: number;
        reservedDays: number;
        usedDays: number;
      }> = [];
      for (const balance of data.leave.balances) {
        if (!balance.isSelf || balance.balanceYear !== data.leave.currentYear) continue;
        selfLeaveBalances.push({
          leaveType: balance.leaveTypeName,
          availableDays: balance.availableDays,
          reservedDays: balance.reservedDays,
          usedDays: balance.usedDays,
        });
      }
      return {
        summary: data.summary,
        employees: data.employees.map((employee) => ({
          membershipId: employee.membershipId,
          displayName: employee.displayName,
          workEmail: employee.workEmail,
          employeeNumber: employee.employeeNumber,
          designation: employee.designationName,
          department: employee.departmentName,
          manager: employee.managerName,
          lifecycleStatus: employee.lifecycleStatus,
          employmentType: employee.employmentType,
          workMode: employee.workMode,
        })),
        designations: data.designations.map((designation) => ({
          id: designation.id,
          name: designation.name,
          code: designation.code,
          status: designation.status,
        })),
        attendance: data.attendance.capabilities.canView
          ? {
              month: data.attendance.currentMonth,
              summary: data.attendance.summary,
            }
          : null,
        leave: data.leave.capabilities.canView
          ? {
              year: data.leave.currentYear,
              summary: data.leave.summary,
              balances: selfLeaveBalances,
            }
          : null,
        onboarding: data.onboarding.capabilities.canView
          ? {
              summary: data.onboarding.summary,
              plans: data.onboarding.plans.map((plan) => ({
                membershipId: plan.membershipId,
                employeeName: plan.employeeName,
                status: plan.status,
                targetStartDate: plan.targetStartDate,
                progress: plan.progress,
              })),
            }
          : null,
        offboarding: data.offboarding.capabilities.canView
          ? {
              summary: data.offboarding.summary,
              plans: data.offboarding.plans.map((plan) => ({
                membershipId: plan.membershipId,
                employeeName: plan.employeeName,
                separationType: plan.separationType,
                status: plan.status,
                lastWorkingDate: plan.lastWorkingDate,
                progress: plan.progress,
              })),
            }
          : null,
      };
    },
  },
  {
    name: "agencyos.assets.search_assets",
    title: "Search asset register",
    description:
      "Returns permission-scoped asset metadata, custody, warranty, depreciation, maintenance counts, and linked-document counts. Notes, maintenance details and outcomes, disposal reasons, document contents, and audit history are excluded.",
    inputSchema: objectSchema({
      q: { type: "string", maxLength: 100, default: "" },
      status: {
        type: "string",
        enum: [
          "all",
          "ordered",
          "received",
          "available",
          "assigned",
          "under_repair",
          "lost",
          "stolen",
          "retired",
          "disposed",
        ],
        default: "all",
      },
      category: { type: "string", maxLength: 100, default: "all" },
    }),
    requiredPermissions: [assetPermissionKeys.workspace, assetPermissionKeys.view],
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute(input) {
      const data = unwrapResult(
        await getAssetWorkspaceData({
          query: typeof input.q === "string" ? input.q : "",
          status: typeof input.status === "string" ? input.status : "all",
          category: typeof input.category === "string" ? input.category : "all",
        }),
      );
      return {
        summary: data.summary,
        assets: data.assets.map((asset) => ({
          id: asset.id,
          assetTag: asset.assetTag,
          serialNumber: asset.serialNumber,
          name: asset.name,
          categoryName: asset.categoryName,
          categoryKind: asset.categoryKind,
          manufacturer: asset.manufacturer,
          model: asset.model,
          ownershipType: asset.ownershipType,
          ownerName: asset.ownerName,
          vendorName: asset.vendorName,
          status: asset.status,
          condition: asset.condition,
          location: asset.location,
          assignedTo: asset.activeAssignment?.memberName ?? null,
          checkedOutAt: asset.activeAssignment?.checkoutAt ?? null,
          expectedReturnAt: asset.activeAssignment?.expectedReturnAt ?? null,
          acknowledgedAt: asset.activeAssignment?.acknowledgedAt ?? null,
          warrantyStartDate: asset.warrantyStartDate,
          warrantyEndDate: asset.warrantyEndDate,
          warrantyState: asset.warrantyState,
          depreciationMethod: asset.depreciationMethod,
          estimatedBookValueMinor: asset.estimatedBookValueMinor,
          currency: asset.currency,
          maintenanceRecordCount: asset.maintenance.length,
          linkedDocumentCount: asset.documents.length,
        })),
      };
    },
  },
  {
    name: "agencyos.vendors.search_procurement",
    title: "Search vendors and procurement",
    description:
      "Returns permission-scoped vendor, purchase-request, purchase-order, receipt, and bill metadata. Tax identifiers, banking metadata, payment instructions, note bodies, quotation notes, receipt notes, document contents, and audit history are excluded.",
    inputSchema: objectSchema({
      q: { type: "string", maxLength: 100, default: "" },
      vendorStatus: {
        type: "string",
        enum: ["all", "prospect", "active", "on_hold", "inactive", "blocked"],
        default: "all",
      },
      requestStatus: {
        type: "string",
        enum: [
          "all",
          "draft",
          "pending_approval",
          "approved",
          "revision_requested",
          "rejected",
          "cancelled",
          "sourcing",
          "ordered",
          "partially_received",
          "received",
          "closed",
        ],
        default: "all",
      },
      purchaseOrderStatus: {
        type: "string",
        enum: [
          "all",
          "issued",
          "acknowledged",
          "partially_received",
          "received",
          "cancelled",
          "closed",
        ],
        default: "all",
      },
    }),
    requiredPermissions: [vendorPermissionKeys.workspace],
    requiredAnyPermissions: [
      vendorPermissionKeys.view,
      vendorPermissionKeys.requestView,
      vendorPermissionKeys.purchaseOrderView,
    ],
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute(input) {
      const data = unwrapResult(
        await getVendorWorkspaceData({
          query: typeof input.q === "string" ? input.q : "",
          vendorStatus: typeof input.vendorStatus === "string" ? input.vendorStatus : "all",
          requestStatus: typeof input.requestStatus === "string" ? input.requestStatus : "all",
          purchaseOrderStatus:
            typeof input.purchaseOrderStatus === "string" ? input.purchaseOrderStatus : "all",
        }),
      );
      return {
        summary: data.summary,
        vendors: data.vendors.map((vendor) => ({
          id: vendor.id,
          vendorKey: vendor.vendorKey,
          displayName: vendor.displayName,
          legalName: vendor.legalName,
          primaryCategoryName: vendor.primaryCategoryName,
          status: vendor.status,
          riskClassification: vendor.riskClassification,
          ownerName: vendor.ownerName,
          countryCode: vendor.countryCode,
          defaultCurrency: vendor.defaultCurrency,
          paymentTermsDays: vendor.paymentTermsDays,
          onboardingDate: vendor.onboardingDate,
          nextReviewDate: vendor.nextReviewDate,
          contactCount: vendor.contacts.length,
          contractCount: vendor.contracts.length,
          linkedDocumentCount: vendor.documents.length,
          lifecycleEventCount: vendor.events.length,
        })),
        purchaseRequests: data.purchaseRequests.map((request) => ({
          id: request.id,
          requestKey: request.requestKey,
          title: request.title,
          requesterName: request.requesterName,
          departmentName: request.departmentName,
          projectName: request.projectName,
          budgetMinor: request.budgetMinor,
          currency: request.currency,
          requiredByDate: request.requiredByDate,
          status: request.status,
          selectedVendorName: request.selectedVendorName,
          itemCount: request.items.length,
          quotationCount: request.quotations.length,
        })),
        purchaseOrders: data.purchaseOrders.map((order) => ({
          id: order.id,
          purchaseOrderKey: order.purchaseOrderKey,
          purchaseRequestKey: order.purchaseRequestKey,
          requestTitle: order.requestTitle,
          vendorName: order.vendorName,
          contractTitle: order.contractTitle,
          issueDate: order.issueDate,
          expectedDeliveryDate: order.expectedDeliveryDate,
          totalMinor: order.totalMinor,
          currency: order.currency,
          status: order.status,
          itemCount: order.items.length,
          receiptCount: order.receipts.length,
          billCount: order.bills.length,
          linkedDocumentCount: order.documents.length,
        })),
      };
    },
  },
  {
    name: "agencyos.support.search_tickets",
    title: "Search support tickets",
    description:
      "Returns permission-scoped ticket metadata, client/project links, priority, status, assignment, SLA state, resolution state, and public activity counts. Internal note bodies, public reply bodies, watcher identities, satisfaction comments, and audit details are excluded.",
    inputSchema: objectSchema({
      q: { type: "string", maxLength: 100, default: "" },
      status: {
        type: "string",
        enum: ["all", "new", "open", "pending_customer", "pending_internal", "resolved", "closed"],
        default: "all",
      },
      priority: {
        type: "string",
        enum: ["all", "low", "normal", "high", "urgent"],
        default: "all",
      },
    }),
    requiredPermissions: [supportPermissionKeys.workspace, supportPermissionKeys.view],
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute(input) {
      const data = unwrapResult(
        await getSupportWorkspaceData({
          query: typeof input.q === "string" ? input.q : "",
          status: typeof input.status === "string" ? input.status : "all",
          priority: typeof input.priority === "string" ? input.priority : "all",
        }),
      );
      return {
        summary: data.summary,
        tickets: data.tickets.map((ticket) => ({
          id: ticket.id,
          ticketKey: ticket.ticketKey,
          subject: ticket.subject,
          clientName: ticket.clientName,
          contactName: ticket.contactName,
          projectName: ticket.projectName,
          categoryName: ticket.categoryName,
          priority: ticket.priority,
          status: ticket.status,
          assignedAgentName: ticket.assignedAgentName,
          assignedTeamName: ticket.assignedTeamName,
          dueAt: ticket.dueAt,
          firstResponseDueAt: ticket.firstResponseDueAt,
          resolutionDueAt: ticket.resolutionDueAt,
          firstRespondedAt: ticket.firstRespondedAt,
          resolvedAt: ticket.resolvedAt,
          closedAt: ticket.closedAt,
          slaState: ticket.slaState,
          reopenedCount: ticket.reopenedCount,
          publicReplyCount: ticket.messages.filter(
            (message) => message.messageType === "public_reply",
          ).length,
          linkedDocumentCount: ticket.documents.length,
        })),
      };
    },
  },
  {
    name: "agencyos.documents.search_library",
    title: "Search document library",
    description:
      "Returns permission-filtered document metadata, tags, business links, version numbers, review dates, retention state, and file scan status. File contents, comments, access grants, and restricted history details are excluded.",
    inputSchema: objectSchema({
      q: { type: "string", maxLength: 100, default: "" },
      status: { type: "string", enum: ["active", "archived", "all"], default: "active" },
    }),
    requiredPermissions: [documentPermissionKeys.workspace, documentPermissionKeys.view],
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute(input) {
      const data = unwrapResult(
        await getDocumentWorkspaceData({
          query: typeof input.q === "string" ? input.q : "",
          status: typeof input.status === "string" ? input.status : "active",
        }),
      );
      return {
        summary: data.summary,
        documents: data.documents.map((document) => ({
          id: document.id,
          title: document.title,
          classification: document.classification,
          ownerName: document.ownerName,
          folderPath: document.folderPath,
          category: document.categoryName,
          status: document.status,
          reviewDate: document.reviewDate,
          expiryDate: document.expiryDate,
          retentionUntil: document.retentionUntil,
          legalHold: document.legalHold,
          reviewState: document.reviewState,
          retentionState: document.retentionState,
          tags: document.tags.map((tag) => tag.name),
          links: document.links.map((link) => ({
            type: link.entityType,
            label: link.label,
          })),
          versions: document.versions.map((version) => ({
            version: version.versionNumber,
            fileName: version.fileName,
            mimeType: version.mimeType,
            fileStatus: version.fileStatus,
            createdAt: version.createdAt,
          })),
        })),
      };
    },
  },
  {
    name: "agencyos.legal.search_contracts",
    title: "Search legal contracts",
    description:
      "Returns permission-scoped contract metadata, lifecycle status, dates, counterparties, signature state, and immutable version summaries. File contents, legal comments, approval comments, and termination reasons are excluded.",
    inputSchema: objectSchema({
      q: { type: "string", maxLength: 100, default: "" },
      status: {
        type: "string",
        enum: [
          "all",
          "request",
          "draft",
          "in_review",
          "approved",
          "awaiting_signature",
          "active",
          "terminated",
          "expired",
          "cancelled",
        ],
        default: "all",
      },
    }),
    requiredPermissions: [legalPermissionKeys.workspace, legalPermissionKeys.view],
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute(input) {
      const data = unwrapResult(
        await getLegalWorkspaceData({
          query: typeof input.q === "string" ? input.q : "",
          status: typeof input.status === "string" ? input.status : "all",
        }),
      );
      return {
        summary: data.summary,
        contracts: data.contracts.map((contract) => ({
          id: contract.id,
          internalReference: contract.internalReference,
          title: contract.title,
          contractType: contract.contractType,
          counterpartyName: contract.counterpartyName,
          ownerName: contract.ownerName,
          departmentName: contract.departmentName,
          status: contract.status,
          effectiveDate: contract.effectiveDate,
          endDate: contract.endDate,
          renewalDate: contract.renewalDate,
          noticePeriodDays: contract.noticePeriodDays,
          jurisdiction: contract.jurisdiction,
          governingLaw: contract.governingLaw,
          contractValueMinor: contract.contractValueMinor,
          currency: contract.currency,
          signatureStatus: contract.signatureStatus,
          timingState: contract.timingState,
          versions: contract.versions.map((version) => ({
            versionNumber: version.versionNumber,
            versionKind: version.versionKind,
            status: version.status,
            documentTitle: version.documentTitle,
            createdAt: version.createdAt,
          })),
        })),
      };
    },
  },
  {
    name: "agencyos.legal.search_compliance_records",
    title: "Search legal compliance records",
    description:
      "Returns permission-scoped compliance-record metadata, dates, masked identifier suffixes, classification, timing state, and linked document version labels. File contents, internal summaries, event details, closure reasons, and privileged records outside the caller's access are excluded.",
    inputSchema: objectSchema({
      q: { type: "string", maxLength: 100, default: "" },
      type: {
        type: "string",
        enum: [
          "all",
          "privacy_document",
          "corporate_registration",
          "gst_record",
          "pan_record",
          "licence",
          "insurance_policy",
          "intellectual_property",
          "compliance_certificate",
          "board_resolution",
          "legal_notice",
          "dispute_record",
        ],
        default: "all",
      },
      status: { type: "string", enum: ["all", "active", "closed", "archived"], default: "all" },
    }),
    requiredPermissions: [legalPermissionKeys.workspace, legalCompliancePermissionKeys.view],
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute(input) {
      const data = unwrapResult(
        await getLegalComplianceWorkspaceData({
          query: typeof input.q === "string" ? input.q : "",
          type: typeof input.type === "string" ? input.type : "all",
          status: typeof input.status === "string" ? input.status : "all",
        }),
      );
      return {
        summary: data.summary,
        records: data.records.map((record) => ({
          id: record.id,
          internalReference: record.internalReference,
          title: record.title,
          recordType: record.recordType,
          status: record.status,
          ownerName: record.ownerName,
          departmentName: record.departmentName,
          issuingAuthority: record.issuingAuthority,
          jurisdiction: record.jurisdiction,
          identifierLastFour: record.identifierLastFour,
          issueDate: record.issueDate,
          effectiveDate: record.effectiveDate,
          expiryDate: record.expiryDate,
          renewalDate: record.renewalDate,
          reviewDate: record.reviewDate,
          responseDueDate: record.responseDueDate,
          confidentialityLevel: record.confidentialityLevel,
          legalPrivilege: record.legalPrivilege,
          timingState: record.timingState,
          document: {
            title: record.documentTitle,
            versionNumber: record.documentVersionNumber,
            fileName: record.documentFileName,
          },
        })),
      };
    },
  },
  {
    name: "agencyos.finance.get_workspace",
    title: "Get finance workspace",
    description:
      "Returns permission-scoped catalogue, estimate, invoice, credit-note, payment, expense, financial-report, and client-statement data without file contents or banking credentials.",
    inputSchema: objectSchema({
      q: { type: "string", maxLength: 120, default: "" },
      tab: {
        type: "string",
        enum: [
          "catalog",
          "estimates",
          "invoices",
          "credit_notes",
          "payments",
          "expenses",
          "reports",
        ],
        default: "invoices",
      },
      status: { anyOf: [{ type: "string", maxLength: 40 }, { type: "null" }] },
      company: nullableUuidSchema,
      from: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
      to: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
    }),
    requiredPermissions: [financePermissionKeys.workspace],
    requiredAnyPermissions: [
      financePermissionKeys.catalogView,
      financePermissionKeys.estimateView,
      financePermissionKeys.invoiceView,
      financePermissionKeys.creditNoteView,
      financePermissionKeys.paymentView,
      financePermissionKeys.expenseView,
      financePermissionKeys.reportView,
    ],
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: async (input) =>
      unwrapResult(
        await getFinanceWorkspaceData({
          q: typeof input.q === "string" ? input.q : "",
          tab:
            input.tab === "catalog" ||
            input.tab === "estimates" ||
            input.tab === "credit_notes" ||
            input.tab === "payments" ||
            input.tab === "expenses" ||
            input.tab === "reports"
              ? input.tab
              : "invoices",
          status: typeof input.status === "string" ? input.status : null,
          company: typeof input.company === "string" ? input.company : null,
          from: typeof input.from === "string" ? input.from : null,
          to: typeof input.to === "string" ? input.to : null,
        }),
      ),
  },
  {
    name: "agencyos.finance.create_catalog_item",
    title: "Create finance catalogue item",
    description:
      "Creates a duplicate-protected product or service with minor-unit rate and tax defaults.",
    inputSchema: objectSchema(
      {
        itemType: { type: "string", enum: ["service", "product"] },
        name: { type: "string", minLength: 2, maxLength: 180 },
        sku: { anyOf: [{ type: "string", maxLength: 80 }, { type: "null" }] },
        description: { anyOf: [{ type: "string", maxLength: 2000 }, { type: "null" }] },
        unit: { type: "string", minLength: 1, maxLength: 40 },
        standardRate: { type: "string", pattern: "^\\d+(?:\\.\\d+)?$" },
        taxCategory: { type: "string", minLength: 1, maxLength: 80 },
        taxPercent: { type: "string", pattern: "^\\d+(?:\\.\\d+)?$" },
        currency: { type: "string", pattern: "^[A-Z]{3}$" },
        isActive: { type: "boolean", default: true },
        defaultInvoiceDescription: {
          anyOf: [{ type: "string", maxLength: 500 }, { type: "null" }],
        },
      },
      ["itemType", "name", "unit", "standardRate", "taxCategory", "taxPercent", "currency"],
    ),
    requiredPermissions: [financePermissionKeys.workspace, financePermissionKeys.catalogManage],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: (input) => runAction(createCatalogItemAction as ActionFunction, input),
  },
  {
    name: "agencyos.finance.create_estimate",
    title: "Create estimate",
    description:
      "Creates a duplicate-safe estimate with transactionally allocated numbering and calculated lines.",
    inputSchema: objectSchema(
      {
        companyId: uuidSchema,
        contactId: nullableUuidSchema,
        projectId: nullableUuidSchema,
        issueDate: { type: "string", format: "date" },
        expiryDate: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
        currency: { type: "string", pattern: "^[A-Z]{3}$" },
        lines: { type: "array", minItems: 1, maxItems: 50, items: financeDocumentLineSchema },
        notes: { anyOf: [{ type: "string", maxLength: 4000 }, { type: "null" }] },
        terms: { anyOf: [{ type: "string", maxLength: 4000 }, { type: "null" }] },
        internalNotes: { anyOf: [{ type: "string", maxLength: 4000 }, { type: "null" }] },
      },
      ["companyId", "issueDate", "currency", "lines"],
    ),
    requiredPermissions: [financePermissionKeys.workspace, financePermissionKeys.estimateCreate],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: (input) => runAction(createEstimateAction as ActionFunction, input),
  },
  {
    name: "agencyos.finance.create_invoice",
    title: "Create invoice draft",
    description: "Creates a duplicate-safe invoice draft. Final numbering is deferred until issue.",
    inputSchema: objectSchema(
      {
        companyId: uuidSchema,
        contactId: nullableUuidSchema,
        projectId: nullableUuidSchema,
        sourceEstimateId: nullableUuidSchema,
        purchaseOrderReference: { anyOf: [{ type: "string", maxLength: 120 }, { type: "null" }] },
        issueDate: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
        dueDate: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
        servicePeriodStart: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
        servicePeriodEnd: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
        currency: { type: "string", pattern: "^[A-Z]{3}$" },
        exchangeRate: {
          anyOf: [
            { type: "string", pattern: "^(?:0\\.\\d*[1-9]\\d*|[1-9]\\d*(?:\\.\\d+)?)$" },
            { type: "null" },
          ],
        },
        lines: { type: "array", minItems: 1, maxItems: 50, items: financeDocumentLineSchema },
        notes: { anyOf: [{ type: "string", maxLength: 4000 }, { type: "null" }] },
        terms: { anyOf: [{ type: "string", maxLength: 4000 }, { type: "null" }] },
        bankDetails: { anyOf: [{ type: "string", maxLength: 2000 }, { type: "null" }] },
        internalNotes: { anyOf: [{ type: "string", maxLength: 4000 }, { type: "null" }] },
      },
      ["companyId", "currency", "lines"],
    ),
    requiredPermissions: [financePermissionKeys.workspace, financePermissionKeys.invoiceCreate],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: (input) => runAction(createInvoiceAction as ActionFunction, input),
  },
  {
    name: "agencyos.finance.set_approval",
    title: "Set finance approval state",
    description:
      "Submits, approves, or rejects an estimate, invoice, or credit note after exact permission re-authorization.",
    inputSchema: objectSchema(
      {
        entityId: uuidSchema,
        entityType: { type: "string", enum: ["estimate", "invoice", "credit_note"] },
        decision: { type: "string", enum: ["submit", "approve", "reject"] },
        reason: { anyOf: [{ type: "string", maxLength: 1000 }, { type: "null" }] },
      },
      ["entityId", "entityType", "decision"],
    ),
    requiredPermissions: [financePermissionKeys.workspace],
    requiredAnyPermissions: [
      financePermissionKeys.estimateUpdate,
      financePermissionKeys.estimateApprove,
      financePermissionKeys.invoiceUpdate,
      financePermissionKeys.invoiceApprove,
      financePermissionKeys.creditNoteCreate,
      financePermissionKeys.creditNoteApprove,
    ],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: (input) => runAction(decideFinanceApprovalAction as ActionFunction, input),
  },
  {
    name: "agencyos.finance.issue_invoice",
    title: "Issue invoice",
    description:
      "Allocates a permanent invoice number and freezes seller, client, calculation, and payment snapshots.",
    inputSchema: objectSchema(
      {
        invoiceId: uuidSchema,
        issueDate: { type: "string", format: "date" },
        dueDate: { type: "string", format: "date" },
      },
      ["invoiceId", "issueDate", "dueDate"],
    ),
    requiredPermissions: [financePermissionKeys.workspace, financePermissionKeys.invoiceIssue],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: (input) => runAction(issueInvoiceAction as ActionFunction, input),
  },
  {
    name: "agencyos.finance.void_invoice",
    title: "Void invoice",
    description:
      "Voids an issued invoice with a required audit reason while preserving its immutable snapshot.",
    inputSchema: objectSchema(
      { invoiceId: uuidSchema, reason: { type: "string", minLength: 5, maxLength: 1000 } },
      ["invoiceId", "reason"],
    ),
    requiredPermissions: [financePermissionKeys.workspace, financePermissionKeys.invoiceVoid],
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: (input) => runAction(voidInvoiceAction as ActionFunction, input),
  },
  {
    name: "agencyos.finance.create_revised_invoice",
    title: "Create revised invoice",
    description:
      "Creates a new invoice draft that records correction lineage to an issued original invoice.",
    inputSchema: objectSchema(
      {
        invoiceId: uuidSchema,
        reason: { type: "string", minLength: 5, maxLength: 1000 },
        issueDate: { type: "string", format: "date" },
        dueDate: { type: "string", format: "date" },
      },
      ["invoiceId", "reason", "issueDate", "dueDate"],
    ),
    requiredPermissions: [
      financePermissionKeys.workspace,
      financePermissionKeys.invoiceView,
      financePermissionKeys.invoiceCreate,
      financePermissionKeys.invoiceCorrect,
    ],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: (input) => runAction(createRevisedInvoiceAction as ActionFunction, input),
  },
  {
    name: "agencyos.finance.create_credit_note",
    title: "Create credit note",
    description:
      "Creates a duplicate-protected credit-note draft against an issued invoice with explicit line values.",
    inputSchema: objectSchema(
      {
        originalInvoiceId: uuidSchema,
        reason: { type: "string", minLength: 5, maxLength: 2000 },
        internalNotes: { anyOf: [{ type: "string", maxLength: 4000 }, { type: "null" }] },
        lines: { type: "array", minItems: 1, maxItems: 50, items: financeDocumentLineSchema },
      },
      ["originalInvoiceId", "reason", "lines"],
    ),
    requiredPermissions: [
      financePermissionKeys.workspace,
      financePermissionKeys.invoiceView,
      financePermissionKeys.creditNoteCreate,
    ],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: (input) => runAction(createCreditNoteAction as ActionFunction, input),
  },
  {
    name: "agencyos.finance.issue_credit_note",
    title: "Issue credit note",
    description:
      "Allocates a permanent credit-note number, freezes immutable snapshots, and applies the credit to the original invoice.",
    inputSchema: objectSchema(
      {
        creditNoteId: uuidSchema,
        issueDate: { type: "string", format: "date" },
      },
      ["creditNoteId", "issueDate"],
    ),
    requiredPermissions: [financePermissionKeys.workspace, financePermissionKeys.creditNoteIssue],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: (input) => runAction(issueCreditNoteAction as ActionFunction, input),
  },
  {
    name: "agencyos.finance.void_credit_note",
    title: "Void credit note",
    description:
      "Voids an issued credit note with a required reason and recalculates the original invoice balance.",
    inputSchema: objectSchema(
      {
        creditNoteId: uuidSchema,
        reason: { type: "string", minLength: 5, maxLength: 1000 },
      },
      ["creditNoteId", "reason"],
    ),
    requiredPermissions: [financePermissionKeys.workspace, financePermissionKeys.creditNoteVoid],
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: (input) => runAction(voidCreditNoteAction as ActionFunction, input),
  },
  {
    name: "agencyos.finance.record_payment",
    title: "Record payment",
    description: "Records one payment and atomically allocates it across matching client invoices.",
    inputSchema: objectSchema(
      {
        paymentDate: { type: "string", format: "date" },
        amount: { type: "string", pattern: "^\\d+(?:\\.\\d+)?$" },
        currency: { type: "string", pattern: "^[A-Z]{3}$" },
        paymentMethod: {
          type: "string",
          enum: ["bank_transfer", "card", "cash", "cheque", "wallet", "other"],
        },
        transactionReference: { anyOf: [{ type: "string", maxLength: 160 }, { type: "null" }] },
        bankAccount: { anyOf: [{ type: "string", maxLength: 160 }, { type: "null" }] },
        companyId: uuidSchema,
        notes: { anyOf: [{ type: "string", maxLength: 2000 }, { type: "null" }] },
        allocations: {
          type: "array",
          minItems: 1,
          maxItems: 50,
          items: objectSchema(
            { invoiceId: uuidSchema, amount: { type: "string", pattern: "^\\d+(?:\\.\\d+)?$" } },
            ["invoiceId", "amount"],
          ),
        },
      },
      ["paymentDate", "amount", "currency", "paymentMethod", "companyId", "allocations"],
    ),
    requiredPermissions: [financePermissionKeys.workspace, financePermissionKeys.paymentCreate],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: (input) => runAction(createPaymentAction as ActionFunction, input),
  },
  {
    name: "agencyos.finance.update_invoice_status",
    title: "Record invoice status evidence",
    description: "Records viewed, disputed, or dispute-resolution evidence on an issued invoice.",
    inputSchema: objectSchema(
      {
        invoiceId: uuidSchema,
        action: { type: "string", enum: ["viewed", "disputed", "resolve_dispute"] },
        reason: { anyOf: [{ type: "string", minLength: 5, maxLength: 2000 }, { type: "null" }] },
      },
      ["invoiceId", "action"],
    ),
    requiredPermissions: [
      financePermissionKeys.workspace,
      financePermissionKeys.invoiceView,
      financePermissionKeys.invoiceStatusManage,
    ],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: (input) => runAction(updateInvoiceStatusAction as ActionFunction, input),
  },
  {
    name: "agencyos.finance.set_payment_reconciliation",
    title: "Set payment reconciliation",
    description:
      "Changes payment reconciliation state without exposing bank connector credentials.",
    inputSchema: objectSchema(
      {
        paymentId: uuidSchema,
        reconciliationStatus: {
          type: "string",
          enum: ["unreconciled", "matched", "reconciled", "exception"],
        },
      },
      ["paymentId", "reconciliationStatus"],
    ),
    requiredPermissions: [financePermissionKeys.workspace, financePermissionKeys.paymentReconcile],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) => runAction(reconcilePaymentAction as ActionFunction, input),
  },
  {
    name: "agencyos.finance.record_payment_refund",
    title: "Record payment refund",
    description:
      "Records immutable refund evidence without allowing the total refunded amount to exceed the payment.",
    inputSchema: objectSchema(
      {
        paymentId: uuidSchema,
        refundDate: { type: "string", format: "date" },
        amount: { type: "string", pattern: "^\\d+(?:\\.\\d+)?$" },
        refundMethod: {
          type: "string",
          enum: ["bank_transfer", "card", "cash", "cheque", "wallet", "other"],
        },
        transactionReference: { anyOf: [{ type: "string", maxLength: 160 }, { type: "null" }] },
        reason: { type: "string", minLength: 5, maxLength: 2000 },
      },
      ["paymentId", "refundDate", "amount", "refundMethod", "reason"],
    ),
    requiredPermissions: [
      financePermissionKeys.workspace,
      financePermissionKeys.paymentView,
      financePermissionKeys.paymentRefund,
    ],
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: (input) => runAction(recordPaymentRefundAction as ActionFunction, input),
  },
  {
    name: "agencyos.finance.generate_payment_receipt",
    title: "Generate payment receipt",
    description:
      "Generates or reuses the immutable MinIO-backed PDF receipt for a visible payment.",
    inputSchema: objectSchema({ entityId: uuidSchema }, ["entityId"]),
    requiredPermissions: [
      financePermissionKeys.workspace,
      financePermissionKeys.paymentView,
      financePermissionKeys.documentDownload,
    ],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: (input) =>
      runAction(generateFinanceDocumentSnapshotAction as ActionFunction, {
        entityType: "payment_receipt",
        entityId: input.entityId,
      }),
  },
] as const;

function withAiApprovalArgument(schema: JsonSchema): JsonSchema {
  if (schema.type !== "object" || !schema.properties || typeof schema.properties !== "object") {
    return schema;
  }
  return {
    ...schema,
    properties: {
      ...(schema.properties as Record<string, unknown>),
      [AI_APPROVAL_ARGUMENT_NAME]: {
        anyOf: [uuidSchema, { type: "null" }],
        description:
          "Approved shared-approval request returned by a previous call for this exact operation and argument hash.",
      },
    },
  };
}

export function getAvailableMcpToolsForPermissions(
  permissions: ReadonlySet<string>,
): AgencyOsMcpToolDescriptor[] {
  const availableTools: AgencyOsMcpToolDescriptor[] = [];
  for (const tool of AGENCYOS_MCP_TOOLS) {
    if (
      hasAllPermissions(permissions, tool.requiredPermissions) &&
      hasAnyPermission(permissions, tool.requiredAnyPermissions)
    ) {
      const approvalRequired = toolRequiresAiApproval(tool.name, tool.annotations);
      availableTools.push({
        name: tool.name,
        title: tool.title,
        description: approvalRequired
          ? `${tool.description} This sensitive mutation requires an approved AgencyOS approval request before execution.`
          : tool.description,
        inputSchema: approvalRequired ? withAiApprovalArgument(tool.inputSchema) : tool.inputSchema,
        annotations: tool.annotations,
      });
    }
  }
  return availableTools;
}

export async function listAvailableMcpTools(): Promise<AgencyOsMcpToolDescriptor[]> {
  const context = await getCurrentPermissionContext();
  if (!context.allowed) {
    throw new McpToolError(
      context.reason === "access-check-failed"
        ? "AgencyOS could not verify the current session because a required service is temporarily unavailable."
        : `AgencyOS access denied: ${context.reason}.`,
      context.reason === "access-check-failed" ? "UNAVAILABLE" : "UNAUTHORIZED",
    );
  }

  return getAvailableMcpToolsForPermissions(context.context.permissions);
}

async function authorizeTool(tool: AgencyOsMcpToolDefinition): Promise<CurrentPermissionContext> {
  const authorization = await authorizeCurrentUser(tool.requiredPermissions);
  if (!authorization.allowed) {
    throw new McpToolError(
      authorization.reason === "access-check-failed"
        ? "AgencyOS could not verify tool access because a required service is temporarily unavailable."
        : `This user is not allowed to run ${tool.name}.`,
      authorization.reason === "access-check-failed" ? "UNAVAILABLE" : "UNAUTHORIZED",
    );
  }

  if (!hasAnyPermission(authorization.context.permissions, tool.requiredAnyPermissions)) {
    throw new McpToolError(`This user is not allowed to run ${tool.name}.`, "UNAUTHORIZED");
  }
  return authorization.context;
}

function mcpErrorCode(error: unknown): string {
  if (error instanceof McpToolError) return error.code.toLowerCase();
  if (error instanceof Error && error.name) return error.name.slice(0, 80).toLowerCase();
  return "unknown_error";
}

export async function callMcpTool(name: string, input: unknown): Promise<unknown> {
  const tool = AGENCYOS_MCP_TOOLS.find((candidate) => candidate.name === name);
  if (!tool) throw new McpToolError(`Unknown AgencyOS tool: ${name}.`, "NOT_FOUND");
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new McpToolError("Tool arguments must be a JSON object.", "INVALID_ARGUMENTS");
  }

  const context = await authorizeTool(tool);
  let prepared;
  try {
    prepared = prepareMcpInput(input as Record<string, unknown>);
  } catch (error) {
    throw new McpToolError(
      error instanceof Error ? error.message : "Tool arguments are not safe for model execution.",
      "INVALID_ARGUMENTS",
    );
  }
  const mode = getAiOperationMode(tool.name, tool.annotations);
  const startedAt = new Date();
  let intentId: string | null = null;

  if (toolRequiresAiApproval(tool.name, tool.annotations) && !prepared.approvalRequestId) {
    try {
      const approval = await requestSensitiveMcpApproval(context, tool.name, prepared);
      await recordAiExecutionEvent({
        context,
        intentId: approval.intentId,
        toolName: tool.name,
        mode,
        status: "approval_required",
        inputHash: prepared.hash,
        inputSummary: prepared.summary,
        outputSummary: { approvalRequestId: approval.approvalRequestId },
        errorCode: null,
        startedAt,
      });
      return {
        status: "approval_required",
        intentId: approval.intentId,
        approvalRequestId: approval.approvalRequestId,
        message:
          "This sensitive AgencyOS mutation was not executed. Approve the request, then repeat the exact call with approvalRequestId.",
      };
    } catch (error) {
      throw new McpToolError(
        error instanceof Error && error.message.includes("Active approval policy")
          ? "The ai_sensitive_operation approval policy is not configured in AgencyOS."
          : error instanceof Error
            ? error.message
            : "The AI mutation approval request could not be created.",
        "UNAVAILABLE",
      );
    }
  }

  if (toolRequiresAiApproval(tool.name, tool.annotations)) {
    try {
      intentId = await beginApprovedMcpMutation(context, tool.name, prepared);
    } catch (error) {
      throw new McpToolError(
        error instanceof Error ? error.message : "The approved AI mutation could not be verified.",
        "UNAUTHORIZED",
      );
    }
  }

  await recordAiExecutionEvent({
    context,
    intentId,
    toolName: tool.name,
    mode,
    status: "started",
    inputHash: prepared.hash,
    inputSummary: prepared.summary,
    outputSummary: {},
    errorCode: null,
    startedAt,
  });

  try {
    const cacheVersion = tool.annotations?.readOnlyHint
      ? await getRedisCacheVersion("mcp-org", [context.membership.organizationId])
      : 0;
    const output = tool.annotations?.readOnlyHint
      ? await readThroughRedisJsonCache(
          {
            namespace: "mcp-read",
            identity: [
              context.membership.organizationId,
              context.membership.id,
              String(cacheVersion),
              tool.name,
              prepared.hash,
            ],
            ttlSeconds: 45,
            maximumBytes: 512 * 1024,
            parse: (value) => value,
          },
          () => tool.execute(prepared.arguments),
        )
      : await tool.execute(prepared.arguments);
    if (!tool.annotations?.readOnlyHint) {
      await bumpRedisCacheVersion("mcp-org", [context.membership.organizationId]);
    }
    const outputSummary = ensureBoundedMcpOutput(output);
    await recordAiExecutionEvent({
      context,
      intentId,
      toolName: tool.name,
      mode,
      status: "succeeded",
      inputHash: prepared.hash,
      inputSummary: prepared.summary,
      outputSummary,
      errorCode: null,
      startedAt,
    });
    if (intentId) await completeApprovedMcpMutation(intentId, true, null);
    return output;
  } catch (error) {
    const errorCode = mcpErrorCode(error);
    if (intentId) await completeApprovedMcpMutation(intentId, false, errorCode);
    await recordAiExecutionEvent({
      context,
      intentId,
      toolName: tool.name,
      mode,
      status: "failed",
      inputHash: prepared.hash,
      inputSummary: prepared.summary,
      outputSummary: {},
      errorCode,
      startedAt,
    });
    throw error;
  }
}

export function getToolRequiredPermissions(name: string): {
  all: readonly string[];
  any: readonly string[];
} | null {
  const tool = AGENCYOS_MCP_TOOLS.find((candidate) => candidate.name === name);
  return tool ? { all: tool.requiredPermissions, any: tool.requiredAnyPermissions ?? [] } : null;
}

export function mapAuthorizationFailureToMcpError(
  reason: AuthorizationFailureReason,
): McpToolError {
  return new McpToolError(
    reason === "access-check-failed"
      ? "AgencyOS access verification is temporarily unavailable."
      : `AgencyOS access denied: ${reason}.`,
    reason === "access-check-failed" ? "UNAVAILABLE" : "UNAUTHORIZED",
  );
}

export type AgencyOsMcpScope = PermissionScope;
