import {
  Archive,
  CalendarClock,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Home,
  LockKeyhole,
  Search,
} from "lucide-react";
import Link from "next/link";

import { DocumentAdminPanels } from "@/components/documents/document-admin-panels";
import { DocumentCard } from "@/components/documents/document-card";
import { DocumentUploadForm } from "@/components/documents/document-upload-form";
import { Button } from "@/components/ui/button";
import type {
  DocumentFolderSummary,
  DocumentWorkspaceData,
} from "@/modules/documents/server/documents";

function libraryHref(
  data: DocumentWorkspaceData,
  folderId: string | null,
  options: { clearSearch?: boolean } = {},
): string {
  const params = new URLSearchParams();
  if (folderId) params.set("folder", folderId);
  if (data.filters.status !== "active") params.set("status", data.filters.status);
  if (data.filters.query && !options.clearSearch) params.set("q", data.filters.query);
  const query = params.toString();
  return query ? `/documents?${query}` : "/documents";
}

function activeChildren(folders: DocumentFolderSummary[], parentId: string | null) {
  return folders
    .filter((folder) => folder.parentFolderId === parentId && !folder.archivedAt)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function FolderTree({
  data,
  parentId,
  depth = 0,
}: {
  data: DocumentWorkspaceData;
  parentId: string | null;
  depth?: number;
}) {
  const children = activeChildren(data.folders, parentId);
  if (!children.length) return null;

  return (
    <ul className="document-folder-tree__branch">
      {children.map((folder) => {
        const selected = data.filters.folderId === folder.id;
        return (
          <li key={folder.id}>
            <Link
              href={libraryHref(data, folder.id, { clearSearch: true })}
              className={selected ? "is-selected" : undefined}
              aria-current={selected ? "page" : undefined}
              style={{ paddingInlineStart: `${0.7 + depth * 0.9}rem` }}
            >
              {selected ? (
                <FolderOpen size={16} aria-hidden="true" />
              ) : (
                <Folder size={16} aria-hidden="true" />
              )}
              <span>{folder.name}</span>
            </Link>
            <FolderTree data={data} parentId={folder.id} depth={depth + 1} />
          </li>
        );
      })}
    </ul>
  );
}

function folderBreadcrumbs(data: DocumentWorkspaceData): DocumentFolderSummary[] {
  const byId = new Map(data.folders.map((folder) => [folder.id, folder]));
  const values: DocumentFolderSummary[] = [];
  let current = data.filters.folderId ? byId.get(data.filters.folderId) : undefined;
  const seen = new Set<string>();

  while (current && !seen.has(current.id) && values.length < 25) {
    seen.add(current.id);
    values.unshift(current);
    current = current.parentFolderId ? byId.get(current.parentFolderId) : undefined;
  }

  return values;
}

function documentFolderSummary(folder: DocumentFolderSummary): string {
  return `${folder.classification.charAt(0).toUpperCase()}${folder.classification.slice(1)} folder`;
}

export function DocumentWorkspace({ data }: { data: DocumentWorkspaceData }) {
  const currentFolder = data.filters.folderId
    ? (data.folders.find((folder) => folder.id === data.filters.folderId) ?? null)
    : null;
  const childFolders = activeChildren(data.folders, data.filters.folderId);
  const breadcrumbs = folderBreadcrumbs(data);
  const searching = Boolean(data.filters.query);

  return (
    <div className="document-workspace">
      <section className="document-summary-grid" aria-label="Document summary">
        <article>
          <FileText size={20} aria-hidden="true" />
          <span>{searching ? "Search results" : "Visible here"}</span>
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
          {data.filters.folderId ? (
            <input type="hidden" name="folder" value={data.filters.folderId} />
          ) : null}
          <label className="field">
            <span>Search all folders</span>
            <div className="document-search-input">
              <Search size={16} aria-hidden="true" />
              <input
                name="q"
                defaultValue={data.filters.query}
                maxLength={100}
                placeholder="Title, reference, tag, category, or filename"
              />
            </div>
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
            Search library
          </Button>
          {searching ? (
            <Link
              className="button button--ghost"
              href={libraryHref(data, data.filters.folderId, { clearSearch: true })}
            >
              Clear search
            </Link>
          ) : null}
        </form>
        <DocumentUploadForm data={data} />
      </section>

      <DocumentAdminPanels data={data} />

      <div className="document-drive-layout">
        <nav className="document-folder-tree" aria-label="Document folders">
          <div className="document-folder-tree__heading">
            <strong>Folders</strong>
            <span>{data.folders.filter((folder) => !folder.archivedAt).length}</span>
          </div>
          <Link
            href={libraryHref(data, null, { clearSearch: true })}
            className={data.filters.folderId === null ? "is-selected" : undefined}
            aria-current={data.filters.folderId === null ? "page" : undefined}
          >
            <Home size={16} aria-hidden="true" />
            <span>Library root</span>
          </Link>
          <FolderTree data={data} parentId={null} />
        </nav>

        <section className="document-drive-content" aria-labelledby="document-folder-heading">
          <nav className="document-breadcrumbs" aria-label="Folder breadcrumb">
            <Link href={libraryHref(data, null, { clearSearch: true })}>Library</Link>
            {breadcrumbs.map((folder) => (
              <span key={folder.id}>
                <ChevronRight size={14} aria-hidden="true" />
                <Link href={libraryHref(data, folder.id, { clearSearch: true })}>
                  {folder.name}
                </Link>
              </span>
            ))}
          </nav>

          <header className="document-drive-content__heading">
            <div>
              <h2 id="document-folder-heading">
                {searching
                  ? `Search results for “${data.filters.query}”`
                  : (currentFolder?.name ?? "Library root")}
              </h2>
              <p>
                {searching
                  ? "Results are searched across every folder you are allowed to view."
                  : (currentFolder?.description ??
                    "Top-level folders and documents that have not been filed yet.")}
              </p>
            </div>
            {!searching ? <span>{data.documents.length} documents</span> : null}
          </header>

          {!searching && childFolders.length ? (
            <section className="document-folder-grid" aria-label="Subfolders">
              {childFolders.map((folder) => (
                <Link key={folder.id} href={libraryHref(data, folder.id, { clearSearch: true })}>
                  <Folder size={20} aria-hidden="true" />
                  <span>
                    <strong>{folder.name}</strong>
                    <small>{folder.description ?? documentFolderSummary(folder)}</small>
                  </span>
                  <ChevronRight size={16} aria-hidden="true" />
                </Link>
              ))}
            </section>
          ) : null}

          <section className="document-library" aria-label="Document library">
            {data.documents.map((document) => (
              <DocumentCard key={document.id} document={document} data={data} />
            ))}
            {data.documents.length === 0 ? (
              <div className="document-library-empty">
                <FileText size={24} aria-hidden="true" />
                <strong>
                  {searching ? "No matching documents" : "This folder has no documents"}
                </strong>
                <p>
                  {searching
                    ? "Try a title, reference code, tag, category, folder name, or original filename."
                    : "Upload a document here or create a subfolder to continue organizing the library."}
                </p>
              </div>
            ) : null}
          </section>
        </section>
      </div>
    </div>
  );
}
