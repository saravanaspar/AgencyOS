"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  BadgeCheck,
  CalendarClock,
  FileCheck2,
  FileSignature,
  Landmark,
  Plus,
  Scale,
} from "lucide-react";

import { LegalActionMessage } from "@/components/legal/legal-action-message";
import { LegalAccessReviewWorkspace } from "@/components/legal/legal-access-review";
import { LegalComplianceWorkspace } from "@/components/legal/legal-compliance";
import { LegalDeletionWorkspace } from "@/components/legal/legal-deletion";
import { getNumberFormatter } from "@/lib/intl-formatters";
import {
  attachLegalContractVersionAction,
  saveLegalContractAction,
  saveLegalTemplateAction,
  submitLegalContractApprovalAction,
  updateLegalLifecycleAction,
  updateLegalSignatureAction,
} from "@/modules/legal/actions/legal";
import {
  legalContractTypeLabels,
  legalContractTypes,
  legalSignatureStatusLabels,
  legalSignatureStatuses,
  legalVersionKinds,
} from "@/modules/legal/legal";
import type { LegalActionState } from "@/modules/legal/schemas/legal";
import type { LegalAccessReviewWorkspaceData } from "@/modules/legal/server/access-review";
import type { LegalComplianceWorkspaceData } from "@/modules/legal/server/compliance";
import type { LegalDeletionWorkspaceData } from "@/modules/legal/server/deletion";
import type { LegalContractSummary, LegalWorkspaceData } from "@/modules/legal/server/legal";

const idle: LegalActionState = { status: "idle" };

function money(value: number | null, currency: string | null) {
  if (value === null || !currency) return "Not recorded";
  return getNumberFormatter("en", { style: "currency", currency }).format(value / 100);
}

function ContractForm({
  data,
  contract,
}: {
  data: LegalWorkspaceData;
  contract?: LegalContractSummary;
}) {
  const [state, action, pending] = useActionState(saveLegalContractAction, idle);
  return (
    <form action={action} className="legal-form-grid">
      {contract ? <input type="hidden" name="contractId" value={contract.id} /> : null}
      <label>
        Internal reference
        <input
          name="internalReference"
          defaultValue={contract?.internalReference ?? ""}
          placeholder="CTR-2026-001"
          required
        />
      </label>
      <label className="legal-form-grid__wide">
        Title
        <input name="title" defaultValue={contract?.title ?? ""} required maxLength={180} />
      </label>
      <label>
        Contract type
        <select name="contractType" defaultValue={contract?.contractType ?? "client_contract"}>
          {legalContractTypes.map((type) => (
            <option key={type} value={type}>
              {legalContractTypeLabels[type]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Counterparty
        <input name="counterpartyName" defaultValue={contract?.counterpartyName ?? ""} required />
      </label>
      <label>
        Linked CRM company
        <select name="counterpartyCompanyId" defaultValue={contract?.counterpartyCompanyId ?? ""}>
          <option value="">No linked company</option>
          {data.companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Responsible owner
        <select
          name="responsibleOwnerMembershipId"
          defaultValue={contract?.responsibleOwnerMembershipId ?? data.members[0]?.id ?? ""}
          required
        >
          {data.members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Department
        <select name="departmentId" defaultValue={contract?.departmentId ?? ""}>
          <option value="">No department</option>
          {data.departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Template
        <select name="templateId" defaultValue={contract?.templateId ?? ""}>
          <option value="">No template selected</option>
          {data.templates.map((template) =>
            template.status === "active" ? (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ) : null,
          )}
        </select>
      </label>
      <label>
        Effective date
        <input type="date" name="effectiveDate" defaultValue={contract?.effectiveDate ?? ""} />
      </label>
      <label>
        End date
        <input type="date" name="endDate" defaultValue={contract?.endDate ?? ""} />
      </label>
      <label>
        Renewal date
        <input type="date" name="renewalDate" defaultValue={contract?.renewalDate ?? ""} />
      </label>
      <label>
        Notice period days
        <input
          type="number"
          name="noticePeriodDays"
          min={0}
          max={3650}
          defaultValue={contract?.noticePeriodDays ?? ""}
        />
      </label>
      <label>
        Jurisdiction
        <input name="jurisdiction" defaultValue={contract?.jurisdiction ?? ""} maxLength={120} />
      </label>
      <label>
        Governing law
        <input name="governingLaw" defaultValue={contract?.governingLaw ?? ""} maxLength={160} />
      </label>
      <label>
        Contract value (minor units)
        <input
          type="number"
          name="contractValueMinor"
          min={0}
          defaultValue={contract?.contractValueMinor ?? ""}
        />
      </label>
      <label>
        Currency
        <input
          name="currency"
          defaultValue={contract?.currency ?? ""}
          maxLength={3}
          placeholder="INR"
        />
      </label>
      <label className="legal-checkbox">
        <input
          type="checkbox"
          name="financeReviewRequired"
          defaultChecked={contract?.financeReviewRequired ?? false}
        />{" "}
        Finance review required
      </label>
      <label className="legal-checkbox">
        <input
          type="checkbox"
          name="ownerApprovalRequired"
          defaultChecked={contract?.ownerApprovalRequired ?? false}
        />{" "}
        Owner approval required
      </label>
      <div className="legal-form-grid__wide">
        <button type="submit" className="button button--primary" disabled={pending}>
          {contract ? "Save draft" : "Create contract request"}
        </button>
        <LegalActionMessage state={state} />
      </div>
    </form>
  );
}

function VersionForm({
  data,
  contract,
  kindMode,
}: {
  data: LegalWorkspaceData;
  contract: LegalContractSummary;
  kindMode: "draft" | "signed";
}) {
  const [state, action, pending] = useActionState(attachLegalContractVersionAction, idle);
  const [documentId, setDocumentId] = useState(data.documents[0]?.id ?? "");
  const document = data.documents.find((item) => item.id === documentId);
  const selectableKinds =
    kindMode === "signed" ? (["signed"] as const) : legalVersionKinds.slice(0, -1);
  return (
    <form action={action} className="legal-inline-form">
      <input type="hidden" name="contractId" value={contract.id} />
      <label>
        Document
        <select
          name="documentId"
          value={documentId}
          onChange={(event) => setDocumentId(event.target.value)}
          required
        >
          {data.documents.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
      </label>
      <label>
        Version
        <select name="documentVersionId" required>
          {(document?.versions ?? []).map((version) => (
            <option key={version.id} value={version.id} disabled={version.status !== "clean"}>
              v{version.versionNumber} · {version.fileName} · {version.status}
            </option>
          ))}
        </select>
      </label>
      <label>
        Kind
        <select name="versionKind" defaultValue={kindMode === "signed" ? "signed" : "draft"}>
          {selectableKinds.map((kind) => (
            <option key={kind} value={kind}>
              {kind.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </label>
      <label className="legal-inline-form__grow">
        Note
        <input name="note" maxLength={500} />
      </label>
      <button
        type="submit"
        className="button button--secondary"
        disabled={pending || !document?.versions.length}
      >
        Attach version
      </button>
      <LegalActionMessage state={state} />
    </form>
  );
}

function ContractCard({
  data,
  contract,
}: {
  data: LegalWorkspaceData;
  contract: LegalContractSummary;
}) {
  const [expanded, setExpanded] = useState(false);
  const [signatureState, signatureAction, signaturePending] = useActionState(
    updateLegalSignatureAction,
    idle,
  );
  const [lifecycleState, lifecycleAction, lifecyclePending] = useActionState(
    updateLegalLifecycleAction,
    idle,
  );
  return (
    <article className="legal-contract-card">
      <header className="legal-contract-card__header">
        <div>
          <p className="eyebrow">
            {contract.internalReference} · {contract.contractTypeLabel}
          </p>
          <h3>{contract.title}</h3>
          <p>
            {contract.counterpartyName} · Owner: {contract.ownerName}
          </p>
        </div>
        <div className="legal-contract-card__badges">
          <span className={`status-badge status-badge--${contract.status}`}>
            {contract.statusLabel}
          </span>
          <span className={`status-badge status-badge--${contract.timingState}`}>
            {contract.timingState.replaceAll("_", " ")}
          </span>
        </div>
      </header>
      <dl className="legal-contract-meta">
        <div>
          <dt>Dates</dt>
          <dd>
            {contract.effectiveDate ?? "—"} → {contract.endDate ?? "Open-ended"}
          </dd>
        </div>
        <div>
          <dt>Renewal</dt>
          <dd>{contract.renewalDate ?? "—"}</dd>
        </div>
        <div>
          <dt>Value</dt>
          <dd>{money(contract.contractValueMinor, contract.currency)}</dd>
        </div>
        <div>
          <dt>Signature</dt>
          <dd>{contract.signatureStatusLabel}</dd>
        </div>
        <div>
          <dt>Template</dt>
          <dd>{contract.templateName ?? "None"}</dd>
        </div>
        <div>
          <dt>Review path</dt>
          <dd>
            Legal{contract.financeReviewRequired ? " → Finance" : ""}
            {contract.ownerApprovalRequired ? " → Owner" : ""}
          </dd>
        </div>
      </dl>
      <div className="legal-contract-card__actions">
        <button
          type="button"
          className="button button--secondary"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Hide details" : "Manage contract"}
        </button>
        {contract.canReview && contract.status === "draft" && contract.versions.length > 0 ? (
          <form action={submitLegalContractApprovalAction}>
            <input type="hidden" name="contractId" value={contract.id} />
            <button type="submit" className="button button--primary">
              Submit for approval
            </button>
          </form>
        ) : null}
      </div>
      {expanded ? (
        <div className="legal-contract-card__details">
          {contract.canEdit ? (
            <details>
              <summary>Edit metadata</summary>
              <ContractForm data={data} contract={contract} />
            </details>
          ) : null}
          {contract.canEdit ? (
            <details>
              <summary>Attach immutable draft version</summary>
              <VersionForm data={data} contract={contract} kindMode="draft" />
            </details>
          ) : null}
          {contract.canManageSignatures &&
          ["approved", "awaiting_signature"].includes(contract.status) ? (
            <details>
              <summary>Attach immutable signed copy</summary>
              <VersionForm data={data} contract={contract} kindMode="signed" />
            </details>
          ) : null}
          <section>
            <h4>Versions</h4>
            {contract.versions.length ? (
              <ol className="legal-version-list">
                {contract.versions.map((version) => (
                  <li key={version.id}>
                    <div>
                      <strong>
                        v{version.versionNumber} · {version.versionKind}
                      </strong>
                      <span>
                        {version.documentTitle} · {version.documentFileName}
                      </span>
                    </div>
                    <span>{version.status}</span>
                    {version.canOpen ? (
                      <a
                        className="button button--ghost"
                        href={`/api/documents/${version.documentId}/versions/${version.documentVersionId}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open
                      </a>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p>No contract document version attached yet. Upload it in Documents first.</p>
            )}
          </section>
          {contract.canManageSignatures &&
          ["approved", "awaiting_signature"].includes(contract.status) ? (
            <form action={signatureAction} className="legal-inline-form">
              <input type="hidden" name="contractId" value={contract.id} />
              <label>
                Signature status
                <select name="signatureStatus" defaultValue={contract.signatureStatus}>
                  {legalSignatureStatuses.map((status) => (
                    <option key={status} value={status}>
                      {legalSignatureStatusLabels[status]}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                className="button button--secondary"
                disabled={signaturePending}
              >
                Update signature
              </button>
              <LegalActionMessage state={signatureState} />
            </form>
          ) : null}
          {contract.canManageLifecycle ? (
            <form action={lifecycleAction} className="legal-inline-form">
              <input type="hidden" name="contractId" value={contract.id} />
              <label>
                Lifecycle action
                <select name="action" defaultValue="activate">
                  <option value="await_signature">Move to awaiting signature</option>
                  <option value="activate">Activate signed contract</option>
                  <option value="terminate">Terminate</option>
                  <option value="expire">Mark expired</option>
                  <option value="cancel">Cancel draft</option>
                </select>
              </label>
              <label className="legal-inline-form__grow">
                Reason
                <input name="reason" maxLength={1000} />
              </label>
              <button type="submit" className="button button--danger" disabled={lifecyclePending}>
                Apply
              </button>
              <LegalActionMessage state={lifecycleState} />
            </form>
          ) : null}
          <section>
            <h4>Recent lifecycle history</h4>
            <ol className="legal-event-list">
              {contract.events.map((event) => (
                <li key={event.id}>
                  <span>{event.eventType.replaceAll("_", " ")}</span>
                  <small>
                    {event.actorName ?? "System"} ·{" "}
                    {new Date(event.createdAt).toLocaleString("en", { timeZone: "UTC" })} UTC
                  </small>
                </li>
              ))}
            </ol>
          </section>
        </div>
      ) : null}
    </article>
  );
}

function TemplatePanel({ data }: { data: LegalWorkspaceData }) {
  const [state, action, pending] = useActionState(saveLegalTemplateAction, idle);
  const [documentId, setDocumentId] = useState(data.documents[0]?.id ?? "");
  const document = data.documents.find((item) => item.id === documentId);
  return (
    <section className="surface-card legal-admin-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Reusable source files</p>
          <h2>Contract templates</h2>
        </div>
        <FileSignature size={22} aria-hidden="true" />
      </div>
      <p>
        Register a clean, immutable Documents version as a contract template. Replacing a template
        never changes contracts that already reference an older version.
      </p>
      <form action={action} className="legal-form-grid">
        <label>
          Name
          <input name="name" required />
        </label>
        <label>
          Type
          <select name="contractType">
            {legalContractTypes.map((type) => (
              <option key={type} value={type}>
                {legalContractTypeLabels[type]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Document
          <select
            name="sourceDocumentId"
            value={documentId}
            onChange={(event) => setDocumentId(event.target.value)}
            required
          >
            {data.documents.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Version
          <select name="sourceVersionId" required>
            {(document?.versions ?? []).map((version) => (
              <option key={version.id} value={version.id} disabled={version.status !== "clean"}>
                v{version.versionNumber} · {version.fileName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select name="status" defaultValue="active">
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
        <label className="legal-form-grid__wide">
          Description
          <input name="description" maxLength={1000} />
        </label>
        <div className="legal-form-grid__wide">
          <button
            className="button button--secondary"
            type="submit"
            disabled={pending || !document?.versions.length}
          >
            Register template
          </button>
          <LegalActionMessage state={state} />
        </div>
      </form>
      <ul className="legal-template-list">
        {data.templates.map((template) => (
          <li key={template.id}>
            <strong>{template.name}</strong>
            <span>
              {legalContractTypeLabels[template.contractType]} · {template.sourceDocumentTitle} v
              {template.sourceVersionNumber} · {template.status}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function LegalWorkspace({
  data,
  complianceData,
  deletionData,
  accessReviewData,
}: {
  data: LegalWorkspaceData;
  complianceData: LegalComplianceWorkspaceData;
  deletionData: LegalDeletionWorkspaceData | null;
  accessReviewData: LegalAccessReviewWorkspaceData | null;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const searchParams = useSearchParams();
  useEffect(() => {
    if (searchParams.get("create") === "contract") setShowCreate(true);
  }, [searchParams]);
  const stats = useMemo(
    () => [
      { label: "Visible contracts", value: data.summary.total, icon: Scale },
      { label: "In review", value: data.summary.inReview, icon: FileCheck2 },
      { label: "Active", value: data.summary.active, icon: BadgeCheck },
      {
        label: "Renewal/notice due",
        value: data.summary.renewalDue + data.summary.noticeDue,
        icon: CalendarClock,
      },
      { label: "Awaiting signature", value: data.summary.unsigned, icon: FileSignature },
    ],
    [data.summary],
  );
  return (
    <div className="legal-workspace">
      <section className="legal-summary-grid">
        {stats.map(({ label, value, icon: Icon }) => (
          <article key={label} className="surface-card legal-summary-card">
            <Icon size={20} aria-hidden="true" />
            <strong>{value}</strong>
            <span>{label}</span>
          </article>
        ))}
      </section>
      <div className="legal-workspace__toolbar">
        <div>
          <p className="eyebrow">Lifecycle control</p>
          <h2>Contracts</h2>
        </div>
        {data.capabilities.canCreate ? (
          <button
            type="button"
            className="button button--primary"
            onClick={() => setShowCreate((value) => !value)}
          >
            <Plus size={16} aria-hidden="true" />{" "}
            {showCreate ? "Close request form" : "New contract request"}
          </button>
        ) : null}
      </div>
      {showCreate ? (
        <section className="surface-card legal-create-card">
          <ContractForm data={data} />
        </section>
      ) : null}
      <section className="legal-contract-list">
        {data.contracts.length ? (
          data.contracts.map((contract) => (
            <ContractCard key={contract.id} data={data} contract={contract} />
          ))
        ) : (
          <div className="empty-state">
            <Landmark size={28} aria-hidden="true" />
            <h3>No contracts found</h3>
            <p>Create a contract request or change the search filters.</p>
          </div>
        )}
      </section>
      {data.capabilities.canManageTemplates ? <TemplatePanel data={data} /> : null}
      <LegalComplianceWorkspace data={complianceData} />
      {deletionData ? <LegalDeletionWorkspace data={deletionData} /> : null}
      {accessReviewData ? <LegalAccessReviewWorkspace data={accessReviewData} /> : null}
    </div>
  );
}
