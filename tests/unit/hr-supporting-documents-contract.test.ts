import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (file: string) => readFileSync(join(root, file), "utf8");

describe("HR supporting-document contracts", () => {
  it("creates a separate RLS-protected metadata table while reusing private files", () => {
    const migration = source("database/migrations/20260717003600_hr_supporting_documents.sql");
    expect(migration).toContain("create table public.hr_employee_supporting_documents");
    expect(migration).toContain("private_file_id uuid not null unique");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("employee_visible = true");
    expect(migration).toContain("identifier_suffix");
    expect(migration).not.toContain("document_number text");
    expect(migration).not.toContain("government_id text");
  });

  it("reuses quarantine, scanning, MinIO, integrity checks, and audit events", () => {
    const service = source("src/modules/hr/server/supporting-documents.ts");
    const download = source("src/app/api/hr/supporting-documents/[documentId]/route.ts");
    expect(service).toContain("createQuarantinedPrivateFile");
    expect(service).toContain('entityType: "hr_employee_supporting_document"');
    expect(service).toContain("pg_advisory_xact_lock");
    expect(service).toContain('action: "hr.supporting_document_quarantined"');
    expect(download).toContain('createHash("sha256")');
    expect(download).toContain('eventType: "file.downloaded"');
    expect(download).toContain("readMinioObject");
  });

  it("keeps background checks and exit records out of employee self uploads", () => {
    const catalog = source("src/modules/hr/supporting-documents.ts");
    const upload = source("src/app/api/hr/supporting-documents/upload/route.ts");
    expect(catalog).toContain('category: "background_check"');
    expect(catalog).toContain('category: "exit_document"');
    expect(catalog.match(/selfUploadAllowed: false/g)).toHaveLength(2);
    expect(upload).toContain("Only HR can upload this document category.");
    expect(upload).toContain("context.membership.id");
  });

  it("ships scoped review, visibility, upload, download, and expiry UI", () => {
    const component = source("src/components/hr/hr-supporting-documents.tsx");
    expect(component).toContain("Upload supporting document");
    expect(component).toContain("Identifier final four");
    expect(component).toContain("Make HR only");
    expect(component).toContain("Share with employee");
    expect(component).toContain("Expired");
    expect(component).toContain("/api/hr/supporting-documents/");
  });

  it("does not expose private supporting-document contents through MCP", () => {
    const registry = source("src/modules/mcp/tool-registry.ts");
    expect(registry).not.toContain("supporting_document.download");
    expect(registry).not.toContain("supportingDocumentId");
  });
});
