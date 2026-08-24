"use client";

import { useActionState, useMemo, useState } from "react";
import {
  BadgeCheck,
  BriefcaseBusiness,
  ContactRound,
  Plus,
  Search,
  UsersRound,
} from "lucide-react";

import { HrActionMessage } from "@/components/hr/hr-action-message";
import { HrAttendance } from "@/components/hr/hr-attendance";
import { HrLeave } from "@/components/hr/hr-leave";
import { HrOnboarding } from "@/components/hr/hr-onboarding";
import { HrOffboarding } from "@/components/hr/hr-offboarding";
import { HrDocuments } from "@/components/hr/hr-documents";
import { HrSalary } from "@/components/hr/hr-salary";
import { HrSupportingDocuments } from "@/components/hr/hr-supporting-documents";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  changeDesignationStatusAction,
  createDesignationAction,
  saveEmployeeProfileAction,
  updateDesignationAction,
  updateOwnEmployeeProfileAction,
} from "@/modules/hr/actions/hr";
import {
  employeeLifecycleStatuses,
  employmentTypes,
  humanizeHrValue,
  workModes,
} from "@/modules/hr/hr";
import type { HrActionState } from "@/modules/hr/schemas/hr";
import type { HrDesignation, HrEmployee, HrWorkspaceData } from "@/modules/hr/server/hr";

const initialState: HrActionState = { status: "idle" };

function selectableDesignations(
  designations: readonly HrDesignation[],
  currentDesignationId: string | null,
): HrDesignation[] {
  const selectable: HrDesignation[] = [];
  for (const designation of designations) {
    if (designation.status === "active" || designation.id === currentDesignationId) {
      selectable.push(designation);
    }
  }
  return selectable;
}

function EmployeeEditor({ employee, data }: { employee: HrEmployee; data: HrWorkspaceData }) {
  const [state, action, pending] = useActionState(saveEmployeeProfileAction, initialState);
  const managerOptions = data.managers.filter(
    (manager) => manager.membershipId !== employee.membershipId,
  );

  return (
    <form className="hr-employee-form" action={action}>
      <input type="hidden" name="membershipId" value={employee.membershipId} />
      <label className="field">
        <span>Employee ID</span>
        <input name="employeeNumber" defaultValue={employee.employeeNumber ?? ""} maxLength={40} />
      </label>
      <label className="field">
        <span>Legal name</span>
        <input name="legalName" defaultValue={employee.legalName ?? ""} maxLength={180} />
      </label>
      <label className="field">
        <span>Preferred name</span>
        <input name="preferredName" defaultValue={employee.preferredName ?? ""} maxLength={120} />
      </label>
      <label className="field">
        <span>Personal email</span>
        <input name="personalEmail" type="email" defaultValue={employee.personalEmail ?? ""} />
      </label>
      <label className="field">
        <span>Personal phone</span>
        <input name="personalPhone" defaultValue={employee.personalPhone ?? ""} maxLength={40} />
      </label>
      <label className="field">
        <span>Date of birth</span>
        <input name="dateOfBirth" type="date" defaultValue={employee.dateOfBirth ?? ""} />
      </label>
      <label className="field">
        <span>Nationality</span>
        <input name="nationality" defaultValue={employee.nationality ?? ""} maxLength={100} />
      </label>
      <label className="field">
        <span>Designation</span>
        <select name="designationId" defaultValue={employee.designationId ?? ""}>
          <option value="">Not assigned</option>
          {selectableDesignations(data.designations, employee.designationId).map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Department</span>
        <select name="departmentId" defaultValue={employee.departmentId ?? ""}>
          <option value="">Not assigned</option>
          {data.departments.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Manager</span>
        <select name="managerMembershipId" defaultValue={employee.managerMembershipId ?? ""}>
          <option value="">Not assigned</option>
          {managerOptions.map((item) => (
            <option key={item.membershipId} value={item.membershipId}>
              {item.displayName}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Joining date</span>
        <input name="joiningDate" type="date" defaultValue={employee.joiningDate ?? ""} />
      </label>
      <label className="field">
        <span>Employment type</span>
        <select name="employmentType" defaultValue={employee.employmentType ?? ""}>
          <option value="">Not set</option>
          {employmentTypes.map((item) => (
            <option key={item} value={item}>
              {humanizeHrValue(item)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Work mode</span>
        <select name="workMode" defaultValue={employee.workMode ?? ""}>
          <option value="">Not set</option>
          {workModes.map((item) => (
            <option key={item} value={item}>
              {humanizeHrValue(item)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Work location</span>
        <input name="workLocation" defaultValue={employee.workLocation ?? ""} maxLength={160} />
      </label>
      <label className="field">
        <span>Lifecycle status</span>
        <select name="lifecycleStatus" defaultValue={employee.lifecycleStatus}>
          {employeeLifecycleStatuses.map((item) => (
            <option key={item} value={item}>
              {humanizeHrValue(item)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Weekly hours</span>
        <input
          name="weeklyHours"
          type="number"
          min="0"
          max="168"
          step="0.25"
          defaultValue={employee.weeklyHours ?? ""}
        />
      </label>
      <div className="hr-employee-form__actions">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving" : employee.profileId ? "Save employee" : "Create employee record"}
        </Button>
      </div>
      <HrActionMessage state={state} />
    </form>
  );
}

function SelfEditor({ employee }: { employee: HrEmployee }) {
  const [state, action, pending] = useActionState(updateOwnEmployeeProfileAction, initialState);
  return (
    <form className="hr-self-form" action={action}>
      <input type="hidden" name="membershipId" value={employee.membershipId} />
      <label className="field">
        <span>Preferred name</span>
        <input name="preferredName" defaultValue={employee.preferredName ?? ""} maxLength={120} />
      </label>
      <label className="field">
        <span>Personal email</span>
        <input name="personalEmail" type="email" defaultValue={employee.personalEmail ?? ""} />
      </label>
      <label className="field">
        <span>Personal phone</span>
        <input name="personalPhone" defaultValue={employee.personalPhone ?? ""} maxLength={40} />
      </label>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving" : "Save my details"}
      </Button>
      <HrActionMessage state={state} />
    </form>
  );
}

function EmployeeCard({ employee, data }: { employee: HrEmployee; data: HrWorkspaceData }) {
  const canManage =
    data.capabilities.canUpdateEmployee ||
    (!employee.profileId && data.capabilities.canCreateEmployee);
  return (
    <article className="hr-employee-card">
      <header>
        <div className="hr-employee-card__identity">
          <span className="avatar" aria-hidden="true">
            {employee.displayName.slice(0, 2).toUpperCase()}
          </span>
          <div>
            <strong>{employee.displayName}</strong>
            <span>{employee.workEmail}</span>
          </div>
        </div>
        <StatusBadge tone={employee.membershipStatus === "active" ? "success" : "neutral"}>
          {employee.membershipStatus}
        </StatusBadge>
      </header>
      <dl className="hr-employee-card__facts">
        <div>
          <dt>Employee ID</dt>
          <dd>{employee.employeeNumber ?? "Not assigned"}</dd>
        </div>
        <div>
          <dt>Designation</dt>
          <dd>{employee.designationName ?? "Not assigned"}</dd>
        </div>
        <div>
          <dt>Department</dt>
          <dd>{employee.departmentName ?? "Not assigned"}</dd>
        </div>
        <div>
          <dt>Manager</dt>
          <dd>{employee.managerName ?? "Not assigned"}</dd>
        </div>
        <div>
          <dt>Lifecycle</dt>
          <dd>{humanizeHrValue(employee.lifecycleStatus)}</dd>
        </div>
        <div>
          <dt>Work setup</dt>
          <dd>
            {[humanizeHrValue(employee.employmentType), humanizeHrValue(employee.workMode)]
              .filter((value) => value !== "Not set")
              .join(" · ") || "Not set"}
          </dd>
        </div>
      </dl>
      {canManage ? (
        <details className="hr-editor">
          <summary>
            {employee.profileId ? "Edit employee record" : "Complete employee record"}
          </summary>
          <EmployeeEditor employee={employee} data={data} />
        </details>
      ) : null}
      {employee.isSelf &&
      data.capabilities.canUpdateSelf &&
      !data.capabilities.canUpdateEmployee ? (
        <details className="hr-editor">
          <summary>Update my contact details</summary>
          <SelfEditor employee={employee} />
        </details>
      ) : null}
    </article>
  );
}

function DesignationCard({
  designation,
  canManage,
}: {
  designation: HrDesignation;
  canManage: boolean;
}) {
  const [updateState, updateAction, updatePending] = useActionState(
    updateDesignationAction,
    initialState,
  );
  const [statusState, statusAction, statusPending] = useActionState(
    changeDesignationStatusAction,
    initialState,
  );
  return (
    <article className="hr-designation-card">
      <header>
        <div>
          <strong>{designation.name}</strong>
          {designation.code ? <code>{designation.code}</code> : null}
        </div>
        <StatusBadge tone={designation.status === "active" ? "success" : "neutral"}>
          {designation.status}
        </StatusBadge>
      </header>
      <p>{designation.description ?? "No description."}</p>
      {canManage ? <span>{designation.employeeCount} employees</span> : null}
      {canManage ? (
        <details className="hr-editor">
          <summary>Edit designation</summary>
          <form className="hr-designation-form" action={updateAction}>
            <input type="hidden" name="designationId" value={designation.id} />
            <label className="field">
              <span>Name</span>
              <input name="name" defaultValue={designation.name} required />
            </label>
            <label className="field">
              <span>Code</span>
              <input name="code" defaultValue={designation.code ?? ""} />
            </label>
            <label className="field hr-designation-form__description">
              <span>Description</span>
              <textarea name="description" defaultValue={designation.description ?? ""} />
            </label>
            <Button type="submit" size="sm" disabled={updatePending}>
              {updatePending ? "Saving" : "Save"}
            </Button>
            <HrActionMessage state={updateState} />
          </form>
          <form action={statusAction}>
            <input type="hidden" name="designationId" value={designation.id} />
            <input
              type="hidden"
              name="status"
              value={designation.status === "active" ? "inactive" : "active"}
            />
            <Button type="submit" variant="ghost" size="sm" disabled={statusPending}>
              {statusPending
                ? "Updating"
                : designation.status === "active"
                  ? "Deactivate"
                  : "Activate"}
            </Button>
            <HrActionMessage state={statusState} />
          </form>
        </details>
      ) : null}
    </article>
  );
}

export function HrWorkspace({ data }: { data: HrWorkspaceData }) {
  const [query, setQuery] = useState("");
  const [designationState, designationAction, designationPending] = useActionState(
    createDesignationAction,
    initialState,
  );
  const visibleEmployees = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return data.employees;
    return data.employees.filter((employee) =>
      [
        employee.displayName,
        employee.workEmail,
        employee.employeeNumber,
        employee.designationName,
        employee.departmentName,
      ].some((value) => value?.toLowerCase().includes(normalized)),
    );
  }, [data.employees, query]);

  return (
    <div className="hr-workspace">
      <section className="hr-summary" aria-label="People summary">
        <article>
          <UsersRound aria-hidden="true" />
          <div>
            <strong>{data.summary.visibleEmployees}</strong>
            <span>Visible employees</span>
          </div>
        </article>
        <article>
          <BadgeCheck aria-hidden="true" />
          <div>
            <strong>{data.summary.activeEmployees}</strong>
            <span>Active or confirmed</span>
          </div>
        </article>
        <article>
          <ContactRound aria-hidden="true" />
          <div>
            <strong>{data.summary.preboardingEmployees}</strong>
            <span>Preboarding</span>
          </div>
        </article>
        <article>
          <BriefcaseBusiness aria-hidden="true" />
          <div>
            <strong>{data.summary.noticePeriodEmployees}</strong>
            <span>Notice period</span>
          </div>
        </article>
      </section>

      <HrAttendance data={data} />

      <HrLeave data={data} />

      <HrSalary data={data} />

      <HrDocuments data={data} />

      <HrSupportingDocuments data={data} />

      <HrOnboarding data={data} />

      <HrOffboarding data={data} />

      <section className="hr-section">
        <header className="hr-section__header">
          <div>
            <h2>Employee records</h2>
            <p>
              Non-sensitive employment details reuse existing memberships, departments, managers,
              and access controls.
            </p>
          </div>
          <label className="hr-search">
            <Search size={16} aria-hidden="true" />
            <span className="sr-only">Search employees</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search people"
            />
          </label>
        </header>
        <div className="hr-employee-grid">
          {visibleEmployees.map((employee) => (
            <EmployeeCard key={employee.membershipId} employee={employee} data={data} />
          ))}
        </div>
        {visibleEmployees.length === 0 ? (
          <p className="empty-state">No employees match this search.</p>
        ) : null}
      </section>

      <section className="hr-section">
        <header className="hr-section__header">
          <div>
            <h2>Designations</h2>
            <p>
              Maintain a single organization-wide designation catalogue instead of storing free-text
              titles on each employee.
            </p>
          </div>
        </header>
        {data.capabilities.canManageDesignations ? (
          <details className="hr-create-panel">
            <summary>
              <Plus size={16} aria-hidden="true" /> Create designation
            </summary>
            <form className="hr-designation-form" action={designationAction}>
              <label className="field">
                <span>Name</span>
                <input name="name" required maxLength={120} />
              </label>
              <label className="field">
                <span>Code</span>
                <input name="code" maxLength={24} />
              </label>
              <label className="field hr-designation-form__description">
                <span>Description</span>
                <textarea name="description" maxLength={1000} />
              </label>
              <Button type="submit" disabled={designationPending}>
                {designationPending ? "Creating" : "Create designation"}
              </Button>
              <HrActionMessage state={designationState} />
            </form>
          </details>
        ) : null}
        <div className="hr-designation-grid">
          {data.designations.map((designation) => (
            <DesignationCard
              key={designation.id}
              designation={designation}
              canManage={data.capabilities.canManageDesignations}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
