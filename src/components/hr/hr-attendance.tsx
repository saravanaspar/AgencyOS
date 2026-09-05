"use client";

import { useActionState } from "react";
import { CalendarClock, Clock3, Home, TimerReset } from "lucide-react";

import { HrActionMessage } from "@/components/hr/hr-action-message";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { getDateTimeFormatter } from "@/lib/intl-formatters";
import {
  attendanceCheckAction,
  requestAttendanceCorrectionAction,
  saveManualAttendanceAction,
} from "@/modules/hr/actions/attendance";
import { attendanceStatuses } from "@/modules/hr/attendance";
import { humanizeHrValue } from "@/modules/hr/hr";
import type { HrActionState } from "@/modules/hr/schemas/hr";
import type { HrEmployee, HrWorkspaceData } from "@/modules/hr/server/hr";

const initialState: HrActionState = { status: "idle" };

function formatMinutes(value: number): string {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

function localTime(value: string | null, timezone: string): string {
  if (!value) return "—";
  return getDateTimeFormatter("en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
  }).format(new Date(value));
}

function AttendanceFields({ defaultEmployee }: { defaultEmployee?: HrEmployee }) {
  return (
    <>
      {defaultEmployee ? (
        <input type="hidden" name="membershipId" value={defaultEmployee.membershipId} />
      ) : null}
      <label className="field">
        <span>Date</span>
        <input name="attendanceDate" type="date" required />
      </label>
      <label className="field">
        <span>Check-in</span>
        <input name="checkInTime" type="time" />
      </label>
      <label className="field">
        <span>Check-out</span>
        <input name="checkOutTime" type="time" />
      </label>
      <label className="field">
        <span>Day status</span>
        <select name="attendanceStatus" defaultValue="present">
          {attendanceStatuses.map((status) => (
            <option key={status} value={status}>
              {humanizeHrValue(status)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Late minutes</span>
        <input name="lateMinutes" type="number" min="0" max="1440" defaultValue="0" />
      </label>
      <label className="field">
        <span>Early departure</span>
        <input name="earlyDepartureMinutes" type="number" min="0" max="1440" defaultValue="0" />
      </label>
      <label className="field">
        <span>Overtime</span>
        <input name="overtimeMinutes" type="number" min="0" max="1440" defaultValue="0" />
      </label>
      <label className="field hr-attendance-form__notes">
        <span>Attendance notes</span>
        <textarea name="notes" maxLength={2000} />
      </label>
    </>
  );
}

function SelfAttendance({ data }: { data: HrWorkspaceData }) {
  const [state, action, pending] = useActionState(attendanceCheckAction, initialState);
  const record = data.attendance.todayRecord;
  return (
    <article className="hr-attendance-today">
      <div>
        <span>Today · {data.attendance.currentDate}</span>
        <strong>{record ? humanizeHrValue(record.attendanceStatus) : "Not checked in"}</strong>
        <small>
          {record
            ? `${localTime(record.checkInAt, data.attendance.timezone)} – ${localTime(record.checkOutAt, data.attendance.timezone)}`
            : `Timezone: ${data.attendance.timezone}`}
        </small>
      </div>
      {data.attendance.capabilities.canCheck ? (
        <form action={action} className="hr-attendance-today__actions">
          <input
            type="hidden"
            name="operation"
            value={record?.checkInAt && !record.checkOutAt ? "check_out" : "check_in"}
          />
          <Button type="submit" disabled={pending || Boolean(record?.checkOutAt)}>
            {pending
              ? "Updating"
              : record?.checkOutAt
                ? "Day complete"
                : record?.checkInAt
                  ? "Check out"
                  : "Check in"}
          </Button>
          <HrActionMessage state={state} />
        </form>
      ) : null}
    </article>
  );
}

function ManualAttendanceForm({ data }: { data: HrWorkspaceData }) {
  const [state, action, pending] = useActionState(saveManualAttendanceAction, initialState);
  return (
    <details className="hr-create-panel">
      <summary>Record or adjust attendance</summary>
      <form action={action} className="hr-attendance-form">
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
        <AttendanceFields />
        <Button type="submit" disabled={pending}>
          {pending ? "Saving" : "Save attendance"}
        </Button>
        <HrActionMessage state={state} />
      </form>
    </details>
  );
}

function CorrectionForm({ employee }: { employee: HrEmployee }) {
  const [state, action, pending] = useActionState(requestAttendanceCorrectionAction, initialState);
  return (
    <details className="hr-create-panel" id="attendance-corrections">
      <summary>Request attendance correction</summary>
      <form action={action} className="hr-attendance-form">
        <AttendanceFields defaultEmployee={employee} />
        <label className="field hr-attendance-form__notes">
          <span>Reason for correction</span>
          <textarea name="reason" required minLength={5} maxLength={2000} />
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? "Submitting" : "Send to manager"}
        </Button>
        <HrActionMessage state={state} />
      </form>
    </details>
  );
}

export function HrAttendance({ data }: { data: HrWorkspaceData }) {
  const self = data.employees.find(
    (employee) => employee.membershipId === data.attendance.currentMembershipId,
  );
  const summary = data.attendance.summary;

  if (!data.attendance.capabilities.canView) return null;

  return (
    <section className="hr-section" aria-labelledby="attendance-heading">
      <header className="hr-section__header">
        <div>
          <h2 id="attendance-heading">Attendance</h2>
          <p>
            Check in and out, manage scoped records, and route employee corrections through the
            shared approval engine.
          </p>
        </div>
      </header>

      <SelfAttendance data={data} />

      <div className="hr-attendance-summary" aria-label={`${data.attendance.currentMonth} summary`}>
        <article>
          <CalendarClock aria-hidden="true" />
          <strong>{summary.recordedDays}</strong>
          <span>Recorded days</span>
        </article>
        <article>
          <Home aria-hidden="true" />
          <strong>{summary.workFromHomeDays}</strong>
          <span>Work from home</span>
        </article>
        <article>
          <Clock3 aria-hidden="true" />
          <strong>{formatMinutes(summary.workedMinutes)}</strong>
          <span>Worked time</span>
        </article>
        <article>
          <TimerReset aria-hidden="true" />
          <strong>{formatMinutes(summary.overtimeMinutes)}</strong>
          <span>Overtime</span>
        </article>
      </div>

      <div className="hr-attendance-actions">
        {data.attendance.capabilities.canManage ? <ManualAttendanceForm data={data} /> : null}
        {self && data.attendance.capabilities.canRequestCorrection ? (
          <CorrectionForm employee={self} />
        ) : null}
      </div>

      <div className="table-wrap" tabIndex={0} aria-label="Attendance records table">
        <table className="data-table hr-attendance-table">
          <caption className="sr-only">
            Attendance records for {data.attendance.currentMonth}
          </caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Employee</th>
              <th scope="col">Status</th>
              <th scope="col">Check-in</th>
              <th scope="col">Check-out</th>
              <th scope="col">Worked</th>
              <th scope="col">Late</th>
              <th scope="col">Overtime</th>
            </tr>
          </thead>
          <tbody>
            {data.attendance.records.map((record) => (
              <tr key={record.id}>
                <td>{record.attendanceDate}</td>
                <td>{record.employeeName}</td>
                <td>
                  <StatusBadge tone={record.attendanceStatus === "absent" ? "error" : "success"}>
                    {humanizeHrValue(record.attendanceStatus)}
                  </StatusBadge>
                </td>
                <td>{localTime(record.checkInAt, data.attendance.timezone)}</td>
                <td>{localTime(record.checkOutAt, data.attendance.timezone)}</td>
                <td>
                  {record.durationMinutes === null ? "—" : formatMinutes(record.durationMinutes)}
                </td>
                <td>{formatMinutes(record.lateMinutes)}</td>
                <td>{formatMinutes(record.overtimeMinutes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.attendance.records.length === 0 ? (
        <p className="empty-state">No attendance records exist for this month.</p>
      ) : null}

      <div className="hr-correction-list" aria-label="Attendance correction requests">
        <h3>Correction requests</h3>
        {data.attendance.corrections.map((correction) => (
          <article key={correction.id}>
            <div>
              <strong>{correction.employeeName}</strong>
              <span>{correction.attendanceDate}</span>
            </div>
            <p>{correction.reason}</p>
            <StatusBadge
              tone={
                correction.status === "approved"
                  ? "success"
                  : correction.status === "pending"
                    ? "warning"
                    : "error"
              }
            >
              {humanizeHrValue(correction.status)}
            </StatusBadge>
            {correction.approvalRequestId ? (
              <a href={`/approvals?view=submitted&q=${correction.approvalRequestId}`}>
                View approval
              </a>
            ) : null}
          </article>
        ))}
        {data.attendance.corrections.length === 0 ? (
          <p className="empty-state">No correction requests yet.</p>
        ) : null}
      </div>
    </section>
  );
}
