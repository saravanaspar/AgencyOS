import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (file: string) => readFileSync(join(root, file), "utf8");

describe("legal contract lifecycle contracts", () => {
  it("creates scoped contract, template, version, and event records with RLS", () => {
    const migration = source("database/migrations/20260717004000_legal_contract_lifecycle.sql");
    for (const table of [
      "legal_contract_templates",
      "legal_contracts",
      "legal_contract_versions",
      "legal_contract_events",
      "legal_contract_reminders",
    ])
      expect(migration).toContain(`create table public.${table}`);
    expect(migration).toContain("private.legal_contract_membership_access_allowed");
    expect(migration).toContain("private.legal_contract_access_allowed");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("'manage_lifecycle'");
    expect(migration).toContain("private.sync_legal_contract_reminders");
    expect(migration).toContain("actor_membership_id, created_at");
    expect(migration).not.toContain(
      "grant select on public.legal_contract_versions, public.legal_contract_events",
    );
  });

  it("reuses Documents for immutable files and widens entity links only once", () => {
    const migration = source("database/migrations/20260717004000_legal_contract_lifecycle.sql");
    expect(migration).toContain("document_id uuid not null references public.documents");
    expect(migration).toContain(
      "document_version_id uuid not null references public.document_versions",
    );
    expect(migration).toContain("'contract'");
    const actions = source("src/modules/legal/actions/legal.ts");
    expect(actions).toContain("requireDocumentAccess");
    expect(actions).toContain("public.document_entity_links");
    expect(actions).toContain("pg_advisory_xact_lock");
    expect(actions).toContain("validateLegalOwnerAssignment");
    expect(actions).toContain("validateCounterpartyCompanyReference");
    expect(actions).toContain('error.message === "template-locked"');
  });

  it("routes sequential reviews through the shared approval engine", () => {
    const actions = source("src/modules/legal/actions/legal.ts");
    expect(actions).toContain("createApprovalDefinition");
    expect(actions).toContain("createApprovalRequest");
    expect(actions).toContain('selectorRoleKey: "legal_manager"');
    expect(actions).toContain('selectorRoleKey: "finance_manager"');
    expect(actions).toContain('selectorRoleKey: "owner"');
    const migration = source("database/migrations/20260717004000_legal_contract_lifecycle.sql");
    expect(migration).toContain("private.apply_legal_contract_approval_result");
  });

  it("requires signed immutable evidence before activation", () => {
    const actions = source("src/modules/legal/actions/legal.ts");
    expect(actions).toContain('contract.signature_status !== "signed"');
    expect(actions).toContain("!contract.signed_version_id");
    expect(actions).toContain("Contract version attached.");
    expect(actions).toContain("attachmentPermission");
    expect(actions).toContain('error.message === "version-state-invalid"');
    const migration = source("database/migrations/20260717004000_legal_contract_lifecycle.sql");
    expect(migration).toContain("private.prevent_legal_contract_version_mutation");
  });

  it("ships a dedicated workspace and metadata-only MCP search", () => {
    expect(source("src/app/(workspace)/legal/page.tsx")).toContain("LegalWorkspace");
    const component = source("src/components/legal/legal-workspace.tsx");
    expect(component).toContain("ContractForm");
    expect(component).toContain("TemplatePanel");
    expect(component).toContain("VersionForm");
    const server = source("src/modules/legal/server/legal.ts");
    expect(server).toContain("can_manage_signatures_scope");
    expect(server).toContain("crmPermissionKeys.companyView");
    expect(server).toContain("version.contract_id");
    expect(server).toContain("event.contract_id");
    const mcp = source("src/modules/mcp/tool-registry.ts");
    expect(mcp).toContain("agencyos.legal.search_contracts");
    expect(mcp).not.toContain("agencyos.legal.download_contract");
  });
});
