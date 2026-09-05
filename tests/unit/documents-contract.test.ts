import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (file: string) => readFileSync(join(root, file), "utf8");

describe("documents module contracts", () => {
  it("creates the document library, immutable versions, access, links, comments, and history", () => {
    const migration = source("database/migrations/20260717003900_documents_foundation.sql");
    for (const table of [
      "document_folders",
      "document_categories",
      "document_tags",
      "documents",
      "document_versions",
      "document_tag_links",
      "document_entity_links",
      "document_access_grants",
      "document_comments",
      "document_events",
    ])
      expect(migration).toContain(`create table public.${table}`);
    expect(migration).toContain("private.prevent_document_immutable_mutation");
    expect(migration).toContain("private.membership_effective_permission_scope");
    expect(migration).toContain("private.membership_display_name");
    expect(migration).toContain("private.document_membership_access_allowed");
    expect(migration).toContain("private.document_access_allowed");
    expect(migration).toContain("enable row level security");
  });

  it("reuses the shared private-file scanner and atomic version allocation", () => {
    const upload = source("src/app/api/documents/upload/route.ts");
    expect(upload).toContain("createQuarantinedPrivateFile");
    expect(upload).toContain('moduleKey: "documents"');
    expect(upload).toContain("pg_advisory_xact_lock");
    expect(upload).toContain("document_versions");
    expect(upload).toContain("current_version_id");
    expect(upload).toContain("effectiveClassification");
    expect(upload).toContain("requireDocumentMembershipScope");
    expect(upload).toContain("requireDocumentEntityAccess");
  });

  it("integrity-checks every preview and download and records both histories", () => {
    const route = source("src/app/api/documents/[documentId]/versions/[versionId]/route.ts");
    expect(route).toContain('createHash("sha256")');
    expect(route).toContain("readObject");
    expect(route).toContain("recordPrivateFileEvent");
    expect(route).toContain("recordDocumentEvent");
    expect(route).toContain("writeAuditEvent");
    expect(route).toContain("content-security-policy");
  });

  it("ships a dedicated workspace and metadata-only MCP search", () => {
    expect(source("src/app/(workspace)/documents/page.tsx")).toContain("DocumentWorkspace");
    const component = source("src/components/documents/document-workspace.tsx");
    expect(component).toContain("DocumentUploadForm");
    expect(component).toContain("DocumentAdminPanels");
    expect(component).toContain("DocumentCard");
    expect(component).toContain("document-folder-tree");
    expect(component).toContain("document-breadcrumbs");
    expect(component).toContain("Search all folders");
    expect(source("src/components/documents/document-admin-panels.tsx")).toContain("Save folder");
    const mcp = source("src/modules/mcp/tool-registry.ts");
    const discovery = source("src/modules/mcp/tools/document-library.ts");
    expect(mcp).toContain("agencyos.documents.search_library");
    expect(mcp).toContain("searchDocumentLibraryForMcp");
    expect(discovery).toContain("documentDate: document.documentDate");
    expect(discovery).toContain("referenceCode: document.referenceCode");
    expect(discovery).toContain("folders: data.folders.map");
    expect(discovery).toContain("sha256: version.sha256");
    expect(discovery).toContain("createdAt: document.createdAt");
    expect(discovery).toContain("updatedAt: document.updatedAt");
    expect(mcp).not.toContain("agencyos.documents.download_file");
  });

  it("adds structured discovery metadata and restores contract document links", () => {
    const migration = source("database/migrations/20260831006600_document_library_discovery.sql");
    const documents = source("src/modules/documents/documents.ts");
    const server = source("src/modules/documents/server/documents.ts");
    const entityOptions = source("src/modules/documents/server/document-entity-options.ts");
    expect(migration).toContain("add column document_date date");
    expect(migration).toContain("add column reference_code text");
    expect(migration).toContain(
      "grant select (document_date, reference_code) on public.documents to authenticated;",
    );
    expect(migration).toContain("'contract'");
    expect(documents).toContain('"contract"');
    expect(documents).toContain('contract: "Contract"');
    expect(entityOptions).toContain("select 'contract'::text as type");
    expect(server).toContain("private.legal_contract_membership_access_allowed");
    expect(server).toContain('entityType === "contract"');
    expect(server).toContain("when 'contract' then");
    expect(server).toContain("with recursive search_folders");
    expect(server).toContain("visible_document_folders");
    expect(server).toContain("document.document_date::text");
  });

  it("keeps restricted access lists and legal-hold reasons out of unauthorized client data", () => {
    const server = source("src/modules/documents/server/documents.ts");
    expect(server).toContain("row.can_manage_access");
    expect(server).toContain("row.can_legal_hold ? row.legal_hold_reason : null");
    expect(server).toContain("details: row.can_manage_access ? event.details : {}");
  });
  it("applies permission scope and related-module visibility before exposing owners or links", () => {
    const server = source("src/modules/documents/server/documents.ts");
    expect(server).toContain("private.crm_scope_allows_membership");
    expect(server).toContain("private.project_is_visible");
    expect(server).toContain("requireDocumentMembershipScope");
    expect(server).toContain("requireDocumentEntityAccess");
    expect(server).toContain("private.membership_display_name");
    expect(server).not.toContain(".unsafe(");
    const migration = source("database/migrations/20260717003900_documents_foundation.sql");
    expect(migration).toContain(
      "v_permission_scope := private.membership_effective_permission_scope",
    );
    expect(migration).toContain("private.document_access_allowed(document_id");
    expect(migration).toContain("grant select (");
  });
});
