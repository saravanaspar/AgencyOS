"use client";

import { useActionState, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  CircleDollarSign,
  FileCheck2,
  History,
  Palmtree,
  RefreshCw,
  Scale,
  ShieldCheck,
  Users,
} from "lucide-react";

import { HrActionMessage } from "@/components/hr/hr-action-message";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  adjustLeaveBalanceAction,
  cancelLeaveRequestAction,
  changeLeaveTypeStatusAction,
  refreshLeaveBalancesAction,
  saveLeaveDraftAction,
  saveLeaveTypeAction,
  submitLeaveRequestAction,
} from "@/modules/hr/actions/leave";
import { humanizeHrValue } from "@/modules/hr/hr";
import { leaveAccrualFrequencies, leaveDayParts } from "@/modules/hr/leave";
import type { HrActionState } from "@/modules/hr/schemas/hr";
import type { HrLeaveRequest, HrLeaveType } from "@/modules/hr/server/leave";
import type { HrWorkspaceData } from "@/modules/hr/server/hr";

const initialState: HrActionState = { status: "idle" };

function dayLabel(value: number): string {
  return `${value.toLocaleString("en", { maximumFractionDigits: 2 })} day${value === 1 ? "" : "s"}`;
}

function LeaveRequestForm({ data }: { data: HrWorkspaceData }) {
  const [state, action, pending] = useActionState(saveLeaveDraftAction, initialState);
  const activeTypes = data.leave.types.filter((leaveType) => leaveType.status === "active");
  if (!data.leave.capabilities.canCreateRequest) return null;
  return (
    <details className="hr-create-panel" open={data.leave.requests.length === 0}>
      <summary>Plan leave</summary>
      <form action={action} className="hr-leave-form">
        <label className="field">
          <span>Leave type</span>
          <select name="leaveTypeId" required defaultValue="">
            <option value="" disabled>
              Choose leave type
            </option>
            {activeTypes.map((leaveType) => (
              <option key={leaveType.id} value={leaveType.id}>
                {leaveType.name} · {leaveType.isPaid ? "Paid" : "Unpaid"}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Start date</span>
          <input name="startDate" type="date" min={data.leave.currentDate} required />
        </label>
        <label className="field">
          <span>End date</span>
          <input name="endDate" type="date" min={data.leave.currentDate} required />
        </label>
        <label className="field">
          <span>Duration</span>
          <select name="dayPart" defaultValue="full_day">
            {leaveDayParts.map((part) => (
              <option key={part} value={part}>
                {part === "full_day" ? "Full day(s)" : humanizeHrValue(part)}
              </option>
            ))}
          </select>
        </label>
        <label className="field hr-leave-form__reason">
          <span>Reason</span>
          <textarea name="reason" required minLength={5} maxLength={2000} />
        </label>
        <div className="hr-leave-form__actions">
          <Button type="submit" disabled={pending || activeTypes.length === 0}>
            {pending ? "Saving" : "Save draft"}
          </Button>
          <small>Draft first, attach evidence when required, then submit for approval.</small>
        </div>
        <HrActionMessage state={state} />
      </form>
    </details>
  );
}

function AttachmentControl({ request }: { request: HrLeaveRequest }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const form = event.currentTarget;
    try {
      const response = await fetch(`/api/hr/leave-requests/${request.id}/attachment`, {
        method: "POST",
        body: new FormData(form),
      });
      const result = (await response.json()) as { message?: string };
      setMessage(result.message ?? "Upload completed.");
      if (response.ok) {
        form.reset();
        router.refresh();
      }
    } catch {
      setMessage("Leave evidence could not be uploaded.");
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!request.attachment) return;
    setPending(true);
    try {
      const response = await fetch(`/api/hr/leave-attachments/${request.attachment.id}`, {
        method: "DELETE",
      });
      const result = (await response.json()) as { message?: string };
      setMessage(result.message ?? "Attachment removed.");
      if (response.ok) router.refresh();
    } catch {
      setMessage("Leave evidence could not be removed.");
    } finally {
      setPending(false);
    }
  }

  if (request.attachment) {
    return (
      <div className="hr-leave-attachment">
        <FileCheck2 aria-hidden="true" />
        <div>
          <strong>{request.attachment.fileName}</strong>
          <span>{humanizeHrValue(request.attachment.status)}</span>
        </div>
        {request.attachment.status === "available" ? (
          <a href={`/api/hr/leave-attachments/${request.attachment.id}`}>Download</a>
        ) : null}
        {request.status === "draft" ? (
          <button type="button" onClick={remove} disabled={pending}>
            Remove
          </button>
        ) : null}
        {message ? <small role="status">{message}</small> : null}
      </div>
    );
  }
  if (request.status !== "draft") return null;
  return (
    <form className="hr-leave-attachment-upload" onSubmit={upload}>
      <label className="field">
        <span>Evidence (PDF, JPEG, or PNG; 10 MB)</span>
        <input name="file" type="file" accept="application/pdf,image/jpeg,image/png" required />
      </label>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Uploading" : "Upload evidence"}
      </Button>
      {message ? <small role="status">{message}</small> : null}
    </form>
  );
}

function LeaveRequestCard({ request }: { request: HrLeaveRequest }) {
  const [submitState, submitAction, submitting] = useActionState(
    submitLeaveRequestAction,
    initialState,
  );
  const [cancelState, cancelAction, cancelling] = useActionState(
    cancelLeaveRequestAction,
    initialState,
  );
  const tone =
    request.status === "approved"
      ? "success"
      : request.status === "pending" || request.status === "draft"
        ? "warning"
        : "error";
  return (
    <article className="hr-leave-request-card">
      <header>
        <div>
          <strong>{request.leaveTypeName}</strong>
          <span>
            {request.startDate} → {request.endDate} · {dayLabel(request.requestedDays)}
          </span>
        </div>
        <StatusBadge tone={tone}>{humanizeHrValue(request.status)}</StatusBadge>
      </header>
      <p>{request.reason}</p>
      <dl>
        <div>
          <dt>Employee</dt>
          <dd>{request.employeeName}</dd>
        </div>
        <div>
          <dt>Pay status</dt>
          <dd>{request.isPaid ? "Paid" : "Unpaid"}</dd>
        </div>
        <div>
          <dt>Team conflicts</dt>
          <dd>{request.teamConflictCount}</dd>
        </div>
      </dl>
      {request.teamConflictCount > 0 ? (
        <p className="hr-leave-conflict" role="status">
          <Users aria-hidden="true" /> Review overlapping leave in this employee&apos;s department.
        </p>
      ) : null}
      <AttachmentControl request={request} />
      {request.isSelf && request.status === "draft" ? (
        <form action={submitAction} className="hr-leave-inline-action">
          <input type="hidden" name="leaveRequestId" value={request.id} />
          <Button type="submit" disabled={submitting || !request.canSubmit}>
            {submitting ? "Submitting" : "Submit for approval"}
          </Button>
          {!request.canSubmit ? <small>Required evidence must be attached first.</small> : null}
          <HrActionMessage state={submitState} />
        </form>
      ) : null}
      {request.canCancel ? (
        <form action={cancelAction} className="hr-leave-cancel-form">
          <input type="hidden" name="leaveRequestId" value={request.id} />
          <label className="field">
            <span>Cancellation reason</span>
            <input name="reason" minLength={3} maxLength={1000} required />
          </label>
          <Button type="submit" variant="secondary" disabled={cancelling}>
            {cancelling
              ? "Cancelling"
              : request.status === "draft"
                ? "Discard draft"
                : "Cancel leave"}
          </Button>
          <HrActionMessage state={cancelState} />
        </form>
      ) : null}
      {request.approvalRequestId ? (
        <a href={`/approvals?view=submitted&q=${request.approvalRequestId}`}>View approval trail</a>
      ) : null}
    </article>
  );
}

function LeaveTypeEditor({ leaveType }: { leaveType?: HrLeaveType }) {
  const [state, action, pending] = useActionState(saveLeaveTypeAction, initialState);
  return (
    <form action={action} className="hr-leave-policy-form">
      {leaveType ? <input type="hidden" name="leaveTypeId" value={leaveType.id} /> : null}
      <label className="field">
        <span>Name</span>
        <input
          name="name"
          defaultValue={leaveType?.name ?? ""}
          minLength={2}
          maxLength={120}
          required
        />
      </label>
      <label className="field">
        <span>Code</span>
        <input name="code" defaultValue={leaveType?.code ?? ""} maxLength={24} />
      </label>
      <label className="field">
        <span>Accrual</span>
        <select name="accrualFrequency" defaultValue={leaveType?.accrualFrequency ?? "annual"}>
          {leaveAccrualFrequencies.map((frequency) => (
            <option key={frequency} value={frequency}>
              {humanizeHrValue(frequency)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Annual allowance</span>
        <input
          name="annualAllowanceDays"
          type="number"
          min="0"
          max="366"
          step="0.25"
          defaultValue={leaveType?.annualAllowanceDays ?? 12}
        />
      </label>
      <label className="field">
        <span>Monthly rate</span>
        <input
          name="accrualRateDays"
          type="number"
          min="0"
          max="31"
          step="0.25"
          defaultValue={leaveType?.accrualRateDays ?? 0}
        />
      </label>
      <label className="field">
        <span>Carry-forward cap</span>
        <input
          name="carryForwardLimitDays"
          type="number"
          min="0"
          max="366"
          step="0.25"
          defaultValue={leaveType?.carryForwardLimitDays ?? 0}
        />
      </label>
      <label className="field">
        <span>Evidence required from</span>
        <input
          name="attachmentRequiredAfterDays"
          type="number"
          min="0.5"
          max="366"
          step="0.5"
          defaultValue={leaveType?.attachmentRequiredAfterDays ?? ""}
          placeholder="No requirement"
        />
      </label>
      <label className="field hr-leave-policy-form__description">
        <span>Description</span>
        <textarea name="description" maxLength={1000} defaultValue={leaveType?.description ?? ""} />
      </label>
      <label className="check-row">
        <input name="isPaid" type="checkbox" defaultChecked={leaveType?.isPaid ?? true} />
        <span>Paid leave</span>
      </label>
      <label className="check-row">
        <input
          name="balanceRequired"
          type="checkbox"
          defaultChecked={leaveType?.balanceRequired ?? true}
        />
        <span>Enforce balance</span>
      </label>
      <label className="check-row">
        <input
          name="requiresHrApproval"
          type="checkbox"
          defaultChecked={leaveType?.requiresHrApproval ?? false}
        />
        <span>Require HR approval after manager</span>
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving" : leaveType ? "Update policy" : "Create policy"}
      </Button>
      <HrActionMessage state={state} />
    </form>
  );
}

function LeaveTypeStatusControl({ leaveType }: { leaveType: HrLeaveType }) {
  const [state, action, pending] = useActionState(changeLeaveTypeStatusAction, initialState);
  return (
    <form action={action} className="hr-leave-inline-action">
      <input type="hidden" name="leaveTypeId" value={leaveType.id} />
      <input
        type="hidden"
        name="status"
        value={leaveType.status === "active" ? "inactive" : "active"}
      />
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Updating" : leaveType.status === "active" ? "Deactivate" : "Activate"}
      </Button>
      <HrActionMessage state={state} />
    </form>
  );
}

function LeaveAdministration({ data }: { data: HrWorkspaceData }) {
  const [refreshState, refreshAction, refreshing] = useActionState(
    refreshLeaveBalancesAction,
    initialState,
  );
  const [adjustState, adjustAction, adjusting] = useActionState(
    adjustLeaveBalanceAction,
    initialState,
  );
  if (!data.leave.capabilities.canManageTypes && !data.leave.capabilities.canAdjustBalances)
    return null;
  return (
    <section className="hr-leave-admin" aria-labelledby="leave-admin-heading">
      <header>
        <div>
          <h3 id="leave-admin-heading">Leave administration</h3>
          <p>Maintain policy rules and append-only balance adjustments.</p>
        </div>
        {data.leave.capabilities.canAdjustBalances ? (
          <form action={refreshAction}>
            <Button type="submit" variant="secondary" disabled={refreshing}>
              <RefreshCw aria-hidden="true" /> {refreshing ? "Refreshing" : "Refresh accruals"}
            </Button>
            <HrActionMessage state={refreshState} />
          </form>
        ) : null}
      </header>
      {data.leave.capabilities.canManageTypes ? (
        <div className="hr-leave-policy-grid">
          <details className="hr-create-panel">
            <summary>Create leave policy</summary>
            <LeaveTypeEditor />
          </details>
          {data.leave.types.map((leaveType) => (
            <details key={leaveType.id} className="hr-create-panel">
              <summary>
                {leaveType.name} · {humanizeHrValue(leaveType.status)}
              </summary>
              <LeaveTypeEditor leaveType={leaveType} />
              <LeaveTypeStatusControl leaveType={leaveType} />
            </details>
          ))}
        </div>
      ) : null}
      {data.leave.capabilities.canAdjustBalances ? (
        <details className="hr-create-panel">
          <summary>Adjust employee balance</summary>
          <form action={adjustAction} className="hr-leave-adjustment-form">
            <label className="field">
              <span>Employee</span>
              <select name="membershipId" required>
                {data.employees.map((employee) => (
                  <option key={employee.membershipId} value={employee.membershipId}>
                    {employee.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Leave type</span>
              <select name="leaveTypeId" required>
                {data.leave.types.map((leaveType) => (
                  <option key={leaveType.id} value={leaveType.id}>
                    {leaveType.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Year</span>
              <input
                name="balanceYear"
                type="number"
                min="2000"
                max="2200"
                defaultValue={data.leave.currentYear}
                required
              />
            </label>
            <label className="field">
              <span>Days (+ or −)</span>
              <input
                name="adjustmentDays"
                type="number"
                min="-366"
                max="366"
                step="0.25"
                required
              />
            </label>
            <label className="field hr-leave-adjustment-form__reason">
              <span>Reason</span>
              <input name="reason" minLength={3} maxLength={1000} required />
            </label>
            <Button type="submit" disabled={adjusting}>
              {adjusting ? "Applying" : "Apply adjustment"}
            </Button>
            <HrActionMessage state={adjustState} />
          </form>
        </details>
      ) : null}
    </section>
  );
}

export function HrLeave({ data }: { data: HrWorkspaceData }) {
  if (!data.leave.capabilities.canView && !data.leave.capabilities.canCreateRequest) return null;
  const currentBalances = data.leave.balances.filter(
    (balance) => balance.balanceYear === data.leave.currentYear,
  );
  return (
    <section className="hr-section" aria-labelledby="leave-heading" id="leave-requests">
      <header className="hr-section__header">
        <div>
          <h2 id="leave-heading">Leave</h2>
          <p>
            Plan leave, reserve balances during approval, and keep a scoped team calendar and
            adjustment history.
          </p>
        </div>
      </header>

      <div className="hr-leave-summary">
        <article>
          <Palmtree aria-hidden="true" />
          <strong>{dayLabel(data.leave.summary.ownAvailableDays)}</strong>
          <span>My available balance</span>
        </article>
        <article>
          <ShieldCheck aria-hidden="true" />
          <strong>{data.leave.summary.pendingRequests}</strong>
          <span>Pending requests</span>
        </article>
        <article>
          <CalendarDays aria-hidden="true" />
          <strong>{data.leave.summary.approvedUpcoming}</strong>
          <span>Approved upcoming</span>
        </article>
        <article>
          <Users aria-hidden="true" />
          <strong>{data.leave.summary.teamConflicts}</strong>
          <span>Conflict warnings</span>
        </article>
      </div>

      <LeaveRequestForm data={data} />

      <div className="hr-leave-request-grid">
        {data.leave.requests.map((request) => (
          <LeaveRequestCard key={request.id} request={request} />
        ))}
      </div>
      {data.leave.requests.length === 0 ? (
        <p className="empty-state">No leave requests are visible yet.</p>
      ) : null}

      <div className="table-wrap" tabIndex={0} aria-label="Leave balances table">
        <table className="data-table hr-leave-balance-table">
          <caption>Leave balances for {data.leave.currentYear}</caption>
          <thead>
            <tr>
              <th scope="col">Employee</th>
              <th scope="col">Leave type</th>
              <th scope="col">Accrued</th>
              <th scope="col">Carry-forward</th>
              <th scope="col">Reserved</th>
              <th scope="col">Used</th>
              <th scope="col">Available</th>
            </tr>
          </thead>
          <tbody>
            {currentBalances.map((balance) => (
              <tr key={balance.id}>
                <td>{balance.employeeName}</td>
                <td>{balance.leaveTypeName}</td>
                <td>{dayLabel(balance.accruedDays)}</td>
                <td>{dayLabel(balance.carriedForwardDays)}</td>
                <td>{dayLabel(balance.reservedDays)}</td>
                <td>{dayLabel(balance.usedDays)}</td>
                <td>
                  <strong>{dayLabel(balance.availableDays)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="hr-leave-calendar" aria-labelledby="leave-calendar-heading">
        <h3 id="leave-calendar-heading">
          <CalendarDays aria-hidden="true" /> Team leave calendar
        </h3>
        <ol>
          {data.leave.requests
            .filter((request) => request.status === "approved" || request.status === "pending")
            .sort((left, right) => left.startDate.localeCompare(right.startDate))
            .map((request) => (
              <li key={request.id}>
                <time dateTime={request.startDate}>{request.startDate}</time>
                <span>→ {request.endDate}</span>
                <strong>{request.employeeName}</strong>
                <span>{request.leaveTypeName}</span>
                <StatusBadge tone={request.status === "approved" ? "success" : "warning"}>
                  {humanizeHrValue(request.status)}
                </StatusBadge>
              </li>
            ))}
        </ol>
      </section>

      {data.leave.events.length > 0 ? (
        <details className="hr-leave-history">
          <summary>
            <History aria-hidden="true" /> Balance adjustment history
          </summary>
          <ol>
            {data.leave.events.map((event) => (
              <li key={event.id}>
                <div>
                  <strong>{event.employeeName}</strong>
                  <span>
                    {event.leaveTypeName} · {event.balanceYear}
                  </span>
                </div>
                <span>{humanizeHrValue(event.eventType)}</span>
                <strong className={event.deltaDays < 0 ? "is-negative" : ""}>
                  {event.deltaDays > 0 ? "+" : ""}
                  {event.deltaDays}
                </strong>
                <small>{event.reason ?? "Recorded automatically"}</small>
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      <LeaveAdministration data={data} />

      <aside className="hr-leave-notes">
        <Scale aria-hidden="true" />
        <p>
          Requests count Monday–Friday only until organization work schedules and holiday calendars
          are delivered. Paid and unpaid policies remain separate.
        </p>
        <CircleDollarSign aria-hidden="true" />
      </aside>
    </section>
  );
}
