import { Archive, CalendarClock, FileText, LockKeyhole } from "lucide-react";

import { DocumentAdminPanels } from "@/components/documents/document-admin-panels";
import { DocumentCard } from "@/components/documents/document-card";
import { DocumentUploadForm } from "@/components/documents/document-upload-form";
import { Button } from "@/components/ui/button";
import type { DocumentWorkspaceData } from "@/modules/documents/server/documents";

export function DocumentWorkspace({ data }: { data: DocumentWorkspaceData }) {
  return (
    <div className="document-workspace">
      <section className="document-summary-grid" aria-label="Document summary">
        <article>
          <FileText size={20} aria-hidden="true" />
          <span>Visible</span>
          <strong>{data.summary.visible}</strong>
        </article>
        <article>
          <Archive size={20} aria-hidden="true" />
          <span>Active</span>
          <strong>{data.summary.active}</strong>
        </article>
        <article>
          <CalendarClock size={20} aria-hidden="true" />
          <span>Review due</span>
          <strong>{data.summary.reviewDue + data.summary.expired}</strong>
        </article>
        <article>
          <LockKeyhole size={20} aria-hidden="true" />
          <span>Legal hold</span>
          <strong>{data.summary.legalHold}</strong>
        </article>
      </section>

      <section className="document-toolbar" aria-label="Search document library">
        <form method="get" className="document-search-form">
          <label className="field">
            <span>Search</span>
            <input
              name="q"
              defaultValue={data.filters.query}
              maxLength={100}
              placeholder="Title or description"
            />
          </label>
          <label className="field">
            <span>Status</span>
            <select name="status" defaultValue={data.filters.status}>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
              <option value="all">All</option>
            </select>
          </label>
          <Button type="submit" variant="secondary">
            Apply filters
          </Button>
        </form>
        <DocumentUploadForm data={data} />
      </section>

      <DocumentAdminPanels data={data} />

      <section className="document-library" aria-label="Document library">
        {data.documents.map((document) => (
          <DocumentCard key={document.id} document={document} data={data} />
        ))}
        {data.documents.length === 0 ? (
          <p className="empty-state">No documents match the current search and access rules.</p>
        ) : null}
      </section>
    </div>
  );
}
