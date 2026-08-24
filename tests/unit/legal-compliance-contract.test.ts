import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (file: string) => readFileSync(join(root, file), "utf8");

describe("legal compliance-record contracts", () => {
  it("creates scoped records, reminders, immutable events, RLS, and safe grants", () => {
    const migration = source("database/migrations/20260717004200_legal_compliance_records.sql");
    for (const table of [
      "legal_compliance_records",
      "legal_compliance_record_reminders",
      "legal_compliance_record_events",
    ]) {
      expect(migration).toContain(`create table public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
    expect(migration).toContain("private.legal_compliance_record_membership_access_allowed");
    expect(migration).toContain("private.legal_compliance_record_access_allowed");
    expect(migration).toContain("private.sync_legal_compliance_record_reminders");
    expect(migration).toContain("legal_compliance_records_sync_reminders_insert");
    expect(migration).toContain("old.review_date is distinct from new.review_date");
    expect(migration).toContain("private.prevent_document_immutable_mutation");
    expect(migration).toContain("actor_membership_id, created_at");
    expect(migration).not.toContain("summary, closure_reason");
  });

  it("reuses Documents, validates clean immutable versions, and enforces privilege classification", () => {
    const migration = source("database/migrations/20260717004200_legal_compliance_records.sql");
    expect(migration).toContain("document_id uuid not null references public.documents");
    expect(migration).toContain(
      "document_version_id uuid not null references public.document_versions",
    );
    expect(migration).toContain("v_file_status <> 'available'");
    expect(migration).toContain(
      "new.legal_privilege and v_document_classification <> 'restricted'",
    );
    const actions = source("src/modules/legal/actions/compliance.ts");
    expect(actions).toContain("requireDocumentAccess");
    expect(actions).toContain('document.file_status !== "available"');
    expect(actions).toContain('document.classification !== "restricted"');
  });

  it("reuses owner-scope validation and keeps lifecycle and audit evidence server-side", () => {
    const actions = source("src/modules/legal/actions/compliance.ts");
    expect(actions).toContain("validateLegalOwnerAssignment");
    expect(actions).toContain("requireLegalComplianceRecordAccess");
    expect(actions).toContain("writeAuditEvent");
    expect(actions).toContain("enqueueNotification");
    expect(actions).toContain('action: "legal.compliance_record.created"');
    expect(actions).toContain('parsed.data.action === "restore"');
    expect(actions).toContain("action: `legal.compliance_record.${lifecycleEvent}`");
    const legalActions = source("src/modules/legal/actions/legal.ts");
    expect(legalActions).toContain("@/modules/legal/server/owner-validation");
  });

  it("ships responsive workspace controls and metadata-only MCP search", () => {
    expect(source("src/app/(workspace)/legal/page.tsx")).toContain(
      "getLegalComplianceWorkspaceData",
    );
    const component = source("src/components/legal/legal-compliance.tsx");
    expect(component).toContain("ComplianceRecordForm");
    expect(component).toContain("LifecycleForm");
    expect(component).toContain("Identifier final four");
    const mcp = source("src/modules/mcp/tool-registry.ts");
    expect(mcp).toContain("agencyos.legal.search_compliance_records");
    const tool = mcp.slice(mcp.indexOf("agencyos.legal.search_compliance_records"));
    expect(tool.slice(0, 5000)).not.toMatch(/record\.summary|closureReason|event\.details/);
  });
});
