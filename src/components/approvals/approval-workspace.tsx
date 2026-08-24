"use client";

import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Clock3,
  FileCheck2,
  History,
  Plus,
  RotateCcw,
  ShieldCheck,
  UserRoundCog,
} from "lucide-react";
import Link from "next/link";
import { useActionState, useMemo, useRef, useState } from "react";

import { ApprovalDialogShell } from "@/components/approvals/approval-dialog-shell";
import { eligibleApprovalMembers } from "@/components/approvals/approval-ui-state";
import { useCloseApprovalDialogOnSuccess } from "@/components/approvals/use-close-approval-dialog-on-success";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  cancelApprovalRequestAction,
  createApprovalDefinitionAction,
  createApprovalDelegationAction,
  createApprovalRequestAction,
  decideApprovalStepAction,
  reassignApprovalStepAction,
  retireApprovalDefinitionAction,
  revokeApprovalDelegationAction,
} from "@/modules/approvals/actions/approvals";
import {
  approvalDecisionModeLabels,
  approvalSelectorLabels,
  approvalStatusLabels,
  approvalStatusTone,
  approvalStepStatusLabels,
  type ApprovalDefinitionStepInput,
  type ApprovalRequestListItem,
  type ApprovalWorkspaceData,
} from "@/modules/approvals/approvals";
import type { ApprovalActionState } from "@/modules/approvals/schemas/approvals";
import { toDateTimeLocalValue } from "@/lib/date-time-local";
import { getDateTimeFormatter } from "@/lib/intl-formatters";

const initialState: ApprovalActionState = { status: "idle" };

function formatDate(value: string | null): string {
  if (!value) return "Not set";
  return getDateTimeFormatter(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function ActionMessage({ state }: { state: ApprovalActionState }) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <div
      className={`approval-action-message${state.status === "success" ? " is-success" : ""}`}
      role={state.status === "error" ? "alert" : "status"}
    >
      {state.status === "success" ? <Check size={15} aria-hidden="true" /> : null}
      <div>
        <p>{state.message}</p>
        {state.fieldErrors ? (
          <ul>
            {Object.entries(state.fieldErrors).flatMap(([field, messages]) =>
              messages.map((message) => <li key={`${field}-${message}`}>{message}</li>),
            )}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function SummaryStrip({ data }: { data: ApprovalWorkspaceData }) {
  const items = [
    ["Assigned to me", data.summary.assignedPending, "Decisions waiting for you"],
    ["My pending requests", data.summary.submittedPending, "Submitted and unresolved"],
    ["Decided this month", data.summary.decidedThisMonth, "Your recorded decisions"],
    ["Overdue", data.summary.overdue, "Assigned steps past due"],
  ] as const;

  return (
    <section className="approval-summary" aria-label="Approval summary">
      {items.map(([label, value, detail]) => (
        <div className="approval-summary__item" key={label}>
          <strong>{value}</strong>
          <span>{label}</span>
          <small>{detail}</small>
        </div>
      ))}
    </section>
  );
}

type DraftStep = {
  id: string;
  name: string;
  stageOrder: string;
  selectorType: "manager" | "role" | "membership";
  selectorRoleKey: string;
  selectorMembershipId: string;
  decisionMode: "any" | "all";
  minimumAmount: string;
  maximumAmount: string;
  departmentId: string;
  commentRequired: boolean;
  reminderAfterHours: string;
  escalationAfterHours: string;
  expiresAfterHours: string;
};

function newStep(index: number): DraftStep {
  return {
    id: `initial-${index}`,
    name: index === 0 ? "Manager review" : `Approval step ${index + 1}`,
    stageOrder: String(index + 1),
    selectorType: "manager",
    selectorRoleKey: "",
    selectorMembershipId: "",
    decisionMode: "any",
    minimumAmount: "",
    maximumAmount: "",
    departmentId: "",
    commentRequired: false,
    reminderAfterHours: "24",
    escalationAfterHours: "48",
    expiresAfterHours: "168",
  };
}

function serializeSteps(steps: DraftStep[]): ApprovalDefinitionStepInput[] {
  return steps.map((step, index) => ({
    name: step.name,
    stageOrder: Number(step.stageOrder),
    sortOrder: index + 1,
    selectorType: step.selectorType,
    selectorRoleKey: step.selectorType === "role" ? step.selectorRoleKey || null : null,
    selectorMembershipId:
      step.selectorType === "membership" ? step.selectorMembershipId || null : null,
    decisionMode: step.decisionMode,
    conditions: {
      ...(step.minimumAmount ? { minimumAmount: Number(step.minimumAmount) } : {}),
      ...(step.maximumAmount ? { maximumAmount: Number(step.maximumAmount) } : {}),
      ...(step.departmentId ? { departmentId: step.departmentId } : {}),
    },
    commentRequired: step.commentRequired,
    reminderAfterHours: step.reminderAfterHours ? Number(step.reminderAfterHours) : null,
    escalationAfterHours: step.escalationAfterHours ? Number(step.escalationAfterHours) : null,
    expiresAfterHours: step.expiresAfterHours ? Number(step.expiresAfterHours) : null,
  }));
}

function PolicyDialog({ data }: { data: ApprovalWorkspaceData }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [steps, setSteps] = useState<DraftStep[]>([newStep(0)]);
  const [state, action, pending] = useActionState(createApprovalDefinitionAction, initialState);

  useCloseApprovalDialogOnSuccess({
    state,
    dialogRef,
    afterSuccess: () => setSteps([newStep(0)]),
  });

  function updateStep(id: string, patch: Partial<DraftStep>) {
    setSteps((current) => current.map((step) => (step.id === id ? { ...step, ...patch } : step)));
  }

  return (
    <>
      <Button type="button" onClick={() => dialogRef.current?.showModal()}>
        <Plus size={16} aria-hidden="true" /> Create policy
      </Button>
      <ApprovalDialogShell
        dialogRef={dialogRef}
        title="Create approval policy"
        description="Define sequential or parallel decisions once, then reuse the policy across modules."
      >
        <form action={action} className="approval-policy-form">
          <div className="approval-form-grid approval-form-grid--three">
            <label>
              <span>Policy key</span>
              <input name="key" required maxLength={80} placeholder="finance_invoice_issue" />
              <small>Stable integration key. Lowercase letters, numbers, and underscores.</small>
            </label>
            <label>
              <span>Policy name</span>
              <input name="name" required maxLength={120} placeholder="Invoice issue approval" />
            </label>
            <label>
              <span>Source module</span>
              <input name="sourceModule" required maxLength={80} placeholder="finance" />
            </label>
            <label>
              <span>Entity type</span>
              <input name="entityType" required maxLength={80} placeholder="invoice" />
            </label>
            <label className="approval-form-grid__wide">
              <span>Description</span>
              <textarea
                name="description"
                rows={2}
                maxLength={1000}
                placeholder="When and why this policy is used."
              />
            </label>
          </div>

          <div className="approval-toggle-row">
            <label className="approval-check">
              <input type="checkbox" name="allowReassignment" defaultChecked />
              <span>
                <strong>Allow reassignment</strong>
                <small>Current approvers or policy managers may transfer pending work.</small>
              </span>
            </label>
            <label className="approval-check">
              <input type="checkbox" name="allowSelfApproval" />
              <span>
                <strong>Allow self-approval</strong>
                <small>Leave disabled for controlled transactions and employee requests.</small>
              </span>
            </label>
          </div>

          <div className="approval-policy-steps">
            <div className="approval-section-heading">
              <div>
                <h3>Policy steps</h3>
                <p>Steps sharing a stage number run in parallel. Later stages wait.</p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  setSteps((current) => [
                    ...current,
                    { ...newStep(current.length), id: `step-${Date.now()}-${current.length}` },
                  ])
                }
                disabled={steps.length >= 20}
              >
                <Plus size={15} /> Add step
              </Button>
            </div>

            {steps.map((step, index) => (
              <fieldset className="approval-step-builder" key={step.id}>
                <legend>Step {index + 1}</legend>
                <div className="approval-form-grid approval-form-grid--four">
                  <label className="approval-form-grid__span-two">
                    <span>Name</span>
                    <input
                      value={step.name}
                      onChange={(event) => updateStep(step.id, { name: event.target.value })}
                      maxLength={120}
                      required
                    />
                  </label>
                  <label>
                    <span>Stage</span>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={step.stageOrder}
                      onChange={(event) => updateStep(step.id, { stageOrder: event.target.value })}
                      required
                    />
                  </label>
                  <label>
                    <span>Decision rule</span>
                    <select
                      value={step.decisionMode}
                      onChange={(event) =>
                        updateStep(step.id, {
                          decisionMode: event.target.value as DraftStep["decisionMode"],
                        })
                      }
                    >
                      <option value="any">Any approver</option>
                      <option value="all">Every approver</option>
                    </select>
                  </label>
                  <label>
                    <span>Approver selector</span>
                    <select
                      value={step.selectorType}
                      onChange={(event) =>
                        updateStep(step.id, {
                          selectorType: event.target.value as DraftStep["selectorType"],
                          selectorRoleKey: "",
                          selectorMembershipId: "",
                        })
                      }
                    >
                      <option value="manager">Requester manager</option>
                      <option value="role">Organization role</option>
                      <option value="membership">Named member</option>
                    </select>
                  </label>
                  {step.selectorType === "role" ? (
                    <label>
                      <span>Role</span>
                      <select
                        value={step.selectorRoleKey}
                        onChange={(event) =>
                          updateStep(step.id, { selectorRoleKey: event.target.value })
                        }
                        required
                      >
                        <option value="">Choose role</option>
                        {data.roles.map((role) => (
                          <option value={role.key} key={role.key}>
                            {role.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {step.selectorType === "membership" ? (
                    <label>
                      <span>Named member</span>
                      <select
                        value={step.selectorMembershipId}
                        onChange={(event) =>
                          updateStep(step.id, { selectorMembershipId: event.target.value })
                        }
                        required
                      >
                        <option value="">Choose member</option>
                        {eligibleApprovalMembers(data.members).map((member) => (
                          <option value={member.id} key={member.id}>
                            {member.displayName} ({member.email})
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <label>
                    <span>Minimum amount</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={step.minimumAmount}
                      onChange={(event) =>
                        updateStep(step.id, { minimumAmount: event.target.value })
                      }
                      placeholder="Any"
                    />
                  </label>
                  <label>
                    <span>Maximum amount</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={step.maximumAmount}
                      onChange={(event) =>
                        updateStep(step.id, { maximumAmount: event.target.value })
                      }
                      placeholder="Any"
                    />
                  </label>
                  <label>
                    <span>Department condition</span>
                    <select
                      value={step.departmentId}
                      onChange={(event) =>
                        updateStep(step.id, { departmentId: event.target.value })
                      }
                    >
                      <option value="">Any department</option>
                      {data.departments.map((department) => (
                        <option value={department.id} key={department.id}>
                          {department.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Reminder after hours</span>
                    <input
                      type="number"
                      min={1}
                      max={720}
                      value={step.reminderAfterHours}
                      onChange={(event) =>
                        updateStep(step.id, { reminderAfterHours: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    <span>Escalate after hours</span>
                    <input
                      type="number"
                      min={1}
                      max={2160}
                      value={step.escalationAfterHours}
                      onChange={(event) =>
                        updateStep(step.id, { escalationAfterHours: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    <span>Expire after hours</span>
                    <input
                      type="number"
                      min={1}
                      max={8760}
                      value={step.expiresAfterHours}
                      onChange={(event) =>
                        updateStep(step.id, { expiresAfterHours: event.target.value })
                      }
                    />
                  </label>
                  <label className="approval-check approval-form-grid__span-two">
                    <input
                      type="checkbox"
                      checked={step.commentRequired}
                      onChange={(event) =>
                        updateStep(step.id, { commentRequired: event.target.checked })
                      }
                    />
                    <span>
                      <strong>Require decision comment</strong>
                      <small>Rejections and revision requests always require a reason.</small>
                    </span>
                  </label>
                </div>
                {steps.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setSteps((current) => current.filter((item) => item.id !== step.id))
                    }
                  >
                    Remove step
                  </Button>
                ) : null}
              </fieldset>
            ))}
          </div>

          <input type="hidden" name="steps" value={JSON.stringify(serializeSteps(steps))} />
          <ActionMessage state={state} />
          <div className="approval-dialog__actions">
            <Button type="button" variant="ghost" onClick={() => dialogRef.current?.close()}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating policy" : "Create policy"}
            </Button>
          </div>
        </form>
      </ApprovalDialogShell>
    </>
  );
}

function RequestDialog({ data }: { data: ApprovalWorkspaceData }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState(createApprovalRequestAction, initialState);

  useCloseApprovalDialogOnSuccess({ state, dialogRef });

  const activeDefinitions = data.definitions.filter((definition) => definition.status === "active");

  return (
    <>
      <Button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        disabled={!activeDefinitions.length}
      >
        <Plus size={16} /> Submit request
      </Button>
      <ApprovalDialogShell
        dialogRef={dialogRef}
        title="Submit approval request"
        description="The selected policy resolves concrete approvers and stores an immutable snapshot."
      >
        <form action={action} className="approval-request-form">
          <div className="approval-form-grid approval-form-grid--two">
            <label>
              <span>Approval policy</span>
              <select name="definitionId" required defaultValue="">
                <option value="" disabled>
                  Choose policy
                </option>
                {activeDefinitions.map((definition) => (
                  <option key={definition.id} value={definition.id}>
                    {definition.name} ({definition.sourceModule}.{definition.entityType})
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Request title</span>
              <input
                name="title"
                required
                maxLength={160}
                placeholder="Approve Q3 campaign expense"
              />
            </label>
            <label>
              <span>Entity ID</span>
              <input name="entityId" maxLength={200} placeholder="Optional record identifier" />
            </label>
            <label>
              <span>Internal record link</span>
              <input name="deepLink" maxLength={500} placeholder="/finance/invoices/..." />
            </label>
            <label>
              <span>Department</span>
              <select name="departmentId" defaultValue="">
                <option value="">No department condition</option>
                {data.departments.map((department) => (
                  <option value={department.id} key={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="approval-inline-fields">
              <label>
                <span>Amount</span>
                <input name="amount" type="number" min="0" step="0.01" placeholder="Optional" />
              </label>
              <label>
                <span>Currency</span>
                <input name="currency" maxLength={3} defaultValue="USD" />
              </label>
            </div>
            <label>
              <span>Request due date</span>
              <input name="dueAt" type="datetime-local" />
            </label>
            <label className="approval-form-grid__wide">
              <span>Immutable snapshot (JSON object)</span>
              <textarea
                name="snapshot"
                rows={7}
                required
                defaultValue={'{\n  "summary": "Values being approved"\n}'}
                spellCheck={false}
              />
              <small>Maximum 64 KB. Secrets and credentials must never be included.</small>
            </label>
          </div>
          <ActionMessage state={state} />
          <div className="approval-dialog__actions">
            <Button type="button" variant="ghost" onClick={() => dialogRef.current?.close()}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Submitting request" : "Submit request"}
            </Button>
          </div>
        </form>
      </ApprovalDialogShell>
    </>
  );
}

function DelegationDialog({ data }: { data: ApprovalWorkspaceData }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState(createApprovalDelegationAction, initialState);
  const now = useMemo(() => new Date(), []);
  const tomorrow = useMemo(() => new Date(now.getTime() + 24 * 60 * 60 * 1000), [now]);

  useCloseApprovalDialogOnSuccess({ state, dialogRef });

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => dialogRef.current?.showModal()}>
        <UserRoundCog size={16} /> Delegate approvals
      </Button>
      <ApprovalDialogShell
        dialogRef={dialogRef}
        title="Delegate approval work"
        description="Future assignments in the selected window are routed to another active member."
      >
        <form action={action} className="approval-request-form">
          <div className="approval-form-grid approval-form-grid--two">
            <label>
              <span>Delegate to</span>
              <select name="toMembershipId" required defaultValue="">
                <option value="" disabled>
                  Choose member
                </option>
                {data.members
                  .filter((member) => member.id !== data.currentMembershipId && member.canApprove)
                  .map((member) => (
                    <option value={member.id} key={member.id}>
                      {member.displayName} ({member.email})
                    </option>
                  ))}
              </select>
            </label>
            <label>
              <span>Source module</span>
              <input name="sourceModule" placeholder="Optional, for example finance" />
              <small>Leave empty to delegate approvals from every module.</small>
            </label>
            <label>
              <span>Starts</span>
              <input
                name="startsAt"
                type="datetime-local"
                defaultValue={toDateTimeLocalValue(now)}
                required
              />
            </label>
            <label>
              <span>Ends</span>
              <input
                name="endsAt"
                type="datetime-local"
                defaultValue={toDateTimeLocalValue(tomorrow)}
                required
              />
            </label>
            <label className="approval-form-grid__wide">
              <span>Reason</span>
              <textarea
                name="reason"
                rows={3}
                maxLength={500}
                placeholder="Annual leave coverage"
              />
            </label>
          </div>
          <ActionMessage state={state} />
          <div className="approval-dialog__actions">
            <Button type="button" variant="ghost" onClick={() => dialogRef.current?.close()}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating delegation" : "Create delegation"}
            </Button>
          </div>
        </form>
      </ApprovalDialogShell>
    </>
  );
}

function DecisionForm({
  step,
  canApprove,
  canReject,
}: {
  step: ApprovalRequestListItem["pendingSteps"][number];
  canApprove: boolean;
  canReject: boolean;
}) {
  const [state, action, pending] = useActionState(decideApprovalStepAction, initialState);
  return (
    <form action={action} className="approval-decision-form">
      <input type="hidden" name="requestStepId" value={step.id} />
      <label>
        <span>Decision comment {step.commentRequired ? "(required)" : ""}</span>
        <textarea name="comment" rows={2} maxLength={2000} required={step.commentRequired} />
      </label>
      <div className="approval-decision-form__actions">
        {canReject ? (
          <Button
            type="submit"
            name="decision"
            value="revision_requested"
            variant="secondary"
            disabled={pending}
          >
            <RotateCcw size={15} /> Request revision
          </Button>
        ) : null}
        {canReject ? (
          <Button
            type="submit"
            name="decision"
            value="rejected"
            variant="danger"
            disabled={pending}
          >
            Reject
          </Button>
        ) : null}
        {canApprove ? (
          <Button type="submit" name="decision" value="approved" disabled={pending}>
            <Check size={15} /> Approve
          </Button>
        ) : null}
      </div>
      <ActionMessage state={state} />
    </form>
  );
}

function ReassignForm({
  step,
  data,
}: {
  step: ApprovalRequestListItem["pendingSteps"][number];
  data: ApprovalWorkspaceData;
}) {
  const [state, action, pending] = useActionState(reassignApprovalStepAction, initialState);
  return (
    <details className="approval-inline-disclosure">
      <summary>
        Reassign step <ChevronDown size={14} />
      </summary>
      <form action={action} className="approval-reassign-form">
        <input type="hidden" name="requestStepId" value={step.id} />
        <label>
          <span>New approver</span>
          <select name="approverMembershipId" required defaultValue="">
            <option value="" disabled>
              Choose member
            </option>
            {eligibleApprovalMembers(data.members, step.approverMembershipId).map((member) => (
              <option value={member.id} key={member.id}>
                {member.displayName} ({member.email})
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Reason</span>
          <input name="comment" required minLength={3} maxLength={2000} />
        </label>
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {pending ? "Reassigning" : "Reassign step"}
        </Button>
        <ActionMessage state={state} />
      </form>
    </details>
  );
}

function CancelRequestForm({ requestId }: { requestId: string }) {
  const [state, action, pending] = useActionState(cancelApprovalRequestAction, initialState);
  return (
    <details className="approval-inline-disclosure approval-inline-disclosure--danger">
      <summary>
        Cancel request <ChevronDown size={14} />
      </summary>
      <form action={action} className="approval-reassign-form">
        <input type="hidden" name="requestId" value={requestId} />
        <label>
          <span>Cancellation reason</span>
          <input name="comment" required minLength={3} maxLength={2000} />
        </label>
        <Button type="submit" size="sm" variant="danger" disabled={pending}>
          {pending ? "Cancelling" : "Cancel request"}
        </Button>
        <ActionMessage state={state} />
      </form>
    </details>
  );
}

function RequestCard({
  request,
  data,
}: {
  request: ApprovalRequestListItem;
  data: ApprovalWorkspaceData;
}) {
  const isRequester = request.requesterMembershipId === data.currentMembershipId;
  return (
    <article className="approval-request-card" id={`approval-${request.id}`}>
      <header className="approval-request-card__header">
        <div>
          <div className="approval-request-card__meta">
            <StatusBadge tone={approvalStatusTone(request.status)}>
              {approvalStatusLabels[request.status]}
            </StatusBadge>
            <span>{request.definitionName}</span>
            <span>
              {request.sourceModule}.{request.entityType}
            </span>
          </div>
          <h2>{request.title}</h2>
          <p>
            Submitted by {request.requesterDisplayName} on {formatDate(request.submittedAt)}
          </p>
        </div>
        {request.deepLink ? (
          <Link className="text-link" href={request.deepLink}>
            Open record <ArrowUpRight size={15} />
          </Link>
        ) : null}
      </header>

      <div className="approval-request-card__facts">
        <span>
          <strong>Stage</strong>
          {request.currentStage ?? "Complete"}
        </span>
        <span>
          <strong>Amount</strong>
          {request.amount === null
            ? "Not set"
            : `${request.currency ?? ""} ${request.amount.toLocaleString()}`.trim()}
        </span>
        <span>
          <strong>Due</strong>
          {formatDate(request.dueAt)}
        </span>
        <span>
          <strong>Entity</strong>
          {request.entityId ?? "Not linked"}
        </span>
      </div>

      <div className="approval-request-card__body">
        <section>
          <h3>
            <ShieldCheck size={16} /> Approval path
          </h3>
          <ol className="approval-step-list">
            {request.pendingSteps.map((step) => (
              <li className={step.canAct ? "is-actionable" : ""} key={step.id}>
                <div className="approval-step-list__marker" aria-hidden="true">
                  {step.stageOrder}
                </div>
                <div className="approval-step-list__content">
                  <div className="approval-step-list__heading">
                    <div>
                      <strong>{step.stepName}</strong>
                      <span>{step.approverDisplayName}</span>
                    </div>
                    <StatusBadge tone={approvalStatusTone(step.status)}>
                      {approvalStepStatusLabels[step.status]}
                    </StatusBadge>
                  </div>
                  <div className="approval-step-list__details">
                    {step.delegatedFromDisplayName ? (
                      <span>Delegated from {step.delegatedFromDisplayName}</span>
                    ) : null}
                    {step.dueAt ? <span>Due {formatDate(step.dueAt)}</span> : null}
                    {step.reminderCount ? (
                      <span>
                        {step.reminderCount} reminder{step.reminderCount === 1 ? "" : "s"}
                      </span>
                    ) : null}
                    {step.escalatedAt ? (
                      <span>Escalated {formatDate(step.escalatedAt)}</span>
                    ) : null}
                  </div>
                  {step.canAct ? (
                    <DecisionForm
                      step={step}
                      canApprove={data.capabilities.canApprove}
                      canReject={data.capabilities.canReject}
                    />
                  ) : null}
                  {step.canReassign ? <ReassignForm step={step} data={data} /> : null}
                </div>
              </li>
            ))}
          </ol>
        </section>

        <aside>
          <details className="approval-snapshot" open>
            <summary>
              <FileCheck2 size={15} /> Approved snapshot
            </summary>
            <dl>
              {Object.entries(request.snapshot)
                .slice(0, 20)
                .map(([key, value]) => (
                  <div key={key}>
                    <dt>{key.replaceAll("_", " ")}</dt>
                    <dd>
                      {typeof value === "string" ||
                      typeof value === "number" ||
                      typeof value === "boolean"
                        ? String(value)
                        : JSON.stringify(value)}
                    </dd>
                  </div>
                ))}
            </dl>
          </details>
          <details className="approval-history">
            <summary>
              <History size={15} /> Decision history ({request.actions.length})
            </summary>
            <ol>
              {request.actions.map((action) => (
                <li key={action.id}>
                  <strong>{action.action.replaceAll("_", " ")}</strong>
                  <span>
                    {action.actorDisplayName} · {formatDate(action.createdAt)}
                  </span>
                  {action.comment ? <p>{action.comment}</p> : null}
                </li>
              ))}
            </ol>
          </details>
          {isRequester && request.status === "pending" ? (
            <CancelRequestForm requestId={request.id} />
          ) : null}
        </aside>
      </div>
    </article>
  );
}

function PolicyList({ data }: { data: ApprovalWorkspaceData }) {
  return (
    <section className="approval-policy-list" aria-labelledby="approval-policies-title">
      <div className="approval-section-heading">
        <div>
          <h2 id="approval-policies-title">Approval policies</h2>
          <p>Reusable definitions for module records and controlled transactions.</p>
        </div>
      </div>
      {data.definitions.length === 0 ? (
        <div className="approval-empty">
          <ShieldCheck size={22} />
          <h3>No approval policies</h3>
          <p>Create the first policy before submitting approval work.</p>
        </div>
      ) : (
        <div className="approval-policy-table">
          {data.definitions.map((definition) => (
            <details key={definition.id}>
              <summary>
                <div>
                  <strong>{definition.name}</strong>
                  <span>
                    {definition.key} · {definition.sourceModule}.{definition.entityType}
                  </span>
                </div>
                <div>
                  <StatusBadge tone={definition.status === "active" ? "success" : "neutral"}>
                    {definition.status}
                  </StatusBadge>
                  <span>
                    {definition.steps.length} step{definition.steps.length === 1 ? "" : "s"}
                  </span>
                  <ChevronDown size={15} />
                </div>
              </summary>
              <div className="approval-policy-table__body">
                {definition.description ? <p>{definition.description}</p> : null}
                <ol>
                  {definition.steps.map((step) => (
                    <li key={step.id}>
                      <span className="approval-policy-stage">Stage {step.stageOrder}</span>
                      <div>
                        <strong>{step.name}</strong>
                        <span>
                          {approvalSelectorLabels[step.selectorType]}
                          {step.selectorDisplayName ? `: ${step.selectorDisplayName}` : ""}
                        </span>
                        <small>
                          {approvalDecisionModeLabels[step.decisionMode]}
                          {step.commentRequired ? " · Comment required" : ""}
                        </small>
                      </div>
                    </li>
                  ))}
                </ol>
                {data.capabilities.canManageDefinitions && definition.status === "active" ? (
                  <RetirePolicyForm definitionId={definition.id} />
                ) : null}
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}

function RetirePolicyForm({ definitionId }: { definitionId: string }) {
  const [state, action, pending] = useActionState(retireApprovalDefinitionAction, initialState);
  return (
    <form action={action} className="approval-retire-form">
      <input type="hidden" name="definitionId" value={definitionId} />
      <Button type="submit" variant="danger" size="sm" disabled={pending}>
        {pending ? "Retiring" : "Retire policy"}
      </Button>
      <ActionMessage state={state} />
    </form>
  );
}

function DelegationList({ data }: { data: ApprovalWorkspaceData }) {
  return (
    <section className="approval-delegation-list" aria-labelledby="approval-delegations-title">
      <div className="approval-section-heading">
        <div>
          <h2 id="approval-delegations-title">Delegations</h2>
          <p>Time-bounded routing for future approval assignments.</p>
        </div>
      </div>
      {data.delegations.length === 0 ? (
        <p className="approval-empty-line">No active or recent delegations.</p>
      ) : (
        <div className="approval-delegation-rows">
          {data.delegations.map((delegation) => (
            <div key={delegation.id}>
              <div>
                <strong>
                  {delegation.fromDisplayName} → {delegation.toDisplayName}
                </strong>
                <span>
                  {delegation.sourceModule ?? "All modules"} · {formatDate(delegation.startsAt)} to{" "}
                  {formatDate(delegation.endsAt)}
                </span>
                {delegation.reason ? <small>{delegation.reason}</small> : null}
              </div>
              <div>
                <StatusBadge tone={delegation.status === "active" ? "success" : "neutral"}>
                  {delegation.status}
                </StatusBadge>
                {delegation.canRevoke && delegation.status === "active" ? (
                  <RevokeDelegationForm delegationId={delegation.id} />
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function RevokeDelegationForm({ delegationId }: { delegationId: string }) {
  const [state, action, pending] = useActionState(revokeApprovalDelegationAction, initialState);
  return (
    <form action={action} className="approval-revoke-form">
      <input type="hidden" name="delegationId" value={delegationId} />
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        {pending ? "Revoking" : "Revoke"}
      </Button>
      <ActionMessage state={state} />
    </form>
  );
}

export function ApprovalWorkspace({ data }: { data: ApprovalWorkspaceData }) {
  return (
    <div className="approval-workspace">
      <SummaryStrip data={data} />

      <section className="approval-toolbar" aria-label="Approval controls">
        <form className="approval-filter-form">
          <label>
            <span>View</span>
            <select name="view" defaultValue={data.filters.view}>
              <option value="inbox">Assigned to me</option>
              <option value="submitted">Submitted by me</option>
              {data.capabilities.canViewAllRequests ? (
                <option value="all">All visible requests</option>
              ) : null}
            </select>
          </label>
          <label>
            <span>Status</span>
            <select name="status" defaultValue={data.filters.status}>
              <option value="all">All statuses</option>
              {Object.entries(approvalStatusLabels).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="approval-filter-form__search">
            <span>Search</span>
            <input
              name="q"
              defaultValue={data.filters.q}
              maxLength={120}
              placeholder="Title, policy, entity, or requester"
            />
          </label>
          <Button type="submit" variant="secondary">
            Apply filters
          </Button>
          <Link className="button button--ghost button--md" href="/approvals">
            Reset
          </Link>
        </form>
        <div className="approval-toolbar__actions">
          {data.capabilities.canManageDelegations ? <DelegationDialog data={data} /> : null}
          {data.capabilities.canManageDefinitions ? <PolicyDialog data={data} /> : null}
          {data.capabilities.canCreateRequest ? <RequestDialog data={data} /> : null}
        </div>
      </section>

      <section className="approval-request-list" aria-live="polite">
        <div className="approval-section-heading">
          <div>
            <h2>Approval requests</h2>
            <p>
              {data.pagination.totalItems} matching request
              {data.pagination.totalItems === 1 ? "" : "s"}
            </p>
          </div>
        </div>
        {data.requests.length === 0 ? (
          <div className="approval-empty">
            <Clock3 size={24} />
            <h3>No matching approvals</h3>
            <p>Change the filters or submit a request using an active policy.</p>
          </div>
        ) : (
          data.requests.map((request) => (
            <RequestCard request={request} data={data} key={request.id} />
          ))
        )}

        {data.pagination.totalPages > 1 ? (
          <nav className="approval-pagination" aria-label="Approval pages">
            <Link
              className={`button button--secondary button--sm${data.pagination.page <= 1 ? " is-disabled" : ""}`}
              aria-disabled={data.pagination.page <= 1}
              href={
                data.pagination.page <= 1
                  ? "#"
                  : `/approvals?view=${data.filters.view}&status=${data.filters.status}&q=${encodeURIComponent(data.filters.q)}&page=${data.pagination.page - 1}`
              }
            >
              Previous
            </Link>
            <span>
              Page {data.pagination.page} of {data.pagination.totalPages}
            </span>
            <Link
              className={`button button--secondary button--sm${data.pagination.page >= data.pagination.totalPages ? " is-disabled" : ""}`}
              aria-disabled={data.pagination.page >= data.pagination.totalPages}
              href={
                data.pagination.page >= data.pagination.totalPages
                  ? "#"
                  : `/approvals?view=${data.filters.view}&status=${data.filters.status}&q=${encodeURIComponent(data.filters.q)}&page=${data.pagination.page + 1}`
              }
            >
              Next
            </Link>
          </nav>
        ) : null}
      </section>

      <PolicyList data={data} />
      {data.capabilities.canManageDelegations ? <DelegationList data={data} /> : null}
    </div>
  );
}
