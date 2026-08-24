import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};
const testGuide = readFileSync(join(root, "TEST.md"), "utf8");
const readme = readFileSync(join(root, "README.md"), "utf8");
const migrations = readFileSync(
  join(root, "database/migrations/20260716002200_minio_object_storage.sql"),
  "utf8",
);
const pgTapMigration = readFileSync(
  join(root, "database/migrations/20260716002500_enable_pgtap.sql"),
  "utf8",
);
const pgTapRoleGrantMigration = readFileSync(
  join(root, "database/migrations/20260716002600_grant_pgtap_cli_test_usage.sql"),
  "utf8",
);
const publicPrivilegeMigration = readFileSync(
  join(root, "database/migrations/20260716002700_normalize_public_table_privileges.sql"),
  "utf8",
);
const membershipPermissionRestrictionMigration = readFileSync(
  join(root, "database/migrations/20260716002800_restrict_membership_permission_helper.sql"),
  "utf8",
);
const pgTapTest = readFileSync(join(root, "database/tests/finance_foundation.test.sql"), "utf8");
const pgTapBootstrap = readFileSync(
  join(root, "database/tests/_helpers/pgtap-bootstrap.inc"),
  "utf8",
);
const databaseTestDirectory = join(root, "database/tests");
const databaseTests = readdirSync(databaseTestDirectory)
  .filter((name) => name.endsWith(".test.sql"))
  .map((name) => readFileSync(join(databaseTestDirectory, name), "utf8"));
const crmImportTest = readFileSync(join(databaseTestDirectory, "crm_imports.test.sql"), "utf8");
const crmLifecycleTest = readFileSync(
  join(databaseTestDirectory, "crm_connector_lifecycle.test.sql"),
  "utf8",
);
const organizationProfileTest = readFileSync(
  join(databaseTestDirectory, "organization_profile.test.sql"),
  "utf8",
);
const organizationStructureTest = readFileSync(
  join(databaseTestDirectory, "organization_structure.test.sql"),
  "utf8",
);
const sharedPrivateFilesTest = readFileSync(
  join(databaseTestDirectory, "shared_private_files.test.sql"),
  "utf8",
);

describe("portable database safety", () => {
  it("uses only provider-neutral database commands", () => {
    expect(packageJson.scripts["db:test"]).toContain("scripts/database/test-portable.mjs");
    expect(packageJson.scripts["db:migrate"]).toContain("scripts/database/migrate.mjs");
    expect(packageJson.scripts["db:copy"]).toContain("scripts/database/copy-database.mjs");
    expect(packageJson.scripts).not.toHaveProperty("db:push");
    expect(
      Object.entries(packageJson.scripts).some(([key, value]) =>
        /supabase/i.test(`${key} ${value}`),
      ),
    ).toBe(false);
  });

  it("does not destructively mutate legacy provider storage tables during historical replay", () => {
    expect(migrations).not.toMatch(/delete\s+from\s+storage\./i);
    expect(migrations).not.toMatch(/update\s+storage\./i);
    expect(migrations).not.toMatch(/truncate(?:\s+table)?\s+storage\./i);
  });

  it("provisions pgTAP and resolves its installed schema for linked tests", () => {
    expect(pgTapMigration).toMatch(/create extension if not exists pgtap with schema extensions;/i);
    expect(pgTapMigration).not.toMatch(/drop extension/i);
    expect(pgTapRoleGrantMigration).toContain("to_regrole('cli_login_postgres')");
    expect(pgTapRoleGrantMigration).toMatch(
      /grant usage on schema extensions to cli_login_postgres/i,
    );
    expect(pgTapTest).toContain("\\ir ./_helpers/pgtap-bootstrap.inc");
    expect(pgTapBootstrap).toContain("from pg_catalog.pg_extension as ext");
    expect(pgTapBootstrap).toContain("join pg_catalog.pg_namespace as ns");
    expect(pgTapBootstrap).toContain("where ext.extname = 'pgtap'");
    expect(pgTapBootstrap).toContain(
      "pg_catalog.has_schema_privilege(current_user, pgtap_schema, 'USAGE')",
    );
    expect(pgTapBootstrap).toContain("perform pg_catalog.set_config(");
    expect(pgTapBootstrap).toContain("'pg_catalog,%I,public,private'");
    expect(pgTapBootstrap).not.toContain("public,private,auth,storage");
    expect(pgTapBootstrap).not.toContain("set local role postgres;");
    expect(databaseTests.some((test) => /\breset\s+role\s*;/i.test(test))).toBe(true);
  });

  it("normalizes public table ACLs to the explicit application grant manifest", () => {
    expect(publicPrivilegeMigration).toMatch(
      /alter default privileges for role postgres in schema public[\s\S]*revoke all privileges on tables from anon, authenticated/i,
    );
    expect(publicPrivilegeMigration).toMatch(
      /revoke all privileges on all tables in schema public from anon, authenticated/i,
    );
    expect(publicPrivilegeMigration).toContain(
      "grant select on public.project_task_attachments to authenticated;",
    );
    expect(publicPrivilegeMigration).toContain(
      "grant select on public.finance_credit_note_events to authenticated;",
    );
    expect(publicPrivilegeMigration).toContain(
      "grant select, insert on public.finance_payment_refunds to authenticated;",
    );
    expect(publicPrivilegeMigration).not.toMatch(
      /grant\s+[^;]*(?:\btruncate\b|\breferences\b|\btrigger\b)[^;]*\s+to\s+authenticated/i,
    );
  });

  it("keeps the arbitrary-membership permission helper trusted-only", () => {
    expect(membershipPermissionRestrictionMigration).toMatch(
      /revoke all on function private\.membership_has_permission\(uuid, text\)[\s\S]*from public, anon, authenticated/i,
    );
    expect(membershipPermissionRestrictionMigration).toMatch(
      /grant execute on function private\.membership_has_permission\(uuid, text\)[\s\S]*to service_role/i,
    );
    expect(crmLifecycleTest).toContain(
      "not has_function_privilege(\n    'authenticated',\n    'private.membership_has_permission(uuid,text)',",
    );
  });

  it("models provider-neutral pgTAP authorization without hosted auth or storage tables", () => {
    expect(organizationProfileTest).toMatch(
      /with attempted_update as \([\s\S]*update public\.organizations[\s\S]*select count\(\*\)::integer as attempted_update_count[\s\S]*from attempted_update[\s\S]*\\gset/i,
    );
    expect(organizationStructureTest).toContain(
      "request.identity.id', '66666666-6666-4666-8666-666666666661'",
    );
    expect(organizationStructureTest).toMatch(
      /set local role authenticated;[\s\S]*owner can create departments[\s\S]*owner can assign team members[\s\S]*reset role;/i,
    );
    expect(sharedPrivateFilesTest).not.toContain("storage.buckets");
    expect(databaseTests.every((test) => !test.includes("auth.users"))).toBe(true);
  });

  it("checks the CRM external-record uniqueness contract by definition", () => {
    expect(crmImportTest).toContain(
      "pg_get_constraintdef(oid) =\n        'UNIQUE (organization_id, provider, external_object, external_id)'",
    );
    expect(crmImportTest).not.toContain(
      "crm_external_records_organization_id_provider_external_object_external_id_key",
    );
  });

  it("blocks the reset script and removes reset instructions from project guides", () => {
    expect(packageJson.scripts["db:reset"]).not.toContain("supabase");
    expect(packageJson.scripts["db:reset"]).toContain("process.exit(1)");

    for (const guide of [testGuide, readme]) {
      expect(guide).not.toContain("npm run db:reset");
      expect(guide).not.toContain("supabase db reset");
    }
  });
});
