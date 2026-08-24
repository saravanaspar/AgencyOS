"use client";

import { useActionState, useMemo } from "react";
import {
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  RefreshCw,
  UserRoundPlus,
} from "lucide-react";

import { HrActionMessage } from "@/components/hr/hr-action-message";
import { toDateTimeLocalValue } from "@/lib/date-time-local";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  completeHrOnboardingOwnItemAction,
  cancelHrOnboardingPlanAction,
  createHrOnboardingPlanAction,
  refreshHrOnboardingEvidenceAction,
  updateHrOnboardingItemAction,
  updateHrOnboardingScheduleAction,
} from "@/modules/hr/actions/onboarding";
import {
  hrOnboardingItemDefinitions,
  hrOnboardingItemStatuses,
  humanizeOnboardingStatus,
} from "@/modules/hr/onboarding";
import type { HrActionState } from "@/modules/hr/schemas/hr";
import type {
  HrOnboardingItemSummary,
  HrOnboardingPlanSummary,
} from "@/modules/hr/server/onboarding";
import type { HrWorkspaceData } from "@/modules/hr/server/hr";

const initialState: HrActionState = { status: "idle" };
const derivedKeys = new Set<string>();
for (const item of hrOnboardingItemDefinitions) {
  if (item.derived) derivedKeys.add(item.key);
}

function planTone(
  status: HrOnboardingPlanSummary["status"],
): "neutral" | "warning" | "success" | "error" {
  if (status === "completed" || status === "ready") return "success";
  if (status === "in_progress") return "warning";
  if (status === "cancelled") return "error";
  return "neutral";
}

function CreateOnboardingPlan({ data }: { data: HrWorkspaceData }) {
  const [state, action, pending] = useActionState(createHrOnboardingPlanAction, initialState);
  const existingMemberships = new Set<string>();
  for (const plan of data.onboarding.plans) {
    if (plan.status !== "completed" && plan.status !== "cancelled") {
      existingMemberships.add(plan.membershipId);
    }
  }
  const candidates = data.employees.filter(
    (employee) =>
      !existingMemberships.has(employee.membershipId) && employee.lifecycleStatus !== "archived",
  );
  if (!data.onboarding.capabilities.canManage) return null;

  return (
    <details className="hr-create-panel">
      <summary>
        <UserRoundPlus size={16} aria-hidden="true" /> Create onboarding plan
      </summary>
      <form className="hr-onboarding-create" action={action}>
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
          <span>Target start date</span>
          <input name="targetStartDate" type="date" required />
        </label>
        <label className="field">
          <span>First-day meeting</span>
          <input name="firstDayMeetingAt" type="datetime-local" />
        </label>
        <label className="field">
          <span>Meeting details</span>
          <input name="firstDayMeetingDetails" maxLength={500} placeholder="Room or meeting link" />
        </label>
        <label className="field">
          <span>Probation review date</span>
          <input name="probationReviewDate" type="date" />
        </label>
        <label className="field hr-onboarding-create__notes">
          <span>Internal notes</span>
          <textarea name="notes" maxLength={2000} />
        </label>
        <Button type="submit" disabled={pending || candidates.length === 0}>
          {pending ? "Creating" : "Create plan"}
        </Button>
        {candidates.length === 0 ? <small>Every visible employee already has a plan.</small> : null}
        <HrActionMessage state={state} />
      </form>
    </details>
  );
}

function OnboardingSchedule({ plan }: { plan: HrOnboardingPlanSummary }) {
  const [state, action, pending] = useActionState(updateHrOnboardingScheduleAction, initialState);
  return (
    <form className="hr-onboarding-schedule" action={action}>
      <input type="hidden" name="planId" value={plan.id} />
      <input type="hidden" name="membershipId" value={plan.membershipId} />
      <label className="field">
        <span>Target start</span>
        <input name="targetStartDate" type="date" required defaultValue={plan.targetStartDate} />
      </label>
      <label className="field">
        <span>First-day meeting</span>
        <input
          name="firstDayMeetingAt"
          type="datetime-local"
          defaultValue={toDateTimeLocalValue(plan.firstDayMeetingAt)}
        />
      </label>
      <label className="field">
        <span>Meeting details</span>
        <input
          name="firstDayMeetingDetails"
          maxLength={500}
          defaultValue={plan.firstDayMeetingDetails ?? ""}
        />
      </label>
      <label className="field">
        <span>Probation review</span>
        <input
          name="probationReviewDate"
          type="date"
          defaultValue={plan.probationReviewDate ?? ""}
        />
      </label>
      <label className="field hr-onboarding-schedule__notes">
        <span>Internal notes</span>
        <textarea name="notes" maxLength={2000} defaultValue={plan.notes ?? ""} />
      </label>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving" : "Save schedule"}
      </Button>
      <HrActionMessage state={state} />
    </form>
  );
}

function EmployeeOnboardingAcknowledgement({ item }: { item: HrOnboardingItemSummary }) {
  const [state, action, pending] = useActionState(completeHrOnboardingOwnItemAction, initialState);
  if (item.status === "complete") return null;
  return (
    <form action={action} className="hr-onboarding-policy-action">
      <input type="hidden" name="itemId" value={item.id} />
      <Button type="submit" size="sm" disabled={pending}>
        {pending
          ? "Recording"
          : item.key === "offer_accepted"
            ? "Accept offer"
            : "Acknowledge policies"}
      </Button>
      <HrActionMessage state={state} />
    </form>
  );
}

function OnboardingItemEditor({
  item,
  data,
  targetMembershipId,
}: {
  item: HrOnboardingItemSummary;
  data: HrWorkspaceData;
  targetMembershipId: string;
}) {
  const [state, action, pending] = useActionState(updateHrOnboardingItemAction, initialState);
  const options = useMemo(() => {
    const seen = new Set<string>();
    const values: Array<{ membershipId: string; displayName: string }> = [];
    const target = data.employees.find((employee) => employee.membershipId === targetMembershipId);
    if (target) {
      seen.add(target.membershipId);
      values.push({ membershipId: target.membershipId, displayName: target.displayName });
    }
    for (const manager of data.managers) {
      if (seen.has(manager.membershipId)) continue;
      seen.add(manager.membershipId);
      values.push(manager);
    }
    return values;
  }, [data.employees, data.managers, targetMembershipId]);

  return (
    <form className="hr-onboarding-item__editor" action={action}>
      <input type="hidden" name="itemId" value={item.id} />
      <label className="field">
        <span>Status</span>
        <select name="status" defaultValue={item.status}>
          {hrOnboardingItemStatuses.map((status) => (
            <option
              key={status}
              value={status}
              disabled={
                derivedKeys.has(item.key) && (status === "complete" || status === "not_applicable")
              }
            >
              {humanizeOnboardingStatus(status)}
            </option>
          ))}
        </select>
        {derivedKeys.has(item.key) ? <small>Completion comes from its source record.</small> : null}
      </label>
      <label className="field">
        <span>Assignee</span>
        <select name="assignedMembershipId" defaultValue={item.assignedMembershipId ?? ""}>
          <option value="">Unassigned</option>
          {options.map((option) => (
            <option key={option.membershipId} value={option.membershipId}>
              {option.displayName}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Due date</span>
        <input name="dueDate" type="date" defaultValue={item.dueDate ?? ""} />
      </label>
      <label className="field hr-onboarding-item__notes">
        <span>Notes</span>
        <input name="notes" maxLength={1000} defaultValue={item.notes ?? ""} />
      </label>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving" : "Save item"}
      </Button>
      <HrActionMessage state={state} />
    </form>
  );
}

function OnboardingPlanCard({
  plan,
  data,
}: {
  plan: HrOnboardingPlanSummary;
  data: HrWorkspaceData;
}) {
  const [refreshState, refreshAction, refreshPending] = useActionState(
    refreshHrOnboardingEvidenceAction,
    initialState,
  );
  const [cancelState, cancelAction, cancelPending] = useActionState(
    cancelHrOnboardingPlanAction,
    initialState,
  );
  const canManage = data.onboarding.capabilities.canManage && plan.status !== "cancelled";

  return (
    <article className="hr-onboarding-plan">
      <header className="hr-onboarding-plan__header">
        <div>
          <strong>{plan.employeeName}</strong>
          <span>
            {plan.employeeNumber ?? "No employee ID"} · cycle {plan.cycleNumber} · starts{" "}
            {plan.targetStartDate}
          </span>
        </div>
        <StatusBadge tone={planTone(plan.status)}>
          {humanizeOnboardingStatus(plan.status)}
        </StatusBadge>
      </header>
      <div className="hr-onboarding-progress" aria-label={`${plan.progress.percent}% complete`}>
        <div style={{ width: `${plan.progress.percent}%` }} />
      </div>
      <p className="hr-onboarding-plan__progress-copy">
        {plan.progress.completed} of {plan.progress.total} items complete · {plan.progress.percent}%
      </p>
      <dl className="hr-onboarding-plan__schedule">
        <div>
          <dt>First-day meeting</dt>
          <dd>
            {plan.firstDayMeetingAt
              ? new Date(plan.firstDayMeetingAt).toLocaleString("en", { timeZone: "UTC" })
              : "Not scheduled"}
          </dd>
        </div>
        <div>
          <dt>Probation review</dt>
          <dd>{plan.probationReviewDate ?? "Not scheduled"}</dd>
        </div>
      </dl>

      {canManage ? (
        <details className="hr-onboarding-plan__schedule-editor">
          <summary>
            <CalendarClock size={15} aria-hidden="true" /> Edit schedule
          </summary>
          <OnboardingSchedule plan={plan} />
        </details>
      ) : null}

      <ol className="hr-onboarding-items">
        {plan.items.map((item) => (
          <li key={item.id} className="hr-onboarding-item">
            <div className="hr-onboarding-item__summary">
              <CheckCircle2 size={17} aria-hidden="true" />
              <div>
                <strong>{item.label}</strong>
                <span>
                  {humanizeOnboardingStatus(item.status)}
                  {item.assignedName ? ` · ${item.assignedName}` : ""}
                  {item.dueDate ? ` · due ${item.dueDate}` : ""}
                </span>
              </div>
              {item.completionSource ? <small>{item.completionSource}</small> : null}
            </div>
            {canManage ? (
              <OnboardingItemEditor
                item={item}
                data={data}
                targetMembershipId={plan.membershipId}
              />
            ) : plan.isSelf &&
              (item.key === "offer_accepted" || item.key === "policies_acknowledged") &&
              data.onboarding.capabilities.canUpdateOwn ? (
              <EmployeeOnboardingAcknowledgement item={item} />
            ) : null}
          </li>
        ))}
      </ol>

      {canManage ? (
        <div className="hr-onboarding-plan__actions">
          <form action={refreshAction}>
            <input type="hidden" name="planId" value={plan.id} />
            <Button type="submit" size="sm" variant="secondary" disabled={refreshPending}>
              <RefreshCw size={14} aria-hidden="true" />{" "}
              {refreshPending ? "Refreshing" : "Refresh evidence"}
            </Button>
          </form>
          {plan.status !== "completed" ? (
            <form action={cancelAction}>
              <input type="hidden" name="planId" value={plan.id} />
              <Button type="submit" size="sm" variant="ghost" disabled={cancelPending}>
                {cancelPending ? "Cancelling" : "Cancel plan"}
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}
      <HrActionMessage state={refreshState} />
      <HrActionMessage state={cancelState} />
    </article>
  );
}

export function HrOnboarding({ data }: { data: HrWorkspaceData }) {
  if (!data.onboarding.capabilities.canView) return null;
  return (
    <section className="hr-section">
      <header className="hr-section__header">
        <div>
          <h2>Employee onboarding</h2>
          <p>
            Coordinate preboarding from one checklist while memberships, employment documents,
            departments, managers, and notifications remain the authoritative source records.
          </p>
        </div>
        <div className="hr-onboarding-summary" aria-label="Onboarding summary">
          <span>
            <ClipboardCheck size={15} aria-hidden="true" /> {data.onboarding.summary.inProgress}{" "}
            active
          </span>
          <span>{data.onboarding.summary.ready} ready</span>
          <span>{data.onboarding.summary.completed} completed</span>
        </div>
      </header>
      <CreateOnboardingPlan data={data} />
      <div className="hr-onboarding-grid">
        {data.onboarding.plans.map((plan) => (
          <OnboardingPlanCard key={plan.id} plan={plan} data={data} />
        ))}
      </div>
      {data.onboarding.plans.length === 0 ? (
        <p className="empty-state">No onboarding plans are visible in your current scope.</p>
      ) : null}
    </section>
  );
}
