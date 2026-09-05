"use client";

import { FolderCog, Sparkles, Tags } from "lucide-react";
import { useActionState } from "react";

import { DocumentActionMessage } from "@/components/documents/document-action-message";
import { Button } from "@/components/ui/button";
import {
  archiveDocumentFolderAction,
  createDocumentStarterStructureAction,
  createDocumentTagAction,
  saveDocumentCategoryAction,
  saveDocumentFolderAction,
} from "@/modules/documents/actions/documents";
import {
  documentClassificationLabels,
  documentClassifications,
} from "@/modules/documents/documents";
import type { DocumentActionState } from "@/modules/documents/schemas/documents";
import type {
  DocumentFolderSummary,
  DocumentWorkspaceData,
} from "@/modules/documents/server/documents";

const initialState: DocumentActionState = { status: "idle", message: "" };

function FolderEditor({
  data,
  folder,
}: {
  data: DocumentWorkspaceData;
  folder: DocumentFolderSummary;
}) {
  const [state, action, pending] = useActionState(saveDocumentFolderAction, initialState);
  return (
    <details className="document-folder-editor">
      <summary>{folder.path}</summary>
      <form action={action} className="document-admin-form">
        <input type="hidden" name="folderId" value={folder.id} />
        <label className="field">
          <span>Name</span>
          <input name="name" required maxLength={120} defaultValue={folder.name} />
        </label>
        <label className="field">
          <span>Parent folder</span>
          <select name="parentFolderId" defaultValue={folder.parentFolderId ?? ""}>
            <option value="">Library root</option>
            {data.folders.map((candidate) =>
              candidate.archivedAt || candidate.id === folder.id ? null : (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.path}
                </option>
              ),
            )}
          </select>
        </label>
        <label className="field">
          <span>Classification</span>
          <select name="classification" defaultValue={folder.classification}>
            {documentClassifications.map((value) => (
              <option key={value} value={value}>
                {documentClassificationLabels[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="field document-admin-form__wide">
          <span>Description</span>
          <input name="description" maxLength={500} defaultValue={folder.description ?? ""} />
        </label>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving" : "Save folder"}
        </Button>
        <DocumentActionMessage state={state} />
      </form>
    </details>
  );
}

function FolderManager({ data }: { data: DocumentWorkspaceData }) {
  const [state, action, pending] = useActionState(saveDocumentFolderAction, initialState);
  const [starterState, starterAction, starterPending] = useActionState(
    createDocumentStarterStructureAction,
    initialState,
  );
  return (
    <details className="document-admin-panel">
      <summary>
        <FolderCog size={17} aria-hidden="true" /> Folders
      </summary>
      <form action={action} className="document-admin-form">
        <label className="field">
          <span>Name</span>
          <input name="name" required maxLength={120} />
        </label>
        <label className="field">
          <span>Parent folder</span>
          <select name="parentFolderId" defaultValue={data.filters.folderId ?? ""}>
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
          <span>Classification</span>
          <select name="classification" defaultValue="internal">
            {documentClassifications.map((value) => (
              <option key={value} value={value}>
                {documentClassificationLabels[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="field document-admin-form__wide">
          <span>Description</span>
          <input name="description" maxLength={500} />
        </label>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving" : "Create folder"}
        </Button>
        <DocumentActionMessage state={state} />
      </form>
      <form action={starterAction} className="document-starter-structure">
        <input type="hidden" name="intent" value="create-starter-structure" />
        <div>
          <strong>Suggested agency structure</strong>
          <small>
            Legal, Finance & Tax, Corporate, HR, Vendors, and Projects with the current fiscal year.
          </small>
        </div>
        <Button type="submit" size="sm" variant="secondary" disabled={starterPending}>
          <Sparkles size={15} aria-hidden="true" />
          {starterPending ? "Creating folders" : "Create suggested folders"}
        </Button>
        <DocumentActionMessage state={starterState} />
      </form>
      <ul className="document-admin-list">
        {data.folders.map((folder) => (
          <li key={folder.id}>
            <FolderEditor data={data} folder={folder} />
            <form action={archiveDocumentFolderAction}>
              <input type="hidden" name="folderId" value={folder.id} />
              <Button
                type="submit"
                size="sm"
                variant="ghost"
                aria-label={`${folder.archivedAt ? "Restore" : "Archive"} ${folder.path}`}
              >
                {folder.archivedAt ? "Restore" : "Archive"}
              </Button>
            </form>
          </li>
        ))}
      </ul>
    </details>
  );
}

function TaxonomyManager({ data }: { data: DocumentWorkspaceData }) {
  const [categoryState, categoryAction, categoryPending] = useActionState(
    saveDocumentCategoryAction,
    initialState,
  );
  const [tagState, tagAction, tagPending] = useActionState(createDocumentTagAction, initialState);
  return (
    <details className="document-admin-panel">
      <summary>
        <Tags size={17} aria-hidden="true" /> Categories and tags
      </summary>
      <div className="document-taxonomy-grid">
        <form action={categoryAction} className="document-admin-form">
          <h3>Create category</h3>
          <label className="field">
            <span>Name</span>
            <input name="name" required maxLength={80} />
          </label>
          <label className="field">
            <span>Status</span>
            <select name="status" defaultValue="active">
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <label className="field document-admin-form__wide">
            <span>Description</span>
            <input name="description" maxLength={300} />
          </label>
          <Button type="submit" size="sm" disabled={categoryPending}>
            {categoryPending ? "Saving" : "Create category"}
          </Button>
          <DocumentActionMessage state={categoryState} />
        </form>
        <form action={tagAction} className="document-admin-form">
          <h3>Create tag</h3>
          <label className="field">
            <span>Name</span>
            <input name="name" required maxLength={50} />
          </label>
          <Button type="submit" size="sm" disabled={tagPending}>
            {tagPending ? "Saving" : "Create tag"}
          </Button>
          <DocumentActionMessage state={tagState} />
        </form>
      </div>
      <div className="document-taxonomy-current">
        <p>
          <strong>Categories:</strong>{" "}
          {data.categories
            .map(
              (category) =>
                `${category.name}${category.status === "inactive" ? " (inactive)" : ""}`,
            )
            .join(", ") || "None"}
        </p>
        <p>
          <strong>Tags:</strong> {data.tags.map((tag) => tag.name).join(", ") || "None"}
        </p>
      </div>
    </details>
  );
}

export function DocumentAdminPanels({ data }: { data: DocumentWorkspaceData }) {
  if (!data.capabilities.canManageFolders && !data.capabilities.canManageTaxonomy) return null;
  return (
    <div className="document-admin-panels">
      {data.capabilities.canManageFolders ? <FolderManager data={data} /> : null}
      {data.capabilities.canManageTaxonomy ? <TaxonomyManager data={data} /> : null}
    </div>
  );
}
