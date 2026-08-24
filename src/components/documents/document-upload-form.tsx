"use client";

import { FileUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  documentClassificationLabels,
  documentClassifications,
  documentEntityTypeLabels,
  documentEntityTypes,
  type DocumentEntityType,
} from "@/modules/documents/documents";
import type { DocumentWorkspaceData } from "@/modules/documents/server/documents";

export function DocumentUploadForm({ data }: { data: DocumentWorkspaceData }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [entityType, setEntityType] = useState<DocumentEntityType | "">("");
  const entityOptions = useMemo(
    () => data.entityOptions.filter((option) => option.type === entityType),
    [data.entityOptions, entityType],
  );
  if (!data.capabilities.canCreate) return null;

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/documents/upload", {
        method: "POST",
        body: new FormData(form),
      });
      const result = (await response.json()) as { message?: string };
      setMessage(result.message ?? "Document upload completed.");
      if (response.ok) {
        form.reset();
        setEntityType("");
        router.refresh();
      }
    } catch {
      setMessage("Document could not be uploaded.");
    } finally {
      setPending(false);
    }
  }

  return (
    <details className="document-create-panel">
      <summary>
        <FileUp size={17} aria-hidden="true" /> Upload document
      </summary>
      <form className="document-upload-form" onSubmit={upload}>
        <label className="field document-upload-form__wide">
          <span>Title</span>
          <input name="title" required minLength={1} maxLength={180} />
        </label>
        <label className="field document-upload-form__wide">
          <span>Description</span>
          <textarea name="description" rows={3} maxLength={2000} />
        </label>
        <label className="field">
          <span>Owner</span>
          <select name="ownerMembershipId" required defaultValue="">
            <option value="" disabled>
              Select owner
            </option>
            {data.members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Classification</span>
          <select name="classification" defaultValue="internal">
            {documentClassifications.map((value) => (
              <option key={value} value={value}>
                {documentClassificationLabels[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Folder</span>
          <select name="folderId" defaultValue="">
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
          <select name="categoryId" defaultValue="">
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
          <input name="reviewDate" type="date" />
        </label>
        <label className="field">
          <span>Expiry date</span>
          <input name="expiryDate" type="date" />
        </label>
        <label className="field">
          <span>Retain until</span>
          <input name="retentionUntil" type="date" />
        </label>
        <label className="field">
          <span>Initial version note</span>
          <input name="versionNote" maxLength={500} placeholder="Original upload" />
        </label>
        <fieldset className="document-upload-form__tags">
          <legend>Tags</legend>
          {data.tags.length ? (
            data.tags.map((tag) => (
              <label key={tag.id} className="check-row">
                <input type="checkbox" name="tagIds" value={tag.id} /> {tag.name}
              </label>
            ))
          ) : (
            <small>Create tags from Library setup.</small>
          )}
        </fieldset>
        <label className="field">
          <span>Related record type</span>
          <select
            name="entityType"
            value={entityType}
            onChange={(event) => setEntityType(event.target.value as DocumentEntityType | "")}
          >
            <option value="">No initial link</option>
            {documentEntityTypes.map((value) => (
              <option key={value} value={value}>
                {documentEntityTypeLabels[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Related record</span>
          <select name="entityId" defaultValue="" key={entityType} disabled={!entityType}>
            <option value="">{entityType ? "Select record" : "Choose type first"}</option>
            {entityOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field document-upload-form__file">
          <span>File</span>
          <input
            name="file"
            type="file"
            required
            accept="application/pdf,image/jpeg,image/png,text/plain,text/csv,.docx,.xlsx"
          />
          <small>
            PDF, JPEG, PNG, TXT, CSV, DOCX, or XLSX up to 25 MB. Every upload is quarantined and
            scanned.
          </small>
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? "Uploading" : "Upload privately"}
        </Button>
        {message ? <small role="status">{message}</small> : null}
      </form>
    </details>
  );
}
