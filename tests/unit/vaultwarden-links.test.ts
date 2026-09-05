import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { createVaultwardenLinkSchema } from "@/modules/automation/schemas/automation";

const migration = readFileSync(
  "database/migrations/20260714001900_n8n_callbacks_vaultwarden_links.sql",
  "utf8",
);
const configuration = readFileSync("src/modules/automation/server/integration-config.ts", "utf8");
const automationService = readFileSync("src/modules/automation/server/automation.ts", "utf8");

describe("Vaultwarden item references", () => {
  it("accepts only UUID item references and supported entity types", () => {
    const valid = createVaultwardenLinkSchema.safeParse({
      entityType: "project",
      entityId: "f4a682cb-16da-4414-a2af-341de650264b",
      entityLabel: "Launch project",
      itemReference: "4e68b3a6-26a2-4d3a-b3d9-4f2dd18bd98d",
    });
    expect(valid.success).toBe(true);
    expect(
      createVaultwardenLinkSchema.safeParse({
        entityType: "project",
        entityId: "f4a682cb-16da-4414-a2af-341de650264b",
        entityLabel: "Launch project",
        itemReference: "password=secret",
      }).success,
    ).toBe(false);
  });

  it("stores only references and derives fixed visibility permissions", () => {
    expect(migration).toContain("item_reference uuid not null");
    expect(migration).toContain("visibility_permission_key");
    expect(migration).toContain("projects.project.view");
    expect(migration).toContain("crm.company.view");
    expect(migration).toContain("vendors.workspace.view");
    expect(migration).toContain("vaultwarden_item_link_target_visible");
    expect(migration).toContain("private.project_permission_allows");
    expect(migration).toContain("private.crm_scope_allows_membership");
    expect(migration).toContain("company.account_owner_membership_id");
    expect(migration).not.toContain("company.owner_membership_id");
    expect(migration).not.toMatch(/vault_password|master_password|totp_secret|secure_note/);
  });

  it("opens the independent Vaultwarden web session without credentials", () => {
    expect(configuration).toContain("/#/vault?itemId=");
    expect(configuration).toContain("parsed.username || parsed.password");
    expect(configuration).not.toContain("VAULTWARDEN_PASSWORD");
    expect(configuration).toContain("INTERNAL_WORKER_SECRET");
    expect(configuration).toContain("normalized.length >= 32");
  });
  it("enforces exact project and CRM record scopes for listing, linking and revocation", () => {
    expect(automationService).toContain("private.project_is_visible");
    expect(automationService).toContain("private.crm_scope_allows_membership");
    expect(automationService).toContain("company.account_owner_membership_id");
    expect(automationService).not.toContain("company.owner_membership_id");
    expect(automationService).toContain(
      "join public.identity_accounts as account on account.id = membership.user_id",
    );
    expect(automationService).not.toContain("membership.email");
    expect(automationService).toContain("context.permissionScopes.get");
    expect(automationService).toContain("update public.vaultwarden_item_links as link");
  });
});
