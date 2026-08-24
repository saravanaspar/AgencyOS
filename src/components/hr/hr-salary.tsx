"use client";

import { useActionState, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { BadgeDollarSign, FileText, History, LockKeyhole, Upload } from "lucide-react";

import { HrActionMessage } from "@/components/hr/hr-action-message";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  acknowledgeSalarySlipAction,
  generateSalarySlipAction,
  saveSalaryRevisionAction,
} from "@/modules/hr/actions/salary";
import { formatMinorMoney } from "@/modules/finance/calculations";
import type { HrActionState } from "@/modules/hr/schemas/hr";
import type { HrSalarySlip, HrSalaryStructure } from "@/modules/hr/server/salary";
import type { HrWorkspaceData } from "@/modules/hr/server/hr";

const initialState: HrActionState = { status: "idle" };

function money(amountMinor: number, currency: string): string {
  return formatMinorMoney(amountMinor, currency, "en-US");
}

function SalaryRevisionForm({ data }: { data: HrWorkspaceData }) {
  const [state, action, pending] = useActionState(saveSalaryRevisionAction, initialState);
  if (!data.salary.capabilities.canManageSalary) return null;
  return (
    <details className="hr-create-panel">
      <summary>Create salary revision</summary>
      <form action={action} className="hr-salary-form">
        <label className="field">
          <span>Employee</span>
          <select name="membershipId" required defaultValue="">
            <option value="" disabled>
              Choose employee
            </option>
            {data.employees.map((employee) => (
              <option key={employee.membershipId} value={employee.membershipId}>
                {employee.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Currency</span>
          <input name="currency" defaultValue="INR" maxLength={3} required />
        </label>
        <label className="field">
          <span>Base salary</span>
          <input name="baseSalary" inputMode="decimal" required placeholder="50000.00" />
        </label>
        <label className="field">
          <span>Effective from</span>
          <input name="effectiveFrom" type="date" required />
        </label>
        <label className="field hr-salary-form__wide">
          <span>Allowances</span>
          <textarea
            name="allowances"
            placeholder="Housing | 12000 | yes&#10;Transport | 3000 | no"
          />
          <small>One per line: Name | Amount | Taxable.</small>
        </label>
        <label className="field hr-salary-form__wide">
          <span>Deductions</span>
          <textarea
            name="deductions"
            placeholder="Provident fund | 2500 | no&#10;Insurance | 900 | no"
          />
          <small>One per line: Name | Amount | Taxable.</small>
        </label>
        <label className="field hr-salary-form__wide">
          <span>Revision notes</span>
          <textarea name="notes" maxLength={2000} />
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating" : "Create immutable revision"}
        </Button>
        <HrActionMessage state={state} />
      </form>
    </details>
  );
}

function GenerateSalarySlipForm({ data }: { data: HrWorkspaceData }) {
  const [state, action, pending] = useActionState(generateSalarySlipAction, initialState);
  if (!data.salary.capabilities.canManageSlips) return null;
  return (
    <details className="hr-create-panel">
      <summary>Generate salary slip</summary>
      <form action={action} className="hr-salary-form">
        <label className="field">
          <span>Employee</span>
          <select name="membershipId" required defaultValue="">
            <option value="" disabled>
              Choose employee
            </option>
            {data.employees.map((employee) => (
              <option key={employee.membershipId} value={employee.membershipId}>
                {employee.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Period start</span>
          <input name="periodStart" type="date" required />
        </label>
        <label className="field">
          <span>Period end</span>
          <input name="periodEnd" type="date" required />
        </label>
        <label className="field">
          <span>Bonus</span>
          <input name="bonus" inputMode="decimal" defaultValue="0" />
        </label>
        <label className="field">
          <span>Reimbursement</span>
          <input name="reimbursement" inputMode="decimal" defaultValue="0" />
        </label>
        <label className="field">
          <span>Additional deduction</span>
          <input name="extraDeduction" inputMode="decimal" defaultValue="0" />
        </label>
        <label className="field hr-salary-form__wide">
          <span>Notes</span>
          <textarea name="notes" maxLength={1000} />
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? "Generating" : "Generate private PDF"}
        </Button>
        <HrActionMessage state={state} />
      </form>
    </details>
  );
}

function UploadSalarySlipForm({ data }: { data: HrWorkspaceData }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  if (!data.salary.capabilities.canManageSlips) return null;

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/hr/salary-slips/upload", {
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
      setMessage("Salary slip could not be uploaded.");
    } finally {
      setPending(false);
    }
  }

  return (
    <details className="hr-create-panel">
      <summary>
        <Upload size={16} aria-hidden="true" /> Upload existing salary slip
      </summary>
      <form className="hr-salary-form" onSubmit={upload}>
        <label className="field">
          <span>Employee</span>
          <select name="membershipId" required defaultValue="">
            <option value="" disabled>
              Choose employee
            </option>
            {data.employees.map((employee) => (
              <option key={employee.membershipId} value={employee.membershipId}>
                {employee.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Period start</span>
          <input name="periodStart" type="date" required />
        </label>
        <label className="field">
          <span>Period end</span>
          <input name="periodEnd" type="date" required />
        </label>
        <label className="field">
          <span>Currency</span>
          <input name="currency" defaultValue="INR" maxLength={3} required />
        </label>
        <label className="field">
          <span>Base salary</span>
          <input name="baseSalary" inputMode="decimal" required />
        </label>
        <label className="field">
          <span>Allowances total</span>
          <input name="allowances" inputMode="decimal" defaultValue="0" />
        </label>
        <label className="field">
          <span>Deductions total</span>
          <input name="deductions" inputMode="decimal" defaultValue="0" />
        </label>
        <label className="field">
          <span>Bonus</span>
          <input name="bonus" inputMode="decimal" defaultValue="0" />
        </label>
        <label className="field">
          <span>Reimbursement</span>
          <input name="reimbursement" inputMode="decimal" defaultValue="0" />
        </label>
        <label className="field">
          <span>Additional deduction</span>
          <input name="extraDeduction" inputMode="decimal" defaultValue="0" />
        </label>
        <label className="field hr-salary-form__wide">
          <span>Salary-slip PDF</span>
          <input name="file" type="file" accept="application/pdf" required />
        </label>
        <label className="field hr-salary-form__wide">
          <span>Notes</span>
          <textarea name="notes" maxLength={1000} />
        </label>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Uploading" : "Upload private PDF"}
        </Button>
        {message ? <small role="status">{message}</small> : null}
      </form>
    </details>
  );
}

function StructureCard({ structure }: { structure: HrSalaryStructure }) {
  const allowances = structure.components.filter((item) => item.type === "allowance");
  const deductions = structure.components.filter((item) => item.type === "deduction");
  return (
    <article className="hr-salary-card">
      <header>
        <div>
          <strong>{structure.employeeName}</strong>
          <span>
            Revision {structure.revisionNumber} · {structure.effectiveFrom}
          </span>
        </div>
        <StatusBadge tone={structure.isCurrent ? "success" : "neutral"}>
          {structure.isCurrent ? "Current" : structure.effectiveTo ? "Historical" : "Scheduled"}
        </StatusBadge>
      </header>
      <dl>
        <div>
          <dt>Base</dt>
          <dd>{money(structure.baseSalaryMinor, structure.currency)}</dd>
        </div>
        <div>
          <dt>Allowances</dt>
          <dd>
            {money(
              allowances.reduce((sum, item) => sum + item.amountMinor, 0),
              structure.currency,
            )}
          </dd>
        </div>
        <div>
          <dt>Deductions</dt>
          <dd>
            {money(
              deductions.reduce((sum, item) => sum + item.amountMinor, 0),
              structure.currency,
            )}
          </dd>
        </div>
        <div>
          <dt>Effective through</dt>
          <dd>{structure.effectiveTo ?? "Open ended"}</dd>
        </div>
      </dl>
      <details>
        <summary>View components and notes</summary>
        <ul className="hr-salary-components">
          {structure.components.map((component) => (
            <li key={component.id}>
              <span>
                {component.name} · {component.type}
              </span>
              <strong>{money(component.amountMinor, structure.currency)}</strong>
            </li>
          ))}
        </ul>
        {structure.notes ? <p>{structure.notes}</p> : null}
      </details>
    </article>
  );
}

function SalarySlipCard({ slip, canAcknowledge }: { slip: HrSalarySlip; canAcknowledge: boolean }) {
  const [state, action, pending] = useActionState(acknowledgeSalarySlipAction, initialState);
  const available = slip.fileStatus === "available";
  return (
    <article className="hr-salary-slip-card">
      <header>
        <div>
          <strong>{slip.employeeName}</strong>
          <span>
            {slip.periodStart} → {slip.periodEnd} · v{slip.version}
          </span>
        </div>
        <StatusBadge
          tone={available ? "success" : slip.fileStatus === "rejected" ? "error" : "warning"}
        >
          {slip.fileStatus ?? "Pending file"}
        </StatusBadge>
      </header>
      <dl>
        <div>
          <dt>Gross</dt>
          <dd>{money(slip.grossMinor, slip.currency)}</dd>
        </div>
        <div>
          <dt>Deductions</dt>
          <dd>{money(slip.deductionsMinor, slip.currency)}</dd>
        </div>
        <div>
          <dt>Net</dt>
          <dd>{money(slip.netMinor, slip.currency)}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{slip.source}</dd>
        </div>
      </dl>
      <div className="hr-salary-slip-card__actions">
        {available ? (
          <a href={`/api/hr/salary-slips/${slip.id}`}>Download</a>
        ) : (
          <span>Security scan pending</span>
        )}
        {slip.acknowledgedAt ? <span>Acknowledged {slip.acknowledgedAt.slice(0, 10)}</span> : null}
      </div>
      {slip.isSelf && available && !slip.acknowledgedAt && canAcknowledge ? (
        <form action={action}>
          <input type="hidden" name="salarySlipId" value={slip.id} />
          <Button type="submit" size="sm" variant="secondary" disabled={pending}>
            {pending ? "Acknowledging" : "Acknowledge receipt"}
          </Button>
          <HrActionMessage state={state} />
        </form>
      ) : null}
    </article>
  );
}

export function HrSalary({ data }: { data: HrWorkspaceData }) {
  const salary = data.salary;
  if (
    !salary.capabilities.canViewSalary &&
    !salary.capabilities.canViewSlips &&
    !salary.capabilities.canManageSalary
  ) {
    return null;
  }
  return (
    <section className="hr-section hr-salary-section">
      <header className="hr-section__header">
        <div>
          <h2>Salary and private slips</h2>
          <p>
            Effective-dated compensation records and malware-scanned private PDFs. Managers do not
            receive salary access automatically.
          </p>
        </div>
        <LockKeyhole aria-hidden="true" />
      </header>

      <div className="hr-salary-summary" aria-label="Salary summary">
        <article>
          <BadgeDollarSign aria-hidden="true" />
          <div>
            <strong>{salary.structures.filter((item) => item.isCurrent).length}</strong>
            <span>Current structures</span>
          </div>
        </article>
        <article>
          <History aria-hidden="true" />
          <div>
            <strong>{salary.structures.length}</strong>
            <span>Visible revisions</span>
          </div>
        </article>
        <article>
          <FileText aria-hidden="true" />
          <div>
            <strong>{salary.slips.length}</strong>
            <span>Visible salary slips</span>
          </div>
        </article>
      </div>

      <SalaryRevisionForm data={data} />
      <GenerateSalarySlipForm data={data} />
      <UploadSalarySlipForm data={data} />

      {salary.capabilities.canViewSalary ? (
        <div>
          <h3>Salary revision history</h3>
          <div className="hr-salary-grid">
            {salary.structures.map((structure) => (
              <StructureCard key={structure.id} structure={structure} />
            ))}
          </div>
          {salary.structures.length === 0 ? (
            <p className="empty-state">No salary structure is visible.</p>
          ) : null}
        </div>
      ) : null}

      {salary.capabilities.canViewSlips ? (
        <div>
          <h3>Salary slips</h3>
          <div className="hr-salary-grid">
            {salary.slips.map((slip) => (
              <SalarySlipCard
                key={slip.id}
                slip={slip}
                canAcknowledge={salary.capabilities.canAcknowledgeSlips}
              />
            ))}
          </div>
          {salary.slips.length === 0 ? (
            <p className="empty-state">No salary slips are visible.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
