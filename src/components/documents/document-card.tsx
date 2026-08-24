"use client";

import {
  Archive,
  Clock3,
  Download,
  Eye,
  FileCheck2,
  FilePlus2,
  Link2,
  LockKeyhole,
  MessageSquareText,
  RotateCcw,
  ShieldAlert,
  Tags,
  UserRoundCog,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useMemo, useState, type FormEvent } from "react";

import { DocumentActionMessage } from "@/components/documents/document-action-message";
import { DocumentPublicationPanel } from "@/components/documents/document-publication-panel";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { getDateTimeFormatter, getNumberFormatter } from "@/lib/intl-formatters";
import {
  addDocumentCommentAction,
  addDocumentEntityLinkAction,
  archiveDocumentAction,
  removeDocumentEntityLinkAction,
  revokeDocumentAccessAction,
  saveDocumentAccessGrantAction,
  setDocumentLegalHoldAction,
  updateDocumentMetadataAction,
} from "@/modules/documents/actions/documents";
import {
  documentAccessLevelLabels,
  documentAccessLevels,
  documentClassificationLabels,
  documentClassifications,
  documentEntityTypeLabels,
  documentEntityTypes,
  type DocumentEntityType,
} from "@/modules/documents/documents";
import type { DocumentActionState } from "@/modules/documents/schemas/documents";
import type { DocumentSummary, DocumentWorkspaceData } from "@/modules/documents/server/documents";

const initialState: DocumentActionState = { status: "idle", message: "" };
const dateTime = getDateTimeFormatter("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});
const bytesFormatter = getNumberFormatter("en", { maximumFractionDigits: 1 });

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${bytesFormatter.format(bytes / 1024)} KB`;
  return `${bytesFormatter.format(bytes / 1024 / 1024)} MB`;
}

function badgeTone(value: string): "success" | "warning" | "error" | "info" | "neutral" {
  if (["current", "available", "active"].includes(value)) return "success";
  if (["review_due", "quarantined", "scanning", "scan_failed"].includes(value)) return "warning";
  if (["expired", "rejected"].includes(value)) return "error";
  if (["hold", "restricted", "confidential"].includes(value)) return "info";
  return "neutral";
}

function VersionUpload({ document }: { document: DocumentSummary }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    setMessage("");
    try {
      const formData = new FormData(form);
      formData.set("documentId", document.id);
      formData.set("title", document.title);
      formData.set("description", document.description ?? "");
      formData.set("folderId", document.folderId ?? "");
      formData.set("categoryId", document.categoryId ?? "");
      formData.set("classification", document.classification);
      formData.set("ownerMembershipId", document.ownerMembershipId);
      formData.set("expiryDate", document.expiryDate ?? "");
      formData.set("reviewDate", document.reviewDate ?? "");
      formData.set("retentionUntil", document.retentionUntil ?? "");
      const response = await fetch("/api/documents/upload", { method: "POST", body: formData });
      const result = (await response.json()) as { message?: string };
      setMessage(result.message ?? "Version upload completed.");
      if (response.ok) {
        form.reset();
        router.refresh();
      }
    } catch {
      setMessage("Version could not be uploaded.");
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="document-version-upload" onSubmit={upload}>
      <label className="field">
        <span>Version note</span>
        <input name="versionNote" maxLength={500} required />
      </label>
      <label className="field document-version-upload__file">
        <span>Replacement file</span>
        <input
          name="file"
          type="file"
          required
          accept="application/pdf,image/jpeg,image/png,text/plain,text/csv,.docx,.xlsx"
        />
      </label>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Uploading" : "Upload new version"}
      </Button>
      {message ? <small role="status">{message}</small> : null}
    </form>
  );
}

function MetadataEditor({
  document,
  data,
}: {
  document: DocumentSummary;
  data: DocumentWorkspaceData;
}) {
  const [state, action, pending] = useActionState(updateDocumentMetadataAction, initialState);
  return (
    <details className="document-card__panel">
      <summary>
        <FileCheck2 size={16} aria-hidden="true" /> Metadata and tags
      </summary>
      <form action={action} className="document-metadata-form">
        <input type="hidden" name="documentId" value={document.id} />
        <label className="field document-metadata-form__wide">
          <span>Title</span>
          <input name="title" defaultValue={document.title} required maxLength={180} />
        </label>
        <label className="field document-metadata-form__wide">
          <span>Description</span>
          <textarea
            name="description"
            defaultValue={document.description ?? ""}
            rows={3}
            maxLength={2000}
          />
        </label>
        <label className="field">
          <span>Owner</span>
          <select name="ownerMembershipId" defaultValue={document.ownerMembershipId}>
            {data.members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Classification</span>
          <select name="classification" defaultValue={document.classification}>
            {documentClassifications.map((value) => (
              <option key={value} value={value}>
                {documentClassificationLabels[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Folder</span>
          <select name="folderId" defaultValue={document.folderId ?? ""}>
            <option value="">Library root</option>
            {data.folders.map((folder) =>
              folder.archivedAt ? null : (
                <option key={folder.id} value={folder.id}>
                  {folder.path}
                </option>
              ),
            )}
          </select>
        </label>
        <label className="field">
          <span>Category</span>
          <select name="categoryId" defaultValue={document.categoryId ?? ""}>
            <option value="">No category</option>
            {data.categories.map((category) =>
              category.status !== "active" ? null : (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ),
            )}
          </select>
        </label>
        <label className="field">
          <span>Review date</span>
          <input name="reviewDate" type="date" defaultValue={document.reviewDate ?? ""} />
        </label>
        <label className="field">
          <span>Expiry date</span>
          <input name="expiryDate" type="date" defaultValue={document.expiryDate ?? ""} />
        </label>
        <label className="field">
          <span>Retain until</span>
          <input name="retentionUntil" type="date" defaultValue={document.retentionUntil ?? ""} />
        </label>
        <fieldset className="document-metadata-form__tags">
          <legend>Tags</legend>
          {data.tags.map((tag) => (
            <label className="check-row" key={tag.id}>
              <input
                type="checkbox"
                name="tagIds"
                value={tag.id}
                defaultChecked={document.tags.some((current) => current.id === tag.id)}
              />{" "}
              {tag.name}
            </label>
          ))}
        </fieldset>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving" : "Save metadata"}
        </Button>
        <DocumentActionMessage state={state} />
      </form>
    </details>
  );
}

function EntityLinks({
  document,
  data,
}: {
  document: DocumentSummary;
  data: DocumentWorkspaceData;
}) {
  const [state, action, pending] = useActionState(addDocumentEntityLinkAction, initialState);
  const [type, setType] = useState<DocumentEntityType>("client");
  const options = useMemo(
    () => data.entityOptions.filter((option) => option.type === type),
    [data.entityOptions, type],
  );
  return (
    <details className="document-card__panel">
      <summary>
        <Link2 size={16} aria-hidden="true" /> Related records
      </summary>
      <ul className="document-link-list">
        {document.links.map((link) => (
          <li key={link.id}>
            <span>
              {documentEntityTypeLabels[link.entityType]}: {link.label}
            </span>
            <form action={removeDocumentEntityLinkAction}>
              <input type="hidden" name="documentId" value={document.id} />
              <input type="hidden" name="linkId" value={link.id} />
              <Button type="submit" variant="ghost" size="sm">
                Remove
              </Button>
            </form>
          </li>
        ))}
      </ul>
      <form action={action} className="document-inline-form">
        <input type="hidden" name="documentId" value={document.id} />
        <label className="field">
          <span>Type</span>
          <select
            name="entityType"
            value={type}
            onChange={(event) => setType(event.target.value as DocumentEntityType)}
          >
            {documentEntityTypes.map((value) => (
              <option key={value} value={value}>
                {documentEntityTypeLabels[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Record</span>
          <select name="entityId" defaultValue="" key={type} required>
            <option value="" disabled>
              Select record
            </option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Linking" : "Link record"}
        </Button>
        <DocumentActionMessage state={state} />
      </form>
    </details>
  );
}

function Comments({ document }: { document: DocumentSummary }) {
  const [state, action, pending] = useActionState(addDocumentCommentAction, initialState);
  return (
    <details className="document-card__panel">
      <summary>
        <MessageSquareText size={16} aria-hidden="true" /> Comments ({document.comments.length})
      </summary>
      <ol className="document-comment-list">
        {document.comments.map((comment) => (
          <li key={comment.id}>
            <p>{comment.body}</p>
            <small>
              {comment.authorName} · {dateTime.format(new Date(comment.createdAt))}
            </small>
          </li>
        ))}
      </ol>
      <form action={action} className="document-comment-form">
        <input type="hidden" name="documentId" value={document.id} />
        <label className="field">
          <span>Add comment</span>
          <textarea name="body" rows={3} required maxLength={2000} />
        </label>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Adding" : "Add comment"}
        </Button>
        <DocumentActionMessage state={state} />
      </form>
    </details>
  );
}

function AccessManager({
  document,
  data,
}: {
  document: DocumentSummary;
  data: DocumentWorkspaceData;
}) {
  const [state, action, pending] = useActionState(saveDocumentAccessGrantAction, initialState);
  return (
    <details className="document-card__panel">
      <summary>
        <UserRoundCog size={16} aria-hidden="true" /> Explicit access ({document.grants.length})
      </summary>
      <ul className="document-access-list">
        {document.grants.map((grant) => (
          <li key={grant.membershipId}>
            <span>
              {grant.memberName} · {documentAccessLevelLabels[grant.accessLevel]}
              {grant.expiresAt ? ` · until ${dateTime.format(new Date(grant.expiresAt))}` : ""}
            </span>
            <form action={revokeDocumentAccessAction}>
              <input type="hidden" name="documentId" value={document.id} />
              <input type="hidden" name="membershipId" value={grant.membershipId} />
              <Button type="submit" variant="ghost" size="sm">
                Revoke
              </Button>
            </form>
          </li>
        ))}
      </ul>
      <form action={action} className="document-inline-form">
        <input type="hidden" name="documentId" value={document.id} />
        <label className="field">
          <span>Member</span>
          <select name="membershipId" required defaultValue="">
            <option value="" disabled>
              Select member
            </option>
            {data.members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Access</span>
          <select name="accessLevel" defaultValue="viewer">
            {documentAccessLevels.map((level) => (
              <option key={level} value={level}>
                {documentAccessLevelLabels[level]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Expires</span>
          <input name="expiresAt" type="datetime-local" />
        </label>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving" : "Grant access"}
        </Button>
        <DocumentActionMessage state={state} />
      </form>
    </details>
  );
}

function LegalHoldAndArchive({ document }: { document: DocumentSummary }) {
  const [holdState, holdAction, holdPending] = useActionState(
    setDocumentLegalHoldAction,
    initialState,
  );
  const [archiveState, archiveAction, archivePending] = useActionState(
    archiveDocumentAction,
    initialState,
  );
  return (
    <details className="document-card__panel">
      <summary>
        <ShieldAlert size={16} aria-hidden="true" /> Retention and lifecycle
      </summary>
      {document.access.canLegalHold ? (
        <form action={holdAction} className="document-inline-form">
          <input type="hidden" name="documentId" value={document.id} />
          <input type="hidden" name="legalHold" value={document.legalHold ? "false" : "true"} />
          {document.legalHold ? (
            <p>Hold reason: {document.legalHoldReason}</p>
          ) : (
            <label className="field">
              <span>Legal-hold reason</span>
              <input name="reason" required minLength={3} maxLength={1000} />
            </label>
          )}
          <Button
            type="submit"
            size="sm"
            variant={document.legalHold ? "secondary" : "danger"}
            disabled={holdPending}
          >
            {holdPending
              ? "Saving"
              : document.legalHold
                ? "Release legal hold"
                : "Apply legal hold"}
          </Button>
          <DocumentActionMessage state={holdState} />
        </form>
      ) : null}
      {document.access.canArchive ? (
        <form action={archiveAction} className="document-inline-form">
          <input type="hidden" name="documentId" value={document.id} />
          <input
            type="hidden"
            name="archive"
            value={document.status === "active" ? "true" : "false"}
          />
          <Button type="submit" size="sm" variant="secondary" disabled={archivePending}>
            {document.status === "active" ? (
              <>
                <Archive size={15} /> Archive
              </>
            ) : (
              <>
                <RotateCcw size={15} /> Restore
              </>
            )}
          </Button>
          <DocumentActionMessage state={archiveState} />
        </form>
      ) : null}
    </details>
  );
}

function History({ document }: { document: DocumentSummary }) {
  return (
    <details className="document-card__panel">
      <summary>
        <Clock3 size={16} aria-hidden="true" /> Access and change history ({document.events.length})
      </summary>
      <ol className="document-event-list">
        {document.events.map((event) => (
          <li key={event.id}>
            <span>{event.eventType.replaceAll("_", " ").replaceAll(".", " · ")}</span>
            <small>
              {event.actorName ?? "System"} · {dateTime.format(new Date(event.createdAt))}
            </small>
          </li>
        ))}
      </ol>
    </details>
  );
}

export function DocumentCard({
  document,
  data,
}: {
  document: DocumentSummary;
  data: DocumentWorkspaceData;
}) {
  const latest = document.versions[0] ?? null;
  return (
    <article className="document-card">
      <header className="document-card__header">
        <div>
          <div className="document-card__badges">
            <StatusBadge tone={badgeTone(document.classification)}>
              {documentClassificationLabels[document.classification]}
            </StatusBadge>
            <StatusBadge tone={badgeTone(document.reviewState)}>
              {document.reviewState.replaceAll("_", " ")}
            </StatusBadge>
            <StatusBadge tone={badgeTone(document.retentionState)}>
              {document.retentionState}
            </StatusBadge>
            {document.legalHold ? (
              <StatusBadge tone="error">
                <LockKeyhole size={13} /> Legal hold
              </StatusBadge>
            ) : null}
            {document.status === "archived" ? <StatusBadge>Archived</StatusBadge> : null}
          </div>
          <h2>{document.title}</h2>
          <p>{document.description || "No description."}</p>
          <small>
            {document.folderPath ?? "Library root"} · {document.categoryName ?? "Uncategorized"} ·
            Owner: {document.ownerName}
          </small>
        </div>
        {latest && document.access.canDownload ? (
          <div className="document-card__primary-actions">
            {latest.fileStatus === "available" ? (
              <>
                {["application/pdf", "image/jpeg", "image/png", "text/plain", "text/csv"].includes(
                  latest.mimeType,
                ) ? (
                  <a
                    className="button button--secondary button--sm"
                    href={`/api/documents/${document.id}/versions/${latest.id}?mode=preview`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Eye size={15} /> Preview
                  </a>
                ) : null}
                <a
                  className="button button--primary button--sm"
                  href={`/api/documents/${document.id}/versions/${latest.id}`}
                >
                  <Download size={15} /> Download
                </a>
              </>
            ) : (
              <StatusBadge tone={badgeTone(latest.fileStatus)}>
                {latest.fileStatus.replaceAll("_", " ")}
              </StatusBadge>
            )}
          </div>
        ) : null}
      </header>
      <div className="document-card__meta">
        <span>
          <Tags size={14} /> {document.tags.map((tag) => tag.name).join(", ") || "No tags"}
        </span>
        <span>
          <Link2 size={14} /> {document.links.length} related
        </span>
        <span>
          <FilePlus2 size={14} /> {document.versions.length} version
          {document.versions.length === 1 ? "" : "s"}
        </span>
      </div>
      <details className="document-card__panel" open>
        <summary>
          <FilePlus2 size={16} aria-hidden="true" /> Version history
        </summary>
        <div className="table-scroll">
          <table className="document-version-table">
            <thead>
              <tr>
                <th>Version</th>
                <th>File</th>
                <th>Status</th>
                <th>Checksum</th>
                <th>Uploaded</th>
                <th>Open</th>
              </tr>
            </thead>
            <tbody>
              {document.versions.map((version) => (
                <tr key={version.id}>
                  <td>v{version.versionNumber}</td>
                  <td>
                    {version.fileName}
                    <small>
                      {formatBytes(version.sizeBytes)}
                      {version.versionNote ? ` · ${version.versionNote}` : ""}
                    </small>
                  </td>
                  <td>
                    <StatusBadge tone={badgeTone(version.fileStatus)}>
                      {version.fileStatus.replaceAll("_", " ")}
                    </StatusBadge>
                  </td>
                  <td>
                    <code>{version.sha256.slice(0, 12)}…</code>
                  </td>
                  <td>
                    {version.uploadedByName}
                    <small>{dateTime.format(new Date(version.createdAt))}</small>
                  </td>
                  <td>
                    {version.fileStatus === "available" && document.access.canDownload ? (
                      <a
                        className="text-link"
                        href={`/api/documents/${document.id}/versions/${version.id}`}
                      >
                        <Download size={14} /> Download
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {document.access.canEdit ? <VersionUpload document={document} /> : null}
      </details>
      {document.access.canEdit ? <MetadataEditor document={document} data={data} /> : null}
      {document.access.canEdit ? <EntityLinks document={document} data={data} /> : null}
      {document.access.canComment ? <Comments document={document} /> : null}
      {document.access.canManageAccess ? <AccessManager document={document} data={data} /> : null}
      <DocumentPublicationPanel document={document} data={data} />
      {document.access.canLegalHold || document.access.canArchive ? (
        <LegalHoldAndArchive document={document} />
      ) : null}
      <History document={document} />
    </article>
  );
}
