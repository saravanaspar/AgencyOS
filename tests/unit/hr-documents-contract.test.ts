import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (file: string) => readFileSync(join(root, file), "utf8");

describe("HR private-document source contracts", () => {
  it("ships template versioning, defaults, immutable documents, RLS, and permissions", () => {
    const migration = source("database/migrations/20260717003400_hr_private_documents.sql");
    expect(migration).toContain("create table public.hr_document_templates");
    expect(migration).toContain("create table public.hr_document_template_defaults");
    expect(migration).toContain("create table public.hr_employee_documents");
    expect(migration).toContain("document-templates");
    expect(migration).toContain("hr.employee_document.acknowledge");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("crm_scope_allows_membership");
    expect(migration).toContain(
      "unique (organization_id, membership_id, document_type, internal_reference, version)",
    );
  });

  it("keeps uploaded HTML private and validates it before MinIO storage", () => {
    const route = source("src/app/api/hr/document-templates/upload/route.ts");
    const storage = source("src/modules/hr/server/document-template-storage.ts");
    const compiler = source("src/modules/hr/server/document-template-compiler.ts");
    expect(route).toContain("documentTemplateManage");
    expect(route).toContain("512 KB");
    expect(storage).toContain("MINIO_DOCUMENT_TEMPLATE_BUCKET");
    expect(storage).toContain("validateAndNormalizeHrTemplateHtml");
    expect(compiler).toContain("allowedElements");
    expect(compiler).toContain("blocked-element");
    expect(compiler).toContain("containsUnsafeCss");
    expect(compiler).toContain("unsupported-placeholder");
    expect(compiler).toContain("integrity-mismatch");
  });

  it("reuses private files and the shared HTML renderer for generated PDFs", () => {
    const actions = source("src/modules/hr/actions/documents.ts");
    const service = source("src/modules/hr/server/hr-document-service.ts");
    expect(actions).toContain("renderHtmlToPdf");
    expect(actions).toContain("compileHrDocumentTemplate");
    expect(service).toContain("createQuarantinedPrivateFile");
    expect(service).toContain("pg_advisory_xact_lock");
    expect(service).toContain("hr.employee_document_downloaded");
  });

  it("extends the existing template platform without duplicating storage or rendering", () => {
    const migration = source("database/migrations/20260717003500_hr_employment_letters.sql");
    const catalog = source("src/modules/hr/documents.ts");
    for (const type of [
      "experience_letter",
      "relieving_letter",
      "promotion_letter",
      "salary_revision_letter",
      "warning_letter",
      "performance_letter",
    ]) {
      expect(migration).toContain(`'${type}'`);
      expect(catalog).toContain(`"${type}"`);
    }
    expect(migration).not.toContain("create table");
    expect(migration).not.toContain("create policy");
    expect(catalog.match(/fileName: "/g)).toHaveLength(10);
  });

  it("does not expose private HR document contents through MCP", () => {
    const registry = source("src/modules/mcp/tool-registry.ts");
    expect(registry).not.toContain("hr.employee_document.download");
    expect(registry).not.toContain("hr.document_template.upload");
  });
});
