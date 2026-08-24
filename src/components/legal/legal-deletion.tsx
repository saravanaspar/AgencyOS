"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, DatabaseZap, ShieldCheck, Trash2 } from "lucide-react";

import { LegalActionMessage } from "@/components/legal/legal-action-message";
import { getDateTimeFormatter } from "@/lib/intl-formatters";
import {
  executeLegalDeletionAction,
  requestLegalDeletionAction,
  updateLegalDeletionPolicyAction,
} from "@/modules/legal/actions/deletion";
import type { LegalDeletionActionState } from "@/modules/legal/schemas/deletion";
import type { LegalDeletionWorkspaceData } from "@/modules/legal/server/deletion";

const idle: LegalDeletionActionState = { status: "idle" };
const dateTimeFormatter = getDateTimeFormatter("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

function PolicyForm({ data }: { data: LegalDeletionWorkspaceData }) {
  const [state, action, pending] = useActionState(updateLegalDeletionPolicyAction, idle);
  return (
    <form action={action} className="legal-deletion-policy">
      <div>
        <p className="eyebrow">Separation of duties</p>
        <h3>Second-person approval</h3>
        <p>
          When enabled, an Owner other than the requester must approve before any private object is
          removed. Approval policy routing can be further customized in Approvals.
        </p>
      </div>
      <label className="legal-checkbox">
        <input
          type="checkbox"
          name="secondApprovalRequired"
          defaultChecked={data.policy.secondApprovalRequired}
        />{" "}
        Require a second authorized user
      </label>
      <button className="button button--secondary" type="submit" disabled={pending}>
        Save deletion policy
      </button>
      <LegalActionMessage state={state} />
    </form>
  );
}

function DeletionRequestForm({ data }: { data: LegalDeletionWorkspaceData }) {
  const [state, action, pending] = useActionState(requestLegalDeletionAction, idle);
  const options = useMemo(
    () =>
      data.candidates.map((candidate) => ({
        ...candidate,
        value: `${candidate.targetType}:${candidate.targetId}`,
      })),
    [data.candidates],
  );
  const [selection, setSelection] = useState(options[0]?.value ?? "");
  const [targetType = "contract", targetId = ""] = selection.split(":");

  if (!options.length) {
    return (
      <div className="legal-deletion-empty">
        <ShieldCheck size={22} aria-hidden="true" />
        <div>
          <strong>No terminal legal records are available.</strong>
          <p>Terminate, expire, cancel, close, or archive a record before requesting deletion.</p>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="legal-deletion-request-form">
      <input type="hidden" name="targetType" value={targetType} />
      <input type="hidden" name="targetId" value={targetId} />
      <label>
        Legal record
        <select value={selection} onChange={(event) => setSelection(event.target.value)} required>
          {options.map((candidate) => (
            <option key={candidate.value} value={candidate.value}>
              {candidate.reference} · {candidate.title} · {candidate.status}
            </option>
          ))}
        </select>
      </label>
      <label className="legal-deletion-request-form__wide">
        Deletion justification
        <textarea
          name="reason"
          rows={4}
          minLength={10}
          maxLength={1000}
          required
          placeholder="State the retention basis, business reason, and authorization for deletion."
        />
      </label>
      <div className="legal-deletion-warning legal-deletion-request-form__wide">
        <AlertTriangle size={18} aria-hidden="true" />
        <p>
          AgencyOS rechecks legal hold, lifecycle, retention, sharing, publication, review, and file
          status at execution. Approved requests can still be blocked if eligibility changes.
        </p>
      </div>
      <div className="legal-deletion-request-form__wide">
        <button className="button button--danger" type="submit" disabled={pending || !targetId}>
          <Trash2 size={16} aria-hidden="true" /> Request controlled deletion
        </button>
        <LegalActionMessage state={state} />
      </div>
    </form>
  );
}

function ExecuteDeletionForm({ requestId, recovery }: { requestId: string; recovery: boolean }) {
  const [state, action, pending] = useActionState(executeLegalDeletionAction, idle);
  return (
    <form action={action} className="legal-deletion-execute-form">
      <input type="hidden" name="requestId" value={requestId} />
      <button className="button button--danger" type="submit" disabled={pending}>
        <DatabaseZap size={16} aria-hidden="true" />{" "}
        {recovery ? "Recover stalled purge" : "Execute secure deletion"}
      </button>
      <LegalActionMessage state={state} />
    </form>
  );
}

export function LegalDeletionWorkspace({ data }: { data: LegalDeletionWorkspaceData }) {
  return (
    <section className="legal-deletion-workspace" aria-labelledby="legal-deletion-heading">
      <div className="legal-workspace__toolbar">
        <div>
          <p className="eyebrow">Retention and disposal</p>
          <h2 id="legal-deletion-heading">Controlled legal deletion</h2>
          <p>
            Delete only terminal records that are outside retention, free of legal holds and active
            publication, unshared, approved where required, and backed by permanent audit evidence.
          </p>
        </div>
      </div>

      {data.capabilities.canConfigure ? (
        <section className="surface-card legal-deletion-card">
          <PolicyForm data={data} />
        </section>
      ) : null}

      {data.capabilities.canRequest ? (
        <section className="surface-card legal-deletion-card">
          <div className="legal-deletion-card__heading">
            <Trash2 size={20} aria-hidden="true" />
            <div>
              <h3>New deletion request</h3>
              <p>Only eligible contract and compliance-record content can enter this workflow.</p>
            </div>
          </div>
          <DeletionRequestForm data={data} />
        </section>
      ) : null}

      <section className="legal-deletion-history">
        <div className="legal-deletion-card__heading">
          <ShieldCheck size={20} aria-hidden="true" />
          <div>
            <h3>Permanent deletion history</h3>
            <p>
              Requests and object digests remain after the underlying private content is removed.
            </p>
          </div>
        </div>
        {data.requests.length ? (
          <div className="legal-deletion-list">
            {data.requests.map((request) => (
              <article className="surface-card legal-deletion-request" key={request.id}>
                <div className="legal-deletion-request__topline">
                  <div>
                    <span className={`status-badge status-badge--${request.status}`}>
                      {request.statusLabel}
                    </span>
                    <h4>
                      {request.targetReference} · {request.targetTitle}
                    </h4>
                    <p>
                      {request.targetTypeLabel} · target state {request.targetStatus} ·{" "}
                      {request.objectCount} private object{request.objectCount === 1 ? "" : "s"}
                    </p>
                  </div>
                  {request.status === "completed" ? (
                    <CheckCircle2 size={22} aria-label="Deletion completed" />
                  ) : null}
                </div>
                <dl className="legal-deletion-meta">
                  <div>
                    <dt>Requested</dt>
                    <dd>{dateTimeFormatter.format(new Date(request.requestedAt))}</dd>
                  </div>
                  <div>
                    <dt>Requester</dt>
                    <dd>{request.requestedByName}</dd>
                  </div>
                  <div>
                    <dt>Second approval</dt>
                    <dd>{request.secondApprovalRequired ? "Required" : "Disabled by policy"}</dd>
                  </div>
                  <div>
                    <dt>Completed</dt>
                    <dd>
                      {request.completedAt
                        ? dateTimeFormatter.format(new Date(request.completedAt))
                        : "Not completed"}
                    </dd>
                  </div>
                </dl>
                <p className="legal-deletion-reason">{request.reason}</p>
                {request.status === "pending_approval" && request.approvalRequestId ? (
                  <Link className="text-link" href="/approvals">
                    Open approval inbox
                  </Link>
                ) : null}
                {request.canExecute ? (
                  <ExecuteDeletionForm
                    requestId={request.id}
                    recovery={request.status === "purging"}
                  />
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <ShieldCheck size={28} aria-hidden="true" />
            <h3>No deletion requests</h3>
            <p>Controlled deletion activity will appear here permanently.</p>
          </div>
        )}
      </section>
    </section>
  );
}
