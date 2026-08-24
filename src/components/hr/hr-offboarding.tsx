"use client";

import { useActionState } from "react";
import {
  Archive,
  BriefcaseBusiness,
  CheckCircle2,
  ClipboardCheck,
  RefreshCw,
  ShieldOff,
  UserMinus,
} from "lucide-react";

import { HrActionMessage } from "@/components/hr/hr-action-message";
import { toDateTimeLocalValue } from "@/lib/date-time-local";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  cancelHrOffboardingPlanAction,
  completeHrOffboardingPlanAction,
  createHrOffboardingPlanAction,
  reassignHrOffboardingWorkAction,
  refreshHrOffboardingEvidenceAction,
  submitHrResignationAction,
  suspendHrOffboardingAccountAction,
  updateHrOffboardingItemAction,
  updateHrOffboardingPlanAction,
} from "@/modules/hr/actions/offboarding";
import {
  hrOffboardingItemDefinitions,
  hrOffboardingItemStatuses,
  hrSeparationTypes,
  humanizeOffboardingValue,
} from "@/modules/hr/offboarding";
import type { HrActionState } from "@/modules/hr/schemas/hr";
import type {
  HrOffboardingItemSummary,
  HrOffboardingPlanSummary,
} from "@/modules/hr/server/offboarding";
import type { HrWorkspaceData } from "@/modules/hr/server/hr";

const initialState: HrActionState = { status: "idle" };
const derivedKeys = new Set<string>();
for (const item of hrOffboardingItemDefinitions) {
  if (item.derived) derivedKeys.add(item.key);
}
derivedKeys.add("final_clearance");

function planTone(
  status: HrOffboardingPlanSummary["status"],
): "neutral" | "warning" | "success" | "error" {
  if (status === "completed" || status === "ready") return "success";
  if (status === "in_progress") return "warning";
  if (status === "cancelled") return "error";
  return "neutral";
}

function CreateOffboardingPlan({ data }: { data: HrWorkspaceData }) {
  const [state, action, pending] = useActionState(createHrOffboardingPlanAction, initialState);
  if (!data.offboarding.capabilities.canManage) return null;

  const activeMemberships = new Set<string>();
  for (const plan of data.offboarding.plans) {
    if (plan.status !== "completed" && plan.status !== "cancelled") {
      activeMemberships.add(plan.membershipId);
    }
  }
  const candidates = data.employees.filter(
    (employee) =>
      !activeMemberships.has(employee.membershipId) &&
      employee.lifecycleStatus !== "archived" &&
      employee.membershipStatus !== "deactivated",
  );

  return (
    <details className="hr-create-panel">
      <summary>
        <UserMinus size={16} aria-hidden="true" /> Create offboarding plan
      </summary>
      <form className="hr-offboarding-create" action={action}>
        <label className="field">
          <span>Employee</span>
          <select name="membershipId" required defaultValue="">
            <option value="" disabled>
              Select employee
            </option>
            {candidates.map((employee) => (
              <option key={employee.membershipId} value={employee.membershipId}>
                {employee.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Separation type</span>
          <select name="separationType" defaultValue="resignation">
            {hrSeparationTypes.map((type) => (
              <option key={type} value={type}>
                {humanizeOffboardingValue(type)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Notice date</span>
          <input name="noticeDate" type="date" required />
        </label>
        <label className="field">
          <span>Last working date</span>
          <input name="lastWorkingDate" type="date" required />
        </label>
        <label className="field">
          <span>Replacement employee</span>
          <select name="replacementMembershipId" defaultValue="">
            <option value="">Assign later</option>
            {data.managers.map((member) => (
              <option key={member.membershipId} value={member.membershipId}>
                {member.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Exit interview</span>
          <input name="exitInterviewAt" type="datetime-local" />
        </label>
        <label className="field hr-offboarding-create__wide">
          <span>Separation reason</span>
          <textarea name="reason" maxLength={2000} />
        </label>
        <label className="field hr-offboarding-create__wide">
          <span>Exit interview details</span>
          <textarea name="exitInterviewDetails" maxLength={1000} />
        </label>
        <label className="field hr-offboarding-create__wide">
          <span>Internal notes</span>
          <textarea name="notes" maxLength={2000} />
        </label>
        <Button type="submit" disabled={pending || candidates.length === 0}>
          {pending ? "Creating" : "Create plan"}
        </Button>
        {candidates.length === 0 ? <small>No eligible employee is available.</small> : null}
        <HrActionMessage state={state} />
      </form>
    </details>
  );
}

function SubmitOwnResignation({ data }: { data: HrWorkspaceData }) {
  const [state, action, pending] = useActionState(submitHrResignationAction, initialState);
  if (!data.offboarding.capabilities.canCreateOwn) return null;
  const selfHasActivePlan = data.offboarding.plans.some(
    (plan) => plan.isSelf && plan.status !== "completed" && plan.status !== "cancelled",
  );
  if (selfHasActivePlan) return null;

  return (
    <details className="hr-create-panel">
      <summary>
        <UserMinus size={16} aria-hidden="true" /> Submit resignation
      </summary>
      <form className="hr-offboarding-resignation" action={action}>
        <label className="field">
          <span>Notice date</span>
          <input name="noticeDate" type="date" required />
        </label>
        <label className="field">
          <span>Proposed last working date</span>
          <input name="lastWorkingDate" type="date" required />
        </label>
        <label className="field hr-offboarding-resignation__reason">
          <span>Reason</span>
          <textarea name="reason" maxLength={2000} />
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? "Submitting" : "Submit resignation"}
        </Button>
        <HrActionMessage state={state} />
      </form>
    </details>
  );
}

function ChecklistItem({
  item,
  plan,
  data,
}: {
  item: HrOffboardingItemSummary;
  plan: HrOffboardingPlanSummary;
  data: HrWorkspaceData;
}) {
  const [state, action, pending] = useActionState(updateHrOffboardingItemAction, initialState);
  const derived = derivedKeys.has(item.key);
  const closed = plan.status === "completed" || plan.status === "cancelled";

  return (
    <li className="hr-offboarding-item">
      <div className="hr-offboarding-item__heading">
        <div>
          <strong>{item.label}</strong>
          <small>
            {item.assignedName ? `Assigned to ${item.assignedName}` : "Unassigned"}
            {item.dueDate ? ` · Due ${item.dueDate}` : ""}
          </small>
        </div>
        <StatusBadge
          tone={
            item.status === "complete"
              ? "success"
              : item.status === "blocked"
                ? "error"
                : item.status === "in_progress"
                  ? "warning"
                  : "neutral"
          }
        >
          {humanizeOffboardingValue(item.status)}
        </StatusBadge>
      </div>
      {item.notes ? <p>{item.notes}</p> : null}
      {data.offboarding.capabilities.canManage && !derived && !closed ? (
        <form className="hr-offboarding-item__form" action={action}>
          <input type="hidden" name="itemId" value={item.id} />
          <label className="field">
            <span>Status</span>
            <select name="status" defaultValue={item.status}>
              {hrOffboardingItemStatuses.map((status) => (
                <option key={status} value={status}>
                  {humanizeOffboardingValue(status)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Owner</span>
            <select name="assignedMembershipId" defaultValue={item.assignedMembershipId ?? ""}>
              <option value="">Unassigned</option>
              {data.managers.map((member) => (
                <option key={member.membershipId} value={member.membershipId}>
                  {member.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Due date</span>
            <input name="dueDate" type="date" defaultValue={item.dueDate ?? ""} />
          </label>
          <label className="field hr-offboarding-item__notes">
            <span>Evidence or notes</span>
            <input name="notes" maxLength={1000} defaultValue={item.notes ?? ""} />
          </label>
          <Button type="submit" size="sm" variant="secondary" disabled={pending}>
            {pending ? "Saving" : "Save item"}
          </Button>
          <HrActionMessage state={state} />
        </form>
      ) : null}
    </li>
  );
}

function OffboardingPlanCard({
  plan,
  data,
}: {
  plan: HrOffboardingPlanSummary;
  data: HrWorkspaceData;
}) {
  const [planState, planAction, planPending] = useActionState(
    updateHrOffboardingPlanAction,
    initialState,
  );
  const [reassignState, reassignAction, reassignPending] = useActionState(
    reassignHrOffboardingWorkAction,
    initialState,
  );
  const [refreshState, refreshAction, refreshPending] = useActionState(
    refreshHrOffboardingEvidenceAction,
    initialState,
  );
  const [suspendState, suspendAction, suspendPending] = useActionState(
    suspendHrOffboardingAccountAction,
    initialState,
  );
  const [completeState, completeAction, completePending] = useActionState(
    completeHrOffboardingPlanAction,
    initialState,
  );
  const [cancelState, cancelAction, cancelPending] = useActionState(
    cancelHrOffboardingPlanAction,
    initialState,
  );
  const closed = plan.status === "completed" || plan.status === "cancelled";
  const replacements = data.managers.filter((member) => member.membershipId !== plan.membershipId);

  return (
    <article className="hr-offboarding-card">
      <header className="hr-offboarding-card__header">
        <div>
          <p className="eyebrow">Cycle {plan.cycleNumber}</p>
          <h3>{plan.employeeName}</h3>
          <p>
            {humanizeOffboardingValue(plan.separationType)} · Last working date{" "}
            {plan.lastWorkingDate}
          </p>
        </div>
        <StatusBadge tone={planTone(plan.status)}>
          {humanizeOffboardingValue(plan.status)}
        </StatusBadge>
      </header>

      <div className="hr-offboarding-progress">
        <div>
          <strong>{plan.progress.percent}%</strong>
          <span>
            {plan.progress.completed} of {plan.progress.total} cleared
          </span>
        </div>
        <progress
          value={plan.progress.completed}
          max={plan.progress.total || 1}
          aria-label={`${plan.progress.percent}% complete`}
        />
      </div>

      <dl className="hr-offboarding-metrics">
        <div>
          <dt>Active projects</dt>
          <dd>{plan.activeProjectCount}</dd>
        </div>
        <div>
          <dt>Open tasks</dt>
          <dd>{plan.openTaskCount}</dd>
        </div>
        <div>
          <dt>Unsettled expenses</dt>
          <dd>{plan.outstandingExpenseCount}</dd>
        </div>
        <div>
          <dt>Exit letters</dt>
          <dd>{plan.generatedExitDocumentCount}/2</dd>
        </div>
      </dl>

      {plan.reason ? <p className="hr-offboarding-card__reason">{plan.reason}</p> : null}

      {data.offboarding.capabilities.canManage && !closed ? (
        <details className="hr-offboarding-card__details">
          <summary>Edit separation schedule</summary>
          <form className="hr-offboarding-plan-form" action={planAction}>
            <input type="hidden" name="planId" value={plan.id} />
            <input type="hidden" name="membershipId" value={plan.membershipId} />
            <label className="field">
              <span>Separation type</span>
              <select name="separationType" defaultValue={plan.separationType}>
                {hrSeparationTypes.map((type) => (
                  <option key={type} value={type}>
                    {humanizeOffboardingValue(type)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Notice date</span>
              <input name="noticeDate" type="date" defaultValue={plan.noticeDate} required />
            </label>
            <label className="field">
              <span>Last working date</span>
              <input
                name="lastWorkingDate"
                type="date"
                defaultValue={plan.lastWorkingDate}
                required
              />
            </label>
            <label className="field">
              <span>Replacement</span>
              <select
                name="replacementMembershipId"
                defaultValue={plan.replacementMembershipId ?? ""}
              >
                <option value="">Assign later</option>
                {replacements.map((member) => (
                  <option key={member.membershipId} value={member.membershipId}>
                    {member.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Exit interview</span>
              <input
                name="exitInterviewAt"
                type="datetime-local"
                defaultValue={toDateTimeLocalValue(plan.exitInterviewAt)}
              />
            </label>
            <label className="field hr-offboarding-plan-form__wide">
              <span>Reason</span>
              <textarea name="reason" maxLength={2000} defaultValue={plan.reason ?? ""} />
            </label>
            <label className="field hr-offboarding-plan-form__wide">
              <span>Exit interview details</span>
              <textarea
                name="exitInterviewDetails"
                maxLength={1000}
                defaultValue={plan.exitInterviewDetails ?? ""}
              />
            </label>
            <label className="field hr-offboarding-plan-form__wide">
              <span>Internal notes</span>
              <textarea name="notes" maxLength={2000} defaultValue={plan.notes ?? ""} />
            </label>
            <Button type="submit" size="sm" disabled={planPending}>
              {planPending ? "Saving" : "Save schedule"}
            </Button>
            <HrActionMessage state={planState} />
          </form>
        </details>
      ) : null}

      <ol className="hr-offboarding-checklist">
        {plan.items.map((item) => (
          <ChecklistItem key={item.id} item={item} plan={plan} data={data} />
        ))}
      </ol>

      {data.offboarding.capabilities.canManage && !closed ? (
        <div className="hr-offboarding-actions">
          <form className="hr-offboarding-reassign" action={reassignAction}>
            <input type="hidden" name="planId" value={plan.id} />
            <label className="field">
              <span>Reassign projects and open tasks</span>
              <select
                name="replacementMembershipId"
                defaultValue={plan.replacementMembershipId ?? ""}
                required
              >
                <option value="" disabled>
                  Select replacement
                </option>
                {replacements.map((member) => (
                  <option key={member.membershipId} value={member.membershipId}>
                    {member.displayName}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" size="sm" variant="secondary" disabled={reassignPending}>
              <BriefcaseBusiness size={15} aria-hidden="true" />
              {reassignPending ? "Reassigning" : "Reassign work"}
            </Button>
            <HrActionMessage state={reassignState} />
          </form>
          <div className="hr-offboarding-actions__buttons">
            <form action={refreshAction}>
              <input type="hidden" name="planId" value={plan.id} />
              <Button type="submit" size="sm" variant="secondary" disabled={refreshPending}>
                <RefreshCw size={15} aria-hidden="true" />
                {refreshPending ? "Refreshing" : "Refresh evidence"}
              </Button>
            </form>
            <form action={suspendAction}>
              <input type="hidden" name="planId" value={plan.id} />
              <Button
                type="submit"
                size="sm"
                variant="secondary"
                disabled={suspendPending || plan.membershipStatus !== "active"}
              >
                <ShieldOff size={15} aria-hidden="true" />
                {suspendPending ? "Suspending" : "Suspend account"}
              </Button>
            </form>
            <form action={completeAction}>
              <input type="hidden" name="planId" value={plan.id} />
              <Button type="submit" size="sm" disabled={completePending || plan.status !== "ready"}>
                <Archive size={15} aria-hidden="true" />
                {completePending ? "Completing" : "Final clearance"}
              </Button>
            </form>
            <form action={cancelAction}>
              <input type="hidden" name="planId" value={plan.id} />
              <Button type="submit" size="sm" variant="danger" disabled={cancelPending}>
                {cancelPending ? "Cancelling" : "Cancel plan"}
              </Button>
            </form>
          </div>
          <HrActionMessage state={refreshState} />
          <HrActionMessage state={suspendState} />
          <HrActionMessage state={completeState} />
          <HrActionMessage state={cancelState} />
        </div>
      ) : null}
    </article>
  );
}

export function HrOffboarding({ data }: { data: HrWorkspaceData }) {
  if (!data.offboarding.capabilities.canView && !data.offboarding.capabilities.canCreateOwn)
    return null;

  return (
    <section className="hr-section" aria-labelledby="hr-offboarding-heading">
      <header className="hr-section__header">
        <div>
          <p className="eyebrow">Employee lifecycle</p>
          <h2 id="hr-offboarding-heading">Offboarding</h2>
          <p>
            Coordinate work transfer, access removal, expense settlement, exit documents, final
            clearance, and immutable employee archival.
          </p>
        </div>
      </header>

      <div className="hr-offboarding-summary" aria-label="Offboarding summary">
        <article>
          <ClipboardCheck aria-hidden="true" />
          <strong>{data.offboarding.summary.inProgress}</strong>
          <span>In progress</span>
        </article>
        <article>
          <CheckCircle2 aria-hidden="true" />
          <strong>{data.offboarding.summary.ready}</strong>
          <span>Ready for clearance</span>
        </article>
        <article>
          <Archive aria-hidden="true" />
          <strong>{data.offboarding.summary.completed}</strong>
          <span>Completed</span>
        </article>
        <article>
          <UserMinus aria-hidden="true" />
          <strong>{data.offboarding.summary.dueWithinSevenDays}</strong>
          <span>Leaving within 7 days</span>
        </article>
      </div>

      <div className="hr-offboarding-create-panels">
        <CreateOffboardingPlan data={data} />
        <SubmitOwnResignation data={data} />
      </div>

      <div className="hr-offboarding-grid">
        {data.offboarding.plans.map((plan) => (
          <OffboardingPlanCard key={plan.id} plan={plan} data={data} />
        ))}
      </div>
      {data.offboarding.plans.length === 0 ? (
        <p className="empty-state">No offboarding plans are visible in your scope.</p>
      ) : null}
    </section>
  );
}
