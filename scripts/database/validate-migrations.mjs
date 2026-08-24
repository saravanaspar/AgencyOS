import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const migrationDirectory = path.join(root, "database", "migrations");
const databaseTestDirectory = path.join(root, "database", "tests");

function validateSqlFileStructure(name, sql) {
  let state = "code";
  let dollarDelimiter = null;
  let dollarBodyStart = null;
  let blockCommentDepth = 0;
  let parenthesisDepth = 0;
  let lastCodeCharacter = "";

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const nextCharacter = sql[index + 1] ?? "";

    if (state === "line-comment") {
      if (character === "\n") state = "code";
      continue;
    }

    if (state === "block-comment") {
      if (character === "/" && nextCharacter === "*") {
        blockCommentDepth += 1;
        index += 1;
      } else if (character === "*" && nextCharacter === "/") {
        blockCommentDepth -= 1;
        index += 1;
        if (blockCommentDepth === 0) state = "code";
      }
      continue;
    }

    if (state === "single-quote") {
      if (character === "'" && nextCharacter === "'") {
        index += 1;
      } else if (character === "'") {
        state = "code";
      }
      continue;
    }

    if (state === "double-quote") {
      if (character === '"' && nextCharacter === '"') {
        index += 1;
      } else if (character === '"') {
        state = "code";
      }
      continue;
    }

    if (state === "dollar-quote") {
      if (sql.startsWith(dollarDelimiter, index)) {
        const body = sql.slice(dollarBodyStart, index);
        if (/\bend\s+then\b/i.test(body)) {
          throw new Error(
            `${name} contains an ambiguous PL/pgSQL CASE ... END THEN condition; assign the CASE result first or use explicit predicates.`,
          );
        }
        index += dollarDelimiter.length - 1;
        dollarDelimiter = null;
        dollarBodyStart = null;
        state = "code";
      }
      continue;
    }

    if (character === "-" && nextCharacter === "-") {
      state = "line-comment";
      index += 1;
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      state = "block-comment";
      blockCommentDepth = 1;
      index += 1;
      continue;
    }
    if (character === "'") {
      state = "single-quote";
      continue;
    }
    if (character === '"') {
      state = "double-quote";
      continue;
    }
    if (character === "$") {
      const delimiterMatch = sql.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (delimiterMatch) {
        dollarDelimiter = delimiterMatch[0];
        dollarBodyStart = index + dollarDelimiter.length;
        state = "dollar-quote";
        index += dollarDelimiter.length - 1;
        continue;
      }
    }

    if (character === "(") parenthesisDepth += 1;
    if (character === ")") {
      parenthesisDepth -= 1;
      if (parenthesisDepth < 0) {
        throw new Error(`${name} closes a parenthesis before opening it.`);
      }
    }
    if (!/\s/.test(character)) lastCodeCharacter = character;
  }

  if (state === "dollar-quote") {
    throw new Error(`${name} has an unterminated ${dollarDelimiter} function body.`);
  }
  if (state === "single-quote" || state === "double-quote") {
    throw new Error(`${name} has an unterminated quoted value or identifier.`);
  }
  if (state === "block-comment") {
    throw new Error(`${name} has an unterminated block comment.`);
  }
  if (parenthesisDepth !== 0) {
    throw new Error(`${name} has ${parenthesisDepth} unmatched opening parenthesis.`);
  }
  if (lastCodeCharacter !== ";") {
    throw new Error(`${name} appears truncated because its final SQL statement is not terminated.`);
  }
}

async function listSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) return listSourceFiles(absolutePath);
      return /\.(?:ts|tsx|mjs)$/.test(entry.name) ? [absolutePath] : [];
    }),
  );
  return files.flat();
}
const migrationNames = (await readdir(migrationDirectory))
  .filter((name) => name.endsWith(".sql"))
  .sort();

if (migrationNames.length === 0) {
  throw new Error("No AgencyOS database migrations were found.");
}

const migrationContents = await Promise.all(
  migrationNames.map(async (name) => readFile(path.join(migrationDirectory, name), "utf8")),
);
for (const [migrationIndex, migrationContent] of migrationContents.entries()) {
  validateSqlFileStructure(migrationNames[migrationIndex], migrationContent);
}

const legacySelfManagedMigrationNames = new Set([
  "20260718005300_crm_relationship_completeness.sql",
  "20260722005500_crm_lead_extra_fields.sql",
]);
for (const [migrationIndex, migrationContent] of migrationContents.entries()) {
  const name = migrationNames[migrationIndex];
  const ownsTransaction =
    /^\s*begin\s*;/im.test(migrationContent) && /^\s*commit\s*;/im.test(migrationContent);
  if (ownsTransaction && !legacySelfManagedMigrationNames.has(name)) {
    throw new Error(
      `${name} manages its own transaction. AgencyOS migrations must leave transaction ownership to scripts/database/migrate.mjs so DDL and migration history commit atomically.`,
    );
  }
}
const migrationText = migrationContents.join("\n");

const privateRoutines = new Set(
  [...migrationText.matchAll(/create(?: or replace)? function\s+private\.([a-z0-9_]+)\s*\(/gi)].map(
    (match) => match[1],
  ),
);
const privateRelations = new Set(
  [
    ...migrationText.matchAll(
      /create(?: or replace)? (?:table|view)\s+(?:if not exists\s+)?private\.([a-z0-9_]+)/gi,
    ),
  ].map((match) => match[1]),
);
const unknownPrivateRoutineReferences = [
  ...new Set(
    [...migrationText.matchAll(/\bprivate\.([a-z0-9_]+)\s*\(/gi)].map((match) => match[1]),
  ),
].filter((name) => !privateRoutines.has(name) && !privateRelations.has(name));
if (unknownPrivateRoutineReferences.length > 0) {
  throw new Error(
    `Migrations reference undefined private routines: ${unknownPrivateRoutineReferences.join(", ")}`,
  );
}

const definedTriggerRoutines = new Set(
  [
    ...migrationText.matchAll(
      /create(?: or replace)? function\s+((?:public|private)\.[a-z0-9_]+)\s*\(/gi,
    ),
  ].map((match) => match[1].toLowerCase()),
);
const unknownTriggerRoutines = [
  ...new Set(
    [...migrationText.matchAll(/execute function\s+((?:public|private)\.[a-z0-9_]+)\s*\(/gi)].map(
      (match) => match[1].toLowerCase(),
    ),
  ),
].filter((routine) => !definedTriggerRoutines.has(routine));
if (unknownTriggerRoutines.length > 0) {
  throw new Error(
    `Triggers reference undefined migration routines: ${unknownTriggerRoutines.join(", ")}`,
  );
}

const publicTables = [
  ...migrationText.matchAll(/create table(?: if not exists)? public\.([a-z0-9_]+)/gi),
].map((match) => match[1]);
const publicViews = [
  ...migrationText.matchAll(/create(?: or replace)? view public\.([a-z0-9_]+)/g),
].map((match) => match[1]);
const renamedPublicTables = [
  ...migrationText.matchAll(/alter table public\.[a-z0-9_]+\s+rename to ([a-z0-9_]+)\s*;/gi),
].map((match) => match[1]);
const publicRelations = new Set([...publicTables, ...publicViews, ...renamedPublicTables]);

const sourceFiles = await listSourceFiles(path.join(root, "src"));
const unknownPublicRelations = new Map();

for (const sourceFile of sourceFiles) {
  const sourceText = await readFile(sourceFile, "utf8");
  for (const match of sourceText.matchAll(/\bpublic\.([a-z][a-z0-9_]*)\b/g)) {
    const relation = match[1];
    if (publicRelations.has(relation)) continue;
    const relativePath = path.relative(root, sourceFile);
    const paths = unknownPublicRelations.get(relation) ?? new Set();
    paths.add(relativePath);
    unknownPublicRelations.set(relation, paths);
  }
}

if (unknownPublicRelations.size > 0) {
  const details = [...unknownPublicRelations.entries()]
    .map(([relation, paths]) => `public.${relation} (${[...paths].join(", ")})`)
    .join(", ");
  throw new Error(`Runtime SQL references relations absent from migrations: ${details}`);
}

const missingRls = [];
for (const [migrationIndex, migrationContent] of migrationContents.entries()) {
  const tablesCreatedInMigration = [
    ...migrationContent.matchAll(/create table(?: if not exists)? public\.([a-z0-9_]+)/gi),
  ].map((match) => match[1]);
  for (const table of tablesCreatedInMigration) {
    if (!migrationContent.includes(`alter table public.${table} enable row level security;`)) {
      missingRls.push(`${migrationNames[migrationIndex]}:public.${table}`);
    }
  }
}

if (missingRls.length > 0) {
  throw new Error(
    `Public tables must enable RLS in the migration that creates them: ${missingRls.join(", ")}`,
  );
}

const securityDefinerBlocks = migrationText
  .split(/create or replace function /i)
  .slice(1)
  .filter((block) => /security definer/i.test(block));

const unsafeFunctions = securityDefinerBlocks.filter(
  (block) => !/set search_path\s*=\s*''/i.test(block),
);

if (unsafeFunctions.length > 0) {
  throw new Error("Every security-definer function must set an empty search_path.");
}

const sharedProjectTriggerMatch = migrationText.match(
  /create or replace function private\.validate_project_child_tenant\(\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/i,
);
if (!sharedProjectTriggerMatch) {
  throw new Error("Missing private.validate_project_child_tenant().");
}
if (/\bnew\.[a-z_]/i.test(sharedProjectTriggerMatch[1])) {
  throw new Error(
    "Shared project-child triggers must read table-specific fields through to_jsonb(new), not NEW.field.",
  );
}

if (/grant\s+all\s+on\s+all\s+tables\s+in\s+schema\s+public/i.test(migrationText)) {
  throw new Error("Broad grants on every public table are prohibited.");
}

if (/grant\s+(select|insert|update|delete|all)[^;]*\s+to\s+anon/i.test(migrationText)) {
  throw new Error("The database baseline must not grant application-table access to anon.");
}

if (/(?:delete\s+from|update|truncate(?:\s+table)?)\s+(?:auth|storage)\./i.test(migrationText)) {
  throw new Error(
    "Historical migrations must not destructively mutate provider-managed auth/storage tables during cutover replay.",
  );
}

if (!/create extension if not exists pgtap with schema extensions;/i.test(migrationText)) {
  throw new Error(
    "Linked database tests require the pgTAP extension to be provisioned by migration.",
  );
}

if (
  !/to_regrole\('cli_login_postgres'\)/i.test(migrationText) ||
  !/grant usage on schema extensions to cli_login_postgres/i.test(migrationText)
) {
  throw new Error("Legacy database-test compatibility roles require USAGE on the pgTAP schema.");
}

const requiredPublicPrivilegeContracts = [
  "alter default privileges for role postgres in schema public",
  "revoke all privileges on tables from anon, authenticated",
  "revoke all privileges on all tables in schema public from anon, authenticated",
  "grant select on public.project_task_attachments to authenticated",
  "grant select on public.finance_credit_note_events to authenticated",
  "grant select, insert on public.finance_payment_refunds to authenticated",
];
const missingPublicPrivilegeContracts = requiredPublicPrivilegeContracts.filter(
  (contract) => !migrationText.toLowerCase().includes(contract),
);
if (missingPublicPrivilegeContracts.length > 0) {
  throw new Error(
    `Public table ACLs must be normalized to the explicit AgencyOS grant manifest: ${missingPublicPrivilegeContracts.join(", ")}`,
  );
}

if (
  /grant\s+[^;]*(?:\btruncate\b|\breferences\b|\btrigger\b)[^;]*\s+to\s+authenticated/i.test(
    migrationText,
  )
) {
  throw new Error(
    "Authenticated application roles must never receive TRUNCATE, REFERENCES, or TRIGGER on public tables.",
  );
}

const membershipPermissionRestrictionMigrationName =
  "20260716002800_restrict_membership_permission_helper.sql";
const membershipPermissionRestrictionMigrationIndex = migrationNames.indexOf(
  membershipPermissionRestrictionMigrationName,
);
if (membershipPermissionRestrictionMigrationIndex < 0) {
  throw new Error(
    `Missing membership permission helper restriction migration: ${membershipPermissionRestrictionMigrationName}`,
  );
}
const membershipPermissionRestrictionMigration =
  migrationContents[membershipPermissionRestrictionMigrationIndex].toLowerCase();
for (const contract of [
  "revoke all on function private.membership_has_permission(uuid, text)",
  "from public, anon, authenticated",
  "grant execute on function private.membership_has_permission(uuid, text)",
  "to service_role",
]) {
  if (!membershipPermissionRestrictionMigration.includes(contract)) {
    throw new Error(
      `Membership permission helper must remain internal to trusted services: ${contract}`,
    );
  }
}

const privilegeNormalizationMigrationName = "20260716002700_normalize_public_table_privileges.sql";
const privilegeNormalizationMigrationIndex = migrationNames.indexOf(
  privilegeNormalizationMigrationName,
);
if (privilegeNormalizationMigrationIndex < 0) {
  throw new Error(
    `Missing privilege normalization migration: ${privilegeNormalizationMigrationName}`,
  );
}

const normalizeGrant = (statement) => statement.trim().replace(/\s+/g, " ").toLowerCase();
const collectAuthenticatedTableGrants = (sql) =>
  new Set(
    [...sql.matchAll(/^grant\s+[^;]+\s+on\s+public\.[^;]+\s+to\s+authenticated;$/gim)].map(
      (match) => normalizeGrant(match[0]),
    ),
  );
const declaredAuthenticatedGrants = collectAuthenticatedTableGrants(
  migrationContents.slice(0, privilegeNormalizationMigrationIndex).join("\n"),
);
const normalizedAuthenticatedGrants = collectAuthenticatedTableGrants(
  migrationContents[privilegeNormalizationMigrationIndex],
);
const missingNormalizedGrants = [...declaredAuthenticatedGrants].filter(
  (grant) => !normalizedAuthenticatedGrants.has(grant),
);
const unexpectedNormalizedGrants = [...normalizedAuthenticatedGrants].filter(
  (grant) => !declaredAuthenticatedGrants.has(grant),
);
if (missingNormalizedGrants.length > 0 || unexpectedNormalizedGrants.length > 0) {
  throw new Error(
    [
      "Public privilege normalization must exactly restore the grants declared before migration 027.",
      missingNormalizedGrants.length > 0 ? `Missing: ${missingNormalizedGrants.join(" | ")}` : null,
      unexpectedNormalizedGrants.length > 0
        ? `Unexpected: ${unexpectedNormalizedGrants.join(" | ")}`
        : null,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

const pgTapBootstrapPath = path.join(databaseTestDirectory, "_helpers", "pgtap-bootstrap.inc");
const pgTapBootstrapText = await readFile(pgTapBootstrapPath, "utf8");
const requiredPgTapBootstrapContracts = [
  "from pg_catalog.pg_extension as ext",
  "join pg_catalog.pg_namespace as ns",
  "where ext.extname = 'pgtap'",
  "pg_catalog.has_schema_privilege(current_user, pgtap_schema, 'USAGE')",
  "perform pg_catalog.set_config(",
  "'pg_catalog,%I,public,private'",
];
const missingPgTapBootstrapContracts = requiredPgTapBootstrapContracts.filter(
  (contract) => !pgTapBootstrapText.includes(contract),
);
if (missingPgTapBootstrapContracts.length > 0) {
  throw new Error(
    `The shared pgTAP bootstrap must resolve the installed extension schema dynamically: ${missingPgTapBootstrapContracts.join(", ")}`,
  );
}

const databaseTestNames = (await readdir(databaseTestDirectory))
  .filter((name) => name.endsWith(".test.sql"))
  .sort();
const pgTapBootstrapInclude = "\\ir ./_helpers/pgtap-bootstrap.inc";
const pgTapTestsMissingBootstrap = [];
const pgTapTestsAssumingPostgresRole = [];
for (const testName of databaseTestNames) {
  const testText = await readFile(path.join(databaseTestDirectory, testName), "utf8");
  if (!testText.includes(pgTapBootstrapInclude)) pgTapTestsMissingBootstrap.push(testName);
  if (/set\s+local\s+role\s+postgres\s*;/i.test(testText)) {
    pgTapTestsAssumingPostgresRole.push(testName);
  }
}
if (pgTapTestsMissingBootstrap.length > 0) {
  throw new Error(
    `pgTAP tests must include the shared dynamic bootstrap: ${pgTapTestsMissingBootstrap.join(", ")}`,
  );
}
if (pgTapTestsAssumingPostgresRole.length > 0) {
  throw new Error(
    `pgTAP tests must not assume a provider-specific postgres fixture role: ${pgTapTestsAssumingPostgresRole.join(", ")}`,
  );
}

const requiredTables = [
  "organizations",
  "profiles",
  "memberships",
  "permissions",
  "roles",
  "role_permissions",
  "membership_roles",
  "audit_events",
  "crm_import_connections",
  "crm_connection_notifications",
  "notifications",
  "notification_deliveries",
  "notification_push_subscriptions",
  "approval_definitions",
  "approval_definition_steps",
  "approval_requests",
  "approval_request_steps",
  "approval_actions",
  "approval_delegations",
  "private_files",
  "private_file_events",
  "automation_definitions",
  "automation_callback_events",
  "vaultwarden_item_links",
  "finance_document_sequences",
  "finance_catalog_items",
  "finance_estimates",
  "finance_estimate_lines",
  "finance_estimate_versions",
  "finance_invoices",
  "finance_invoice_lines",
  "finance_invoice_events",
  "finance_credit_notes",
  "finance_credit_note_lines",
  "finance_credit_note_events",
  "finance_payments",
  "finance_payment_allocations",
  "finance_document_snapshots",
  "finance_email_deliveries",
  "finance_invoice_attachments",
  "finance_payment_refunds",
];

const missingTables = requiredTables.filter((table) => !publicTables.includes(table));
if (missingTables.length > 0) {
  throw new Error(`Missing required foundation tables: ${missingTables.join(", ")}`);
}

const requiredCrmLifecycleContracts = [
  "add column auth_method",
  "add column sync_checkpoint",
  "add column sync_cursor",
  "add column next_sync_at",
  "add column backoff_until",
  "add column last_health_status",
  "add column credential_version",
  "create table private.crm_oauth_states",
  "create unique index crm_connection_notifications_open_unique",
  "create or replace function private.membership_has_permission",
];
const missingCrmLifecycleContracts = requiredCrmLifecycleContracts.filter(
  (contract) => !migrationText.toLowerCase().includes(contract),
);
if (missingCrmLifecycleContracts.length > 0) {
  throw new Error(
    `Missing CRM connector lifecycle contracts: ${missingCrmLifecycleContracts.join(", ")}`,
  );
}

const requiredNotificationDeliveryContracts = [
  "add column locked_at",
  "add column lock_token",
  "create index notification_deliveries_worker_due_idx",
  "create table public.notification_push_subscriptions",
  "notification_push_subscriptions_validate_tenant",
  "revoke all on public.notification_push_subscriptions from anon, authenticated",
];
const missingNotificationDeliveryContracts = requiredNotificationDeliveryContracts.filter(
  (contract) => !migrationText.toLowerCase().includes(contract),
);
if (missingNotificationDeliveryContracts.length > 0) {
  throw new Error(
    `Missing notification delivery contracts: ${missingNotificationDeliveryContracts.join(", ")}`,
  );
}

const requiredApprovalContracts = [
  "create unique index approval_definitions_active_key_unique",
  "create unique index approval_requests_pending_entity_unique",
  "create index approval_request_steps_due_idx",
  "create index approval_request_steps_reminder_idx",
  "create index approval_request_steps_escalation_idx",
  "create index approval_delegations_expiry_idx",
  "create or replace function private.approval_request_visible",
  "create or replace function private.prevent_approval_snapshot_mutation",
  "create or replace function private.prevent_approval_action_mutation",
  "create policy approval_requests_select_visible",
  "revoke all on public.approval_actions from anon, authenticated",
];
const missingApprovalContracts = requiredApprovalContracts.filter(
  (contract) => !migrationText.toLowerCase().includes(contract),
);
if (missingApprovalContracts.length > 0) {
  throw new Error(`Missing shared approval contracts: ${missingApprovalContracts.join(", ")}`);
}

const requiredPrivateFileContracts = [
  "create unique index private_files_active_entity_sha_unique",
  "create index private_files_scan_due_idx",
  "create index private_files_purge_due_idx",
  "create or replace function private.validate_private_file_transition",
  "create or replace function private.prevent_private_file_event_mutation",
  "create or replace function private.prevent_private_file_hard_delete",
  "create trigger project_task_attachments_validate_private_file",
  "private-file-quarantine",
  "revoke all on public.private_files from anon, authenticated",
];
const missingPrivateFileContracts = requiredPrivateFileContracts.filter(
  (contract) => !migrationText.toLowerCase().includes(contract),
);
if (missingPrivateFileContracts.length > 0) {
  throw new Error(
    `Missing shared private-file contracts: ${missingPrivateFileContracts.join(", ")}`,
  );
}

const requiredAutomationIntegrationContracts = [
  "create unique index automation_callback_execution_unique",
  "create unique index automation_callback_nonce_unique",
  "create unique index vaultwarden_item_links_active_unique",
  "create or replace function private.prevent_automation_callback_mutation",
  "create or replace function private.vaultwarden_item_link_visible",
  "revoke all on public.automation_callback_events from anon, authenticated",
  "item_reference uuid not null",
  "company.account_owner_membership_id",
];
const missingAutomationIntegrationContracts = requiredAutomationIntegrationContracts.filter(
  (contract) => !migrationText.toLowerCase().includes(contract),
);
if (missingAutomationIntegrationContracts.length > 0) {
  throw new Error(
    `Missing n8n callback or Vaultwarden-link contracts: ${missingAutomationIntegrationContracts.join(", ")}`,
  );
}

if (migrationText.includes("company.owner_membership_id")) {
  throw new Error("Vaultwarden CRM visibility must use crm_companies.account_owner_membership_id.");
}

const requiredFinanceContracts = [
  "create unique index finance_estimates_draft_content_unique",
  "create unique index finance_invoices_draft_content_unique",
  "create or replace function private.next_finance_document_number",
  "create or replace function private.set_finance_line_totals",
  "create or replace function private.prevent_issued_invoice_mutation",
  "create or replace function private.prevent_issued_invoice_line_mutation",
  "create or replace function private.prevent_finance_event_mutation",
  "create trigger finance_invoices_prevent_issued_mutation",
  "create trigger finance_invoice_lines_prevent_issued_mutation",
  "create trigger finance_invoice_events_prevent_update",
  "create trigger finance_invoice_events_prevent_delete",
  "revoke all on public.finance_document_sequences from public, anon, authenticated",
  "create unique index finance_invoices_source_estimate_unique",
  "create or replace function private.validate_finance_document_snapshot",
  "create or replace function private.prevent_finance_document_snapshot_mutation",
  "create or replace function private.validate_finance_email_delivery",
  "create trigger finance_document_snapshots_prevent_update",
  "create trigger finance_document_snapshots_prevent_delete",
  "create trigger finance_email_deliveries_validate",
  "unique (organization_id, request_token)",
  "revoke all on public.finance_document_snapshots from public, anon",
  "revoke all on public.finance_email_deliveries from public, anon",
  "create unique index finance_credit_notes_draft_content_unique",
  "create or replace function private.validate_invoice_correction_tenant",
  "create or replace function private.validate_credit_note_tenant",
  "create or replace function private.prevent_issued_credit_note_mutation",
  "create or replace function private.prevent_issued_credit_note_line_mutation",
  "create or replace function private.refresh_invoice_credit_totals",
  "create trigger finance_credit_notes_refresh_invoice",
  "create trigger finance_credit_note_events_prevent_update",
  "create trigger finance_credit_note_events_prevent_delete",
  "finance.credit_note.issue",
  "entity_type in ('estimate', 'invoice', 'credit_note')",
  "create table public.finance_invoice_attachments",
  "create table public.finance_payment_refunds",
  "create or replace function private.prevent_issued_invoice_exchange_rate_mutation",
  "create trigger finance_invoices_prevent_issued_exchange_rate_mutation",
  "create or replace function private.prevent_finance_payment_refund_mutation",
  "entity_type in ('estimate', 'invoice', 'credit_note', 'payment_receipt')",
];
const missingFinanceContracts = requiredFinanceContracts.filter(
  (contract) => !migrationText.toLowerCase().includes(contract),
);
if (missingFinanceContracts.length > 0) {
  throw new Error(`Missing finance foundation contracts: ${missingFinanceContracts.join(", ")}`);
}

const approvalMigration = await readFile(
  path.join(migrationDirectory, "20260714001500_shared_approval_engine.sql"),
  "utf8",
);
if (
  !/before update on public\.approval_requests[\s\S]*private\.prevent_approval_snapshot_mutation\(\)/i.test(
    approvalMigration,
  )
) {
  throw new Error("Approval request snapshots must be protected by an immutable update trigger.");
}
if (
  !/before update on public\.approval_actions[\s\S]*before delete on public\.approval_actions/i.test(
    approvalMigration,
  )
) {
  throw new Error("Approval action history must reject both updates and deletes.");
}
if (!/scope\)\s*select[^;]*'assigned_or_created'/is.test(approvalMigration)) {
  throw new Error("Normal approval request visibility must use assigned_or_created scope.");
}

console.log(
  `Validated ${migrationNames.length} migrations, ${publicTables.length} public tables, ${sourceFiles.length} runtime source files, relation references, RLS coverage, grants, and security-definer search paths.`,
);
