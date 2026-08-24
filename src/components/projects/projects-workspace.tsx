"use client";

import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FolderKanban,
  MessageSquareText,
  Plus,
  Save,
  Search,
  ShieldCheck,
  UserPlus,
  UsersRound,
  X,
} from "lucide-react";

import { ProjectActionMessage } from "@/components/projects/project-action-message";
import { CreateQueryDetails } from "@/components/shell/create-query-details";
import {
  ProjectAlternateView,
  ProjectLifecyclePanel,
  ProjectPlanningPanel,
  ProjectTaskEnhancements,
} from "@/components/projects/project-stage-two";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  addProjectMemberAction,
  bulkUpdateProjectTasksAction,
  createProjectAction,
  createProjectFromTemplateAction,
  createProjectCommentAction,
  createProjectTaskAction,
  createProjectTimeEntryAction,
  deleteProjectSavedFilterAction,
  duplicateProjectAction,
  moveProjectTaskAction,
  saveProjectFilterAction,
  saveProjectTemplateAction,
  updateProjectAction,
} from "@/modules/projects/actions/projects";
import {
  projectBillingMethods,
  projectGroupOptions,
  projectMemberRoles,
  projectPriorities,
  projectSortOptions,
  projectStatuses,
  projectVisibilities,
} from "@/modules/projects/projects";
import type { ProjectActionState } from "@/modules/projects/schemas/projects";
import type {
  ProjectSummary,
  ProjectTask,
  ProjectsWorkspaceData,
} from "@/modules/projects/server/projects";
import { getDateTimeFormatter } from "@/lib/intl-formatters";
import { currencyMinorUnits, formatMinorMoney } from "@/modules/finance/calculations";
const initialState: ProjectActionState = { status: "idle" };
function buildProjectHref(data: ProjectsWorkspaceData, projectId: string): string {
  const parameters = new URLSearchParams();
  if (data.filters.q) parameters.set("q", data.filters.q);
  if (data.filters.status) parameters.set("status", data.filters.status);
  if (data.filters.owner) parameters.set("owner", data.filters.owner);
  if (data.filters.archive !== "active") parameters.set("archive", data.filters.archive);
  if (data.filters.mine) parameters.set("mine", "true");
  if (data.filters.sort !== "updated") parameters.set("sort", data.filters.sort);
  if (data.filters.group !== "none") parameters.set("group", data.filters.group);
  parameters.set("project", projectId);
  return `/projects?${parameters.toString()}`;
}
function SummaryCards({ data }: { data: ProjectsWorkspaceData }) {
  return (
    <section className="project-summary" aria-label="Project overview">
      <div>
        <FolderKanban size={19} aria-hidden="true" />
        <span>Active projects</span>
        <strong>{data.summary.activeProjects}</strong>
      </div>
      <div>
        <AlertTriangle size={19} aria-hidden="true" />
        <span>At risk</span>
        <strong>{data.summary.atRiskProjects}</strong>
      </div>
      <div>
        <CheckCircle2 size={19} aria-hidden="true" />
        <span>Open tasks</span>
        <strong>{data.summary.openTasks}</strong>
      </div>
      <div>
        <Clock3 size={19} aria-hidden="true" />
        <span>Tracked hours</span>
        <strong>{Math.round((data.summary.trackedMinutes / 60) * 10) / 10}</strong>
      </div>
    </section>
  );
}
function savedFilterHref(
  filters: ProjectsWorkspaceData["savedFilters"][number]["filters"],
): string {
  const parameters = new URLSearchParams();
  if (filters.q) parameters.set("q", filters.q);
  if (filters.status) parameters.set("status", filters.status);
  if (filters.owner) parameters.set("owner", filters.owner);
  if (filters.archive !== "active") parameters.set("archive", filters.archive);
  if (filters.mine) parameters.set("mine", "true");
  if (filters.sort !== "updated") parameters.set("sort", filters.sort);
  if (filters.group !== "none") parameters.set("group", filters.group);
  return `/projects${parameters.size ? `?${parameters.toString()}` : ""}`;
}
function ProjectSavedFilterTools({ data }: { data: ProjectsWorkspaceData }) {
  const [saveState, saveAction, savePending] = useActionState(
    saveProjectFilterAction,
    initialState,
  );
  const [deleteState, deleteAction, deletePending] = useActionState(
    deleteProjectSavedFilterAction,
    initialState,
  );
  return (
    <div className="project-saved-filter-tools">
      <div className="project-saved-filter-list">
        {data.savedFilters.map((filter) => (
          <span className="project-saved-filter" key={filter.id}>
            <Link href={savedFilterHref(filter.filters)}>{filter.name}</Link>
            <form action={deleteAction}>
              <input type="hidden" name="filterId" value={filter.id} />
              <button type="submit" disabled={deletePending} aria-label={`Delete ${filter.name}`}>
                ×
              </button>
            </form>
          </span>
        ))}
      </div>
      <form action={saveAction} className="project-save-filter-form">
        <input name="name" placeholder="Save current filter as..." maxLength={100} required />
        <input type="hidden" name="q" value={data.filters.q} />
        <input type="hidden" name="status" value={data.filters.status ?? ""} />
        <input type="hidden" name="owner" value={data.filters.owner ?? ""} />
        <input type="hidden" name="archive" value={data.filters.archive} />
        <input type="hidden" name="mine" value={data.filters.mine ? "true" : "false"} />
        <input type="hidden" name="sort" value={data.filters.sort} />
        <input type="hidden" name="group" value={data.filters.group} />
        <Button type="submit" size="sm" variant="secondary" disabled={savePending}>
          Save view
        </Button>
      </form>
      <ProjectActionMessage state={saveState} />
      <ProjectActionMessage state={deleteState} />
    </div>
  );
}
function ProjectFilters({ data }: { data: ProjectsWorkspaceData }) {
  return (
    <section className="project-filter-stack">
      <form className="project-filter-form" method="get">
        <label className="project-search-field">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Search projects</span>
          <input
            type="search"
            name="q"
            defaultValue={data.filters.q}
            placeholder="Search project name or code"
          />
        </label>
        <label className="field">
          <span>Status</span>
          <select name="status" defaultValue={data.filters.status ?? ""}>
            <option value="">All statuses</option>
            {projectStatuses
              .filter((status) => status !== "completed")
              .map((status) => (
                <option value={status} key={status}>
                  {status.replaceAll("_", " ")}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          <span>Owner</span>
          <select name="owner" defaultValue={data.filters.owner ?? ""}>
            <option value="">All owners</option>
            {data.memberOptions.map((member) => (
              <option value={member.membershipId} key={member.membershipId}>
                {member.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Archive</span>
          <select name="archive" defaultValue={data.filters.archive}>
            <option value="active">Active projects</option>
            <option value="archived">Archived projects</option>
            <option value="all">Active and archived</option>
          </select>
        </label>
        <label className="field">
          <span>Sort</span>
          <select name="sort" defaultValue={data.filters.sort}>
            {projectSortOptions.map((sort) => (
              <option value={sort} key={sort}>
                {sort.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Group</span>
          <select name="group" defaultValue={data.filters.group}>
            {projectGroupOptions.map((group) => (
              <option value={group} key={group}>
                {group.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="project-filter-checkbox">
          <input type="checkbox" name="mine" value="true" defaultChecked={data.filters.mine} />
          <span>My projects</span>
        </label>
        {data.selectedProjectId ? (
          <input type="hidden" name="project" value={data.selectedProjectId} />
        ) : null}
        <Button type="submit" variant="secondary">
          Apply filters
        </Button>
      </form>
      <ProjectSavedFilterTools data={data} />
    </section>
  );
}
function MyTasksPanel({ data }: { data: ProjectsWorkspaceData }) {
  if (!data.myTasks.length) return null;
  return (
    <details className="project-my-tasks" open>
      <summary>
        My Tasks <span>{data.myTasks.length}</span>
      </summary>
      <div className="project-my-tasks__list">
        {data.myTasks.slice(0, 20).map((task) => (
          <Link key={task.id} href={buildProjectHref(data, task.projectId)}>
            <span>
              <strong>{task.code}</strong> {task.title}
            </span>
            <small>
              {task.projectName} · {task.dueDate ?? "No due date"} · {task.priority}
            </small>
          </Link>
        ))}
      </div>
    </details>
  );
}
function minorToInput(value: number | null, currency: string): string {
  if (value === null) return "";
  return String(value / 10 ** currencyMinorUnits(currency));
}
function ProjectCommercialFields({ project }: { project?: ProjectSummary }) {
  const [billingMethod, setBillingMethod] = useState(project?.billingMethod ?? "none");
  const currency = project?.currency ?? "USD";
  return (
    <>
      <label className="field">
        <span>Project currency</span>
        <input
          name="currency"
          defaultValue={currency}
          maxLength={3}
          pattern="[A-Za-z]{3}"
          required
        />
      </label>
      <label className="field">
        <span>Billing method</span>
        <select
          name="billingMethod"
          value={billingMethod}
          onChange={(event) => setBillingMethod(event.target.value as typeof billingMethod)}
        >
          {projectBillingMethods.map((method) => (
            <option value={method} key={method}>
              {method.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Budget</span>
        <input
          name="budgetAmount"
          type="number"
          min="0"
          step="0.01"
          defaultValue={project ? minorToInput(project.budgetMinor, currency) : ""}
        />
      </label>
      <label className="field">
        <span>Hourly rate</span>
        <input
          name="hourlyRate"
          type="number"
          min="0"
          step="0.01"
          disabled={billingMethod !== "hourly"}
          defaultValue={project ? minorToInput(project.hourlyRateMinor, currency) : ""}
        />
      </label>
      <label className="field">
        <span>Fixed price</span>
        <input
          name="fixedPrice"
          type="number"
          min="0"
          step="0.01"
          disabled={billingMethod !== "fixed"}
          defaultValue={project ? minorToInput(project.fixedPriceMinor, currency) : ""}
        />
      </label>
      <label className="field">
        <span>Retainer amount</span>
        <input
          name="retainerAmount"
          type="number"
          min="0"
          step="0.01"
          disabled={billingMethod !== "retainer"}
          defaultValue={project ? minorToInput(project.retainerAmountMinor, currency) : ""}
        />
      </label>
      <label className="field">
        <span>Estimated completion</span>
        <input
          name="estimatedCompletionDate"
          type="date"
          defaultValue={project?.estimatedCompletionDate ?? ""}
        />
      </label>
    </>
  );
}
function CreateProjectDialogForm({
  data,
  onCancel,
  onCreated,
}: {
  data: ProjectsWorkspaceData;
  onCancel: () => void;
  onCreated: (projectId: string) => void;
}) {
  const [state, action, pending] = useActionState(createProjectAction, initialState);
  const [projectType, setProjectType] = useState<"client" | "internal">("client");
  const nameInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (state.status === "success" && state.projectId) onCreated(state.projectId);
  }, [onCreated, state.projectId, state.status]);

  return (
    <form action={action} className="project-form project-form--create">
      <label className="field project-form__wide">
        <span>Project name</span>
        <input ref={nameInputRef} name="name" maxLength={180} required />
      </label>
      <label className="field">
        <span>Type</span>
        <select
          name="projectType"
          value={projectType}
          onChange={(event) =>
            setProjectType(event.target.value === "internal" ? "internal" : "client")
          }
        >
          <option value="client">Client project</option>
          <option value="internal">Internal project</option>
        </select>
      </label>
      <label className="field">
        <span>CRM company</span>
        <select
          name="companyId"
          defaultValue=""
          required={projectType === "client"}
          disabled={projectType === "internal"}
        >
          <option value="">
            {projectType === "client" ? "Choose a CRM company" : "Not used for internal projects"}
          </option>
          {data.companyOptions.map((company) => (
            <option value={company.id} key={company.id}>
              {company.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Owner</span>
        <select name="ownerMembershipId" defaultValue="">
          <option value="">Assign to me</option>
          {data.capabilities.canAssignProjects
            ? data.memberOptions.map((member) => (
                <option value={member.membershipId} key={member.membershipId}>
                  {member.displayName}
                </option>
              ))
            : null}
        </select>
      </label>
      <label className="field">
        <span>Status</span>
        <select name="status" defaultValue="planned">
          {projectStatuses
            .filter((status) => status !== "completed")
            .map((status) => (
              <option value={status} key={status}>
                {status.replaceAll("_", " ")}
              </option>
            ))}
        </select>
      </label>
      <label className="field">
        <span>Priority</span>
        <select name="priority" defaultValue="normal">
          {projectPriorities.map((priority) => (
            <option value={priority} key={priority}>
              {priority}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Visibility</span>
        <select name="visibility" defaultValue="members">
          {projectVisibilities.map((visibility) => (
            <option value={visibility} key={visibility}>
              {visibility}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Start date</span>
        <input name="startDate" type="date" />
      </label>
      <label className="field">
        <span>Due date</span>
        <input name="dueDate" type="date" />
      </label>
      <ProjectCommercialFields />
      <label className="field project-form__full">
        <span>Description</span>
        <textarea name="description" rows={3} maxLength={4000} />
      </label>
      <div className="project-security-note project-form__full">
        <ShieldCheck size={17} aria-hidden="true" />
        <p>
          Project codes are allocated transactionally. Client links, owners, members, and task
          assignments are validated against the active organization before saving.
        </p>
      </div>
      <div className="project-create-dialog__actions">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          <Plus size={15} aria-hidden="true" /> {pending ? "Creating" : "Create project"}
        </Button>
      </div>
      <ProjectActionMessage state={state} />
    </form>
  );
}

function CreateProjectForm({
  data,
  openFromCommand = false,
}: {
  data: ProjectsWorkspaceData;
  openFromCommand?: boolean;
}) {
  const [open, setOpen] = useState(openFromCommand);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const close = useCallback(() => setOpen(false), []);
  const handleCreated = useCallback(
    (projectId: string) => {
      setOpen(false);
      router.replace(buildProjectHref(data, projectId));
    },
    [data, router],
  );

  return (
    <>
      <button className="project-create-trigger" type="button" onClick={() => setOpen(true)}>
        <Plus size={16} aria-hidden="true" /> Create project
      </button>
      <dialog
        className="project-create-dialog"
        ref={dialogRef}
        aria-labelledby="create-project-title"
        onClose={close}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
      >
        <div className="project-create-dialog__panel">
          <header className="project-create-dialog__header">
            <div>
              <h2 id="create-project-title">Create project</h2>
              <p>Set the delivery context, ownership, dates, and visibility.</p>
            </div>
            <button className="icon-button" type="button" onClick={close} aria-label="Close dialog">
              <X size={19} aria-hidden="true" />
            </button>
          </header>
          {open ? (
            <CreateProjectDialogForm data={data} onCancel={close} onCreated={handleCreated} />
          ) : null}
        </div>
      </dialog>
    </>
  );
}

function CreateFromTemplatePanel({ data }: { data: ProjectsWorkspaceData }) {
  const [state, action, pending] = useActionState(createProjectFromTemplateAction, initialState);
  const router = useRouter();
  useEffect(() => {
    if (state.status === "success" && state.projectId) {
      router.replace(buildProjectHref(data, state.projectId));
    }
  }, [data, router, state.projectId, state.status]);
  if (!data.templates.length || !data.capabilities.canCreateProjects) return null;
  return (
    <details className="project-inline-panel project-template-create">
      <summary>Create from template</summary>
      <form action={action} className="project-form">
        <label className="field">
          <span>Template</span>
          <select name="templateId" defaultValue="" required>
            <option value="" disabled>
              Select template
            </option>
            {data.templates.map((template) => (
              <option value={template.id} key={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Project name</span>
          <input name="name" required maxLength={180} />
        </label>
        <label className="field">
          <span>CRM company</span>
          <select name="companyId" defaultValue="">
            <option value="">None / internal</option>
            {data.companyOptions.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Owner</span>
          <select name="ownerMembershipId" defaultValue="">
            <option value="">Assign to me</option>
            {data.capabilities.canAssignProjects
              ? data.memberOptions.map((member) => (
                  <option key={member.membershipId} value={member.membershipId}>
                    {member.displayName}
                  </option>
                ))
              : null}
          </select>
        </label>
        <label className="field">
          <span>Start date</span>
          <input type="date" name="startDate" />
        </label>
        <label className="field">
          <span>Due date override</span>
          <input type="date" name="dueDate" />
        </label>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Creating" : "Create from template"}
        </Button>
        <ProjectActionMessage state={state} />
      </form>
    </details>
  );
}

function projectGroupLabel(
  project: ProjectSummary,
  group: ProjectsWorkspaceData["filters"]["group"],
): string {
  if (group === "status") return project.status.replaceAll("_", " ");
  if (group === "owner") return project.ownerName;
  if (group === "client") return project.companyName ?? "Internal";
  if (group === "health") return project.health.replaceAll("_", " ");
  return "Projects";
}

function ProjectList({
  data,
  openCreateProject = false,
}: {
  data: ProjectsWorkspaceData;
  openCreateProject?: boolean;
}) {
  const grouped = new Map<string, ProjectSummary[]>();
  for (const project of data.projects) {
    const label = projectGroupLabel(project, data.filters.group);
    grouped.set(label, [...(grouped.get(label) ?? []), project]);
  }
  return (
    <aside className="project-list-panel" aria-label="Projects">
      <header>
        <div>
          <h2>Projects</h2>
          <p>{data.projects.length} visible</p>
        </div>
        {data.capabilities.canCreateProjects ? <CreateProjectForm data={data} openFromCommand={openCreateProject} /> : null}
      </header>
      <CreateFromTemplatePanel data={data} />
      <div className="project-list">
        {data.projects.length ? (
          [...grouped.entries()].map(([group, projects]) => (
            <section className="project-list-group" key={group}>
              {data.filters.group !== "none" ? (
                <h3>
                  {group} <span>{projects.length}</span>
                </h3>
              ) : null}
              {projects.map((project) => (
                <Link
                  href={buildProjectHref(data, project.id)}
                  className={data.selectedProjectId === project.id ? "is-active" : ""}
                  key={project.id}
                >
                  <div>
                    <strong>{project.name}</strong>
                    <span>
                      {project.code}
                      {project.archivedAt ? " · archived" : ""}
                    </span>
                  </div>
                  <div className="project-list__meta">
                    <StatusBadge
                      tone={
                        project.health === "at_risk"
                          ? "error"
                          : project.health === "attention"
                            ? "warning"
                            : project.health === "complete"
                              ? "success"
                              : "info"
                      }
                    >
                      {project.health.replaceAll("_", " ")}
                    </StatusBadge>
                    <span>{project.progress}%</span>
                    <ChevronRight size={15} aria-hidden="true" />
                  </div>
                </Link>
              ))}
            </section>
          ))
        ) : (
          <p className="empty-state-copy">No projects match the current filters.</p>
        )}
      </div>
    </aside>
  );
}

function ProjectEditForm({
  project,
  data,
}: {
  project: ProjectSummary;
  data: ProjectsWorkspaceData;
}) {
  const [state, action, pending] = useActionState(updateProjectAction, initialState);
  return (
    <details className="project-inline-panel">
      <summary>
        <Save size={15} aria-hidden="true" /> Edit project
      </summary>
      <form action={action} className="project-form">
        <input type="hidden" name="projectId" value={project.id} />
        <label className="field project-form__wide">
          <span>Project name</span>
          <input name="name" defaultValue={project.name} required />
        </label>
        <label className="field">
          <span>Type</span>
          <select name="projectType" defaultValue={project.projectType}>
            <option value="client">Client project</option>
            <option value="internal">Internal project</option>
          </select>
        </label>
        <label className="field">
          <span>CRM company</span>
          <select name="companyId" defaultValue={project.companyId ?? ""}>
            <option value="">None / internal</option>
            {data.companyOptions.map((company) => (
              <option value={company.id} key={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Owner</span>
          <select
            name="ownerMembershipId"
            defaultValue={project.ownerMembershipId}
            disabled={!data.capabilities.canAssignProjects}
          >
            {data.memberOptions.map((member) => (
              <option value={member.membershipId} key={member.membershipId}>
                {member.displayName}
              </option>
            ))}
          </select>
          {!data.capabilities.canAssignProjects ? (
            <input type="hidden" name="ownerMembershipId" value={project.ownerMembershipId} />
          ) : null}
        </label>
        <label className="field">
          <span>Status</span>
          <select name="status" defaultValue={project.status}>
            {projectStatuses
              .filter((status) => status !== "completed")
              .map((status) => (
                <option value={status} key={status}>
                  {status.replaceAll("_", " ")}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          <span>Priority</span>
          <select name="priority" defaultValue={project.priority}>
            {projectPriorities.map((priority) => (
              <option value={priority} key={priority}>
                {priority}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Visibility</span>
          <select name="visibility" defaultValue={project.visibility}>
            {projectVisibilities.map((visibility) => (
              <option value={visibility} key={visibility}>
                {visibility}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Start date</span>
          <input name="startDate" type="date" defaultValue={project.startDate ?? ""} />
        </label>
        <label className="field">
          <span>Due date</span>
          <input name="dueDate" type="date" defaultValue={project.dueDate ?? ""} />
        </label>
        <ProjectCommercialFields project={project} />
        <label className="field project-form__full">
          <span>Description</span>
          <textarea name="description" rows={3} defaultValue={project.description ?? ""} />
        </label>
        <Button type="submit" disabled={pending}>
          <Save size={15} aria-hidden="true" /> {pending ? "Saving" : "Save project"}
        </Button>
        <ProjectActionMessage state={state} />
      </form>
    </details>
  );
}

function MemberForm({ project, data }: { project: ProjectSummary; data: ProjectsWorkspaceData }) {
  const [state, action, pending] = useActionState(addProjectMemberAction, initialState);
  return (
    <details className="project-inline-panel">
      <summary>
        <UserPlus size={15} aria-hidden="true" /> Add or update member
      </summary>
      <form action={action} className="project-member-form">
        <input type="hidden" name="projectId" value={project.id} />
        <label className="field">
          <span>Member</span>
          <select name="membershipId" required defaultValue="">
            <option value="" disabled>
              Select member
            </option>
            {data.memberOptions.map((member) => (
              <option value={member.membershipId} key={member.membershipId}>
                {member.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Project role</span>
          <select name="role" defaultValue="member">
            {projectMemberRoles.map((role) => (
              <option value={role} key={role}>
                {role}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Hourly labor cost ({project.currency})</span>
          <input name="hourlyCostRate" type="number" min="0" step="0.01" placeholder="0.00" />
        </label>
        <Button type="submit" disabled={pending}>
          <UserPlus size={15} aria-hidden="true" /> {pending ? "Saving" : "Save member"}
        </Button>
        <ProjectActionMessage state={state} />
      </form>
    </details>
  );
}

function CreateTaskForm({
  project,
  data,
}: {
  project: ProjectSummary;
  data: ProjectsWorkspaceData;
}) {
  const [state, action, pending] = useActionState(createProjectTaskAction, initialState);
  const defaultStatus =
    data.statuses.find((status) => status.slug === "backlog") ?? data.statuses[0];
  return (
<CreateQueryDetails className="project-inline-panel project-inline-panel--task" target="task">
      <summary>
        <Plus size={15} aria-hidden="true" /> Create task
      </summary>
      <form action={action} className="project-form project-task-create-form">
        <input type="hidden" name="projectId" value={project.id} />
        <label className="field project-form__wide">
          <span>Task title</span>
          <input name="title" maxLength={240} required />
        </label>
        <label className="field">
          <span>Status</span>
          <select name="statusId" defaultValue={defaultStatus?.id ?? ""} required>
            {data.statuses.map((status) => (
              <option value={status.id} key={status.id}>
                {status.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Priority</span>
          <select name="priority" defaultValue="normal">
            {projectPriorities.map((priority) => (
              <option value={priority} key={priority}>
                {priority}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Assignee</span>
          <select name="assigneeMembershipId" defaultValue="">
            <option value="">Unassigned</option>
            {data.members.map((member) => (
              <option value={member.membershipId} key={member.membershipId}>
                {member.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Parent task</span>
          <select name="parentTaskId" defaultValue="">
            <option value="">Top-level task</option>
            {data.tasks.map((task) => (
              <option value={task.id} key={task.id}>
                {task.code} — {task.title}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Phase</span>
          <select name="phaseId" defaultValue="">
            <option value="">No phase</option>
            {data.phases.map((phase) => (
              <option value={phase.id} key={phase.id}>
                {phase.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Milestone</span>
          <select name="milestoneId" defaultValue="">
            <option value="">No milestone</option>
            {data.milestones.map((milestone) => (
              <option value={milestone.id} key={milestone.id}>
                {milestone.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Start date</span>
          <input name="startDate" type="date" />
        </label>
        <label className="field">
          <span>Due date</span>
          <input name="dueDate" type="date" />
        </label>
        <label className="field">
          <span>Reminder</span>
          <input name="reminderAt" type="datetime-local" />
        </label>
        <label className="field">
          <span>Estimated minutes</span>
          <input name="estimatedMinutes" type="number" min="1" max="100000" />
        </label>
        <label className="field project-form__full">
          <span>Description</span>
          <textarea name="description" rows={3} maxLength={10000} />
        </label>
        <Button type="submit" disabled={pending || !defaultStatus}>
          <Plus size={15} aria-hidden="true" /> {pending ? "Creating" : "Create task"}
        </Button>
        <ProjectActionMessage state={state} />
      </form>
    </CreateQueryDetails>
  );
}

function TaskCard({
  task,
  data,
  readOnly,
}: {
  task: ProjectTask;
  data: ProjectsWorkspaceData;
  readOnly: boolean;
}) {
  const [moveState, moveAction, moving] = useActionState(moveProjectTaskAction, initialState);
  const [commentState, commentAction, commenting] = useActionState(
    createProjectCommentAction,
    initialState,
  );
  const comments = data.comments.filter((comment) => comment.taskId === task.id);
  return (
    <article className="project-task-card">
      <header>
        <div>
          <span>{task.code}</span>
          <strong>{task.title}</strong>
        </div>
        <StatusBadge
          tone={
            task.priority === "urgent" ? "error" : task.priority === "high" ? "warning" : "neutral"
          }
        >
          {task.priority}
        </StatusBadge>
      </header>
      {task.description ? <p>{task.description}</p> : null}
      <dl>
        <div>
          <dt>Assignee</dt>
          <dd>
            {task.assignees.map((assignee) => assignee.displayName).join(", ") || "Unassigned"}
          </dd>
        </div>
        <div>
          <dt>Due</dt>
          <dd>{task.dueDate ?? "No due date"}</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>{Math.round((task.trackedMinutes / 60) * 10) / 10}h</dd>
        </div>
      </dl>
      {data.capabilities.canUpdateTasks && !readOnly ? (
        <form action={moveAction} className="project-task-move-form">
          <input type="hidden" name="taskId" value={task.id} />
          <label>
            <span className="sr-only">Move {task.title}</span>
            <select name="statusId" defaultValue={task.statusId}>
              {data.statuses.map((status) => (
                <option value={status.id} key={status.id}>
                  {status.name}
                </option>
              ))}
            </select>
          </label>
          <Button size="sm" variant="secondary" type="submit" disabled={moving}>
            {moving ? "Moving" : "Move"}
          </Button>
          <ProjectActionMessage state={moveState} />
        </form>
      ) : null}
      <details className="project-task-details">
        <summary>
          <MessageSquareText size={14} aria-hidden="true" /> {task.commentCount} comments
        </summary>
        <div className="project-comment-list">
          {comments.length ? (
            comments.map((comment) => (
              <article key={comment.id}>
                <header>
                  <strong>{comment.authorName}</strong>
                  <time dateTime={comment.createdAt}>
                    {getDateTimeFormatter("en", { dateStyle: "medium" }).format(
                      new Date(comment.createdAt),
                    )}
                  </time>
                </header>
                <p>{comment.body}</p>
              </article>
            ))
          ) : (
            <p>No comments yet.</p>
          )}
        </div>
        {data.capabilities.canCreateComments && !readOnly ? (
          <form action={commentAction} className="project-comment-form">
            <input type="hidden" name="taskId" value={task.id} />
            <label className="field">
              <span>Add internal comment</span>
              <textarea name="body" rows={2} required maxLength={8000} />
            </label>
            <input type="hidden" name="isInternal" value="on" />
            <Button size="sm" type="submit" disabled={commenting}>
              {commenting ? "Adding" : "Add comment"}
            </Button>
            <ProjectActionMessage state={commentState} />
          </form>
        ) : null}
      </details>
      <ProjectTaskEnhancements task={task} data={data} readOnly={readOnly} />
    </article>
  );
}

function Kanban({ project, data }: { project: ProjectSummary; data: ProjectsWorkspaceData }) {
  const tasksByStatus = useMemo(() => {
    const map = new Map<string, ProjectTask[]>();
    data.tasks.forEach((task) => map.set(task.statusId, [...(map.get(task.statusId) ?? []), task]));
    return map;
  }, [data.tasks]);

  return (
    <section className="project-kanban" aria-label={`${project.name} task board`}>
      {data.statuses.map((status) => {
        const tasks = tasksByStatus.get(status.id) ?? [];
        return (
          <section className="project-kanban-column" key={status.id}>
            <header>
              <div>
                <strong>{status.name}</strong>
                <span>{tasks.length}</span>
              </div>
              {status.isTerminal ? <StatusBadge tone="success">Terminal</StatusBadge> : null}
            </header>
            <div>
              {tasks.length ? (
                tasks.map((task) => (
                  <TaskCard
                    task={task}
                    data={data}
                    readOnly={Boolean(project.archivedAt) || project.closureStatus === "closed"}
                    key={task.id}
                  />
                ))
              ) : (
                <p className="project-empty-column">No tasks.</p>
              )}
            </div>
          </section>
        );
      })}
    </section>
  );
}

function TimePanel({ project, data }: { project: ProjectSummary; data: ProjectsWorkspaceData }) {
  const [state, action, pending] = useActionState(createProjectTimeEntryAction, initialState);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <section className="project-time-panel">
      <header>
        <div>
          <h3>Time tracking</h3>
          <p>Log actual work against this project or one of its tasks.</p>
        </div>
        <Clock3 size={20} aria-hidden="true" />
      </header>
      {data.capabilities.canCreateTime &&
      !project.archivedAt &&
      project.closureStatus !== "closed" ? (
        <form action={action} className="project-time-form">
          <input type="hidden" name="projectId" value={project.id} />
          <label className="field">
            <span>Task</span>
            <select name="taskId" defaultValue="">
              <option value="">Project-level time</option>
              {data.tasks.map((task) => (
                <option value={task.id} key={task.id}>
                  {task.code} — {task.title}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Work date</span>
            <input name="workDate" type="date" defaultValue={today} required />
          </label>
          <label className="field">
            <span>Minutes</span>
            <input name="minutes" type="number" min="1" max="1440" required />
          </label>
          <label className="field">
            <span>Submission</span>
            <select name="submissionStatus" defaultValue="submitted">
              <option value="submitted">Submitted</option>
              <option value="draft">Draft</option>
            </select>
          </label>
          <label className="field project-time-form__notes">
            <span>Notes</span>
            <input name="notes" maxLength={1000} />
          </label>
          <Button type="submit" disabled={pending}>
            <Clock3 size={15} aria-hidden="true" /> {pending ? "Logging" : "Log time"}
          </Button>
          <ProjectActionMessage state={state} />
        </form>
      ) : null}
      {data.capabilities.canViewTime ? (
        <div className="project-time-list">
          {data.timeEntries.length ? (
            data.timeEntries.map((entry) => (
              <article key={entry.id}>
                <div>
                  <strong>{entry.memberName}</strong>
                  <span>{entry.taskTitle ?? "Project-level work"}</span>
                </div>
                <span>
                  {entry.workDate} · {entry.submissionStatus}
                </span>
                <b>{Math.round((entry.minutes / 60) * 10) / 10}h</b>
              </article>
            ))
          ) : (
            <p className="empty-state-copy">No time has been logged for this project.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}

function ProjectProfitabilityPanel({
  project,
  data,
}: {
  project: ProjectSummary;
  data: ProjectsWorkspaceData;
}) {
  const profit = project.profitability;
  const dimensions = ["client", "project_manager", "department", "month"] as const;
  return (
    <details className="project-profitability-panel" open>
      <summary>Commercial performance</summary>
      <div className="project-profitability-kpis">
        <div>
          <span>Invoiced revenue</span>
          <strong>{formatMinorMoney(profit.invoicedRevenueMinor, profit.currency)}</strong>
        </div>
        <div>
          <span>Labor cost</span>
          <strong>{formatMinorMoney(profit.laborCostMinor, profit.currency)}</strong>
        </div>
        <div>
          <span>Vendor cost</span>
          <strong>{formatMinorMoney(profit.vendorCostMinor, profit.currency)}</strong>
        </div>
        <div>
          <span>Project expenses</span>
          <strong>{formatMinorMoney(profit.projectExpenseMinor, profit.currency)}</strong>
        </div>
        <div>
          <span>Gross contribution</span>
          <strong>{formatMinorMoney(profit.grossContributionMinor, profit.currency)}</strong>
        </div>
        <div>
          <span>Margin</span>
          <strong>{profit.marginPercent === null ? "—" : `${profit.marginPercent}%`}</strong>
        </div>
        <div>
          <span>Expected billable</span>
          <strong>{formatMinorMoney(profit.expectedBillableMinor, profit.currency)}</strong>
        </div>
        <div>
          <span>Unbilled</span>
          <strong>{formatMinorMoney(profit.unbilledMinor, profit.currency)}</strong>
        </div>
        <div>
          <span>Committed vendor</span>
          <strong>{formatMinorMoney(profit.committedVendorMinor, profit.currency)}</strong>
        </div>
        <div>
          <span>Budget variance</span>
          <strong>
            {profit.budgetVarianceMinor === null
              ? "—"
              : formatMinorMoney(profit.budgetVarianceMinor, profit.currency)}
          </strong>
        </div>
      </div>
      <div className="project-profitability-rollups">
        {dimensions.map((dimension) => {
          const rows = data.profitabilityRollups
            .filter((row) => row.dimension === dimension)
            .slice(0, 8);
          if (!rows.length) return null;
          return (
            <section key={dimension}>
              <h4>{dimension.replaceAll("_", " ")}</h4>
              <table>
                <thead>
                  <tr>
                    <th>Group</th>
                    <th>Revenue</th>
                    <th>Contribution</th>
                    <th>Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`${row.dimension}:${row.key}:${row.currency}`}>
                      <td>{row.label}</td>
                      <td>{formatMinorMoney(row.invoicedRevenueMinor, row.currency)}</td>
                      <td>{formatMinorMoney(row.grossContributionMinor, row.currency)}</td>
                      <td>{row.marginPercent === null ? "—" : `${row.marginPercent}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        })}
      </div>
    </details>
  );
}

function ProjectBulkTaskPanel({
  project,
  data,
}: {
  project: ProjectSummary;
  data: ProjectsWorkspaceData;
}) {
  const [state, action, pending] = useActionState(bulkUpdateProjectTasksAction, initialState);
  if (!data.capabilities.canUpdateTasks || !data.tasks.length) return null;
  return (
    <details className="project-inline-panel">
      <summary>Bulk task update</summary>
      <form action={action} className="project-form">
        <input type="hidden" name="projectId" value={project.id} />
        <fieldset className="project-bulk-task-selection">
          <legend>Select tasks</legend>
          {data.tasks.map((task) => (
            <label key={task.id}>
              <input type="checkbox" name="taskIds" value={task.id} />{" "}
              <span>
                {task.code} — {task.title}
              </span>
            </label>
          ))}
        </fieldset>
        <label className="field">
          <span>Move to status</span>
          <select name="statusId" defaultValue="">
            <option value="">No status change</option>
            {data.statuses.map((status) => (
              <option key={status.id} value={status.id}>
                {status.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Priority</span>
          <select name="priority" defaultValue="">
            <option value="">No priority change</option>
            {projectPriorities.map((priority) => (
              <option key={priority} value={priority}>
                {priority}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Due date</span>
          <input name="dueDate" type="date" />
        </label>
        <label className="field">
          <span>Add assignee</span>
          <select name="assigneeMembershipId" defaultValue="">
            <option value="">No assignee change</option>
            {data.members.map((member) => (
              <option key={member.membershipId} value={member.membershipId}>
                {member.displayName}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Updating" : "Update selected tasks"}
        </Button>
        <ProjectActionMessage state={state} />
      </form>
    </details>
  );
}

function ProjectReusePanel({
  project,
  data,
}: {
  project: ProjectSummary;
  data: ProjectsWorkspaceData;
}) {
  const [templateState, templateAction, templatePending] = useActionState(
    saveProjectTemplateAction,
    initialState,
  );
  const [duplicateState, duplicateAction, duplicatePending] = useActionState(
    duplicateProjectAction,
    initialState,
  );
  const router = useRouter();
  useEffect(() => {
    if (duplicateState.status === "success" && duplicateState.projectId) {
      router.replace(buildProjectHref(data, duplicateState.projectId));
    }
  }, [data, duplicateState.projectId, duplicateState.status, router]);
  if (!data.capabilities.canCreateProjects) return null;
  return (
    <details className="project-inline-panel">
      <summary>Reuse project structure</summary>
      <div className="project-reuse-grid">
        <form action={templateAction} className="project-form">
          <input type="hidden" name="projectId" value={project.id} />
          <label className="field">
            <span>Template name</span>
            <input name="name" defaultValue={`${project.name} template`} required maxLength={120} />
          </label>
          <label className="field">
            <span>Description</span>
            <input name="description" maxLength={1000} />
          </label>
          <Button type="submit" size="sm" variant="secondary" disabled={templatePending}>
            {templatePending ? "Saving" : "Save as template"}
          </Button>
          <ProjectActionMessage state={templateState} />
        </form>
        <form action={duplicateAction} className="project-form">
          <input type="hidden" name="projectId" value={project.id} />
          <label className="field">
            <span>Duplicate name</span>
            <input name="name" defaultValue={`${project.name} copy`} required maxLength={180} />
          </label>
          <label className="project-filter-checkbox">
            <input type="checkbox" name="includeMembers" />{" "}
            <span>Copy members and labor rates</span>
          </label>
          <Button type="submit" size="sm" variant="secondary" disabled={duplicatePending}>
            {duplicatePending ? "Duplicating" : "Duplicate project"}
          </Button>
          <ProjectActionMessage state={duplicateState} />
        </form>
      </div>
    </details>
  );
}

function ProjectWorkspaceDetail({ data }: { data: ProjectsWorkspaceData }) {
  const [taskView, setTaskView] = useState<"kanban" | "list" | "calendar" | "timeline" | "reports">(
    "kanban",
  );
  const project = data.projects.find((item) => item.id === data.selectedProjectId);
  if (!project) {
    return (
      <section className="project-empty-workspace">
        <FolderKanban size={30} aria-hidden="true" />
        <h2>Select or create a project</h2>
        <p>Project details, task workflow, comments, members, and time will appear here.</p>
      </section>
    );
  }

  return (
    <section className="project-detail">
      <header className="project-detail__header">
        <div>
          <div className="project-detail__eyebrow">
            <span>{project.code}</span>
            <StatusBadge tone={project.status === "completed" ? "success" : "info"}>
              {project.status.replaceAll("_", " ")}
            </StatusBadge>
            {project.archivedAt ? <StatusBadge tone="neutral">Archived</StatusBadge> : null}
            {project.closureStatus !== "open" ? (
              <StatusBadge tone={project.closureStatus === "closed" ? "success" : "warning"}>
                Closure {project.closureStatus}
              </StatusBadge>
            ) : null}
            <StatusBadge
              tone={
                project.health === "at_risk"
                  ? "error"
                  : project.health === "attention"
                    ? "warning"
                    : "success"
              }
            >
              {project.health.replaceAll("_", " ")}
            </StatusBadge>
          </div>
          <h2>{project.name}</h2>
          <p>{project.description ?? "No description has been added."}</p>
        </div>
        <div className="project-progress" aria-label={`${project.progress}% complete`}>
          <strong>{project.progress}%</strong>
          <span>
            {project.terminalTaskCount} of {project.taskCount} terminal
          </span>
          <div>
            <i style={{ width: `${project.progress}%` }} />
          </div>
        </div>
      </header>

      <dl className="project-detail__meta">
        <div>
          <dt>Client</dt>
          <dd>{project.companyName ?? "Internal"}</dd>
        </div>
        <div>
          <dt>Owner</dt>
          <dd>{project.ownerName}</dd>
        </div>
        <div>
          <dt>Due date</dt>
          <dd>{project.dueDate ?? "Not set"}</dd>
        </div>
        <div>
          <dt>Tracked</dt>
          <dd>{Math.round((project.trackedMinutes / 60) * 10) / 10} hours</dd>
        </div>
      </dl>

      <ProjectProfitabilityPanel project={project} data={data} />

      <div className="project-detail__actions">
        {data.capabilities.canUpdateProjects &&
        !project.archivedAt &&
        project.closureStatus !== "closed" ? (
          <ProjectEditForm project={project} data={data} />
        ) : null}
        {data.capabilities.canAssignProjects &&
        !project.archivedAt &&
        project.closureStatus !== "closed" ? (
          <MemberForm project={project} data={data} />
        ) : null}
        {data.capabilities.canCreateTasks &&
        !project.archivedAt &&
        project.closureStatus !== "closed" ? (
          <CreateTaskForm project={project} data={data} />
        ) : null}
      </div>

      <ProjectBulkTaskPanel project={project} data={data} />
      <ProjectReusePanel project={project} data={data} />
      <ProjectPlanningPanel project={project} data={data} />

      <section className="project-members" aria-label="Project members">
        <UsersRound size={17} aria-hidden="true" />
        <strong>Members</strong>
        <div>
          {data.members.map((member) => (
            <span key={member.membershipId} title={member.email}>
              {member.displayName} · {member.role} ·{" "}
              {formatMinorMoney(member.hourlyCostRateMinor, project.currency)}/h
            </span>
          ))}
        </div>
      </section>

      {data.capabilities.canViewTasks ? (
        <>
          <nav className="project-view-switcher" aria-label="Task view">
            {(["kanban", "list", "calendar", "timeline", "reports"] as const).map((view) => (
              <button
                type="button"
                key={view}
                className={taskView === view ? "is-active" : ""}
                aria-pressed={taskView === view}
                onClick={() => setTaskView(view)}
              >
                {view}
              </button>
            ))}
          </nav>
          {taskView === "kanban" ? (
            <Kanban project={project} data={data} />
          ) : (
            <ProjectAlternateView view={taskView} project={project} data={data} />
          )}
        </>
      ) : (
        <p className="structure-read-only-note">Task records are not granted to your role.</p>
      )}
      <TimePanel project={project} data={data} />
      <ProjectLifecyclePanel project={project} data={data} />
    </section>
  );
}

export function ProjectsWorkspace({
  data,
  openCreateProject = false,
}: {
  data: ProjectsWorkspaceData;
  openCreateProject?: boolean;
}) {
  const router = useRouter();
  const scanRefreshCountRef = useRef(0);
  const hasPendingFileScan = data.tasks.some((task) =>
    task.attachments.some((attachment) =>
      ["quarantined", "scanning", "scan_failed"].includes(attachment.status),
    ),
  );

  useEffect(() => {
    if (!hasPendingFileScan) {
      scanRefreshCountRef.current = 0;
      return;
    }
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || scanRefreshCountRef.current >= 24) return;
      scanRefreshCountRef.current += 1;
      router.refresh();
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [hasPendingFileScan, router]);
  if (!data.capabilities.canViewProjects) {
    return (
      <p className="structure-read-only-note">
        Projects navigation is available, but project records are not granted to your role.
      </p>
    );
  }

  return (
    <div className="projects-workspace">
      <SummaryCards data={data} />
      <MyTasksPanel data={data} />
      <ProjectFilters data={data} />
      <div className="projects-layout">
        <ProjectList data={data} openCreateProject={openCreateProject} />
        <ProjectWorkspaceDetail data={data} />
      </div>
      <section className="project-workflow-note">
        <CalendarClock size={18} aria-hidden="true" />
        <p>
          Project delivery now keeps planning, collaboration, files, recurring work, workload,
          closure, archive history, and reports in one permission-scoped workspace. Private files
          download through authorized routes and every mutation rechecks organization scope.
        </p>
      </section>
    </div>
  );
}
