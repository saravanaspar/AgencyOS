import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (file: string) => readFileSync(join(root, file), "utf8");

describe("legal access-review contracts", () => {
  it("registers sensitive least-privilege permissions and server-only RLS writes", () => {
    const migration = source("database/migrations/20260824006300_legal_access_reviews.sql");
    expect(migration).toContain("('legal', 'access_review', 'view'");
    expect(migration).toContain("('legal', 'access_review', 'manage_access'");
    expect(migration).toContain("role_template.key in ('owner', 'legal_manager')");
    expect(migration).toContain("select 'auditor', permission.id, 'organization'");
    expect(migration).toContain("where permission.key = 'legal.access_review.view'");
    expect(migration).not.toContain("grant insert on public.legal_access_review");
    for (const table of [
      "legal_access_review_campaigns",
      "legal_access_review_items",
      "legal_access_review_attestations",
      "legal_access_review_completions",
    ]) {
      expect(migration).toContain(`create table public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
  });

  it("makes snapshots, attestations, and complete campaign evidence immutable and hashed", () => {
    const migration = source("database/migrations/20260824006300_legal_access_reviews.sql");
    expect(migration).toContain("due_at = opened_at + interval '14 days'");
    expect(migration).toContain("legal_access_review_campaigns_one_open_idx");
    expect(migration).toContain("private.legal_access_review_sha256");
    expect(migration).toContain("extensions.digest");
    expect(migration).toContain("private.prevent_legal_access_review_evidence_mutation");
    expect(migration).toContain(
      "Every legal access-review item requires an immutable attestation.",
    );
    expect(migration).toContain("Self-review evidence must be explicitly and accurately flagged.");
    expect(migration).toContain("permanent explicit deny overrides");
  });

  it("snapshots every effective sensitive legal permission with source and scope evidence", () => {
    const worker = source("src/modules/legal/server/access-review-worker.ts");
    expect(worker).toContain("permission.module = 'legal'");
    expect(worker).toContain("permission.is_sensitive");
    expect(worker).toContain("private.membership_effective_permission_scope");
    expect(worker).toContain("'kind', 'role'");
    expect(worker).toContain("'kind', 'override'");
    expect(worker).toContain("effectiveScope");
    expect(worker).toContain("legalAccessReviewWorkerCampaignLimit");
    expect(worker).toContain("legalAccessReviewNotificationRecipientLimit");
    expect(worker).toContain("on conflict do nothing");
  });

  it("requires recent organization-scoped reauthentication and revokes with permanent denies", () => {
    const actions = source("src/modules/legal/actions/access-review.ts");
    expect(actions).toContain("requireRecentReauthentication");
    expect(actions).toMatch(
      /permissionScopes\.get\(legalAccessReviewPermissionKeys\.manage\)[\s\S]{0,40}!==(?:\s|\n)*"organization"/,
    );
    expect(actions).toContain("membership_permission_overrides");
    expect(actions).toContain("effect = 'deny'");
    expect(actions).toContain("expires_at = null");
    expect(actions).not.toContain("delete from public.membership_roles");
    expect(actions).toContain('action: "legal.access_review.attested"');
    expect(actions).toContain('action: "legal.access_review.completed"');
  });

  it("registers the bounded worker and exposes the optional Legal workspace", () => {
    const registry = source("src/modules/workers/server/worker-registry.ts");
    expect(registry).toContain('"legal-access-reviews"');
    expect(registry).toContain("runLegalAccessReviewWorker");
    const page = source("src/app/(workspace)/legal/page.tsx");
    expect(page).toContain("getLegalAccessReviewWorkspaceData");
    const workspace = source("src/components/legal/legal-workspace.tsx");
    expect(workspace).toContain("LegalAccessReviewWorkspace");
  });
});
