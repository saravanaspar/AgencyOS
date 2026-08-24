"use client";

import { useActionState, useMemo, useState } from "react";
import {
  Archive,
  CalendarClock,
  FileLock2,
  FileSearch,
  FolderLock,
  Plus,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";

import { LegalActionMessage } from "@/components/legal/legal-action-message";
import { getDateTimeFormatter } from "@/lib/intl-formatters";
import {
  saveLegalComplianceRecordAction,
  updateLegalComplianceLifecycleAction,
} from "@/modules/legal/actions/compliance";
import {
  legalComplianceConfidentialityLabels,
  legalComplianceConfidentialityLevels,
  legalComplianceRecordTypeLabels,
  legalComplianceRecordTypes,
} from "@/modules/legal/compliance";
import type { LegalActionState } from "@/modules/legal/schemas/legal";
import type {
  LegalComplianceRecordSummary,
  LegalComplianceWorkspaceData,
} from "@/modules/legal/server/compliance";

const idle: LegalActionState = { status: "idle" };
const dateFormatter = getDateTimeFormatter("en", { dateStyle: "medium" });
const dateTimeFormatter = getDateTimeFormatter("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

function dateLabel(value: string | null): string {
  if (!value) return "Not set";
  return dateFormatter.format(new Date(`${value}T00:00:00Z`));
}

function ComplianceRecordForm({
  data,
  record,
  onDone,
}: {
  data: LegalComplianceWorkspaceData;
  record?: LegalComplianceRecordSummary;
  onDone?: () => void;
}) {
  const [state, action, pending] = useActionState(saveLegalComplianceRecordAction, idle);
  const [documentId, setDocumentId] = useState(record?.documentId ?? data.documents[0]?.id ?? "");
  const document = data.documents.find((item) => item.id === documentId);
  const defaultVersionId =
    record?.documentId === documentId
      ? record.documentVersionId
      : (document?.versions[0]?.id ?? "");

  return (
    <form action={action} className="legal-compliance-form">
      {record ? <input type="hidden" name="recordId" value={record.id} /> : null}
      <label>
        Internal reference
        <input
          name="internalReference"
          defaultValue={record?.internalReference ?? ""}
          placeholder="COMP-2026-001"
          required
        />
      </label>
      <label className="legal-compliance-form__wide">
        Title
        <input name="title" defaultValue={record?.title ?? ""} maxLength={180} required />
      </label>
      <label>
        Record type
        <select name="recordType" defaultValue={record?.recordType ?? "privacy_document"}>
          {legalComplianceRecordTypes.map((type) => (
            <option key={type} value={type}>
              {legalComplianceRecordTypeLabels[type]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Responsible owner
        <select
          name="responsibleOwnerMembershipId"
          defaultValue={record?.responsibleOwnerMembershipId ?? data.members[0]?.id ?? ""}
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
        <select name="departmentId" defaultValue={record?.departmentId ?? ""}>
          <option value="">No department</option>
          {data.departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Issuing authority / counterparty
        <input
          name="issuingAuthority"
          defaultValue={record?.issuingAuthority ?? ""}
          maxLength={180}
        />
      </label>
      <label>
        Jurisdiction
        <input name="jurisdiction" defaultValue={record?.jurisdiction ?? ""} maxLength={120} />
      </label>
      <label>
        Identifier final four
        <input
          name="identifierLastFour"
          defaultValue={record?.identifierLastFour ?? ""}
          maxLength={4}
          autoComplete="off"
          placeholder="1234"
        />
      </label>
      <label>
        Issue date
        <input type="date" name="issueDate" defaultValue={record?.issueDate ?? ""} />
      </label>
      <label>
        Effective date
        <input type="date" name="effectiveDate" defaultValue={record?.effectiveDate ?? ""} />
      </label>
      <label>
        Expiry date
        <input type="date" name="expiryDate" defaultValue={record?.expiryDate ?? ""} />
      </label>
      <label>
        Renewal date
        <input type="date" name="renewalDate" defaultValue={record?.renewalDate ?? ""} />
      </label>
      <label>
        Review date
        <input type="date" name="reviewDate" defaultValue={record?.reviewDate ?? ""} />
      </label>
      <label>
        Response due date
        <input type="date" name="responseDueDate" defaultValue={record?.responseDueDate ?? ""} />
      </label>
      <label>
        Confidentiality
        <select
          name="confidentialityLevel"
          defaultValue={record?.confidentialityLevel ?? "confidential"}
        >
          {legalComplianceConfidentialityLevels.map((level) => (
            <option key={level} value={level}>
              {legalComplianceConfidentialityLabels[level]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Linked document
        <select
          name="documentId"
          value={documentId}
          onChange={(event) => setDocumentId(event.target.value)}
          required
        >
          {data.documents.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title} · {item.classification}
            </option>
          ))}
        </select>
      </label>
      <label>
        Immutable version
        <select key={documentId} name="documentVersionId" defaultValue={defaultVersionId} required>
          {(document?.versions ?? []).map((version) => (
            <option key={version.id} value={version.id} disabled={version.status !== "available"}>
              v{version.versionNumber} · {version.fileName} · {version.status}
            </option>
          ))}
        </select>
      </label>
      {data.capabilities.canManagePrivileged ? (
        <label className="legal-checkbox legal-compliance-form__wide">
          <input type="checkbox" name="legalPrivilege" defaultChecked={record?.legalPrivilege} />
          Legally privileged — linked document must be Restricted
        </label>
      ) : (
        <input type="hidden" name="legalPrivilege" value="false" />
      )}
      <label className="legal-compliance-form__wide">
        Internal summary
        <textarea name="summary" defaultValue={record?.summary ?? ""} maxLength={2000} rows={3} />
      </label>
      <div className="legal-compliance-form__wide legal-compliance-form__actions">
        <button type="submit" className="button button--primary" disabled={pending || !documentId}>
          {record ? "Save compliance record" : "Create compliance record"}
        </button>
        {onDone ? (
          <button type="button" className="button button--ghost" onClick={onDone}>
            Cancel
          </button>
        ) : null}
        <LegalActionMessage state={state} />
      </div>
    </form>
  );
}

function LifecycleForm({
  record,
  actionName,
}: {
  record: LegalComplianceRecordSummary;
  actionName: "close" | "archive" | "restore";
}) {
  const [state, action, pending] = useActionState(updateLegalComplianceLifecycleAction, idle);
  return (
    <form action={action} className="legal-compliance-lifecycle-form">
      <input type="hidden" name="recordId" value={record.id} />
      <input type="hidden" name="action" value={actionName} />
      {actionName === "close" ? (
        <input name="reason" required maxLength={1000} placeholder="Closure reason" />
      ) : null}
      <button type="submit" className="button button--secondary" disabled={pending}>
        {actionName === "close" ? "Close record" : actionName === "archive" ? "Archive" : "Restore"}
      </button>
      <LegalActionMessage state={state} />
    </form>
  );
}

function ComplianceRecordCard({
  data,
  record,
}: {
  data: LegalComplianceWorkspaceData;
  record: LegalComplianceRecordSummary;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <article className="surface-card legal-compliance-card">
      <header className="legal-compliance-card__header">
        <div>
          <div className="legal-compliance-card__badges">
            <span className="status-badge">{record.recordTypeLabel}</span>
            <span className={`status-badge status-badge--${record.status}`}>
              {record.statusLabel}
            </span>
            <span className="status-badge">{record.confidentialityLabel}</span>
            {record.legalPrivilege ? <span className="status-badge">Privileged</span> : null}
          </div>
          <h3>{record.title}</h3>
          <p>
            {record.internalReference} · Owner: {record.ownerName}
            {record.departmentName ? ` · ${record.departmentName}` : ""}
          </p>
        </div>
        <strong className={`legal-timing-state legal-timing-state--${record.timingState}`}>
          {record.timingState.replaceAll("_", " ")}
        </strong>
      </header>

      <dl className="legal-compliance-card__facts">
        <div>
          <dt>Authority</dt>
          <dd>{record.issuingAuthority ?? "Not recorded"}</dd>
        </div>
        <div>
          <dt>Identifier</dt>
          <dd>
            {record.identifierLastFour ? `•••• ${record.identifierLastFour}` : "Not recorded"}
          </dd>
        </div>
        <div>
          <dt>Effective</dt>
          <dd>{dateLabel(record.effectiveDate ?? record.issueDate)}</dd>
        </div>
        <div>
          <dt>Expiry</dt>
          <dd>{dateLabel(record.expiryDate)}</dd>
        </div>
        <div>
          <dt>Review</dt>
          <dd>{dateLabel(record.reviewDate)}</dd>
        </div>
        <div>
          <dt>Response due</dt>
          <dd>{dateLabel(record.responseDueDate)}</dd>
        </div>
      </dl>

      {record.summary ? <p className="legal-compliance-card__summary">{record.summary}</p> : null}

      <div className="legal-compliance-card__document">
        <FileLock2 size={18} aria-hidden="true" />
        <span>
          {record.documentTitle} · v{record.documentVersionNumber} · {record.documentFileName}
        </span>
        {record.canOpen ? (
          <a
            className="button button--secondary"
            href={`/api/documents/${record.documentId}/versions/${record.documentVersionId}?mode=preview`}
            target="_blank"
            rel="noreferrer"
          >
            Open
          </a>
        ) : null}
      </div>

      {record.reminders.length ? (
        <div className="legal-compliance-card__reminders">
          {record.reminders.map((reminder) => (
            <span key={`${reminder.type}-${reminder.remindOn}`}>
              <CalendarClock size={14} aria-hidden="true" /> {reminder.type}:{" "}
              {dateLabel(reminder.remindOn)}
            </span>
          ))}
        </div>
      ) : null}

      <div className="legal-compliance-card__actions">
        {record.canEdit ? (
          <button
            type="button"
            className="button button--secondary"
            onClick={() => setEditing((value) => !value)}
          >
            {editing ? "Close editor" : "Edit metadata / version"}
          </button>
        ) : null}
        {record.canManageLifecycle && record.status === "active" ? (
          <LifecycleForm record={record} actionName="close" />
        ) : null}
        {record.canManageLifecycle && record.status === "closed" ? (
          <LifecycleForm record={record} actionName="archive" />
        ) : null}
        {record.canManageLifecycle && record.status === "archived" ? (
          <LifecycleForm record={record} actionName="restore" />
        ) : null}
      </div>

      {editing ? (
        <div className="legal-compliance-card__editor">
          <ComplianceRecordForm data={data} record={record} onDone={() => setEditing(false)} />
        </div>
      ) : null}

      {record.events.length ? (
        <details className="legal-compliance-card__history">
          <summary>History ({record.events.length})</summary>
          <ol>
            {record.events.map((event) => (
              <li key={event.id}>
                <strong>{event.eventType.replaceAll("_", " ")}</strong>
                <span>
                  {event.actorName ?? "System"} ·{" "}
                  {dateTimeFormatter.format(new Date(event.createdAt))}
                </span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </article>
  );
}

export function LegalComplianceWorkspace({ data }: { data: LegalComplianceWorkspaceData }) {
  const [showCreate, setShowCreate] = useState(false);
  const stats = useMemo(
    () => [
      { label: "Visible records", value: data.summary.total, icon: FileSearch },
      { label: "Active", value: data.summary.active, icon: ShieldCheck },
      { label: "Review / response due", value: data.summary.due, icon: CalendarClock },
      { label: "Expired", value: data.summary.expired, icon: Archive },
      { label: "Privileged", value: data.summary.privileged, icon: FolderLock },
    ],
    [data.summary],
  );

  return (
    <section className="legal-compliance-workspace" aria-labelledby="legal-compliance-title">
      <div className="legal-workspace__toolbar">
        <div>
          <p className="eyebrow">Compliance and corporate records</p>
          <h2 id="legal-compliance-title">Legal records</h2>
          <p>
            Track registrations, tax records, licences, insurance, IP, resolutions, notices,
            disputes, reviews, responses, renewals, and expiry against immutable Documents files.
          </p>
        </div>
        {data.capabilities.canCreate ? (
          <button
            type="button"
            className="button button--primary"
            onClick={() => setShowCreate((value) => !value)}
          >
            <Plus size={16} aria-hidden="true" /> {showCreate ? "Close form" : "New legal record"}
          </button>
        ) : null}
      </div>

      <div className="legal-summary-grid">
        {stats.map(({ label, value, icon: Icon }) => (
          <article key={label} className="surface-card legal-summary-card">
            <Icon size={20} aria-hidden="true" />
            <strong>{value}</strong>
            <span>{label}</span>
          </article>
        ))}
      </div>

      {showCreate ? (
        <section className="surface-card legal-create-card">
          {data.documents.length ? (
            <ComplianceRecordForm data={data} />
          ) : (
            <div className="empty-state">
              <RotateCcw size={24} aria-hidden="true" />
              <h3>Upload a document first</h3>
              <p>Create and scan the legal file in Documents before registering its metadata.</p>
            </div>
          )}
        </section>
      ) : null}

      <div className="legal-compliance-list">
        {data.records.length ? (
          data.records.map((record) => (
            <ComplianceRecordCard key={record.id} data={data} record={record} />
          ))
        ) : (
          <div className="empty-state">
            <FileSearch size={28} aria-hidden="true" />
            <h3>No legal records found</h3>
            <p>Create a compliance record or change the filters.</p>
          </div>
        )}
      </div>
    </section>
  );
}
