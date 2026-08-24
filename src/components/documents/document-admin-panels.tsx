"use client";

import { FolderCog, Tags } from "lucide-react";
import { useActionState } from "react";

import { DocumentActionMessage } from "@/components/documents/document-action-message";
import { Button } from "@/components/ui/button";
import {
  archiveDocumentFolderAction,
  createDocumentTagAction,
  saveDocumentCategoryAction,
  saveDocumentFolderAction,
} from "@/modules/documents/actions/documents";
import {
  documentClassificationLabels,
  documentClassifications,
} from "@/modules/documents/documents";
import type { DocumentActionState } from "@/modules/documents/schemas/documents";
import type { DocumentWorkspaceData } from "@/modules/documents/server/documents";

const initialState: DocumentActionState = { status: "idle", message: "" };

function FolderManager({ data }: { data: DocumentWorkspaceData }) {
  const [state, action, pending] = useActionState(saveDocumentFolderAction, initialState);
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
          <select name="parentFolderId" defaultValue="">
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
      <ul className="document-admin-list">
        {data.folders.map((folder) => (
          <li key={folder.id}>
            <span>{folder.path}</span>
            <form action={archiveDocumentFolderAction}>
              <input type="hidden" name="folderId" value={folder.id} />
              <Button type="submit" size="sm" variant="ghost">
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
