"use client";

import type { CSSProperties, FormEvent } from "react";
import { useActionState, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  Bell,
  CalendarDays,
  CheckSquare2,
  CircleDot,
  FileDown,
  FilePlus2,
  Flag,
  GitBranch,
  ListChecks,
  Milestone,
  Paperclip,
  RefreshCw,
  RotateCcw,
  Tags,
  Trash2,
  UserRoundPlus,
  UsersRound,
} from "lucide-react";

import { ProjectActionMessage } from "@/components/projects/project-action-message";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  archiveProjectAction,
  closeProjectAction,
  createProjectChecklistItemAction,
  createProjectLabelAction,
  createProjectMilestoneAction,
  createProjectPhaseAction,
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
} from "@/modules/projects/actions/projects";
import {
  projectMilestoneStatuses,
  projectPhaseStatuses,
  projectRecurrenceUnits,
  projectTaskDependencyRelationships,
} from "@/modules/projects/projects";
import type { ProjectActionState } from "@/modules/projects/schemas/projects";
import type {
  ProjectMilestone,
  ProjectPhase,
  ProjectSummary,
  ProjectTask,
  ProjectsWorkspaceData,
} from "@/modules/projects/server/projects";

const initialState: ProjectActionState = { status: "idle" };

function SubmitButton({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {children}
    </Button>
  );
}

function TaskAssignmentTools({
  task,
  data,
  readOnly,
}: {
  task: ProjectTask;
  data: ProjectsWorkspaceData;
  readOnly: boolean;
}) {
  const [assigneeState, assigneeAction, assigneePending] = useActionState(
    saveProjectTaskAssigneeAction,
    initialState,
  );
  const [watcherState, watcherAction, watcherPending] = useActionState(
    saveProjectTaskWatcherAction,
    initialState,
  );
  const currentIsWatching = task.watchers.some(
    (watcher) => watcher.membershipId === data.currentMembershipId,
  );

  return (
    <section className="task-tool-section" aria-labelledby={`people-${task.id}`}>
      <h5 id={`people-${task.id}`}>
        <UsersRound size={15} aria-hidden="true" /> People
      </h5>
      <div className="task-tool-list">
        <span className="task-tool-label">Assignees</span>
        {task.assignees.length ? (
          task.assignees.map((assignee) => (
            <form action={assigneeAction} className="task-token" key={assignee.membershipId}>
              <input type="hidden" name="taskId" value={task.id} />
              <input type="hidden" name="membershipId" value={assignee.membershipId} />
              <input type="hidden" name="operation" value="remove" />
              <span>{assignee.displayName}</span>
              {data.capabilities.canAssignTasks && !readOnly ? (
                <button
                  type="submit"
                  disabled={assigneePending}
                  aria-label={`Remove ${assignee.displayName}`}
                >
                  ×
                </button>
              ) : null}
            </form>
          ))
        ) : (
          <span className="task-tool-empty">Unassigned</span>
        )}
      </div>
      {data.capabilities.canAssignTasks && !readOnly ? (
        <form action={assigneeAction} className="task-tool-form">
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="operation" value="add" />
          <label className="field">
            <span>Add assignee</span>
            <select name="membershipId" defaultValue="" required>
              <option value="" disabled>
                Select project member
              </option>
              {data.members
                .filter(
                  (member) =>
                    !task.assignees.some(
                      (assignee) => assignee.membershipId === member.membershipId,
                    ),
                )
                .map((member) => (
                  <option key={member.membershipId} value={member.membershipId}>
                    {member.displayName}
                  </option>
                ))}
            </select>
          </label>
          <SubmitButton pending={assigneePending}>
            <UserRoundPlus size={14} aria-hidden="true" /> Add
          </SubmitButton>
        </form>
      ) : null}
      <div className="task-tool-list">
        <span className="task-tool-label">Watchers</span>
        {task.watchers.length ? (
          task.watchers.map((watcher) => (
            <span key={watcher.membershipId}>{watcher.displayName}</span>
          ))
        ) : (
          <span className="task-tool-empty">No watchers</span>
        )}
      </div>
      {!readOnly ? (
        <form action={watcherAction} className="task-tool-form task-tool-form--compact">
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="membershipId" value={data.currentMembershipId} />
          <input type="hidden" name="operation" value={currentIsWatching ? "remove" : "add"} />
          <SubmitButton pending={watcherPending}>
            <Bell size={14} aria-hidden="true" />{" "}
            {currentIsWatching ? "Stop watching" : "Watch task"}
          </SubmitButton>
        </form>
      ) : null}
      <ProjectActionMessage state={assigneeState} />
      <ProjectActionMessage state={watcherState} />
    </section>
  );
}

function TaskLabelTools({ task, data }: { task: ProjectTask; data: ProjectsWorkspaceData }) {
  const [state, action, pending] = useActionState(saveProjectTaskLabelAction, initialState);
  const availableLabels = data.labels.filter(
    (label) => !task.labels.some((taskLabel) => taskLabel.id === label.id),
  );
  return (
    <section className="task-tool-section" aria-labelledby={`labels-${task.id}`}>
      <h5 id={`labels-${task.id}`}>
        <Tags size={15} aria-hidden="true" /> Labels
      </h5>
      <div className="project-label-list">
        {task.labels.length ? (
          task.labels.map((label) => (
            <form action={action} key={label.id}>
              <input type="hidden" name="taskId" value={task.id} />
              <input type="hidden" name="labelId" value={label.id} />
              <input type="hidden" name="operation" value="remove" />
              <button
                type="submit"
                className="project-label-chip"
                disabled={!data.capabilities.canUpdateTasks || pending}
                style={{ "--label-color": label.color } as CSSProperties}
                title={data.capabilities.canUpdateTasks ? "Remove label" : undefined}
              >
                {label.name}
              </button>
            </form>
          ))
        ) : (
          <span className="task-tool-empty">No labels</span>
        )}
      </div>
      {data.capabilities.canUpdateTasks && availableLabels.length ? (
        <form action={action} className="task-tool-form">
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="operation" value="add" />
          <label className="field">
            <span>Add label</span>
            <select name="labelId" defaultValue="" required>
              <option value="" disabled>
                Select label
              </option>
              {availableLabels.map((label) => (
                <option key={label.id} value={label.id}>
                  {label.name}
                </option>
              ))}
            </select>
          </label>
          <SubmitButton pending={pending}>Add</SubmitButton>
        </form>
      ) : null}
      <ProjectActionMessage state={state} />
    </section>
  );
}

function TaskChecklistTools({ task, data }: { task: ProjectTask; data: ProjectsWorkspaceData }) {
  const [createState, createAction, createPending] = useActionState(
    createProjectChecklistItemAction,
    initialState,
  );
  const [toggleState, toggleAction, togglePending] = useActionState(
    toggleProjectChecklistItemAction,
    initialState,
  );
  const completed = task.checklist.filter((item) => item.isCompleted).length;

  return (
    <section className="task-tool-section" aria-labelledby={`checklist-${task.id}`}>
      <h5 id={`checklist-${task.id}`}>
        <ListChecks size={15} aria-hidden="true" /> Checklist
        {task.checklist.length ? (
          <span>
            {completed}/{task.checklist.length}
          </span>
        ) : null}
      </h5>
      <div className="task-checklist">
        {task.checklist.map((item) => (
          <form action={toggleAction} key={item.id}>
            <input type="hidden" name="checklistItemId" value={item.id} />
            <input type="hidden" name="completed" value={item.isCompleted ? "false" : "true"} />
            <button
              type="submit"
              className={item.isCompleted ? "is-complete" : ""}
              disabled={!data.capabilities.canUpdateTasks || togglePending}
            >
              {item.isCompleted ? (
                <CheckSquare2 size={16} aria-hidden="true" />
              ) : (
                <CircleDot size={16} aria-hidden="true" />
              )}
              <span>{item.label}</span>
              {item.isRequired ? <small>Required</small> : null}
            </button>
          </form>
        ))}
        {!task.checklist.length ? (
          <span className="task-tool-empty">No checklist items</span>
        ) : null}
      </div>
      {data.capabilities.canUpdateTasks ? (
        <form action={createAction} className="task-tool-form">
          <input type="hidden" name="taskId" value={task.id} />
          <label className="field task-tool-form__grow">
            <span>New checklist item</span>
            <input name="label" maxLength={240} required placeholder="Review final deliverable" />
          </label>
          <label className="project-check-label">
            <input type="checkbox" name="isRequired" defaultChecked /> Required
          </label>
          <SubmitButton pending={createPending}>Add</SubmitButton>
        </form>
      ) : null}
      <ProjectActionMessage state={createState} />
      <ProjectActionMessage state={toggleState} />
    </section>
  );
}

function TaskDependencyTools({ task, data }: { task: ProjectTask; data: ProjectsWorkspaceData }) {
  const [state, action, pending] = useActionState(saveProjectTaskDependencyAction, initialState);
  const otherTasks = data.tasks.filter((candidate) => candidate.id !== task.id);
  return (
    <section className="task-tool-section" aria-labelledby={`dependencies-${task.id}`}>
      <h5 id={`dependencies-${task.id}`}>
        <GitBranch size={15} aria-hidden="true" /> Dependencies
      </h5>
      <ul className="task-dependency-list">
        {task.dependencies.map((dependency) => (
          <li
            key={`${dependency.direction}-${dependency.relationship}-${dependency.relatedTaskId}`}
          >
            <div>
              <span>
                {dependency.direction === "incoming"
                  ? "Referenced by"
                  : dependency.relationship.replaceAll("_", " ")}
              </span>
              <strong>{dependency.relatedTaskCode}</strong>
              <span>{dependency.relatedTaskTitle}</span>
            </div>
            {data.capabilities.canUpdateTasks ? (
              <form action={action}>
                <input
                  type="hidden"
                  name="taskId"
                  value={dependency.direction === "incoming" ? dependency.relatedTaskId : task.id}
                />
                <input
                  type="hidden"
                  name="relatedTaskId"
                  value={dependency.direction === "incoming" ? task.id : dependency.relatedTaskId}
                />
                <input type="hidden" name="relationship" value={dependency.relationship} />
                <input type="hidden" name="operation" value="remove" />
                <button
                  type="submit"
                  disabled={pending}
                  aria-label={`Remove dependency with ${dependency.relatedTaskCode}`}
                  title="Remove dependency"
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
      {!task.dependencies.length ? <span className="task-tool-empty">No dependencies</span> : null}
      {data.capabilities.canUpdateTasks && otherTasks.length ? (
        <form action={action} className="task-tool-form task-tool-form--three">
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="operation" value="add" />
          <label className="field">
            <span>Relationship</span>
            <select name="relationship" defaultValue="blocks">
              {projectTaskDependencyRelationships.map((relationship) => (
                <option key={relationship} value={relationship}>
                  {relationship.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="field task-tool-form__grow">
            <span>Related task</span>
            <select name="relatedTaskId" defaultValue="" required>
              <option value="" disabled>
                Select task
              </option>
              {otherTasks.map((candidate) => (
                <option value={candidate.id} key={candidate.id}>
                  {candidate.code} · {candidate.title}
                </option>
              ))}
            </select>
          </label>
          <SubmitButton pending={pending}>Add</SubmitButton>
        </form>
      ) : null}
      <ProjectActionMessage state={state} />
    </section>
  );
}

function TaskRecurrenceTools({ task, data }: { task: ProjectTask; data: ProjectsWorkspaceData }) {
  const [state, action, pending] = useActionState(saveProjectTaskRecurrenceAction, initialState);
  return (
    <section className="task-tool-section" aria-labelledby={`recurrence-${task.id}`}>
      <h5 id={`recurrence-${task.id}`}>
        <RefreshCw size={15} aria-hidden="true" /> Recurring work
      </h5>
      {task.recurrence ? (
        <p className="task-tool-summary">
          Every {task.recurrence.intervalCount} {task.recurrence.intervalUnit}
          {task.recurrence.intervalCount === 1 ? "" : "s"}; next occurrence{" "}
          {task.recurrence.nextRunOn}
          {task.recurrence.isActive ? "" : " (paused)"}.
        </p>
      ) : (
        <p className="task-tool-empty">No recurrence is configured.</p>
      )}
      {data.capabilities.canUpdateTasks ? (
        <form action={action} className="task-tool-form task-tool-form--recurrence">
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="active" value="false" />
          <label className="field">
            <span>Repeat every</span>
            <input
              name="intervalCount"
              type="number"
              min={1}
              max={365}
              defaultValue={task.recurrence?.intervalCount ?? 1}
              required
            />
          </label>
          <label className="field">
            <span>Unit</span>
            <select name="intervalUnit" defaultValue={task.recurrence?.intervalUnit ?? "week"}>
              {projectRecurrenceUnits.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Next run</span>
            <input
              name="nextRunOn"
              type="date"
              defaultValue={task.recurrence?.nextRunOn ?? task.dueDate ?? ""}
              required
            />
          </label>
          <label className="field">
            <span>End date</span>
            <input name="endOn" type="date" defaultValue={task.recurrence?.endOn ?? ""} />
          </label>
          <label className="project-check-label">
            <input
              type="checkbox"
              name="active"
              value="true"
              defaultChecked={task.recurrence?.isActive ?? true}
            />{" "}
            Active
          </label>
          <SubmitButton pending={pending}>Save recurrence</SubmitButton>
        </form>
      ) : null}
      <ProjectActionMessage state={state} />
    </section>
  );
}

function AttachmentTools({ task, canUpdate }: { task: ProjectTask; canUpdate: boolean }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/projects/tasks/${task.id}/attachments`, {
        method: "POST",
        body: new FormData(event.currentTarget),
      });
      const payload = (await response.json()) as { ok?: boolean; message?: string };
      setMessage({
        tone: response.ok ? "success" : "error",
        text: payload.message ?? (response.ok ? "Attachment uploaded." : "Upload failed."),
      });
      if (response.ok) {
        formRef.current?.reset();
        router.refresh();
      }
    } catch {
      setMessage({ tone: "error", text: "The attachment could not be uploaded." });
    } finally {
      setPending(false);
    }
  }

  async function remove(attachmentId: string) {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/projects/attachments/${attachmentId}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as { message?: string };
      setMessage({
        tone: response.ok ? "success" : "error",
        text: payload.message ?? (response.ok ? "Attachment removed." : "Removal failed."),
      });
      if (response.ok) router.refresh();
    } catch {
      setMessage({ tone: "error", text: "The attachment could not be removed." });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="task-tool-section" aria-labelledby={`attachments-${task.id}`}>
      <h5 id={`attachments-${task.id}`}>
        <Paperclip size={15} aria-hidden="true" /> Attachments
      </h5>
      <ul className="task-attachment-list">
        {task.attachments.map((attachment) => (
          <li key={attachment.id}>
            {attachment.downloadHref ? (
              <a href={attachment.downloadHref} className="task-attachment-file">
                <FileDown size={15} aria-hidden="true" />
                <span>{attachment.fileName}</span>
                <small>{Math.max(1, Math.round(attachment.sizeBytes / 1024))} KB</small>
              </a>
            ) : (
              <div className="task-attachment-file is-unavailable">
                <RefreshCw size={15} aria-hidden="true" />
                <span>{attachment.fileName}</span>
                <small>{Math.max(1, Math.round(attachment.sizeBytes / 1024))} KB</small>
              </div>
            )}
            <StatusBadge
              tone={
                attachment.status === "available"
                  ? "success"
                  : attachment.status === "rejected"
                    ? "error"
                    : attachment.status === "scan_failed"
                      ? "warning"
                      : "info"
              }
              className="task-attachment-status"
            >
              {attachment.statusLabel}
            </StatusBadge>
            {canUpdate ? (
              <button
                type="button"
                onClick={() => void remove(attachment.id)}
                disabled={pending}
                aria-label={`Remove ${attachment.fileName}`}
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {!task.attachments.length ? <span className="task-tool-empty">No attachments</span> : null}
      {canUpdate ? (
        <form ref={formRef} onSubmit={upload} className="task-attachment-upload">
          <label className="field">
            <span>Upload file</span>
            <input name="file" type="file" accept=".png,.jpg,.jpeg,.pdf,.txt,.csv" required />
          </label>
          <Button type="submit" size="sm" disabled={pending}>
            <FilePlus2 size={14} aria-hidden="true" /> {pending ? "Working" : "Upload"}
          </Button>
          <small>
            Private, 10 MB maximum. Files stay unavailable until malware scanning succeeds.
          </small>
        </form>
      ) : null}
      {message ? (
        <p
          className={`task-upload-message is-${message.tone}`}
          role={message.tone === "error" ? "alert" : "status"}
        >
          {message.text}
        </p>
      ) : null}
    </section>
  );
}

export function ProjectTaskEnhancements({
  task,
  data,
  readOnly = false,
}: {
  task: ProjectTask;
  data: ProjectsWorkspaceData;
  readOnly?: boolean;
}) {
  const effectiveData = readOnly
    ? {
        ...data,
        capabilities: {
          ...data.capabilities,
          canUpdateTasks: false,
          canAssignTasks: false,
        },
      }
    : data;

  return (
    <details className="task-enhancements">
      <summary>Task details and collaboration</summary>
      <div className="task-enhancements__grid">
        <TaskLabelTools task={task} data={effectiveData} />
        <TaskAssignmentTools task={task} data={effectiveData} readOnly={readOnly} />
        <TaskChecklistTools task={task} data={effectiveData} />
        <TaskDependencyTools task={task} data={effectiveData} />
        <TaskRecurrenceTools task={task} data={effectiveData} />
        <AttachmentTools task={task} canUpdate={effectiveData.capabilities.canUpdateTasks} />
      </div>
    </details>
  );
}

function PhaseForm({ project, data }: { project: ProjectSummary; data: ProjectsWorkspaceData }) {
  const [state, action, pending] = useActionState(createProjectPhaseAction, initialState);
  if (!data.capabilities.canUpdateProjects) return null;
  return (
    <form action={action} className="project-stage-form">
      <input type="hidden" name="projectId" value={project.id} />
      <h4>
        <Flag size={16} aria-hidden="true" /> New phase
      </h4>
      <label className="field">
        <span>Name</span>
        <input name="name" maxLength={120} required />
      </label>
      <label className="field">
        <span>Status</span>
        <select name="status" defaultValue="planned">
          {projectPhaseStatuses.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Start</span>
        <input name="startDate" type="date" />
      </label>
      <label className="field">
        <span>Due</span>
        <input name="dueDate" type="date" />
      </label>
      <label className="field project-stage-form__wide">
        <span>Description</span>
        <input name="description" maxLength={1000} />
      </label>
      <SubmitButton pending={pending}>Create phase</SubmitButton>
      <ProjectActionMessage state={state} />
    </form>
  );
}

function MilestoneForm({
  project,
  data,
}: {
  project: ProjectSummary;
  data: ProjectsWorkspaceData;
}) {
  const [state, action, pending] = useActionState(createProjectMilestoneAction, initialState);
  if (!data.capabilities.canUpdateProjects) return null;
  return (
    <form action={action} className="project-stage-form">
      <input type="hidden" name="projectId" value={project.id} />
      <h4>
        <Milestone size={16} aria-hidden="true" /> New milestone
      </h4>
      <label className="field">
        <span>Name</span>
        <input name="name" maxLength={120} required />
      </label>
      <label className="field">
        <span>Phase</span>
        <select name="phaseId" defaultValue="">
          <option value="">No phase</option>
          {data.phases.map((phase) => (
            <option key={phase.id} value={phase.id}>
              {phase.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Status</span>
        <select name="status" defaultValue="open">
          {projectMilestoneStatuses.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Due</span>
        <input name="dueDate" type="date" />
      </label>
      <label className="field project-stage-form__wide">
        <span>Description</span>
        <input name="description" maxLength={1000} />
      </label>
      <SubmitButton pending={pending}>Create milestone</SubmitButton>
      <ProjectActionMessage state={state} />
    </form>
  );
}

function LabelForm({ project, data }: { project: ProjectSummary; data: ProjectsWorkspaceData }) {
  const [state, action, pending] = useActionState(createProjectLabelAction, initialState);
  if (!data.capabilities.canUpdateTasks) return null;
  return (
    <form action={action} className="project-stage-form project-stage-form--label">
      <input type="hidden" name="projectId" value={project.id} />
      <h4>
        <Tags size={16} aria-hidden="true" /> New label
      </h4>
      <label className="field">
        <span>Name</span>
        <input name="name" maxLength={60} required />
      </label>
      <label className="field">
        <span>Color</span>
        <input name="color" type="color" defaultValue="#2563eb" required />
      </label>
      <SubmitButton pending={pending}>Create label</SubmitButton>
      <ProjectActionMessage state={state} />
    </form>
  );
}

function PhaseStatusForm({ phase }: { phase: ProjectPhase }) {
  const [state, action, pending] = useActionState(updateProjectPhaseStatusAction, initialState);

  return (
    <form action={action} className="project-stage-status-form">
      <input type="hidden" name="phaseId" value={phase.id} />
      <label>
        <span className="sr-only">Status for {phase.name}</span>
        <select name="status" defaultValue={phase.status} disabled={pending}>
          {projectPhaseStatuses.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        Update
      </Button>
      <ProjectActionMessage state={state} />
    </form>
  );
}

function MilestoneStatusForm({ milestone }: { milestone: ProjectMilestone }) {
  const [state, action, pending] = useActionState(updateProjectMilestoneStatusAction, initialState);

  return (
    <form action={action} className="project-stage-status-form">
      <input type="hidden" name="milestoneId" value={milestone.id} />
      <label>
        <span className="sr-only">Status for {milestone.name}</span>
        <select name="status" defaultValue={milestone.status} disabled={pending}>
          {projectMilestoneStatuses.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        Update
      </Button>
      <ProjectActionMessage state={state} />
    </form>
  );
}

export function ProjectPlanningPanel({
  project,
  data,
}: {
  project: ProjectSummary;
  data: ProjectsWorkspaceData;
}) {
  const planningReadOnly =
    !data.capabilities.canUpdateProjects ||
    Boolean(project.archivedAt) ||
    project.closureStatus === "closed";

  return (
    <details className="project-planning-panel">
      <summary>Phases, milestones, and labels</summary>
      <div className="project-planning-panel__content">
        <div className="project-stage-overview">
          <section>
            <h4>Phases</h4>
            {data.phases.map((phase) => (
              <article key={phase.id}>
                <div>
                  <strong>{phase.name}</strong>
                  <StatusBadge
                    tone={
                      phase.status === "completed"
                        ? "success"
                        : phase.status === "active"
                          ? "info"
                          : "neutral"
                    }
                  >
                    {phase.status}
                  </StatusBadge>
                </div>
                <p>
                  {phase.completedTaskCount}/{phase.taskCount} tasks complete
                  {phase.dueDate ? ` · due ${phase.dueDate}` : ""}
                </p>
                {!planningReadOnly ? <PhaseStatusForm phase={phase} /> : null}
              </article>
            ))}
            {!data.phases.length ? <p className="empty-state-copy">No phases yet.</p> : null}
          </section>
          <section>
            <h4>Milestones</h4>
            {data.milestones.map((milestone) => (
              <article key={milestone.id}>
                <div>
                  <strong>{milestone.name}</strong>
                  <StatusBadge
                    tone={
                      milestone.status === "completed"
                        ? "success"
                        : milestone.status === "cancelled"
                          ? "neutral"
                          : "warning"
                    }
                  >
                    {milestone.status}
                  </StatusBadge>
                </div>
                <p>
                  {milestone.completedTaskCount}/{milestone.taskCount} tasks complete
                  {milestone.dueDate ? ` · due ${milestone.dueDate}` : ""}
                </p>
                {!planningReadOnly ? <MilestoneStatusForm milestone={milestone} /> : null}
              </article>
            ))}
            {!data.milestones.length ? (
              <p className="empty-state-copy">No milestones yet.</p>
            ) : null}
          </section>
          <section>
            <h4>Project labels</h4>
            <div className="project-label-list">
              {data.labels.map((label) => (
                <span
                  className="project-label-chip"
                  style={{ "--label-color": label.color } as CSSProperties}
                  key={label.id}
                >
                  {label.name}
                </span>
              ))}
              {!data.labels.length ? <p className="empty-state-copy">No labels yet.</p> : null}
            </div>
          </section>
        </div>
        {!project.archivedAt && project.closureStatus !== "closed" ? (
          <div className="project-stage-forms">
            <PhaseForm project={project} data={data} />
            <MilestoneForm project={project} data={data} />
            <LabelForm project={project} data={data} />
          </div>
        ) : null}
      </div>
    </details>
  );
}

function ClosureChecklist({
  project,
  data,
}: {
  project: ProjectSummary;
  data: ProjectsWorkspaceData;
}) {
  const [state, action, pending] = useActionState(toggleProjectClosureItemAction, initialState);
  return (
    <div className="project-closure-checklist">
      {data.closureItems.map((item) => {
        const manual = ["deliverables_confirmed", "followups_recorded", "assets_returned"].includes(
          item.checkKey,
        );
        return (
          <form action={action} key={item.id}>
            <input type="hidden" name="closureItemId" value={item.id} />
            <input type="hidden" name="completed" value={item.isCompleted ? "false" : "true"} />
            <button
              type="submit"
              disabled={
                !manual ||
                !data.capabilities.canUpdateProjects ||
                pending ||
                Boolean(project.archivedAt) ||
                project.closureStatus === "closed"
              }
              className={item.isCompleted ? "is-complete" : ""}
            >
              {item.isCompleted ? (
                <CheckSquare2 size={17} aria-hidden="true" />
              ) : (
                <CircleDot size={17} aria-hidden="true" />
              )}
              <span>{item.label}</span>
              {item.isRequired ? (
                <small>{manual ? "Required confirmation" : "Verified automatically"}</small>
              ) : null}
            </button>
          </form>
        );
      })}
      <ProjectActionMessage state={state} />
    </div>
  );
}

export function ProjectLifecyclePanel({
  project,
  data,
}: {
  project: ProjectSummary;
  data: ProjectsWorkspaceData;
}) {
  const [requestState, requestAction, requestPending] = useActionState(
    requestProjectClosureAction,
    initialState,
  );
  const [closeState, closeAction, closePending] = useActionState(closeProjectAction, initialState);
  const [archiveState, archiveAction, archivePending] = useActionState(
    archiveProjectAction,
    initialState,
  );
  const readiness = data.closureReadiness;
  const requiredComplete =
    readiness?.ready ??
    data.closureItems.filter((item) => item.isRequired).every((item) => item.isCompleted);
  const openTasks = readiness?.openTasks ?? project.taskCount - project.terminalTaskCount;

  return (
    <details className="project-lifecycle-panel">
      <summary>Closure and archive</summary>
      <div className="project-lifecycle-panel__content">
        <header>
          <div>
            <h3>Project lifecycle</h3>
            <p>
              Closure requires all open tasks and required checks to be resolved. Archive keeps
              history available without cluttering active work.
            </p>
          </div>
          <StatusBadge
            tone={
              project.closureStatus === "closed"
                ? "success"
                : project.closureStatus === "requested"
                  ? "warning"
                  : "neutral"
            }
          >
            {project.closureStatus}
          </StatusBadge>
        </header>
        <ClosureChecklist project={project} data={data} />
        {project.closureNotes ? <blockquote>{project.closureNotes}</blockquote> : null}
        {data.capabilities.canUpdateProjects &&
        !project.archivedAt &&
        project.closureStatus !== "closed" ? (
          <div className="project-lifecycle-actions">
            <form action={requestAction}>
              <input type="hidden" name="projectId" value={project.id} />
              <label className="field">
                <span>Closure notes</span>
                <textarea
                  name="notes"
                  rows={2}
                  maxLength={2000}
                  defaultValue={project.closureNotes ?? ""}
                />
              </label>
              <SubmitButton pending={requestPending}>Request closure</SubmitButton>
              <ProjectActionMessage state={requestState} />
            </form>
            <form action={closeAction}>
              <input type="hidden" name="projectId" value={project.id} />
              <label className="field">
                <span>Final closure notes</span>
                <textarea
                  name="notes"
                  rows={3}
                  maxLength={4000}
                  defaultValue={project.closureNotes ?? ""}
                  required
                />
              </label>
              <Button
                type="submit"
                size="sm"
                disabled={closePending || openTasks > 0 || !requiredComplete}
              >
                <CheckSquare2 size={14} aria-hidden="true" /> Close project
              </Button>
              <small>
                {openTasks > 0
                  ? `${openTasks} open task${openTasks === 1 ? "" : "s"} remain.`
                  : readiness && readiness.unsubmittedTimeEntries > 0
                    ? `${readiness.unsubmittedTimeEntries} draft time entr${readiness.unsubmittedTimeEntries === 1 ? "y" : "ies"} remain.`
                    : readiness && readiness.outstandingExpenses > 0
                      ? `${readiness.outstandingExpenses} project expense${readiness.outstandingExpenses === 1 ? "" : "s"} require resolution.`
                      : readiness && readiness.openSupportTickets > 0
                        ? `${readiness.openSupportTickets} support ticket${readiness.openSupportTickets === 1 ? "" : "s"} remain open.`
                        : readiness && readiness.unbilledMinor !== 0
                          ? "Final billing is incomplete; unbilled project value remains."
                          : !requiredComplete
                            ? "Complete the remaining required confirmations first."
                            : "Ready to close."}
              </small>
              <ProjectActionMessage state={closeState} />
            </form>
          </div>
        ) : null}
        {data.capabilities.canArchiveProjects ? (
          <form action={archiveAction} className="project-archive-action">
            <input type="hidden" name="projectId" value={project.id} />
            <input
              type="hidden"
              name="operation"
              value={project.archivedAt ? "restore" : "archive"}
            />
            <Button
              type="submit"
              variant={project.archivedAt ? "secondary" : "danger"}
              size="sm"
              disabled={archivePending}
            >
              {project.archivedAt ? (
                <RotateCcw size={14} aria-hidden="true" />
              ) : (
                <Archive size={14} aria-hidden="true" />
              )}
              {project.archivedAt ? "Restore project" : "Archive project"}
            </Button>
            <ProjectActionMessage state={archiveState} />
          </form>
        ) : null}
      </div>
    </details>
  );
}

function ListView({ data }: { data: ProjectsWorkspaceData }) {
  return (
    <div
      className="project-list-view table-scroll"
      role="region"
      aria-label="Task list"
      tabIndex={0}
    >
      <table>
        <thead>
          <tr>
            <th>Task</th>
            <th>Status</th>
            <th>Phase</th>
            <th>Milestone</th>
            <th>Assignees</th>
            <th>Due</th>
            <th>Effort</th>
          </tr>
        </thead>
        <tbody>
          {data.tasks.map((task) => (
            <tr key={task.id}>
              <td>
                <strong>{task.code}</strong>
                <span>{task.title}</span>
                {task.parentTaskId ? <small>Subtask</small> : null}
              </td>
              <td>{task.statusSlug.replaceAll("_", " ")}</td>
              <td>{data.phases.find((phase) => phase.id === task.phaseId)?.name ?? "—"}</td>
              <td>
                {data.milestones.find((milestone) => milestone.id === task.milestoneId)?.name ??
                  "—"}
              </td>
              <td>
                {task.assignees.map((assignee) => assignee.displayName).join(", ") || "Unassigned"}
              </td>
              <td>{task.dueDate ?? "—"}</td>
              <td>
                {task.estimatedMinutes
                  ? `${Math.round((task.estimatedMinutes / 60) * 10) / 10}h`
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CalendarView({ data }: { data: ProjectsWorkspaceData }) {
  const grouped = useMemo(() => {
    const map = new Map<string, ProjectTask[]>();
    for (const task of data.tasks) {
      const key = task.dueDate ?? "Unscheduled";
      map.set(key, [...(map.get(key) ?? []), task]);
    }
    return [...map.entries()].sort(([left], [right]) =>
      left === "Unscheduled" ? 1 : right === "Unscheduled" ? -1 : left.localeCompare(right),
    );
  }, [data.tasks]);
  return (
    <div className="project-calendar-view">
      {grouped.map(([date, tasks]) => (
        <section key={date}>
          <h4>
            <CalendarDays size={16} aria-hidden="true" /> {date}
          </h4>
          {tasks.map((task) => (
            <article key={task.id}>
              <strong>{task.code}</strong>
              <span>{task.title}</span>
              <small>{task.statusSlug.replaceAll("_", " ")}</small>
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}

function TimelineView({ data }: { data: ProjectsWorkspaceData }) {
  const datedTasks = data.tasks.filter((task) => task.startDate || task.dueDate);
  const bounds = datedTasks
    .flatMap((task) => [task.startDate, task.dueDate].filter(Boolean) as string[])
    .sort();
  const first = bounds[0] ? new Date(`${bounds[0]}T00:00:00Z`).getTime() : 0;
  const last = bounds.at(-1)
    ? new Date(`${bounds.at(-1)}T00:00:00Z`).getTime()
    : first + 86_400_000;
  const range = Math.max(last - first, 86_400_000);
  return (
    <div className="project-timeline-view">
      <header>
        <span>{bounds[0] ?? "No start"}</span>
        <span>{bounds.at(-1) ?? "No due date"}</span>
      </header>
      {datedTasks.map((task) => {
        const start = new Date(`${task.startDate ?? task.dueDate}T00:00:00Z`).getTime();
        const end = new Date(`${task.dueDate ?? task.startDate}T00:00:00Z`).getTime();
        const left = Math.max(0, ((start - first) / range) * 100);
        const width = Math.max(2, ((Math.max(end, start) - start) / range) * 100 + 2);
        return (
          <article key={task.id}>
            <div>
              <strong>{task.code}</strong>
              <span>{task.title}</span>
            </div>
            <div className="project-timeline-track">
              <span style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }} />
            </div>
          </article>
        );
      })}
      {!datedTasks.length ? (
        <p className="empty-state-copy">Add task dates to build the timeline.</p>
      ) : null}
    </div>
  );
}

function ReportsView({ project, data }: { project: ProjectSummary; data: ProjectsWorkspaceData }) {
  const overdue = data.tasks.filter(
    (task) =>
      task.dueDate && task.dueDate < new Date().toISOString().slice(0, 10) && !task.completedAt,
  ).length;
  const estimated = data.tasks.reduce((total, task) => total + (task.estimatedMinutes ?? 0), 0);
  return (
    <div className="project-report-view">
      <section className="project-report-metrics">
        <article>
          <span>Progress</span>
          <strong>{project.progress}%</strong>
        </article>
        <article>
          <span>Overdue tasks</span>
          <strong>{overdue}</strong>
        </article>
        <article>
          <span>Estimated hours</span>
          <strong>{Math.round((estimated / 60) * 10) / 10}</strong>
        </article>
        <article>
          <span>Tracked hours</span>
          <strong>{Math.round((project.trackedMinutes / 60) * 10) / 10}</strong>
        </article>
      </section>
      <section>
        <h4>Workload by member</h4>
        <div className="project-workload-list">
          {data.workload.map((item) => (
            <article key={item.membershipId}>
              <div>
                <strong>{item.displayName}</strong>
                <span>
                  {item.openTasks} open · {item.overdueTasks} overdue
                </span>
              </div>
              <div>
                <span>Planned {Math.round((item.estimatedMinutes / 60) * 10) / 10}h</span>
                <span>Tracked {Math.round((item.trackedMinutes / 60) * 10) / 10}h</span>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section>
        <h4>Delivery structure</h4>
        <p>
          {data.phases.length} phases · {data.milestones.length} milestones · {data.labels.length}{" "}
          labels
        </p>
      </section>
    </div>
  );
}

export function ProjectAlternateView({
  view,
  project,
  data,
}: {
  view: "list" | "calendar" | "timeline" | "reports";
  project: ProjectSummary;
  data: ProjectsWorkspaceData;
}) {
  if (view === "list") return <ListView data={data} />;
  if (view === "calendar") return <CalendarView data={data} />;
  if (view === "timeline") return <TimelineView data={data} />;
  return <ReportsView project={project} data={data} />;
}
