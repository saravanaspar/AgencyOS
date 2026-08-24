import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (file: string) => readFileSync(join(root, file), "utf8");

describe("controlled legal deletion contracts", () => {
  it("creates policy, request, object, and permanent event records with RLS", () => {
    const migration = source("database/migrations/20260717004300_controlled_legal_deletion.sql");
    for (const table of [
      "legal_deletion_policies",
      "legal_deletion_requests",
      "legal_deletion_objects",
      "legal_deletion_events",
    ]) {
      expect(migration).toContain(`create table public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
    expect(migration).toContain("legal_deletion_requests_active_target_unique");
    expect(migration).toContain("private.prevent_legal_deletion_request_delete");
    expect(migration).toContain("private.prevent_legal_deletion_history_mutation");
    expect(migration).not.toContain(
      "grant insert on public.legal_deletion_requests to authenticated",
    );
  });

  it("requires scoped permission and optional second-person approval", () => {
    const migration = source("database/migrations/20260717004300_controlled_legal_deletion.sql");
    expect(migration).toContain("('legal', 'deletion', 'request'");
    expect(migration).toContain("('legal', 'deletion', 'execute'");
    expect(migration).toContain("second_approval_required boolean not null default true");
    expect(migration).toContain("purge_claim_token uuid");
    expect(migration).toContain("purge_claimed_at timestamptz");
    expect(migration).toContain("approval_requests_apply_legal_deletion");
    const actions = source("src/modules/legal/actions/deletion.ts");
    expect(actions).toContain("allowSelfApproval: false");
    expect(actions).toContain('selectorRoleKey: "owner"');
    expect(actions).toContain("submitApprovalForRecordAtomically");
    expect(actions).toContain("requireLegalDeletionRequestAccess");
    expect(actions).toContain("legalDeletionPurgeClaimStale");
    expect(actions).toContain("deletion.purge_recovered");
    expect(actions).toContain("purge_claim_token = ${prepared.claimToken}::uuid");
  });

  it("reuses legal holds, retention, publication, review, sharing, and private-file purge", () => {
    const server = source("src/modules/legal/server/deletion.ts");
    expect(server).toContain("document.legal_hold");
    expect(server).toContain("legalDeletionRetentionEligible");
    expect(server).toContain("public.document_publications");
    expect(server).toContain("public.document_review_requests");
    expect(server).toContain("public.document_entity_links");
    expect(server).toContain("public.legal_contract_templates");
    const actions = source("src/modules/legal/actions/deletion.ts");
    expect(actions).toContain("softDeletePrivateFile");
    expect(actions).toContain("purgePrivateFileObjects");
    expect(actions).toContain("deletionDigest");
    expect(actions).toContain('action: "legal.deletion.completed"');
  });

  it("hides deleted targets from ordinary Legal and MCP workspace reads", () => {
    const migration = source("database/migrations/20260717004300_controlled_legal_deletion.sql");
    expect(migration).toContain("v_contract.deleted_at is not null");
    expect(migration).toContain("v_record.deleted_at is not null");
    const page = source("src/app/(workspace)/legal/page.tsx");
    expect(page).toContain("getLegalDeletionWorkspaceData");
    const workspace = source("src/components/legal/legal-workspace.tsx");
    expect(workspace).toContain("LegalDeletionWorkspace");
  });
});
