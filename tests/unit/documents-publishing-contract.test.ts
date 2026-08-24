import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (file: string) => readFileSync(join(root, file), "utf8");

describe("documents approval and publishing contracts", () => {
  it("adds immutable review, publication, and audience records with RLS", () => {
    const migration = source(
      "database/migrations/20260717004100_documents_approval_publishing.sql",
    );
    for (const table of [
      "document_review_requests",
      "document_publications",
      "document_publication_audiences",
    ]) {
      expect(migration).toContain(`create table public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
    expect(migration).toContain("document_review_requests_pending_document_unique");
    expect(migration).toContain("document_publications_one_active_unique");
    expect(migration).toContain("private.apply_document_review_approval_result");
    expect(migration).toContain("approval_requests_apply_document_review");
    expect(migration).toContain("Only an approved document version may be published");
    expect(migration).toContain("Publication audiences are immutable");
  });

  it("reuses the shared approval engine and atomically pins review to a version", () => {
    const actions = source("src/modules/documents/actions/publication.ts");
    expect(actions).toContain("createApprovalDefinition");
    expect(actions).toContain("submitApprovalForRecordAtomically");
    expect(actions).toContain('sourceModule: "documents"');
    expect(actions).toContain('entityType: "document_review"');
    expect(actions).toContain("current_version_id !== candidate.current_version_id");
    expect(actions).toContain("pg_advisory_xact_lock");
    expect(actions).toContain("document.publication_superseded");
    expect(actions).toContain("document.publication_withdrawn");
  });

  it("enforces publication audiences inside the existing document access helper", () => {
    const migration = source(
      "database/migrations/20260717004100_documents_approval_publishing.sql",
    );
    expect(migration).toContain("v_publication_allowed");
    expect(migration).toContain("audience.audience_type = 'organization'");
    expect(migration).toContain("audience.audience_type = 'department'");
    expect(migration).toContain("audience.audience_type = 'team'");
    expect(migration).toContain("audience.audience_type = 'membership'");
    expect(migration).toContain("p_action in ('view', 'download')");
  });

  it("blocks pre-storage and concurrent uploads while review is pending", () => {
    const upload = source("src/app/api/documents/upload/route.ts");
    const migration = source(
      "database/migrations/20260717004100_documents_approval_publishing.sql",
    );
    expect(upload).toContain("A new version cannot be uploaded while review is pending");
    expect(migration).toContain("document_versions_block_pending_review");
  });

  it("surfaces review, publication, supersession, withdrawal, and audience controls", () => {
    const component = source("src/components/documents/document-publication-panel.tsx");
    expect(component).toContain("Submit v");
    expect(component).toContain("Publish release");
    expect(component).toContain("Withdraw release");
    expect(component).toContain("Everyone in the organization");
    expect(component).toContain("Departments");
    expect(component).toContain("Teams");
    expect(component).toContain("Named members");
  });
});
