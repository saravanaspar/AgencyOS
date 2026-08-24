import "server-only";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { withInfrastructureRetry } from "@/lib/server/retry";
import type { AuthorizationFailureReason } from "@/modules/permissions/server/authorization";
import { getCurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";
import type { PermissionScope } from "@/modules/permissions/permission-scopes";
import {
  privateFileStatusLabels,
  type PrivateFileStatus,
} from "@/modules/private-files/private-files";
import {
  calculateProjectProgress,
  projectHealth,
  projectPermissionKeys,
  type ProjectBillingMethod,
  type ProjectMemberRole,
  type ProjectMilestoneStatus,
  type ProjectPhaseStatus,
  type ProjectPriority,
  type ProjectRecurrenceUnit,
  type ProjectStatus,
  type ProjectTaskDependencyRelationship,
  type ProjectVisibility,
} from "@/modules/projects/projects";
import type { ProjectFilters } from "@/modules/projects/schemas/projects";
import {
  getProjectProfitabilityForContext,
  type ProjectProfitability,
  type ProjectProfitabilityRollup,
} from "@/modules/projects/server/profitability";

export interface ProjectMemberOption {
  membershipId: string;
  displayName: string;
  email: string;
}

export interface ProjectCompanyOption {
  id: string;
  name: string;
}

export interface ProjectSummary {
  id: string;
  code: string;
  name: string;
  description: string | null;
  projectType: "client" | "internal";
  companyId: string | null;
  companyName: string | null;
  status: ProjectStatus;
  priority: ProjectPriority;
  visibility: ProjectVisibility;
  ownerMembershipId: string;
  ownerName: string;
  startDate: string | null;
  dueDate: string | null;
  currency: string;
  billingMethod: ProjectBillingMethod;
  budgetMinor: number | null;
  hourlyRateMinor: number | null;
  fixedPriceMinor: number | null;
  retainerAmountMinor: number | null;
  estimatedCompletionDate: string | null;
  actualCompletionDate: string | null;
  profitability: ProjectProfitability;
  completedAt: string | null;
  archivedAt: string | null;
  closureStatus: "open" | "requested" | "closed";
  closureNotes: string | null;
  closureRequestedAt: string | null;
  closedAt: string | null;
  taskCount: number;
  terminalTaskCount: number;
  blockedTaskCount: number;
  trackedMinutes: number;
  progress: number;
  health: "healthy" | "attention" | "at_risk" | "complete";
  updatedAt: string;
}

export interface ProjectMember {
  projectId: string;
  membershipId: string;
  displayName: string;
  email: string;
  role: ProjectMemberRole;
  hourlyCostRateMinor: number;
}

export interface ProjectTaskStatus {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  position: number;
  isTerminal: boolean;
  isCancelled: boolean;
}

export interface ProjectTaskLabel {
  id: string;
  name: string;
  color: string;
}

export interface ProjectTaskWatcher {
  membershipId: string;
  displayName: string;
}

export interface ProjectChecklistItem {
  id: string;
  label: string;
  position: number;
  isRequired: boolean;
  isCompleted: boolean;
  completedAt: string | null;
}

export interface ProjectTaskDependency {
  relatedTaskId: string;
  relatedTaskCode: string;
  relatedTaskTitle: string;
  relationship: ProjectTaskDependencyRelationship;
  direction: "outgoing" | "incoming";
}

export interface ProjectTaskAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByName: string;
  createdAt: string;
  status: PrivateFileStatus;
  statusLabel: string;
  scanErrorCode: string | null;
  downloadHref: string | null;
}

export interface ProjectTaskRecurrence {
  id: string;
  intervalUnit: ProjectRecurrenceUnit;
  intervalCount: number;
  nextRunOn: string;
  endOn: string | null;
  isActive: boolean;
}

export interface ProjectTask {
  id: string;
  projectId: string;
  taskNumber: number;
  code: string;
  title: string;
  description: string | null;
  statusId: string;
  statusSlug: string;
  priority: ProjectPriority;
  parentTaskId: string | null;
  phaseId: string | null;
  milestoneId: string | null;
  recurrenceId: string | null;
  startDate: string | null;
  dueDate: string | null;
  reminderAt: string | null;
  reminderSentAt: string | null;
  estimatedMinutes: number | null;
  trackedMinutes: number;
  assignees: Array<{ membershipId: string; displayName: string }>;
  labels: ProjectTaskLabel[];
  watchers: ProjectTaskWatcher[];
  checklist: ProjectChecklistItem[];
  dependencies: ProjectTaskDependency[];
  attachments: ProjectTaskAttachment[];
  recurrence: ProjectTaskRecurrence | null;
  commentCount: number;
  completedAt: string | null;
  updatedAt: string;
}

export interface ProjectComment {
  id: string;
  taskId: string;
  body: string;
  isInternal: boolean;
  authorName: string;
  createdAt: string;
}

export interface ProjectTimeEntry {
  id: string;
  projectId: string;
  taskId: string | null;
  taskTitle: string | null;
  membershipId: string;
  memberName: string;
  workDate: string;
  minutes: number;
  notes: string | null;
  submissionStatus: "draft" | "submitted";
  hourlyCostRateMinor: number;
}

export interface ProjectPhase {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  position: number;
  status: ProjectPhaseStatus;
  startDate: string | null;
  dueDate: string | null;
  completedAt: string | null;
  taskCount: number;
  completedTaskCount: number;
}

export interface ProjectMilestone {
  id: string;
  projectId: string;
  phaseId: string | null;
  name: string;
  description: string | null;
  dueDate: string | null;
  status: ProjectMilestoneStatus;
  completedAt: string | null;
  taskCount: number;
  completedTaskCount: number;
}

export interface ProjectLabel {
  id: string;
  projectId: string;
  name: string;
  color: string;
}

export interface ProjectClosureItem {
  id: string;
  projectId: string;
  label: string;
  position: number;
  isRequired: boolean;
  isCompleted: boolean;
  completedAt: string | null;
  checkKey: string;
}

export interface ProjectMyTask {
  id: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  code: string;
  title: string;
  statusSlug: string;
  priority: ProjectPriority;
  dueDate: string | null;
  reminderAt: string | null;
}

export interface ProjectSavedFilter {
  id: string;
  name: string;
  filters: Omit<ProjectFilters, "project">;
}

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "archived";
}

export interface ProjectClosureReadiness {
  openTasks: number;
  unsubmittedTimeEntries: number;
  outstandingExpenses: number;
  openSupportTickets: number;
  unbilledMinor: number;
  manualChecksRemaining: number;
  ready: boolean;
}

export interface ProjectWorkloadItem {
  membershipId: string;
  displayName: string;
  openTasks: number;
  overdueTasks: number;
  estimatedMinutes: number;
  trackedMinutes: number;
}

export interface ProjectsWorkspaceData {
  filters: ProjectFilters;
  currentMembershipId: string;
  selectedProjectId: string | null;
  projects: ProjectSummary[];
  members: ProjectMember[];
  memberOptions: ProjectMemberOption[];
  companyOptions: ProjectCompanyOption[];
  statuses: ProjectTaskStatus[];
  tasks: ProjectTask[];
  comments: ProjectComment[];
  timeEntries: ProjectTimeEntry[];
  phases: ProjectPhase[];
  milestones: ProjectMilestone[];
  labels: ProjectLabel[];
  closureItems: ProjectClosureItem[];
  workload: ProjectWorkloadItem[];
  myTasks: ProjectMyTask[];
  savedFilters: ProjectSavedFilter[];
  templates: ProjectTemplate[];
  profitabilityRollups: ProjectProfitabilityRollup[];
  closureReadiness: ProjectClosureReadiness | null;
  summary: {
    activeProjects: number;
    atRiskProjects: number;
    openTasks: number;
    trackedMinutes: number;
  };
  capabilities: {
    canViewProjects: boolean;
    canCreateProjects: boolean;
    canUpdateProjects: boolean;
    canArchiveProjects: boolean;
    canAssignProjects: boolean;
    canViewTasks: boolean;
    canCreateTasks: boolean;
    canUpdateTasks: boolean;
    canAssignTasks: boolean;
    canCreateComments: boolean;
    canViewTime: boolean;
    canCreateTime: boolean;
  };
}

export type ProjectsWorkspaceResult =
  | { allowed: true; data: ProjectsWorkspaceData }
  | { allowed: false; reason: AuthorizationFailureReason };

interface ProjectRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  project_type: "client" | "internal";
  company_id: string | null;
  company_name: string | null;
  status: ProjectStatus;
  priority: ProjectPriority;
  visibility: ProjectVisibility;
  owner_membership_id: string;
  owner_name: string;
  start_date: string | null;
  due_date: string | null;
  currency: string;
  billing_method: ProjectBillingMethod;
  budget_minor: string | number | null;
  hourly_rate_minor: string | number | null;
  fixed_price_minor: string | number | null;
  retainer_amount_minor: string | number | null;
  estimated_completion_date: string | null;
  actual_completion_date: string | null;
  completed_at: Date | null;
  archived_at: Date | null;
  closure_status: "open" | "requested" | "closed";
  closure_notes: string | null;
  closure_requested_at: Date | null;
  closed_at: Date | null;
  task_count: number;
  terminal_task_count: number;
  blocked_task_count: number;
  tracked_minutes: number;
  updated_at: Date;
}

interface MemberOptionRow {
  membership_id: string;
  display_name: string;
  email: string;
}

interface CompanyOptionRow {
  id: string;
  name: string;
}

interface SavedFilterRow {
  id: string;
  name: string;
  filters: Omit<ProjectFilters, "project">;
}

interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "archived";
}

interface MyTaskRow {
  id: string;
  project_id: string;
  project_code: string;
  project_name: string;
  task_number: number;
  title: string;
  status_slug: string;
  priority: ProjectPriority;
  due_date: string | null;
  reminder_at: Date | null;
}

interface DetailMemberRow {
  projectId: string;
  membershipId: string;
  displayName: string;
  email: string;
  role: ProjectMemberRole;
  hourlyCostRateMinor: number;
}

interface DetailStatusRow {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  position: number;
  isTerminal: boolean;
  isCancelled: boolean;
}

interface DetailTaskRow {
  id: string;
  projectId: string;
  projectCode: string;
  taskNumber: number;
  title: string;
  description: string | null;
  statusId: string;
  statusSlug: string;
  priority: ProjectPriority;
  parentTaskId: string | null;
  phaseId: string | null;
  milestoneId: string | null;
  recurrenceId: string | null;
  startDate: string | null;
  dueDate: string | null;
  reminderAt: string | null;
  reminderSentAt: string | null;
  estimatedMinutes: number | null;
  trackedMinutes: number;
  assignees: Array<{ membershipId: string; displayName: string }>;
  labels: ProjectTaskLabel[];
  watchers: ProjectTaskWatcher[];
  checklist: ProjectChecklistItem[];
  dependencies: ProjectTaskDependency[];
  attachments: Omit<ProjectTaskAttachment, "downloadHref" | "statusLabel">[];
  recurrence: ProjectTaskRecurrence | null;
  commentCount: number;
  completedAt: string | null;
  updatedAt: string;
}

interface DetailCommentRow {
  id: string;
  taskId: string;
  body: string;
  isInternal: boolean;
  authorName: string;
  createdAt: string;
}

interface DetailTimeRow {
  id: string;
  projectId: string;
  taskId: string | null;
  taskTitle: string | null;
  membershipId: string;
  memberName: string;
  workDate: string;
  minutes: number;
  notes: string | null;
  submissionStatus: "draft" | "submitted";
  hourlyCostRateMinor: number;
}

interface ClosureReadinessRow {
  open_tasks: number;
  unsubmitted_time_entries: number;
  outstanding_expenses: number;
  open_support_tickets: number;
  unbilled_minor: string | number;
  manual_checks_remaining: number;
}

interface ProjectDetailPayloadRow {
  members: DetailMemberRow[];
  statuses: DetailStatusRow[];
  tasks: DetailTaskRow[];
  comments: DetailCommentRow[];
  timeEntries: DetailTimeRow[];
  phases: ProjectPhase[];
  milestones: ProjectMilestone[];
  labels: ProjectLabel[];
  closureItems: ProjectClosureItem[];
  workload: ProjectWorkloadItem[];
}

function scopeFor(scopes: ReadonlyMap<string, PermissionScope>, key: string): PermissionScope {
  return scopes.get(key) ?? "own";
}

function emptyData(
  filters: ProjectFilters,
  capabilities: ProjectsWorkspaceData["capabilities"],
): ProjectsWorkspaceData {
  return {
    filters,
    currentMembershipId: "",
    selectedProjectId: null,
    projects: [],
    members: [],
    memberOptions: [],
    companyOptions: [],
    statuses: [],
    tasks: [],
    comments: [],
    timeEntries: [],
    phases: [],
    milestones: [],
    labels: [],
    closureItems: [],
    workload: [],
    myTasks: [],
    savedFilters: [],
    templates: [],
    profitabilityRollups: [],
    closureReadiness: null,
    summary: { activeProjects: 0, atRiskProjects: 0, openTasks: 0, trackedMinutes: 0 },
    capabilities,
  };
}

function workspaceSummary(projects: ProjectSummary[]): ProjectsWorkspaceData["summary"] {
  return {
    activeProjects: projects.filter((project) => project.status === "active").length,
    atRiskProjects: projects.filter((project) => project.health === "at_risk").length,
    openTasks: projects.reduce(
      (total, project) => total + project.taskCount - project.terminalTaskCount,
      0,
    ),
    trackedMinutes: projects.reduce((total, project) => total + project.trackedMinutes, 0),
  };
}

export async function getProjectsWorkspaceData(
  filters: ProjectFilters,
): Promise<ProjectsWorkspaceResult> {
  const permissionResult = await getCurrentPermissionContext();
  if (!permissionResult.allowed) return permissionResult;
  const context = permissionResult.context;
  if (!context.permissions.has(projectPermissionKeys.workspaceView)) {
    return { allowed: false, reason: "insufficient-permission" };
  }

  const capabilities: ProjectsWorkspaceData["capabilities"] = {
    canViewProjects: context.permissions.has(projectPermissionKeys.projectView),
    canCreateProjects: context.permissions.has(projectPermissionKeys.projectCreate),
    canUpdateProjects: context.permissions.has(projectPermissionKeys.projectUpdate),
    canArchiveProjects: context.permissions.has(projectPermissionKeys.projectArchive),
    canAssignProjects: context.permissions.has(projectPermissionKeys.projectAssign),
    canViewTasks: context.permissions.has(projectPermissionKeys.taskView),
    canCreateTasks: context.permissions.has(projectPermissionKeys.taskCreate),
    canUpdateTasks: context.permissions.has(projectPermissionKeys.taskUpdate),
    canAssignTasks: context.permissions.has(projectPermissionKeys.taskAssign),
    canCreateComments: context.permissions.has(projectPermissionKeys.commentCreate),
    canViewTime: context.permissions.has(projectPermissionKeys.timeView),
    canCreateTime: context.permissions.has(projectPermissionKeys.timeCreate),
  };
  if (!capabilities.canViewProjects) {
    return { allowed: true, data: emptyData(filters, capabilities) };
  }

  const database = getDatabaseClient();
  const organizationId = context.membership.organizationId;
  const membershipId = context.membership.id;
  const projectScope = scopeFor(context.permissionScopes, projectPermissionKeys.projectView);
  const taskScope = scopeFor(context.permissionScopes, projectPermissionKeys.taskView);
  const search = filters.q ? `%${filters.q.replaceAll("%", "\\%").replaceAll("_", "\\_")}%` : null;

  let projectRows: ProjectRow[];
  let memberOptionRows: MemberOptionRow[];
  let companyOptionRows: CompanyOptionRow[];

  try {
    [projectRows, memberOptionRows, companyOptionRows] = await withInfrastructureRetry(
      () =>
        Promise.all([
          database<ProjectRow[]>`
      with member_directory as (
        select
          membership.id as membership_id,
          coalesce(
            profile.display_name,
            nullif(trim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
            nullif(auth_user.raw_user_meta_data ->> 'full_name', ''),
            auth_user.email,
            'AgencyOS user'
          ) as display_name
        from public.memberships as membership
        join public.identity_accounts as auth_user on auth_user.id = membership.user_id
        left join public.profiles as profile on profile.id = membership.user_id
        where membership.organization_id = ${organizationId}::uuid
      ), task_summary as (
        select task.project_id,
          count(*)::int as task_count,
          count(*) filter (where status.is_terminal)::int as terminal_task_count,
          count(*) filter (where status.slug = 'blocked')::int as blocked_task_count
        from public.project_tasks as task
        join public.project_task_statuses as status on status.id = task.status_id
        where task.organization_id = ${organizationId}::uuid
          and ${capabilities.canViewTasks}
        group by task.project_id
      ), time_summary as (
        select entry.project_id, coalesce(sum(entry.minutes), 0)::int as tracked_minutes
        from public.project_time_entries as entry
        where entry.organization_id = ${organizationId}::uuid
          and ${capabilities.canViewTime}
        group by entry.project_id
      )
      select
        project.id, project.code, project.name, project.description, project.project_type,
        project.company_id, coalesce(company.display_name, company.legal_name) as company_name,
        project.status, project.priority, project.visibility, project.owner_membership_id,
        owner.display_name as owner_name,
        project.start_date::text, project.due_date::text, project.currency, project.billing_method,
        project.budget_minor, project.hourly_rate_minor, project.fixed_price_minor, project.retainer_amount_minor,
        project.estimated_completion_date::text, project.actual_completion_date::text,
        project.completed_at, project.archived_at,
        project.closure_status, project.closure_notes, project.closure_requested_at, project.closed_at,
        case when ${capabilities.canViewTasks} then coalesce(task_summary.task_count, 0) else 0 end::int as task_count,
        case when ${capabilities.canViewTasks} then coalesce(task_summary.terminal_task_count, 0) else 0 end::int as terminal_task_count,
        case when ${capabilities.canViewTasks} then coalesce(task_summary.blocked_task_count, 0) else 0 end::int as blocked_task_count,
        case when ${capabilities.canViewTime} then coalesce(time_summary.tracked_minutes, 0) else 0 end::int as tracked_minutes,
        project.updated_at
      from public.projects as project
      join member_directory as owner on owner.membership_id = project.owner_membership_id
      left join public.crm_companies as company on company.id = project.company_id
      left join task_summary on task_summary.project_id = project.id
      left join time_summary on time_summary.project_id = project.id
      where project.organization_id = ${organizationId}::uuid
        and private.project_is_visible(project.id, ${membershipId}::uuid, ${projectScope})
        and (${filters.status}::text is null or project.status = ${filters.status})
        and (${filters.owner}::uuid is null or project.owner_membership_id = ${filters.owner}::uuid)
        and (
          not ${filters.mine}
          or project.owner_membership_id = ${membershipId}::uuid
          or exists (
            select 1 from public.project_members mine_member
            where mine_member.project_id = project.id and mine_member.membership_id = ${membershipId}::uuid
          )
        )
        and (
          ${filters.archive} = 'all'
          or (${filters.archive} = 'active' and project.archived_at is null)
          or (${filters.archive} = 'archived' and project.archived_at is not null)
        )
        and (
          ${search}::text is null
          or project.name ilike ${search} escape '\\'
          or project.code ilike ${search} escape '\\'
        )
      order by project.archived_at nulls first, project.updated_at desc, project.name
      limit 100
    `,
          database<MemberOptionRow[]>`
      select membership.id as membership_id,
        coalesce(
          profile.display_name,
          nullif(trim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
          nullif(auth_user.raw_user_meta_data ->> 'full_name', ''),
          auth_user.email,
          'AgencyOS user'
        ) as display_name,
        coalesce(auth_user.email, '') as email
      from public.memberships as membership
      join public.identity_accounts as auth_user on auth_user.id = membership.user_id
      left join public.profiles as profile on profile.id = membership.user_id
      where membership.organization_id = ${organizationId}::uuid and membership.status = 'active'
      order by display_name, email
      limit 1000
    `,
          context.permissions.has("crm.company.view")
            ? database<CompanyOptionRow[]>`
          select company.id, coalesce(company.display_name, company.legal_name) as name
          from public.crm_companies as company
          where company.organization_id = ${organizationId}::uuid
            and private.crm_scope_allows_membership(
              ${membershipId}::uuid,
              ${scopeFor(context.permissionScopes, "crm.company.view")},
              company.account_owner_membership_id,
              company.created_by_membership_id
            )
          order by name
          limit 500
        `
            : Promise.resolve([] as CompanyOptionRow[]),
        ]),
      { attempts: 2, operationName: "Project workspace summary" },
    );
  } catch {
    return { allowed: false, reason: "access-check-failed" };
  }

  let profitabilityBundle: Awaited<ReturnType<typeof getProjectProfitabilityForContext>>;
  let savedFilterRows: SavedFilterRow[];
  let templateRows: TemplateRow[];
  let myTaskRows: MyTaskRow[];
  try {
    [profitabilityBundle, savedFilterRows, templateRows, myTaskRows] = await Promise.all([
      getProjectProfitabilityForContext(context),
      database<SavedFilterRow[]>`
        select id, name, filters
        from public.project_saved_filters
        where organization_id = ${organizationId}::uuid
          and owner_membership_id = ${membershipId}::uuid
        order by name
      `,
      database<TemplateRow[]>`
        select id, name, description, status
        from public.project_templates
        where organization_id = ${organizationId}::uuid and status = 'active'
        order by name
      `,
      capabilities.canViewTasks
        ? database<MyTaskRow[]>`
          select task.id, task.project_id, project.code as project_code, project.name as project_name,
            task.task_number, task.title, status.slug as status_slug, task.priority,
            task.due_date::text, task.reminder_at
          from public.project_task_assignees assignee
          join public.project_tasks task on task.id = assignee.task_id
          join public.projects project on project.id = task.project_id
          join public.project_task_statuses status on status.id = task.status_id
          where assignee.membership_id = ${membershipId}::uuid
            and task.organization_id = ${organizationId}::uuid
            and not status.is_terminal
            and project.archived_at is null
            and private.project_is_visible(project.id, ${membershipId}::uuid, ${taskScope})
          order by task.due_date nulls last, task.updated_at desc
          limit 200
        `
        : Promise.resolve([] as MyTaskRow[]),
    ]);
  } catch {
    return { allowed: false, reason: "access-check-failed" };
  }

  let projects = projectRows.map((row) => {
    const progress = calculateProjectProgress(row.task_count, row.terminal_task_count);
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      projectType: row.project_type,
      companyId: row.company_id,
      companyName: row.company_name,
      status: row.status,
      priority: row.priority,
      visibility: row.visibility,
      ownerMembershipId: row.owner_membership_id,
      ownerName: row.owner_name,
      startDate: row.start_date,
      dueDate: row.due_date,
      currency: row.currency,
      billingMethod: row.billing_method,
      budgetMinor: row.budget_minor === null ? null : Number(row.budget_minor),
      hourlyRateMinor: row.hourly_rate_minor === null ? null : Number(row.hourly_rate_minor),
      fixedPriceMinor: row.fixed_price_minor === null ? null : Number(row.fixed_price_minor),
      retainerAmountMinor:
        row.retainer_amount_minor === null ? null : Number(row.retainer_amount_minor),
      estimatedCompletionDate: row.estimated_completion_date,
      actualCompletionDate: row.actual_completion_date,
      profitability: profitabilityBundle.byProject.get(row.id) ?? {
        projectId: row.id,
        currency: row.currency,
        invoicedRevenueMinor: 0,
        laborCostMinor: 0,
        vendorCostMinor: 0,
        projectExpenseMinor: 0,
        committedVendorMinor: 0,
        grossContributionMinor: 0,
        marginPercent: null,
        expectedBillableMinor: 0,
        unbilledMinor: 0,
        budgetMinor: row.budget_minor === null ? null : Number(row.budget_minor),
        budgetVarianceMinor: row.budget_minor === null ? null : Number(row.budget_minor),
      },
      completedAt: row.completed_at?.toISOString() ?? null,
      archivedAt: row.archived_at?.toISOString() ?? null,
      closureStatus: row.closure_status,
      closureNotes: row.closure_notes,
      closureRequestedAt: row.closure_requested_at?.toISOString() ?? null,
      closedAt: row.closed_at?.toISOString() ?? null,
      taskCount: row.task_count,
      terminalTaskCount: row.terminal_task_count,
      blockedTaskCount: row.blocked_task_count,
      trackedMinutes: row.tracked_minutes,
      progress,
      health: projectHealth({
        status: row.status,
        dueDate: row.due_date,
        progress,
        blockedTasks: row.blocked_task_count,
      }),
      updatedAt: row.updated_at.toISOString(),
    } satisfies ProjectSummary;
  });

  projects = [...projects].sort((left, right) => {
    if (filters.sort === "name") return left.name.localeCompare(right.name);
    if (filters.sort === "due") {
      return (left.dueDate ?? "9999-12-31").localeCompare(right.dueDate ?? "9999-12-31");
    }
    if (filters.sort === "profitability") {
      return right.profitability.grossContributionMinor - left.profitability.grossContributionMinor;
    }
    return right.updatedAt.localeCompare(left.updatedAt);
  });

  const selectedProjectId =
    (filters.project && projects.some((project) => project.id === filters.project)
      ? filters.project
      : projects[0]?.id) ?? null;

  const memberOptions = memberOptionRows.map((row) => ({
    membershipId: row.membership_id,
    displayName: row.display_name,
    email: row.email,
  }));

  if (!selectedProjectId) {
    const data = emptyData(filters, capabilities);
    data.currentMembershipId = membershipId;
    data.projects = projects;
    data.memberOptions = memberOptions;
    data.companyOptions = companyOptionRows;
    data.summary = workspaceSummary(projects);
    data.savedFilters = savedFilterRows;
    data.templates = templateRows;
    data.myTasks = myTaskRows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      projectCode: row.project_code,
      projectName: row.project_name,
      code: `${row.project_code}-${row.task_number}`,
      title: row.title,
      statusSlug: row.status_slug,
      priority: row.priority,
      dueDate: row.due_date,
      reminderAt: row.reminder_at?.toISOString() ?? null,
    }));
    data.profitabilityRollups = profitabilityBundle.rollups;
    return { allowed: true, data };
  }

  let detailRows: ProjectDetailPayloadRow[];
  let closureRows: ClosureReadinessRow[];

  try {
    [detailRows, closureRows] = await Promise.all([
      withInfrastructureRetry(
        () => database<ProjectDetailPayloadRow[]>`
    with member_directory as (
      select
        membership.id as membership_id,
        coalesce(
          profile.display_name,
          nullif(trim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
          nullif(auth_user.raw_user_meta_data ->> 'full_name', ''),
          auth_user.email,
          'AgencyOS user'
        ) as display_name,
        coalesce(auth_user.email, '') as email
      from public.memberships as membership
      join public.identity_accounts as auth_user on auth_user.id = membership.user_id
      left join public.profiles as profile on profile.id = membership.user_id
      where membership.organization_id = ${organizationId}::uuid
    ), selected_tasks as (
      select task.*
      from public.project_tasks as task
      where task.project_id = ${selectedProjectId}::uuid
        and task.organization_id = ${organizationId}::uuid
        and private.project_is_visible(task.project_id, ${membershipId}::uuid, ${taskScope})
      order by task.updated_at desc, task.task_number
      limit 500
    )
    select
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'projectId', member.project_id,
          'membershipId', member.membership_id,
          'displayName', member_directory.display_name,
          'email', member_directory.email,
          'role', member.role,
          'hourlyCostRateMinor', member.hourly_cost_rate_minor
        ) order by case member.role when 'owner' then 1 when 'manager' then 2 when 'member' then 3 else 4 end,
          member_directory.display_name)
        from public.project_members as member
        join member_directory on member_directory.membership_id = member.membership_id
        where member.project_id = ${selectedProjectId}::uuid
      ), '[]'::jsonb) as members,
      case when ${capabilities.canViewTasks} then coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', status.id,
          'projectId', status.project_id,
          'name', status.name,
          'slug', status.slug,
          'position', status.position,
          'isTerminal', status.is_terminal,
          'isCancelled', status.is_cancelled
        ) order by status.position)
        from public.project_task_statuses as status
        where status.project_id = ${selectedProjectId}::uuid
      ), '[]'::jsonb) else '[]'::jsonb end as statuses,
      case when ${capabilities.canViewTasks} then coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', task.id,
          'projectId', task.project_id,
          'projectCode', project.code,
          'taskNumber', task.task_number,
          'title', task.title,
          'description', task.description,
          'statusId', task.status_id,
          'statusSlug', status.slug,
          'priority', task.priority,
          'parentTaskId', task.parent_task_id,
          'phaseId', task.phase_id,
          'milestoneId', task.milestone_id,
          'recurrenceId', task.recurrence_id,
          'startDate', task.start_date::text,
          'dueDate', task.due_date::text,
          'reminderAt', task.reminder_at,
          'reminderSentAt', task.reminder_sent_at,
          'estimatedMinutes', task.estimated_minutes,
          'trackedMinutes', coalesce((
            select sum(entry.minutes)::int from public.project_time_entries as entry where entry.task_id = task.id
          ), 0),
          'assignees', coalesce((
            select jsonb_agg(jsonb_build_object(
              'membershipId', assignee.membership_id,
              'displayName', assignee_directory.display_name
            ) order by assignee_directory.display_name)
            from public.project_task_assignees as assignee
            join member_directory as assignee_directory
              on assignee_directory.membership_id = assignee.membership_id
            where assignee.task_id = task.id
          ), '[]'::jsonb),
          'labels', coalesce((
            select jsonb_agg(jsonb_build_object('id', label.id, 'name', label.name, 'color', label.color) order by label.name)
            from public.project_task_labels as task_label
            join public.project_labels as label on label.id = task_label.label_id
            where task_label.task_id = task.id
          ), '[]'::jsonb),
          'watchers', coalesce((
            select jsonb_agg(jsonb_build_object(
              'membershipId', watcher.membership_id,
              'displayName', watcher_directory.display_name
            ) order by watcher_directory.display_name)
            from public.project_task_watchers as watcher
            join member_directory as watcher_directory
              on watcher_directory.membership_id = watcher.membership_id
            where watcher.task_id = task.id
          ), '[]'::jsonb),
          'checklist', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', item.id,
              'label', item.label,
              'position', item.position,
              'isRequired', item.is_required,
              'isCompleted', item.is_completed,
              'completedAt', item.completed_at
            ) order by item.position)
            from public.project_task_checklist_items as item
            where item.task_id = task.id
          ), '[]'::jsonb),
          'dependencies', coalesce((
            select jsonb_agg(jsonb_build_object(
              'relatedTaskId', related.id,
              'relatedTaskCode', related_project.code || '-' || related.task_number,
              'relatedTaskTitle', related.title,
              'relationship', relation.relationship,
              'direction', relation.direction
            ) order by related.task_number)
            from (
              select dependency.related_task_id, dependency.relationship, 'outgoing'::text as direction
              from public.project_task_dependencies as dependency where dependency.task_id = task.id
              union all
              select dependency.task_id as related_task_id, dependency.relationship, 'incoming'::text as direction
              from public.project_task_dependencies as dependency where dependency.related_task_id = task.id
            ) as relation
            join public.project_tasks as related on related.id = relation.related_task_id
            join public.projects as related_project on related_project.id = related.project_id
          ), '[]'::jsonb),
          'attachments', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', attachment.id,
              'fileName', attachment.file_name,
              'mimeType', attachment.mime_type,
              'sizeBytes', attachment.size_bytes,
              'uploadedByName', upload_directory.display_name,
              'createdAt', attachment.created_at,
              'status', private_file.status,
              'scanErrorCode', private_file.scan_error_code
            ) order by attachment.created_at desc)
            from public.project_task_attachments as attachment
            join public.private_files as private_file on private_file.id = attachment.private_file_id
            join member_directory as upload_directory
              on upload_directory.membership_id = attachment.uploaded_by_membership_id
            where attachment.task_id = task.id
              and private_file.status <> 'deleted' 
          ), '[]'::jsonb),
          'recurrence', case when recurrence.id is null then null else jsonb_build_object(
            'id', recurrence.id,
            'intervalUnit', recurrence.interval_unit,
            'intervalCount', recurrence.interval_count,
            'nextRunOn', recurrence.next_run_on::text,
            'endOn', recurrence.end_on::text,
            'isActive', recurrence.is_active
          ) end,
          'commentCount', (select count(*)::int from public.project_task_comments as comment where comment.task_id = task.id),
          'completedAt', task.completed_at,
          'updatedAt', task.updated_at
        ) order by task.updated_at desc, task.task_number)
        from selected_tasks as task
        join public.projects as project on project.id = task.project_id
        join public.project_task_statuses as status on status.id = task.status_id
        left join public.project_task_recurrences as recurrence on recurrence.id = task.recurrence_id
      ), '[]'::jsonb) else '[]'::jsonb end as tasks,
      case when ${capabilities.canViewTasks} then coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', comment.id,
          'taskId', comment.task_id,
          'body', comment.body,
          'isInternal', comment.is_internal,
          'authorName', author_directory.display_name,
          'createdAt', comment.created_at
        ) order by comment.created_at desc)
        from (
          select project_comment.*
          from public.project_task_comments as project_comment
          join public.project_tasks as project_task on project_task.id = project_comment.task_id
          where project_task.project_id = ${selectedProjectId}::uuid
          order by project_comment.created_at desc
          limit 100
        ) as comment
        join member_directory as author_directory
          on author_directory.membership_id = comment.created_by_membership_id
      ), '[]'::jsonb) else '[]'::jsonb end as comments,
      case when ${capabilities.canViewTime} then coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', entry.id,
          'projectId', entry.project_id,
          'taskId', entry.task_id,
          'taskTitle', task.title,
          'membershipId', entry.membership_id,
          'memberName', time_directory.display_name,
          'workDate', entry.work_date::text,
          'minutes', entry.minutes,
          'notes', entry.notes,
          'submissionStatus', entry.submission_status,
          'hourlyCostRateMinor', entry.hourly_cost_rate_minor
        ) order by entry.work_date desc, entry.created_at desc)
        from (
          select project_entry.*
          from public.project_time_entries as project_entry
          where project_entry.project_id = ${selectedProjectId}::uuid
          order by project_entry.work_date desc, project_entry.created_at desc
          limit 100
        ) as entry
        join member_directory as time_directory
          on time_directory.membership_id = entry.membership_id
        left join public.project_tasks as task on task.id = entry.task_id
      ), '[]'::jsonb) else '[]'::jsonb end as "timeEntries",
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', phase.id,
          'projectId', phase.project_id,
          'name', phase.name,
          'description', phase.description,
          'position', phase.position,
          'status', phase.status,
          'startDate', phase.start_date::text,
          'dueDate', phase.due_date::text,
          'completedAt', phase.completed_at,
          'taskCount', (select count(*)::int from public.project_tasks as task where task.phase_id = phase.id),
          'completedTaskCount', (select count(*)::int from public.project_tasks as task join public.project_task_statuses as status on status.id = task.status_id where task.phase_id = phase.id and status.is_terminal)
        ) order by phase.position)
        from public.project_phases as phase
        where phase.project_id = ${selectedProjectId}::uuid
      ), '[]'::jsonb) as phases,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', milestone.id,
          'projectId', milestone.project_id,
          'phaseId', milestone.phase_id,
          'name', milestone.name,
          'description', milestone.description,
          'dueDate', milestone.due_date::text,
          'status', milestone.status,
          'completedAt', milestone.completed_at,
          'taskCount', (select count(*)::int from public.project_tasks as task where task.milestone_id = milestone.id),
          'completedTaskCount', (select count(*)::int from public.project_tasks as task join public.project_task_statuses as status on status.id = task.status_id where task.milestone_id = milestone.id and status.is_terminal)
        ) order by milestone.due_date nulls last, milestone.name)
        from public.project_milestones as milestone
        where milestone.project_id = ${selectedProjectId}::uuid
      ), '[]'::jsonb) as milestones,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', label.id,
          'projectId', label.project_id,
          'name', label.name,
          'color', label.color
        ) order by label.name)
        from public.project_labels as label
        where label.project_id = ${selectedProjectId}::uuid
      ), '[]'::jsonb) as labels,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', item.id,
          'projectId', item.project_id,
          'label', item.label,
          'position', item.position,
          'isRequired', item.is_required,
          'isCompleted', item.is_completed,
          'completedAt', item.completed_at,
          'checkKey', item.check_key
        ) order by item.position)
        from public.project_closure_items as item
        where item.project_id = ${selectedProjectId}::uuid
      ), '[]'::jsonb) as "closureItems",
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'membershipId', member.membership_id,
          'displayName', workload_directory.display_name,
          'openTasks', coalesce(work.open_tasks, 0),
          'overdueTasks', coalesce(work.overdue_tasks, 0),
          'estimatedMinutes', coalesce(work.estimated_minutes, 0),
          'trackedMinutes', coalesce(tracked.tracked_minutes, 0)
        ) order by coalesce(work.open_tasks, 0) desc, workload_directory.display_name)
        from public.project_members as member
        join member_directory as workload_directory
          on workload_directory.membership_id = member.membership_id
        left join lateral (
          select count(*) filter (where not status.is_terminal)::int as open_tasks,
            count(*) filter (where not status.is_terminal and task.due_date < current_date)::int as overdue_tasks,
            coalesce(sum(task.estimated_minutes) filter (where not status.is_terminal), 0)::int as estimated_minutes
          from public.project_task_assignees as assignee
          join public.project_tasks as task on task.id = assignee.task_id
          join public.project_task_statuses as status on status.id = task.status_id
          where assignee.membership_id = member.membership_id and task.project_id = member.project_id
        ) as work on true
        left join lateral (
          select coalesce(sum(entry.minutes), 0)::int as tracked_minutes
          from public.project_time_entries as entry
          where entry.membership_id = member.membership_id and entry.project_id = member.project_id
        ) as tracked on true
        where member.project_id = ${selectedProjectId}::uuid
      ), '[]'::jsonb) as workload
      `,
        { attempts: 2, operationName: "Project workspace detail" },
      ),
      database<ClosureReadinessRow[]>`
        select
          (select count(*)::int from public.project_tasks task
            join public.project_task_statuses status on status.id = task.status_id
            where task.project_id = ${selectedProjectId}::uuid and not status.is_terminal) as open_tasks,
          (select count(*)::int from public.project_time_entries entry
            where entry.project_id = ${selectedProjectId}::uuid and entry.submission_status <> 'submitted') as unsubmitted_time_entries,
          (select count(*)::int from public.finance_expense_project_allocations allocation
            join public.finance_expenses expense on expense.id = allocation.expense_id
            where allocation.project_id = ${selectedProjectId}::uuid
              and (expense.approval_status = 'pending' or expense.payment_status in ('unpaid','scheduled'))) as outstanding_expenses,
          (select count(*)::int from public.support_tickets ticket
            where ticket.project_id = ${selectedProjectId}::uuid and ticket.status not in ('resolved','closed')) as open_support_tickets,
          private.project_unbilled_minor(${selectedProjectId}::uuid) as unbilled_minor,
          (select count(*)::int from public.project_closure_items item
            where item.project_id = ${selectedProjectId}::uuid and item.is_required and not item.is_completed
              and item.check_key in ('deliverables_confirmed','followups_recorded','assets_returned')) as manual_checks_remaining
      `,
    ]);
  } catch {
    return { allowed: false, reason: "access-check-failed" };
  }

  const payload = detailRows[0];
  if (!payload) {
    return { allowed: false, reason: "access-check-failed" };
  }
  const closure = closureRows[0];
  const automaticClosureChecks: Record<string, boolean> = closure
    ? {
        tasks_complete: closure.open_tasks === 0,
        time_submitted: closure.unsubmitted_time_entries === 0,
        expenses_resolved: closure.outstanding_expenses === 0,
        support_resolved: closure.open_support_tickets === 0,
        final_billing_complete: Number(closure.unbilled_minor ?? 0) === 0,
      }
    : {};
  const closureItems = payload.closureItems.map((item) =>
    Object.hasOwn(automaticClosureChecks, item.checkKey)
      ? { ...item, isCompleted: automaticClosureChecks[item.checkKey] }
      : item,
  );

  return {
    allowed: true,
    data: {
      filters,
      currentMembershipId: membershipId,
      selectedProjectId,
      projects,
      memberOptions,
      companyOptions: companyOptionRows,
      members: payload.members,
      statuses: payload.statuses,
      tasks: payload.tasks.map((task) => ({
        ...task,
        code: `${task.projectCode}-${task.taskNumber}`,
        attachments: task.attachments.map((attachment) => ({
          ...attachment,
          statusLabel: privateFileStatusLabels[attachment.status],
          downloadHref:
            attachment.status === "available" ? `/api/projects/attachments/${attachment.id}` : null,
        })),
      })),
      comments: payload.comments,
      timeEntries: payload.timeEntries,
      phases: payload.phases,
      milestones: payload.milestones,
      labels: payload.labels,
      closureItems,
      workload: payload.workload,
      myTasks: myTaskRows.map((row) => ({
        id: row.id,
        projectId: row.project_id,
        projectCode: row.project_code,
        projectName: row.project_name,
        code: `${row.project_code}-${row.task_number}`,
        title: row.title,
        statusSlug: row.status_slug,
        priority: row.priority,
        dueDate: row.due_date,
        reminderAt: row.reminder_at?.toISOString() ?? null,
      })),
      savedFilters: savedFilterRows,
      templates: templateRows,
      profitabilityRollups: profitabilityBundle.rollups,
      closureReadiness: closureRows[0]
        ? {
            openTasks: closureRows[0].open_tasks,
            unsubmittedTimeEntries: closureRows[0].unsubmitted_time_entries,
            outstandingExpenses: closureRows[0].outstanding_expenses,
            openSupportTickets: closureRows[0].open_support_tickets,
            unbilledMinor: Number(closureRows[0].unbilled_minor ?? 0),
            manualChecksRemaining: closureRows[0].manual_checks_remaining,
            ready:
              closureRows[0].open_tasks === 0 &&
              closureRows[0].unsubmitted_time_entries === 0 &&
              closureRows[0].outstanding_expenses === 0 &&
              closureRows[0].open_support_tickets === 0 &&
              Number(closureRows[0].unbilled_minor ?? 0) === 0 &&
              closureRows[0].manual_checks_remaining === 0,
          }
        : null,
      summary: workspaceSummary(projects),
      capabilities,
    },
  };
}
