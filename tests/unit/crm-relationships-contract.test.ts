import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (file: string) => readFileSync(join(root, file), "utf8");

describe("CRM relationship completeness contracts", () => {
  it("stores a trigger-enforced primary contact without adding a parallel contact model", () => {
    const migration = source(
      "database/migrations/20260718005300_crm_relationship_completeness.sql",
    );
    expect(migration).toContain("add column primary_contact_id uuid");
    expect(migration).toContain("validate_crm_company_primary_contact");
    expect(migration).toContain("protect_crm_primary_contact_membership");
    expect(migration).toContain("contact_record.company_id is distinct from new.id");
    expect(migration).not.toContain("create table public.crm_primary_contacts");
  });

  it("reauthorizes company and contact scope before changing the primary contact", () => {
    const actions = source("src/modules/crm/actions/crm.ts");
    expect(actions).toContain("setCompanyPrimaryContactAction");
    expect(actions).toContain("crmPermissionKeys.companyUpdate");
    expect(actions).toContain("crmPermissionKeys.contactView");
    expect(actions).toContain("private.crm_scope_allows_membership");
    expect(actions).toContain("crm.company_primary_contact_updated");
  });

  it("loads related records through their existing module visibility helpers", () => {
    const server = source("src/modules/crm/server/crm.ts");
    expect(server).toContain("private.project_is_visible");
    expect(server).toContain("private.legal_contract_membership_access_allowed");
    expect(server).toContain("private.support_ticket_membership_access_allowed");
    expect(server).toContain("private.document_membership_access_allowed");
    expect(server).toContain("relatedRecordsByCompany");
  });

  it("reuses the scanner-gated Documents upload route for Lead attachments", () => {
    const workspace = source("src/components/crm/crm-workspace.tsx");
    expect(workspace).toContain('fetch("/api/documents/upload"');
    expect(workspace).toContain('name="entityType" value="lead"');
    expect(workspace).toContain('name="classification" value="internal"');
    expect(workspace).toContain("Upload privately");
    expect(workspace).not.toContain("createQuarantinedPrivateFile");
  });

  it("adds only metadata relationships to global search and MCP", () => {
    const search = source("src/modules/search/server/search.ts");
    const mcp = source("src/modules/mcp/tool-registry.ts");
    expect(search).toContain("company.primary_contact_id");
    expect(search).toContain("' projects'");
    expect(search).toContain("' documents'");
    expect(mcp).toContain("agencyos.crm.set_company_primary_contact");
    expect(mcp).toContain("without exposing contact notes or document contents");
  });

  it("uses inline relationship panels and preserves deep-link tab selection", () => {
    const workspace = source("src/components/crm/crm-workspace.tsx");
    const page = source("src/app/(workspace)/crm/page.tsx");
    expect(workspace).toContain("CompanyRelationships");
    expect(workspace).toContain("PrimaryContactForm");
    expect(workspace).toContain("<details");
    expect(workspace).not.toContain("<dialog");
    expect(page).toContain("firstValue(raw.company)");
    expect(page).toContain("firstValue(raw.contact)");
  });
});
