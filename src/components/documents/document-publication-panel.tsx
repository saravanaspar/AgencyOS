"use client";

import { CheckCircle2, ExternalLink, Send, Share2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";

import { DocumentActionMessage } from "@/components/documents/document-action-message";
import { Button } from "@/components/ui/button";
import { toDateTimeLocalValue } from "@/lib/date-time-local";
import { StatusBadge } from "@/components/ui/status-badge";
import { getDateTimeFormatter } from "@/lib/intl-formatters";
import {
  publishDocumentAction,
  submitDocumentReviewAction,
  withdrawDocumentPublicationAction,
} from "@/modules/documents/actions/publication";
import { documentReviewStatusLabels } from "@/modules/documents/documents";
import type { DocumentActionState } from "@/modules/documents/schemas/documents";
import type {
  DocumentPublicationSummary,
  DocumentSummary,
  DocumentWorkspaceData,
} from "@/modules/documents/server/documents";

const initialState: DocumentActionState = { status: "idle", message: "" };
const dateTime = getDateTimeFormatter("en", { dateStyle: "medium", timeStyle: "short" });

function publicationTone(state: DocumentPublicationSummary["state"]) {
  if (state === "published") return "success" as const;
  if (state === "scheduled") return "info" as const;
  if (state === "withdrawn" || state === "expired") return "error" as const;
  return "neutral" as const;
}

function ReviewHistory({ document }: { document: DocumentSummary }) {
  if (!document.reviews.length) return <p className="muted">No approval requests yet.</p>;
  return (
    <ol className="document-review-list">
      {document.reviews.map((review) => (
        <li key={review.id}>
          <div>
            <strong>Version {review.versionNumber}</strong>
            <small>
              Submitted by {review.submittedByName} ·{" "}
              {dateTime.format(new Date(review.submittedAt))}
            </small>
          </div>
          <StatusBadge
            tone={
              review.status === "approved"
                ? "success"
                : review.status === "pending"
                  ? "info"
                  : review.status === "rejected" || review.status === "revision_requested"
                    ? "error"
                    : "neutral"
            }
          >
            {documentReviewStatusLabels[review.status]}
          </StatusBadge>
        </li>
      ))}
    </ol>
  );
}

function ReviewControls({ document }: { document: DocumentSummary }) {
  const [state, action, pending] = useActionState(submitDocumentReviewAction, initialState);
  const latest = document.versions[0] ?? null;
  const pendingReview = document.reviews.find((review) => review.status === "pending");
  const approvedCurrent = document.reviews.some(
    (review) => review.status === "approved" && review.versionId === latest?.id,
  );

  return (
    <div className="document-publication-controls">
      <div>
        <h4>Formal review</h4>
        <p>
          Approval is pinned to one immutable version. Uploading another version is blocked while a
          review is pending.
        </p>
      </div>
      {approvedCurrent ? (
        <StatusBadge tone="success">
          <CheckCircle2 size={14} /> Current version approved
        </StatusBadge>
      ) : pendingReview ? (
        <div className="document-publication-controls__actions">
          <StatusBadge tone="info">Version {pendingReview.versionNumber} under review</StatusBadge>
          <Link className="text-link" href="/approvals">
            Open approvals <ExternalLink size={14} />
          </Link>
        </div>
      ) : document.access.canSubmitApproval && latest?.fileStatus === "available" ? (
        <form action={action} className="document-inline-form">
          <input type="hidden" name="documentId" value={document.id} />
          <Button type="submit" size="sm" disabled={pending}>
            <Send size={15} /> {pending ? "Submitting" : `Submit v${latest.versionNumber}`}
          </Button>
          <DocumentActionMessage state={state} />
        </form>
      ) : (
        <p className="muted">A clean current version and submit permission are required.</p>
      )}
    </div>
  );
}

function AudienceFields({ data }: { data: DocumentWorkspaceData }) {
  return (
    <div className="document-audience-grid">
      <label className="checkbox-row">
        <input type="checkbox" name="organizationWide" value="true" />
        <span>Everyone in the organization</span>
      </label>
      <label className="field">
        <span>Departments</span>
        <select
          name="departmentIds"
          multiple
          size={Math.min(5, Math.max(2, data.departments.length))}
        >
          {data.departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Teams</span>
        <select name="teamIds" multiple size={Math.min(5, Math.max(2, data.teams.length))}>
          {data.teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Named members</span>
        <select name="membershipIds" multiple size={Math.min(5, Math.max(2, data.members.length))}>
          {data.members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function PublicationForm({
  document,
  data,
}: {
  document: DocumentSummary;
  data: DocumentWorkspaceData;
}) {
  const [state, action, pending] = useActionState(publishDocumentAction, initialState);
  const latest = document.versions[0] ?? null;
  const approvedCurrent = document.reviews.some(
    (review) => review.status === "approved" && review.versionId === latest?.id,
  );
  if (!document.access.canPublish || !approvedCurrent) return null;

  return (
    <form action={action} className="document-publication-form">
      <input type="hidden" name="documentId" value={document.id} />
      <div className="document-publication-form__header">
        <div>
          <h4>Publish approved version {latest?.versionNumber}</h4>
          <p>A new release supersedes the current release without rewriting its history.</p>
        </div>
        <Share2 size={20} aria-hidden="true" />
      </div>
      <div className="document-form-grid">
        <label className="field">
          <span>Effective time</span>
          <input
            name="effectiveAt"
            type="datetime-local"
            required
            defaultValue={toDateTimeLocalValue()}
          />
        </label>
        <label className="field">
          <span>Optional expiry</span>
          <input name="expiresAt" type="datetime-local" />
        </label>
      </div>
      <label className="field">
        <span>Release note</span>
        <textarea name="releaseNote" rows={2} maxLength={1000} />
      </label>
      <AudienceFields data={data} />
      <small>Use Ctrl/Cmd to select multiple departments, teams, or members.</small>
      <Button type="submit" size="sm" disabled={pending}>
        <Share2 size={15} /> {pending ? "Publishing" : "Publish release"}
      </Button>
      <DocumentActionMessage state={state} />
    </form>
  );
}

function WithdrawControl({
  document,
  publication,
}: {
  document: DocumentSummary;
  publication: DocumentPublicationSummary;
}) {
  const [state, action, pending] = useActionState(withdrawDocumentPublicationAction, initialState);
  if (!document.access.canWithdraw || publication.status !== "active") return null;
  return (
    <form action={action} className="document-withdraw-form">
      <input type="hidden" name="documentId" value={document.id} />
      <input type="hidden" name="publicationId" value={publication.id} />
      <label className="field">
        <span>Withdrawal reason</span>
        <input name="reason" required minLength={3} maxLength={1000} />
      </label>
      <Button type="submit" size="sm" variant="danger" disabled={pending}>
        <Undo2 size={15} /> {pending ? "Withdrawing" : "Withdraw release"}
      </Button>
      <DocumentActionMessage state={state} />
    </form>
  );
}

function PublicationHistory({ document }: { document: DocumentSummary }) {
  if (!document.publications.length) return <p className="muted">No publication history yet.</p>;
  return (
    <div className="document-publication-history">
      {document.publications.map((publication) => (
        <article key={publication.id} className="document-publication-release">
          <div className="document-publication-release__header">
            <div>
              <strong>
                Release {publication.publicationNumber} · version {publication.versionNumber}
              </strong>
              <small>
                Published by {publication.publishedByName} ·{" "}
                {dateTime.format(new Date(publication.publishedAt))}
              </small>
            </div>
            <StatusBadge tone={publicationTone(publication.state)}>{publication.state}</StatusBadge>
          </div>
          <p>
            Effective {dateTime.format(new Date(publication.effectiveAt))}
            {publication.expiresAt
              ? ` · expires ${dateTime.format(new Date(publication.expiresAt))}`
              : " · no expiry"}
          </p>
          {publication.releaseNote ? <p>{publication.releaseNote}</p> : null}
          <div className="document-publication-audiences">
            {publication.audiences.map((audience) => (
              <span key={audience.id}>{audience.label}</span>
            ))}
          </div>
          <WithdrawControl document={document} publication={publication} />
        </article>
      ))}
    </div>
  );
}

export function DocumentPublicationPanel({
  document,
  data,
}: {
  document: DocumentSummary;
  data: DocumentWorkspaceData;
}) {
  return (
    <details className="document-card__panel">
      <summary>
        <Share2 size={16} aria-hidden="true" /> Approval and publishing
      </summary>
      <ReviewControls document={document} />
      <ReviewHistory document={document} />
      <PublicationForm document={document} data={data} />
      <PublicationHistory document={document} />
    </details>
  );
}
