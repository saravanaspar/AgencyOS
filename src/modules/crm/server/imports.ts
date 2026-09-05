import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { toJsonValue } from "@/lib/server/json-value";
import { readBoundedResponseText } from "@/lib/server/bounded-response";
import { decryptSecretObject, encryptSecretObject } from "@/lib/security/secret-envelope";
import {
  calculateLeadQualificationScore,
  leadQualificationLabel,
  normalizeCrmCompanyName,
  normalizeCrmEmail,
  normalizeCrmPhone,
} from "@/modules/crm/crm";
import {
  CRM_SYNC_MAX_PAGES,
  CRM_SYNC_MAX_ROWS,
  calculateCrmSyncBackoffSeconds,
  checkpointDate,
  hubSpotNextAfter,
  parseRetryAfterSeconds,
  pipedriveNextStart,
  salesforceNextPath,
  zohoHasMoreRecords,
  type CrmSyncCheckpoint,
  type CrmSyncCursor,
} from "@/modules/crm/crm-connector-sync";
import {
  redactImportPayload,
  sanitizeCrmExtraFields,
  type CrmImportLeadRow,
} from "@/modules/crm/crm-imports";
import {
  crmGoogleAdsWebhookPayloadSchema,
  crmMetaLeadAdsWebhookPayloadSchema,
} from "@/modules/crm/schemas/imports";
import {
  crmImportProviderLabels,
  crmImportProviderModes,
  crmPullAuthenticationMethodLabels,
  crmPullProviderDefaultAuthenticationMethod,
  isCrmPullAuthenticationMethod,
  isCrmPullProvider,
  supportsCrmPullAuthenticationMethod,
  type CrmDuplicatePolicy,
  type CrmImportProvider,
  type CrmImportSourceType,
  type CrmPullAuthenticationMethod,
} from "@/modules/crm/crm-import-providers";
import { leadDuplicateFingerprint, stablePayloadHash } from "@/modules/crm/server/import-hashing";
import { ProviderRequestError } from "@/modules/crm/server/provider-request-error";
import {
  buildCrmOAuthAuthorizationUrl,
  crmOAuthRedirectUri,
  exchangeCrmOAuthCode,
  isCrmOAuthProvider,
  refreshCrmOAuthToken,
  type CrmOAuthClientConfiguration,
  type CrmOAuthCredentials,
  type CrmOAuthProvider,
} from "@/modules/crm/server/crm-oauth";
import { enqueueNotification } from "@/modules/notifications/server/notifications";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

export const CRM_IMPORT_MAX_ROWS = 5_000;
export const CRM_IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;

export interface CrmImportConnection {
  id: string;
  provider: CrmImportProvider;
  providerLabel: string;
  name: string;
  mode: "webhook" | "pull";
  status: "active" | "paused" | "error";
  authMethod: "manual" | "oauth" | "webhook_secret";
  authenticationMethod: CrmPullAuthenticationMethod | "webhook_secret";
  authenticationLabel: string;
  credentialOwner: "client" | "agency" | "system";
  accountReference: string | null;
  configuration: Record<string, unknown>;
  syncEnabled: boolean;
  syncIntervalMinutes: number;
  nextSyncAt: string | null;
  backoffUntil: string | null;
  consecutiveFailures: number;
  checkpoint: CrmSyncCheckpoint;
  cursor: CrmSyncCursor;
  lastSyncAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastHealthCheckAt: string | null;
  lastHealthStatus: "unknown" | "healthy" | "degraded" | "unhealthy";
  lastHealthMessage: string | null;
  credentialVersion: number;
  credentialsExpiresAt: string | null;
  lastCredentialsRotatedAt: string | null;
  oauthStartPath: string | null;
  webhookPath: string | null;
  createdAt: string;
}

export interface CrmConnectionNotification {
  id: string;
  connectionId: string;
  connectionName: string;
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  occurrenceCount: number;
  lastOccurredAt: string;
}

export interface CrmImportRun {
  id: string;
  sourceType: CrmImportSourceType;
  sourceName: string;
  fileName: string | null;
  status: "processing" | "completed" | "failed";
  duplicatePolicy: CrmDuplicatePolicy;
  totalRows: number;
  createdCount: number;
  mergedCount: number;
  skippedCount: number;
  failedCount: number;
  startedAt: string;
  completedAt: string | null;
}

export interface CrmImportErrorSummary {
  id: string;
  importRunId: string;
  rowNumber: number | null;
  code: string;
  message: string;
}

export interface CrmImportWorkspaceData {
  connections: CrmImportConnection[];
  notifications: CrmConnectionNotification[];
  runs: CrmImportRun[];
  errors: CrmImportErrorSummary[];
}

export interface CrmImportOutcome {
  runId: string;
  totalRows: number;
  createdCount: number;
  mergedCount: number;
  skippedCount: number;
  failedCount: number;
}

interface ImportActor {
  organizationId: string;
  membershipId: string;
  userId: string | null;
}

interface ImportInput {
  sourceType: CrmImportSourceType;
  sourceName: string;
  stageId: string;
  ownerMembershipId: string;
  duplicatePolicy: CrmDuplicatePolicy;
  connectionId?: string | null;
  fileName?: string | null;
}

type QuerySql = Sql | TransactionSql;

interface ConnectionSecretRow {
  id: string;
  organization_id: string;
  provider: CrmImportProvider;
  name: string;
  mode: "webhook" | "pull";
  status: "active" | "paused" | "error";
  auth_method: "manual" | "oauth" | "webhook_secret";
  account_reference: string | null;
  configuration: Record<string, unknown>;
  encrypted_credentials: string | null;
  webhook_key_hash: string | null;
  sync_enabled: boolean;
  sync_interval_minutes: number;
  next_sync_at: Date | null;
  sync_checkpoint: CrmSyncCheckpoint;
  sync_cursor: CrmSyncCursor;
  consecutive_failures: number;
  backoff_until: Date | null;
  credentials_expires_at: Date | null;
  credential_version: number;
  created_by_membership_id: string;
  created_by: string | null;
}

interface StageRow {
  probability: number;
}

interface DuplicateRow {
  id: string;
  email: string | null;
  phone: string | null;
  company_name: string | null;
  source: string | null;
  estimated_value: string | number | null;
  expected_close_date: string | null;
  notes: string | null;
}

function oauthCredentialsEnvelope(credentials: CrmOAuthCredentials): Record<string, string> {
  return Object.fromEntries(
    Object.entries(credentials).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0,
    ),
  );
}

function connectionAuthenticationMethod(
  connection: Pick<ConnectionSecretRow, "mode" | "auth_method" | "configuration">,
): CrmPullAuthenticationMethod | "webhook_secret" {
  if (connection.mode === "webhook") return "webhook_secret";
  const configured = connection.configuration.authenticationMethod;
  if (isCrmPullAuthenticationMethod(configured)) return configured;
  return connection.auth_method === "manual" ? "api_token" : "agency_oauth";
}

function connectionCredentialOwner(
  method: CrmPullAuthenticationMethod | "webhook_secret",
): "client" | "agency" | "system" {
  if (method === "agency_oauth") return "agency";
  if (method === "webhook_secret") return "system";
  return "client";
}

function oauthClientConfiguration(
  connection: ConnectionSecretRow,
  credentials: Record<string, string>,
): CrmOAuthClientConfiguration {
  const method = connectionAuthenticationMethod(connection);
  return {
    clientId: method === "client_oauth" ? credentials.oauthClientId : undefined,
    clientSecret: method === "client_oauth" ? credentials.oauthClientSecret : undefined,
    region: String(connection.configuration.region ?? "us"),
    salesforceLoginUrl:
      typeof connection.configuration.salesforceLoginUrl === "string"
        ? connection.configuration.salesforceLoginUrl
        : undefined,
  };
}

function mergedOAuthCredentialEnvelope(
  existing: Record<string, string>,
  credentials: CrmOAuthCredentials,
): Record<string, string> {
  return {
    ...(existing.oauthClientId ? { oauthClientId: existing.oauthClientId } : {}),
    ...(existing.oauthClientSecret ? { oauthClientSecret: existing.oauthClientSecret } : {}),
    ...oauthCredentialsEnvelope(credentials),
  };
}

function actorFromContext(context: CurrentPermissionContext): ImportActor {
  return {
    organizationId: context.membership.organizationId,
    membershipId: context.membership.id,
    userId: context.user.id,
  };
}

function secureEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeSalesforceInstance(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || !/(^|\.)salesforce\.com$/i.test(url.hostname)) {
    throw new Error("Salesforce instance URLs must use HTTPS on a salesforce.com host.");
  }
  return url.origin;
}

function safeZohoApiBase(region: string | null | undefined): string {
  const hostByRegion: Record<string, string> = {
    us: "www.zohoapis.com",
    eu: "www.zohoapis.eu",
    in: "www.zohoapis.in",
    au: "www.zohoapis.com.au",
    jp: "www.zohoapis.jp",
    ca: "www.zohoapis.ca",
  };
  return `https://${hostByRegion[(region ?? "us").toLowerCase()] ?? hostByRegion.us}`;
}

async function writeImportAudit(
  sql: QuerySql,
  actor: ImportActor,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  await sql`
    insert into public.audit_events (
      organization_id, actor_user_id, action, entity_type, entity_id, source, metadata
    ) values (
      ${actor.organizationId}::uuid,
      ${actor.userId}::uuid,
      ${action},
      ${entityType},
      ${entityId},
      'web',
      ${sql.json(toJsonValue({ actorMembershipId: actor.membershipId, ...metadata }))}
    )
  `;
}

async function validateImportReferences(sql: QuerySql, actor: ImportActor, input: ImportInput) {
  const stages = await sql<StageRow[]>`
    select probability
    from public.crm_pipeline_stages
    where id = ${input.stageId}::uuid
      and organization_id = ${actor.organizationId}::uuid
      and is_active = true
    limit 1
  `;
  if (!stages[0]) throw new Error("Choose an active pipeline stage in this organization.");

  const owners = await sql<{ id: string }[]>`
    select id from public.memberships
    where id = ${input.ownerMembershipId}::uuid
      and organization_id = ${actor.organizationId}::uuid
      and status = 'active'
    limit 1
  `;
  if (!owners[0]) throw new Error("Choose an active CRM owner in this organization.");

  if (input.connectionId) {
    const connections = await sql<{ id: string }[]>`
      select id from public.crm_import_connections
      where id = ${input.connectionId}::uuid
        and organization_id = ${actor.organizationId}::uuid
      limit 1
    `;
    if (!connections[0]) throw new Error("CRM import connection was not found.");
  }
  return stages[0].probability;
}

async function findDuplicateLead(
  sql: QuerySql,
  actor: ImportActor,
  row: CrmImportLeadRow,
): Promise<DuplicateRow | null> {
  const email = normalizeCrmEmail(row.email);
  const phone = normalizeCrmPhone(row.phone);
  const company = normalizeCrmCompanyName(row.companyName);
  if (!email && !phone && !company) return null;

  const rows = await sql<DuplicateRow[]>`
    select id, email, phone, company_name, source, estimated_value, expected_close_date::text, notes
    from public.crm_leads
    where organization_id = ${actor.organizationId}::uuid
      and status not in ('converted', 'lost')
      and (
        (${email}::text is not null and lower(coalesce(email, '')) = ${email})
        or (${phone}::text is not null and regexp_replace(coalesce(phone, ''), '[^0-9+]', '', 'g') = ${phone})
        or (
          ${email}::text is null
          and ${phone}::text is null
          and ${company}::text is not null
          and lower(regexp_replace(coalesce(company_name, ''), '\\s+', ' ', 'g')) = ${company}
        )
      )
    order by updated_at desc
    limit 1
  `;
  return rows[0] ?? null;
}

async function findExternalLead(
  sql: QuerySql,
  actor: ImportActor,
  input: ImportInput,
  row: CrmImportLeadRow,
): Promise<DuplicateRow | null> {
  if (!row.externalId || !input.connectionId) return null;

  const rows = await sql<DuplicateRow[]>`
    select lead.id, lead.email, lead.phone, lead.company_name, lead.source,
      lead.estimated_value, lead.expected_close_date::text, lead.notes
    from public.crm_external_records as external
    join public.crm_leads as lead
      on lead.id = external.lead_id
      and lead.organization_id = external.organization_id
    where external.organization_id = ${actor.organizationId}::uuid
      and external.provider = ${input.sourceType}
      and external.external_object = 'lead'
      and external.external_id = ${row.externalId}
    limit 1
  `;
  return rows[0] ?? null;
}

async function lockImportDuplicateIdentities(
  sql: TransactionSql,
  actor: ImportActor,
  input: ImportInput,
  row: CrmImportLeadRow,
): Promise<void> {
  const email = normalizeCrmEmail(row.email);
  const phone = normalizeCrmPhone(row.phone);
  const company = normalizeCrmCompanyName(row.companyName);
  const fingerprint = leadDuplicateFingerprint(row);
  const identities = new Set<string>();

  if (row.externalId && input.connectionId) {
    identities.add(`external:${input.sourceType}:${row.externalId}`);
  }
  if (email) identities.add(`email:${email}`);
  if (phone) identities.add(`phone:${phone}`);
  if (!email && !phone && company) identities.add(`company:${company}`);
  if (fingerprint) identities.add(`fingerprint:${fingerprint}`);

  for (const identity of [...identities].sort()) {
    await sql`
      select pg_advisory_xact_lock(
        hashtextextended(${`${actor.organizationId}:crm-lead:${identity}`}, 0)
      )
    `;
  }
}

async function upsertExternalRecord(
  sql: QuerySql,
  actor: ImportActor,
  input: ImportInput,
  row: CrmImportLeadRow,
  leadId: string,
) {
  if (!row.externalId || !input.connectionId) return;
  await sql`
    insert into public.crm_external_records (
      organization_id, connection_id, provider, external_object, external_id, lead_id, payload_hash
    ) values (
      ${actor.organizationId}::uuid,
      ${input.connectionId}::uuid,
      ${input.sourceType},
      'lead',
      ${row.externalId},
      ${leadId}::uuid,
      ${stablePayloadHash(row.raw ?? row)}
    )
    on conflict (organization_id, provider, external_object, external_id) do update
    set lead_id = excluded.lead_id,
        connection_id = excluded.connection_id,
        payload_hash = excluded.payload_hash,
        last_seen_at = now()
  `;
}

type ImportRowResult = "created" | "merged" | "skipped";

async function processImportLeadRow(
  sql: TransactionSql,
  actor: ImportActor,
  input: ImportInput,
  runId: string,
  stageProbability: number,
  row: CrmImportLeadRow,
): Promise<ImportRowResult> {
  if (!row.name.trim()) throw new Error("Lead name is required.");
  const currency = /^[A-Z]{3}$/.test(row.currency ?? "") ? row.currency! : "USD";
  const email = normalizeCrmEmail(row.email);
  const phone = normalizeCrmPhone(row.phone);
  const companyName = row.companyName?.trim().slice(0, 180) || null;
  const hasExtraFields = Boolean(row.extraFields && Object.keys(row.extraFields).length);
  const extraFields = hasExtraFields ? { [input.sourceType]: row.extraFields } : {};
  const providerExtraFieldsJson = sql.json(toJsonValue(row.extraFields ?? {}));
  const extraFieldsJson = sql.json(toJsonValue(extraFields));
  await lockImportDuplicateIdentities(sql, actor, input, row);
  const duplicate =
    (await findExternalLead(sql, actor, input, row)) ?? (await findDuplicateLead(sql, actor, row));

  if (duplicate && input.duplicatePolicy === "skip") {
    await sql`
      insert into public.crm_import_errors (
        organization_id, import_run_id, row_number, external_id, code, message, redacted_payload
      ) values (
        ${actor.organizationId}::uuid,
        ${runId}::uuid,
        ${row.rowNumber ?? null},
        ${row.externalId ?? null},
        'duplicate_skipped',
        'A lead already matches this external ID, email, phone, or company-only row. The row was skipped.',
        ${sql.json(toJsonValue(redactImportPayload(row.raw ?? {})))}
      )
    `;
    await upsertExternalRecord(sql, actor, input, row, duplicate.id);
    return "skipped";
  }

  if (duplicate) {
    await sql`
      update public.crm_leads
      set email = coalesce(email, ${email}),
          phone = coalesce(phone, ${phone}),
          company_name = coalesce(company_name, ${companyName}),
          source = coalesce(source, ${row.source ?? input.sourceName}),
          estimated_value = coalesce(estimated_value, ${row.estimatedValue ?? null}),
          expected_close_date = coalesce(expected_close_date, ${row.expectedCloseDate ?? null}::date),
          notes = case
            when notes is null then ${row.notes ?? null}
            when ${row.notes ?? null}::text is null then notes
            when position(${row.notes ?? ""} in notes) > 0 then notes
            else left(notes || E'\n\nImported update: ' || ${row.notes ?? ""}, 4000)
          end,
          owner_membership_id = coalesce(owner_membership_id, ${input.ownerMembershipId}::uuid),
          extra_fields = case
            when ${hasExtraFields} then jsonb_set(
              extra_fields,
              array[${input.sourceType}]::text[],
              coalesce(extra_fields -> ${input.sourceType}, '{}'::jsonb) || ${providerExtraFieldsJson},
              true
            )
            else extra_fields
          end
      where id = ${duplicate.id}::uuid
    `;
    await upsertExternalRecord(sql, actor, input, row, duplicate.id);
    return "merged";
  }

  const score = calculateLeadQualificationScore({
    hasEmail: Boolean(email),
    hasPhone: Boolean(phone),
    hasEstimatedValue: row.estimatedValue !== null && row.estimatedValue !== undefined,
    hasExpectedCloseDate: Boolean(row.expectedCloseDate),
    hasOwner: Boolean(input.ownerMembershipId),
    hasCompanyName: Boolean(companyName),
  });
  const leadRows = await sql<{ id: string }[]>`
    insert into public.crm_leads (
      organization_id, name, lead_type, source, status, stage_id, estimated_value,
      currency, probability, expected_close_date, owner_membership_id, email, phone,
      company_name, qualification, qualification_score, qualification_label, notes,
      extra_fields, created_by_membership_id, created_by
    ) values (
      ${actor.organizationId}::uuid,
      ${row.name.trim().slice(0, 180)},
      ${row.leadType ?? (companyName ? "company" : "person")},
      ${row.source ?? input.sourceName},
      'new',
      ${input.stageId}::uuid,
      ${row.estimatedValue ?? null},
      ${currency},
      ${stageProbability},
      ${row.expectedCloseDate ?? null}::date,
      ${input.ownerMembershipId}::uuid,
      ${email},
      ${phone},
      ${companyName},
      ${sql.json(toJsonValue({ imported: true, source: input.sourceType }))},
      ${score},
      ${leadQualificationLabel(score)},
      ${row.notes ?? null},
      ${extraFieldsJson},
      ${actor.membershipId}::uuid,
      ${actor.userId}::uuid
    ) returning id
  `;
  const leadId = leadRows[0]?.id;
  if (!leadId) throw new Error("Lead insert returned no identifier.");
  await upsertExternalRecord(sql, actor, input, row, leadId);
  return "created";
}

export async function importLeadRows(
  actor: ImportActor,
  input: ImportInput,
  rows: CrmImportLeadRow[],
): Promise<CrmImportOutcome> {
  if (rows.length === 0) throw new Error("No importable lead rows were found.");
  if (rows.length > CRM_IMPORT_MAX_ROWS) {
    throw new Error(`Imports are limited to ${CRM_IMPORT_MAX_ROWS} rows per run.`);
  }

  const database = getDatabaseClient();
  return database.begin(async (sql) => {
    const stageProbability = await validateImportReferences(sql, actor, input);
    const runRows = await sql<{ id: string }[]>`
      insert into public.crm_import_runs (
        organization_id, connection_id, source_type, source_name, file_name, duplicate_policy,
        total_rows, created_by_membership_id, created_by
      ) values (
        ${actor.organizationId}::uuid,
        ${input.connectionId ?? null}::uuid,
        ${input.sourceType},
        ${input.sourceName},
        ${input.fileName ?? null},
        ${input.duplicatePolicy},
        ${rows.length},
        ${actor.membershipId}::uuid,
        ${actor.userId}::uuid
      ) returning id
    `;
    const runId = runRows[0]?.id;
    if (!runId) throw new Error("CRM import run could not be created.");

    let createdCount = 0;
    let mergedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const row of rows) {
      try {
        const result = await sql.savepoint((rowSql) =>
          processImportLeadRow(rowSql, actor, input, runId, stageProbability, row),
        );
        if (result === "created") createdCount += 1;
        if (result === "merged") mergedCount += 1;
        if (result === "skipped") skippedCount += 1;
      } catch (error) {
        failedCount += 1;
        await sql`
          insert into public.crm_import_errors (
            organization_id, import_run_id, row_number, external_id, code, message, redacted_payload
          ) values (
            ${actor.organizationId}::uuid,
            ${runId}::uuid,
            ${row.rowNumber ?? null},
            ${row.externalId ?? null},
            'row_failed',
            ${error instanceof Error ? error.message.slice(0, 500) : "The row could not be imported."},
            ${sql.json(toJsonValue(redactImportPayload(row.raw ?? {})))}
          )
        `;
      }
    }

    await sql`
      update public.crm_import_runs
      set status = 'completed',
          created_count = ${createdCount},
          merged_count = ${mergedCount},
          skipped_count = ${skippedCount},
          failed_count = ${failedCount},
          summary = ${sql.json(toJsonValue({ antiDuplicate: true, duplicatePolicy: input.duplicatePolicy }))},
          completed_at = now()
      where id = ${runId}::uuid
    `;
    await writeImportAudit(sql, actor, "crm.import.completed", "crm_import_run", runId, {
      sourceType: input.sourceType,
      totalRows: rows.length,
      createdCount,
      mergedCount,
      skippedCount,
      failedCount,
    });

    return {
      runId,
      totalRows: rows.length,
      createdCount,
      mergedCount,
      skippedCount,
      failedCount,
    };
  });
}

export async function getCrmImportWorkspaceData(
  context: CurrentPermissionContext,
): Promise<CrmImportWorkspaceData> {
  const database = getDatabaseClient();
  const organizationId = context.membership.organizationId;
  const [connections, notifications, runs, errors] = await Promise.all([
    database<
      Array<{
        id: string;
        provider: CrmImportProvider;
        name: string;
        mode: "webhook" | "pull";
        status: "active" | "paused" | "error";
        auth_method: "manual" | "oauth" | "webhook_secret";
        account_reference: string | null;
        configuration: Record<string, unknown>;
        sync_enabled: boolean;
        sync_interval_minutes: number;
        next_sync_at: Date | null;
        backoff_until: Date | null;
        consecutive_failures: number;
        sync_checkpoint: CrmSyncCheckpoint;
        sync_cursor: CrmSyncCursor;
        last_sync_at: Date | null;
        last_success_at: Date | null;
        last_error: string | null;
        last_health_check_at: Date | null;
        last_health_status: "unknown" | "healthy" | "degraded" | "unhealthy";
        last_health_message: string | null;
        credential_version: number;
        credentials_expires_at: Date | null;
        last_credentials_rotated_at: Date | null;
        created_at: Date;
      }>
    >`
      select id, provider, name, mode, status, auth_method, account_reference, configuration,
             sync_enabled, sync_interval_minutes, next_sync_at, backoff_until,
             consecutive_failures, sync_checkpoint, sync_cursor, last_sync_at, last_success_at,
             last_error, last_health_check_at, last_health_status, last_health_message,
             credential_version, credentials_expires_at, last_credentials_rotated_at, created_at
      from public.crm_import_connections
      where organization_id = ${organizationId}::uuid
      order by lower(name)
    `,
    database<
      Array<{
        id: string;
        connection_id: string;
        connection_name: string;
        severity: "info" | "warning" | "error";
        code: string;
        message: string;
        occurrence_count: number;
        last_occurred_at: Date;
      }>
    >`
      select notification.id, notification.connection_id,
             connection.name as connection_name, notification.severity,
             notification.code, notification.message, notification.occurrence_count,
             notification.last_occurred_at
      from public.crm_connection_notifications as notification
      join public.crm_import_connections as connection on connection.id = notification.connection_id
      where notification.organization_id = ${organizationId}::uuid
        and notification.status = 'open'
      order by notification.last_occurred_at desc
      limit 30
    `,
    database<
      Array<{
        id: string;
        source_type: CrmImportSourceType;
        source_name: string;
        file_name: string | null;
        status: "processing" | "completed" | "failed";
        duplicate_policy: CrmDuplicatePolicy;
        total_rows: number;
        created_count: number;
        merged_count: number;
        skipped_count: number;
        failed_count: number;
        started_at: Date;
        completed_at: Date | null;
      }>
    >`
      select id, source_type, source_name, file_name, status, duplicate_policy, total_rows,
             created_count, merged_count, skipped_count, failed_count, started_at, completed_at
      from public.crm_import_runs
      where organization_id = ${organizationId}::uuid
      order by started_at desc
      limit 20
    `,
    database<
      Array<{
        id: string;
        import_run_id: string;
        row_number: number | null;
        code: string;
        message: string;
      }>
    >`
      select import_error.id, import_error.import_run_id, import_error.row_number,
             import_error.code, import_error.message
      from public.crm_import_errors as import_error
      join public.crm_import_runs as run on run.id = import_error.import_run_id
      where run.organization_id = ${organizationId}::uuid
      order by import_error.created_at desc
      limit 30
    `,
  ]);

  return {
    connections: connections.map((connection) => {
      const authenticationMethod = connectionAuthenticationMethod(connection);
      return {
        id: connection.id,
        provider: connection.provider,
        providerLabel: crmImportProviderLabels[connection.provider],
        name: connection.name,
        mode: connection.mode,
        status: connection.status,
        authMethod: connection.auth_method,
        authenticationMethod,
        authenticationLabel:
          authenticationMethod === "webhook_secret"
            ? "Webhook credential"
            : crmPullAuthenticationMethodLabels[authenticationMethod],
        credentialOwner: connectionCredentialOwner(authenticationMethod),
        accountReference: connection.account_reference,
        configuration: connection.configuration,
        syncEnabled: connection.sync_enabled,
        syncIntervalMinutes: connection.sync_interval_minutes,
        nextSyncAt: connection.next_sync_at?.toISOString() ?? null,
        backoffUntil: connection.backoff_until?.toISOString() ?? null,
        consecutiveFailures: connection.consecutive_failures,
        checkpoint: connection.sync_checkpoint ?? {},
        cursor: connection.sync_cursor ?? {},
        lastSyncAt: connection.last_sync_at?.toISOString() ?? null,
        lastSuccessAt: connection.last_success_at?.toISOString() ?? null,
        lastError: connection.last_error,
        lastHealthCheckAt: connection.last_health_check_at?.toISOString() ?? null,
        lastHealthStatus: connection.last_health_status,
        lastHealthMessage: connection.last_health_message,
        credentialVersion: connection.credential_version,
        credentialsExpiresAt: connection.credentials_expires_at?.toISOString() ?? null,
        lastCredentialsRotatedAt: connection.last_credentials_rotated_at?.toISOString() ?? null,
        oauthStartPath:
          connection.mode === "pull" &&
          connection.auth_method === "oauth" &&
          isCrmOAuthProvider(connection.provider)
            ? `/api/crm/connectors/${connection.id}/oauth/start`
            : null,
        webhookPath:
          connection.mode === "webhook" ? `/api/crm/connectors/${connection.id}/webhook` : null,
        createdAt: connection.created_at.toISOString(),
      };
    }),
    notifications: notifications.map((notification) => ({
      id: notification.id,
      connectionId: notification.connection_id,
      connectionName: notification.connection_name,
      severity: notification.severity,
      code: notification.code,
      message: notification.message,
      occurrenceCount: notification.occurrence_count,
      lastOccurredAt: notification.last_occurred_at.toISOString(),
    })),
    runs: runs.map((run) => ({
      id: run.id,
      sourceType: run.source_type,
      sourceName: run.source_name,
      fileName: run.file_name,
      status: run.status,
      duplicatePolicy: run.duplicate_policy,
      totalRows: run.total_rows,
      createdCount: run.created_count,
      mergedCount: run.merged_count,
      skippedCount: run.skipped_count,
      failedCount: run.failed_count,
      startedAt: run.started_at.toISOString(),
      completedAt: run.completed_at?.toISOString() ?? null,
    })),
    errors: errors.map((error) => ({
      id: error.id,
      importRunId: error.import_run_id,
      rowNumber: error.row_number,
      code: error.code,
      message: error.message,
    })),
  };
}

export async function createCrmImportConnection(
  context: CurrentPermissionContext,
  input: {
    provider: CrmImportProvider;
    name: string;
    accountReference: string | null;
    authenticationMethod: CrmPullAuthenticationMethod | null;
    accessToken: string | null;
    oauthClientId: string | null;
    oauthClientSecret: string | null;
    secondarySecret: string | null;
    webhookKey: string | null;
    instanceUrl: string | null;
    salesforceLoginUrl: string | null;
    apiVersion: string | null;
    region: string | null;
    syncEnabled: boolean;
    syncIntervalMinutes: number;
  },
): Promise<{ connectionId: string; oneTimeSecret?: string; oauthStartPath?: string }> {
  const actor = actorFromContext(context);
  const provider = input.provider;
  const mode = crmImportProviderModes[provider];
  const name = input.name.trim();
  const accountReference = input.accountReference?.trim() || null;
  const generatedWebhookKey =
    mode === "webhook" && !input.webhookKey ? randomBytes(24).toString("base64url") : null;
  const webhookKey = input.webhookKey ?? generatedWebhookKey;
  const credentials: Record<string, string> = {};
  const configuration: Record<string, unknown> = {};
  const authenticationMethod =
    mode === "pull" && isCrmPullProvider(provider)
      ? (input.authenticationMethod ?? crmPullProviderDefaultAuthenticationMethod[provider])
      : null;

  if (
    mode === "pull" &&
    isCrmPullProvider(provider) &&
    (!authenticationMethod || !supportsCrmPullAuthenticationMethod(provider, authenticationMethod))
  ) {
    throw new Error("Choose an authentication method supported by this CRM provider.");
  }

  if (provider === "meta_lead_ads") {
    credentials.accessToken = input.accessToken ?? "";
    credentials.appSecret = input.secondarySecret ?? "";
    credentials.verifyToken = webhookKey ?? randomBytes(24).toString("base64url");
    configuration.apiVersion = input.apiVersion?.trim() || "v23.0";
  } else if (provider === "google_ads") {
    // The Google lead-form webhook key is stored only as a one-way hash.
  } else if (authenticationMethod) {
    configuration.authenticationMethod = authenticationMethod;
    configuration.credentialOwner = authenticationMethod === "agency_oauth" ? "agency" : "client";
    if (authenticationMethod === "api_token") {
      if (!input.accessToken)
        throw new Error("Add the API token generated by the client CRM account.");
      credentials.accessToken = input.accessToken;
    } else if (authenticationMethod === "client_oauth") {
      if (!input.oauthClientId || !input.oauthClientSecret) {
        throw new Error("Add the client-owned OAuth application ID and secret.");
      }
      credentials.oauthClientId = input.oauthClientId;
      credentials.oauthClientSecret = input.oauthClientSecret;
    }
    if (provider === "salesforce") {
      if (input.instanceUrl) configuration.instanceUrl = safeSalesforceInstance(input.instanceUrl);
      configuration.apiVersion = input.apiVersion?.trim() || "v61.0";
      configuration.salesforceLoginUrl =
        input.salesforceLoginUrl?.trim() || "https://login.salesforce.com";
    }
    if (provider === "zoho") configuration.region = input.region?.trim().toLowerCase() || "us";
  }

  const encryptedCredentials = Object.keys(credentials).length
    ? encryptSecretObject(credentials)
    : null;
  const oauthPending =
    authenticationMethod === "client_oauth" || authenticationMethod === "agency_oauth";
  const authMethod =
    mode === "webhook"
      ? "webhook_secret"
      : authenticationMethod === "api_token"
        ? "manual"
        : "oauth";
  const database = getDatabaseClient();
  return database.begin(async (sql) => {
    const identity = accountReference
      ? `account:${accountReference.toLowerCase()}`
      : `name:${name.toLowerCase().replace(/\s+/g, " ")}`;
    await sql`
      select pg_advisory_xact_lock(
        hashtextextended(${`${actor.organizationId}:crm-connection:${provider}:${identity}`}, 0)
      )
    `;

    const duplicates = await sql<{ id: string; name: string }[]>`
      select id, name
      from public.crm_import_connections
      where organization_id = ${actor.organizationId}::uuid
        and provider = ${provider}
        and (
          (
            ${accountReference}::text is not null
            and lower(btrim(coalesce(account_reference, ''))) = lower(${accountReference})
          )
          or (
            ${accountReference}::text is null
            and account_reference is null
            and lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) =
                lower(regexp_replace(btrim(${name}), '\s+', ' ', 'g'))
          )
        )
      limit 1
    `;
    if (duplicates[0]) {
      throw new Error(`A matching ${crmImportProviderLabels[provider]} connection already exists.`);
    }

    const rows = await sql<{ id: string }[]>`
      insert into public.crm_import_connections (
        organization_id, provider, name, mode, status, auth_method,
        account_reference, configuration, encrypted_credentials, webhook_key_hash,
        sync_enabled, sync_interval_minutes, next_sync_at,
        last_credentials_rotated_at, created_by_membership_id, created_by
      ) values (
        ${actor.organizationId}::uuid,
        ${provider},
        ${name},
        ${mode},
        ${oauthPending ? "paused" : "active"},
        ${authMethod},
        ${accountReference},
        ${sql.json(toJsonValue(configuration))},
        ${encryptedCredentials},
        ${provider === "google_ads" && webhookKey ? sha256(webhookKey) : null},
        ${mode === "pull" ? input.syncEnabled : false},
        ${input.syncIntervalMinutes},
        ${mode === "pull" && input.syncEnabled && !oauthPending ? new Date() : null},
        ${encryptedCredentials ? new Date() : null},
        ${actor.membershipId}::uuid,
        ${actor.userId}::uuid
      ) returning id
    `;
    const connectionId = rows[0]?.id;
    if (!connectionId) throw new Error("CRM connection could not be created.");
    await writeImportAudit(
      sql,
      actor,
      "crm.connection.created",
      "crm_import_connection",
      connectionId,
      {
        provider,
        mode,
        authMethod,
        authenticationMethod,
        credentialOwner:
          authenticationMethod === "agency_oauth"
            ? "agency"
            : mode === "pull"
              ? "client"
              : "system",
        accountReference,
        syncEnabled: mode === "pull" ? input.syncEnabled : false,
        syncIntervalMinutes: input.syncIntervalMinutes,
      },
    );
    return {
      connectionId,
      oneTimeSecret:
        provider === "google_ads"
          ? (webhookKey ?? undefined)
          : provider === "meta_lead_ads"
            ? credentials.verifyToken
            : undefined,
      oauthStartPath:
        oauthPending && isCrmOAuthProvider(provider)
          ? `/api/crm/connectors/${connectionId}/oauth/start`
          : undefined,
    };
  });
}

export async function setCrmImportConnectionStatus(
  context: CurrentPermissionContext,
  connectionId: string,
  status: "active" | "paused",
): Promise<void> {
  const actor = actorFromContext(context);
  const database = getDatabaseClient();
  const rows = await database<
    Array<{
      id: string;
      mode: "webhook" | "pull";
      auth_method: "manual" | "oauth" | "webhook_secret";
      encrypted_credentials: string | null;
    }>
  >`
    select id, mode, auth_method, encrypted_credentials
    from public.crm_import_connections
    where id = ${connectionId}::uuid and organization_id = ${actor.organizationId}::uuid
    limit 1
  `;
  const connection = rows[0];
  if (!connection) throw new Error("CRM connection was not found.");
  if (status === "active" && connection.mode === "pull") {
    const credentials = connection.encrypted_credentials
      ? decryptSecretObject(connection.encrypted_credentials)
      : {};
    if (!credentials.accessToken) {
      throw new Error(
        connection.auth_method === "oauth"
          ? "Complete OAuth authorization before activating this connection."
          : "Add the client-managed API token before activating this connection.",
      );
    }
  }
  await database`
    update public.crm_import_connections
    set status = ${status},
        last_error = null,
        sync_claimed_until = null,
        next_sync_at = case
          when ${status} = 'active' and sync_enabled then now()
          else null
        end
    where id = ${connectionId}::uuid
  `;
  await writeImportAudit(
    database,
    actor,
    "crm.connection.status_changed",
    "crm_import_connection",
    connectionId,
    { status },
  );
}

export async function deleteCrmImportConnection(
  context: CurrentPermissionContext,
  connectionId: string,
): Promise<void> {
  const actor = actorFromContext(context);
  const database = getDatabaseClient();
  const rows = await database<{ id: string; provider: string }[]>`
    delete from public.crm_import_connections
    where id = ${connectionId}::uuid and organization_id = ${actor.organizationId}::uuid
    returning id, provider
  `;
  if (!rows[0]) throw new Error("CRM connection was not found.");
  await writeImportAudit(
    database,
    actor,
    "crm.connection.deleted",
    "crm_import_connection",
    connectionId,
    { provider: rows[0].provider },
  );
}

export async function updateCrmImportConnectionSchedule(
  context: CurrentPermissionContext,
  connectionId: string,
  syncEnabled: boolean,
  syncIntervalMinutes: number,
): Promise<void> {
  const actor = actorFromContext(context);
  const database = getDatabaseClient();
  const rows = await database<{ id: string; mode: "webhook" | "pull" }[]>`
    select id, mode
    from public.crm_import_connections
    where id = ${connectionId}::uuid
      and organization_id = ${actor.organizationId}::uuid
    limit 1
  `;
  const connection = rows[0];
  if (!connection) throw new Error("CRM connection was not found.");
  if (connection.mode !== "pull") throw new Error("Webhook connections do not use pull schedules.");
  await database`
    update public.crm_import_connections
    set sync_enabled = ${syncEnabled},
        sync_interval_minutes = ${syncIntervalMinutes},
        next_sync_at = case
          when ${syncEnabled} and status <> 'paused' and encrypted_credentials is not null then now()
          else null
        end,
        backoff_until = case when ${syncEnabled} then backoff_until else null end,
        sync_claimed_until = null
    where id = ${connectionId}::uuid
  `;
  await writeImportAudit(
    database,
    actor,
    "crm.connection.schedule_changed",
    "crm_import_connection",
    connectionId,
    { syncEnabled, syncIntervalMinutes },
  );
}

export async function rotateCrmImportConnectionCredentials(
  context: CurrentPermissionContext,
  connectionId: string,
  input: { accessToken: string | null; secondarySecret: string | null; webhookKey: string | null },
): Promise<{ oneTimeSecret?: string }> {
  const actor = actorFromContext(context);
  const connection = await readConnection(connectionId);
  if (connection.organization_id !== actor.organizationId)
    throw new Error("CRM connection was not found.");

  const database = getDatabaseClient();
  if (connection.mode === "pull") {
    if (connection.auth_method !== "manual") {
      throw new Error("Reconnect this OAuth connection to rotate its credentials.");
    }
    if (connection.provider !== "hubspot" && connection.provider !== "pipedrive") {
      throw new Error("This pull provider does not support a client-managed API token.");
    }
    const accessToken = input.accessToken?.trim();
    if (!accessToken) throw new Error("Add the replacement API token.");
    await database`
      update public.crm_import_connections
      set encrypted_credentials = ${encryptSecretObject({ accessToken })},
          credential_version = credential_version + 1,
          credentials_expires_at = null,
          last_credentials_rotated_at = now(),
          last_health_status = 'unknown',
          last_health_message = 'API token replaced; run a health check.',
          last_error = null,
          consecutive_failures = 0,
          backoff_until = null,
          sync_claimed_until = null,
          status = 'active',
          next_sync_at = case when sync_enabled then now() else null end
      where id = ${connection.id}::uuid
    `;
    await resolveConnectionNotifications(connection.id, [
      "credential_rejected",
      "credential_expired",
      "health_check_failed",
    ]);
    await writeImportAudit(
      database,
      actor,
      "crm.connection.credentials_rotated",
      "crm_import_connection",
      connection.id,
      { provider: connection.provider, credentialType: "client_api_token" },
    );
    return {};
  }

  if (connection.provider === "google_ads") {
    const webhookKey = input.webhookKey?.trim() || randomBytes(24).toString("base64url");
    await database`
      update public.crm_import_connections
      set webhook_key_hash = ${sha256(webhookKey)},
          credential_version = credential_version + 1,
          last_credentials_rotated_at = now(),
          last_health_status = 'healthy',
          last_health_check_at = now(),
          last_health_message = 'Webhook key rotated.',
          last_error = null,
          status = 'active'
      where id = ${connection.id}::uuid
    `;
    await writeImportAudit(
      database,
      actor,
      "crm.connection.credentials_rotated",
      "crm_import_connection",
      connection.id,
      { provider: connection.provider, credentialType: "webhook_key" },
    );
    return { oneTimeSecret: webhookKey };
  }

  if (connection.provider !== "meta_lead_ads") {
    throw new Error("This webhook provider does not support credential rotation.");
  }
  const existing = connection.encrypted_credentials
    ? decryptSecretObject(connection.encrypted_credentials)
    : {};
  const accessToken = input.accessToken?.trim() || existing.accessToken;
  const appSecret = input.secondarySecret?.trim() || existing.appSecret;
  const verifyToken = input.webhookKey?.trim() || existing.verifyToken;
  if (!accessToken || !appSecret || !verifyToken) {
    throw new Error(
      "Meta credential rotation requires a Page token, app secret, and verify token.",
    );
  }
  await database`
    update public.crm_import_connections
    set encrypted_credentials = ${encryptSecretObject({ accessToken, appSecret, verifyToken })},
        credential_version = credential_version + 1,
        last_credentials_rotated_at = now(),
        last_health_status = 'unknown',
        last_health_message = 'Credentials rotated; run a health check.',
        last_error = null,
        status = 'active'
    where id = ${connection.id}::uuid
  `;
  await writeImportAudit(
    database,
    actor,
    "crm.connection.credentials_rotated",
    "crm_import_connection",
    connection.id,
    { provider: connection.provider, credentialType: "meta_credentials" },
  );
  return {};
}

export async function acknowledgeCrmConnectionNotification(
  context: CurrentPermissionContext,
  notificationId: string,
): Promise<void> {
  const actor = actorFromContext(context);
  const database = getDatabaseClient();
  const rows = await database<{ id: string; connection_id: string }[]>`
    update public.crm_connection_notifications
    set status = 'acknowledged',
        acknowledged_at = now(),
        acknowledged_by_membership_id = ${actor.membershipId}::uuid
    where id = ${notificationId}::uuid
      and organization_id = ${actor.organizationId}::uuid
      and status = 'open'
    returning id, connection_id
  `;
  if (!rows[0]) throw new Error("CRM connection notification was not found.");
  await writeImportAudit(
    database,
    actor,
    "crm.connection.notification_acknowledged",
    "crm_connection_notification",
    notificationId,
    { connectionId: rows[0].connection_id },
  );
}

export async function beginCrmOAuthAuthorization(
  context: CurrentPermissionContext,
  connectionId: string,
): Promise<string> {
  const connection = await readConnection(connectionId);
  const actor = actorFromContext(context);
  if (connection.organization_id !== actor.organizationId)
    throw new Error("CRM connection was not found.");
  if (
    connection.mode !== "pull" ||
    connection.auth_method !== "oauth" ||
    !isCrmOAuthProvider(connection.provider)
  ) {
    throw new Error("This connection does not use OAuth authorization.");
  }
  const credentials = connection.encrypted_credentials
    ? decryptSecretObject(connection.encrypted_credentials)
    : {};
  const state = randomBytes(32).toString("base64url");
  const authorizationUrl = buildCrmOAuthAuthorizationUrl(
    connection.provider,
    state,
    oauthClientConfiguration(connection, credentials),
  );
  const database = getDatabaseClient();
  await database.begin(async (sql) => {
    await sql`
      delete from private.crm_oauth_states
      where expires_at <= now()
         or (membership_id = ${actor.membershipId}::uuid and connection_id = ${connection.id}::uuid)
    `;
    await sql`
      insert into private.crm_oauth_states (
        state_hash, organization_id, connection_id, provider, membership_id, expires_at
      ) values (
        ${sha256(state)},
        ${actor.organizationId}::uuid,
        ${connection.id}::uuid,
        ${connection.provider},
        ${actor.membershipId}::uuid,
        now() + interval '10 minutes'
      )
    `;
  });
  return authorizationUrl;
}

export async function completeCrmOAuthAuthorization(
  context: CurrentPermissionContext,
  provider: CrmOAuthProvider,
  state: string,
  code: string,
): Promise<string> {
  const actor = actorFromContext(context);
  const database = getDatabaseClient();
  const stateRows = await database<
    Array<{ connection_id: string; organization_id: string; provider: CrmOAuthProvider }>
  >`
    delete from private.crm_oauth_states
    where state_hash = ${sha256(state)}
      and membership_id = ${actor.membershipId}::uuid
      and organization_id = ${actor.organizationId}::uuid
      and provider = ${provider}
      and expires_at > now()
    returning connection_id, organization_id, provider
  `;
  const oauthState = stateRows[0];
  if (!oauthState) throw new Error("The OAuth request expired or did not match this session.");
  const connection = await readConnection(oauthState.connection_id);
  if (
    connection.organization_id !== actor.organizationId ||
    connection.provider !== provider ||
    connection.auth_method !== "oauth"
  ) {
    throw new Error("CRM connection was not found.");
  }

  const existingCredentials = connection.encrypted_credentials
    ? decryptSecretObject(connection.encrypted_credentials)
    : {};
  const tokenResult = await exchangeCrmOAuthCode(
    provider,
    code,
    oauthClientConfiguration(connection, existingCredentials),
  );
  const configuration = { ...connection.configuration, ...tokenResult.configuration };
  const encryptedCredentials = encryptSecretObject(
    mergedOAuthCredentialEnvelope(existingCredentials, tokenResult.credentials),
  );
  await database`
    update public.crm_import_connections
    set encrypted_credentials = ${encryptedCredentials},
        configuration = ${database.json(toJsonValue(configuration))},
        auth_method = 'oauth',
        status = 'active',
        credential_version = credential_version + 1,
        credentials_expires_at = ${tokenResult.expiresAt ? new Date(tokenResult.expiresAt) : null},
        last_credentials_rotated_at = now(),
        last_health_status = 'unknown',
        last_health_message = 'OAuth connected; run a health check or sync.',
        last_error = null,
        consecutive_failures = 0,
        backoff_until = null,
        sync_cursor = '{}'::jsonb,
        next_sync_at = case when sync_enabled then now() else null end
    where id = ${connection.id}::uuid
  `;
  await resolveConnectionNotifications(connection.id, [
    "credential_rejected",
    "credential_expired",
    "health_check_failed",
  ]);
  await writeImportAudit(
    database,
    actor,
    "crm.connection.oauth_connected",
    "crm_import_connection",
    connection.id,
    {
      provider,
      authenticationMethod: connectionAuthenticationMethod(connection),
      credentialOwner: connectionCredentialOwner(connectionAuthenticationMethod(connection)),
      redirectUri: crmOAuthRedirectUri(provider),
      credentialVersion: connection.credential_version + 1,
    },
  );
  return connection.id;
}

async function readConnection(connectionId: string): Promise<ConnectionSecretRow> {
  const database = getDatabaseClient();
  const rows = await database<ConnectionSecretRow[]>`
    select id, organization_id, provider, name, mode, status, auth_method, account_reference,
           configuration, encrypted_credentials, webhook_key_hash, sync_enabled,
           sync_interval_minutes, next_sync_at, sync_checkpoint, sync_cursor,
           consecutive_failures, backoff_until, credentials_expires_at, credential_version,
           created_by_membership_id, created_by
    from public.crm_import_connections
    where id = ${connectionId}::uuid
    limit 1
  `;
  const connection = rows[0];
  if (!connection) throw new Error("CRM connection was not found.");
  return connection;
}

function connectionActor(connection: ConnectionSecretRow): ImportActor {
  return {
    organizationId: connection.organization_id,
    membershipId: connection.created_by_membership_id,
    userId: connection.created_by,
  };
}

async function defaultStageAndOwner(connection: ConnectionSecretRow) {
  const database = getDatabaseClient();
  const stages = await database<{ id: string }[]>`
    select id from public.crm_pipeline_stages
    where organization_id = ${connection.organization_id}::uuid and is_active = true and state = 'open'
    order by position limit 1
  `;
  if (!stages[0]) throw new Error("No active open CRM pipeline stage is configured.");
  return { stageId: stages[0].id, ownerMembershipId: connection.created_by_membership_id };
}

interface ProviderJsonResult {
  payload: unknown;
  status: number;
}

interface PullConnectionResult {
  rows: CrmImportLeadRow[];
  cursor: CrmSyncCursor;
  checkpoint: CrmSyncCheckpoint;
  hasMore: boolean;
  pagesFetched: number;
}

async function fetchJson(url: URL, init: RequestInit): Promise<ProviderJsonResult> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(20_000),
    headers: { Accept: "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
  });
  if (response.status === 304) return { payload: null, status: response.status };
  if (!response.ok) {
    throw new ProviderRequestError(
      response.status === 429
        ? "The provider rate limit was reached. AgencyOS will retry after backoff."
        : response.status === 401 || response.status === 403
          ? "The provider rejected the connection credentials. Reconnect or rotate them."
          : `External CRM returned HTTP ${response.status}.`,
      response.status,
      parseRetryAfterSeconds(response.headers.get("retry-after")),
    );
  }
  const text = await readBoundedResponseText(
    response,
    5 * 1024 * 1024,
    "External CRM response exceeded 5 MB.",
  );
  if (!text) return { payload: null, status: response.status };
  try {
    return { payload: JSON.parse(text), status: response.status };
  } catch {
    throw new Error("External CRM returned invalid JSON.");
  }
}

const hubSpotCanonicalProperties = [
  "firstname",
  "lastname",
  "email",
  "phone",
  "company",
  "jobtitle",
] as const;

function hubSpotPropertyNames(payload: unknown): string[] {
  if (
    !payload ||
    typeof payload !== "object" ||
    !("results" in payload) ||
    !Array.isArray(payload.results)
  ) {
    return [...hubSpotCanonicalProperties, "hs_lead_status", "lastmodifieddate"];
  }
  return [
    ...new Set([
      ...hubSpotCanonicalProperties,
      "hs_lead_status",
      "lastmodifieddate",
      ...payload.results.flatMap((value) => {
        if (!value || typeof value !== "object" || !("name" in value)) return [];
        const name = String(value.name).trim();
        return name ? [name] : [];
      }),
    ]),
  ];
}

function salesforceFieldNames(payload: unknown): string[] {
  if (!payload || typeof payload !== "object" || !("fields" in payload)) return [];
  const fields = Array.isArray(payload.fields) ? payload.fields : [];
  return [
    ...new Set(
      fields.flatMap((value) => {
        if (!value || typeof value !== "object" || !("name" in value)) return [];
        const name = String(value.name).trim();
        return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? [name] : [];
      }),
    ),
  ];
}

function hubSpotRows(payload: unknown): CrmImportLeadRow[] {
  if (
    !payload ||
    typeof payload !== "object" ||
    !("results" in payload) ||
    !Array.isArray(payload.results)
  )
    return [];
  return payload.results.map((item, index) => {
    const record = item as {
      id?: string;
      archived?: boolean;
      createdAt?: string;
      updatedAt?: string;
      properties?: Record<string, unknown>;
    };
    const properties = record.properties ?? {};
    const first = String(properties.firstname ?? "").trim();
    const last = String(properties.lastname ?? "").trim();
    return {
      rowNumber: index + 1,
      externalId: record.id ?? null,
      name: [first, last].filter(Boolean).join(" ") || String(properties.company ?? "HubSpot lead"),
      leadType: "person" as const,
      source: "HubSpot",
      email: String(properties.email ?? "") || null,
      phone: String(properties.phone ?? "") || null,
      companyName: String(properties.company ?? "") || null,
      notes: String(properties.jobtitle ?? "") || null,
      extraFields: sanitizeCrmExtraFields(
        {
          ...properties,
          recordCreatedAt: record.createdAt ?? null,
          recordUpdatedAt: record.updatedAt ?? null,
          archived: record.archived ?? false,
        },
        hubSpotCanonicalProperties,
      ),
      raw: redactImportPayload(properties),
    };
  });
}

function salesforceRows(payload: unknown): CrmImportLeadRow[] {
  if (
    !payload ||
    typeof payload !== "object" ||
    !("records" in payload) ||
    !Array.isArray(payload.records)
  )
    return [];
  return payload.records.map((value, index) => {
    const record = value as Record<string, unknown>;
    return {
      rowNumber: index + 1,
      externalId: String(record.Id ?? "") || null,
      name: String(record.Name ?? record.Company ?? "Salesforce lead"),
      leadType: record.Company ? ("company" as const) : ("person" as const),
      source: String(record.LeadSource ?? "Salesforce"),
      email: String(record.Email ?? "") || null,
      phone: String(record.Phone ?? "") || null,
      companyName: String(record.Company ?? "") || null,
      estimatedValue: typeof record.AnnualRevenue === "number" ? record.AnnualRevenue : null,
      notes: String(record.Description ?? "") || null,
      extraFields: sanitizeCrmExtraFields(record, [
        "Id",
        "Name",
        "Company",
        "Email",
        "Phone",
        "LeadSource",
        "AnnualRevenue",
        "Description",
      ]),
      raw: redactImportPayload(record),
    };
  });
}

function zohoRows(payload: unknown): CrmImportLeadRow[] {
  if (
    !payload ||
    typeof payload !== "object" ||
    !("data" in payload) ||
    !Array.isArray(payload.data)
  )
    return [];
  return payload.data.map((value, index) => {
    const record = value as Record<string, unknown>;
    const first = String(record.First_Name ?? "").trim();
    const last = String(record.Last_Name ?? "").trim();
    return {
      rowNumber: index + 1,
      externalId: String(record.id ?? "") || null,
      name: [first, last].filter(Boolean).join(" ") || String(record.Company ?? "Zoho lead"),
      leadType: "person" as const,
      source: String(record.Lead_Source ?? "Zoho CRM"),
      email: String(record.Email ?? "") || null,
      phone: String(record.Phone ?? record.Mobile ?? "") || null,
      companyName: String(record.Company ?? "") || null,
      estimatedValue: typeof record.Annual_Revenue === "number" ? record.Annual_Revenue : null,
      notes: String(record.Description ?? "") || null,
      extraFields: sanitizeCrmExtraFields(record, [
        "id",
        "First_Name",
        "Last_Name",
        "Company",
        "Email",
        "Phone",
        "Mobile",
        "Lead_Source",
        "Annual_Revenue",
        "Description",
      ]),
      raw: redactImportPayload(record),
    };
  });
}

function pipedriveRows(payload: unknown, modifiedAfter: Date | null): CrmImportLeadRow[] {
  if (
    !payload ||
    typeof payload !== "object" ||
    !("data" in payload) ||
    !Array.isArray(payload.data)
  )
    return [];
  return payload.data
    .filter((value) => {
      if (!modifiedAfter || !value || typeof value !== "object") return true;
      const updated = new Date(String(Reflect.get(value, "update_time") ?? ""));
      return Number.isNaN(updated.getTime()) || updated > modifiedAfter;
    })
    .map((value, index) => {
      const record = value as Record<string, unknown>;
      const person = (record.person_id ?? {}) as Record<string, unknown>;
      const organization = (record.organization_id ?? {}) as Record<string, unknown>;
      return {
        rowNumber: index + 1,
        externalId: String(record.id ?? "") || null,
        name: String(record.title ?? person.name ?? organization.name ?? "Pipedrive lead"),
        leadType: organization.name ? ("company" as const) : ("person" as const),
        source: "Pipedrive",
        email: String(person.email ?? "") || null,
        phone: String(person.phone ?? "") || null,
        companyName: String(organization.name ?? "") || null,
        estimatedValue: typeof record.value === "number" ? record.value : null,
        currency: String(record.currency ?? "") || null,
        extraFields: sanitizeCrmExtraFields(record, ["id", "title", "value", "currency"]),
        raw: redactImportPayload(record),
      };
    });
}

function safePipedriveApiOrigin(value: unknown): string {
  const raw = typeof value === "string" && value ? value : "https://api.pipedrive.com";
  const url = new URL(raw);
  if (url.protocol !== "https:" || !/(^|\.)pipedrive\.com$/i.test(url.hostname)) {
    throw new Error("Pipedrive API domain is not allowlisted.");
  }
  return url.origin;
}

async function usableConnectionCredentials(
  connection: ConnectionSecretRow,
  forceRefresh = false,
): Promise<Record<string, string>> {
  const credentials = connection.encrypted_credentials
    ? decryptSecretObject(connection.encrypted_credentials)
    : {};
  if (!credentials.accessToken) {
    throw new Error(
      connection.auth_method === "manual"
        ? "Replace the client-managed API token before syncing this connection."
        : "Authorize this CRM account with OAuth before syncing it.",
    );
  }

  const expiresAt = checkpointDate(
    credentials.expiresAt ?? connection.credentials_expires_at?.toISOString(),
  );
  if (
    !forceRefresh &&
    (connection.auth_method !== "oauth" || !expiresAt || expiresAt.getTime() > Date.now() + 60_000)
  ) {
    return credentials;
  }
  if (!isCrmOAuthProvider(connection.provider) || !credentials.refreshToken) {
    throw new Error("The OAuth credentials expired. Reconnect the CRM account.");
  }

  const refreshed = await refreshCrmOAuthToken(
    connection.provider,
    credentials.refreshToken,
    oauthClientConfiguration(connection, credentials),
  );
  const mergedConfiguration = { ...connection.configuration, ...refreshed.configuration };
  const refreshedCredentials = mergedOAuthCredentialEnvelope(credentials, refreshed.credentials);
  const refreshedEnvelope = encryptSecretObject(refreshedCredentials);
  const database = getDatabaseClient();
  await database`
    update public.crm_import_connections
    set encrypted_credentials = ${refreshedEnvelope},
        configuration = ${database.json(toJsonValue(mergedConfiguration))},
        credentials_expires_at = ${refreshed.expiresAt ? new Date(refreshed.expiresAt) : null},
        credential_version = credential_version + 1,
        last_credentials_rotated_at = now(),
        last_error = null
    where id = ${connection.id}::uuid
  `;
  connection.configuration = mergedConfiguration;
  connection.encrypted_credentials = refreshedEnvelope;
  connection.credentials_expires_at = refreshed.expiresAt ? new Date(refreshed.expiresAt) : null;
  connection.credential_version += 1;
  return refreshedCredentials;
}

function appendRows(target: CrmImportLeadRow[], rows: CrmImportLeadRow[]) {
  if (target.length + rows.length > CRM_SYNC_MAX_ROWS) {
    throw new Error(
      `External CRM sync exceeded the ${CRM_SYNC_MAX_ROWS.toLocaleString("en-US")}-row safety limit. Narrow the provider data set or run smaller incremental windows.`,
    );
  }
  target.push(...rows);
}

async function pullConnectionRows(
  connection: ConnectionSecretRow,
  suppliedCredentials?: Record<string, string>,
): Promise<PullConnectionResult> {
  const credentials = suppliedCredentials ?? (await usableConnectionCredentials(connection));
  const token = credentials.accessToken;
  const priorCheckpoint = checkpointDate(connection.sync_checkpoint?.modifiedAfter);
  const windowStartedAt =
    connection.sync_cursor?.windowStartedAt &&
    checkpointDate(connection.sync_cursor.windowStartedAt)
      ? connection.sync_cursor.windowStartedAt
      : new Date().toISOString();
  const rows: CrmImportLeadRow[] = [];
  let pagesFetched = 0;
  let hasMore = false;
  let nextCursor: CrmSyncCursor = { windowStartedAt };

  if (connection.provider === "hubspot") {
    const propertyResult = await fetchJson(
      new URL("https://api.hubapi.com/crm/v3/properties/contacts?dataSensitivity=non_sensitive"),
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const properties = hubSpotPropertyNames(propertyResult.payload);
    let after = connection.sync_cursor?.after;
    for (let page = 0; page < CRM_SYNC_MAX_PAGES && rows.length < CRM_SYNC_MAX_ROWS; page += 1) {
      const url = new URL("https://api.hubapi.com/crm/v3/objects/contacts/search");
      const body: Record<string, unknown> = {
        limit: 200,
        properties,
        sorts: ["lastmodifieddate"],
        ...(after ? { after } : {}),
        ...(priorCheckpoint
          ? {
              filterGroups: [
                {
                  filters: [
                    {
                      propertyName: "lastmodifieddate",
                      operator: "GT",
                      value: String(priorCheckpoint.getTime()),
                    },
                  ],
                },
              ],
            }
          : {}),
      };
      const result = await fetchJson(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      pagesFetched += 1;
      appendRows(rows, hubSpotRows(result.payload));
      after = hubSpotNextAfter(result.payload) ?? undefined;
      if (!after) break;
      hasMore = true;
      nextCursor = { windowStartedAt, after, pagesFetched };
    }
    hasMore = Boolean(after);
    nextCursor = hasMore ? { windowStartedAt, after, pagesFetched } : {};
  } else if (connection.provider === "salesforce") {
    const instance = safeSalesforceInstance(
      String(connection.configuration.instanceUrl ?? credentials.apiDomain ?? ""),
    );
    const version = String(connection.configuration.apiVersion ?? "v61.0").replace(
      /[^v0-9.]/gi,
      "",
    );
    const describeUrl = new URL(`${instance}/services/data/${version}/sobjects/Lead/describe`);
    const description = await fetchJson(describeUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const fields = salesforceFieldNames(description.payload);
    if (!fields.length) throw new Error("Salesforce returned no readable Lead fields.");
    let nextPath = connection.sync_cursor?.nextPath;
    for (let page = 0; page < CRM_SYNC_MAX_PAGES && rows.length < CRM_SYNC_MAX_ROWS; page += 1) {
      let url: URL;
      if (nextPath) {
        url = new URL(nextPath, instance);
      } else {
        url = new URL(`${instance}/services/data/${version}/query`);
        const where = priorCheckpoint
          ? ` WHERE LastModifiedDate > ${priorCheckpoint.toISOString()}`
          : "";
        url.searchParams.set(
          "q",
          `SELECT ${fields.join(",")} FROM Lead${where} ORDER BY LastModifiedDate ASC, Id ASC`,
        );
      }
      const result = await fetchJson(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Sforce-Query-Options": "batchSize=200",
        },
      });
      pagesFetched += 1;
      appendRows(rows, salesforceRows(result.payload));
      nextPath = salesforceNextPath(result.payload) ?? undefined;
      if (!nextPath) break;
      hasMore = true;
      nextCursor = { windowStartedAt, nextPath, pagesFetched };
    }
    hasMore = Boolean(nextPath);
    nextCursor = hasMore ? { windowStartedAt, nextPath, pagesFetched } : {};
  } else if (connection.provider === "zoho") {
    let page = connection.sync_cursor?.page ?? 1;
    let nextPage: number | null = null;
    for (let index = 0; index < CRM_SYNC_MAX_PAGES && rows.length < CRM_SYNC_MAX_ROWS; index += 1) {
      const url = new URL(
        `${safeZohoApiBase(String(connection.configuration.region ?? "us"))}/crm/v7/Leads`,
      );
      url.searchParams.set("per_page", "200");
      url.searchParams.set("page", String(page));
      const headers: Record<string, string> = { Authorization: `Zoho-oauthtoken ${token}` };
      if (priorCheckpoint) headers["If-Modified-Since"] = priorCheckpoint.toISOString();
      const result = await fetchJson(url, { headers });
      pagesFetched += 1;
      if (result.status === 304) break;
      appendRows(rows, zohoRows(result.payload));
      const more = zohoHasMoreRecords(result.payload);
      if (!more) {
        nextPage = null;
        break;
      }
      page += 1;
      nextPage = page;
    }
    hasMore = nextPage !== null;
    nextCursor = hasMore ? { windowStartedAt, page: nextPage ?? page, pagesFetched } : {};
  } else if (connection.provider === "pipedrive") {
    let start = connection.sync_cursor?.nextStart ?? 0;
    let pendingNextStart: number | null = null;
    const apiOrigin = safePipedriveApiOrigin(
      connection.configuration.apiDomain ?? credentials.apiDomain,
    );
    for (let page = 0; page < CRM_SYNC_MAX_PAGES && rows.length < CRM_SYNC_MAX_ROWS; page += 1) {
      const url = new URL("/api/v1/leads", apiOrigin);
      url.searchParams.set("limit", "100");
      url.searchParams.set("start", String(start));
      url.searchParams.set("sort", "update_time DESC");
      const headers: Record<string, string> = {};
      if (connection.auth_method === "oauth") headers.Authorization = `Bearer ${token}`;
      else url.searchParams.set("api_token", token);
      const result = await fetchJson(url, { headers });
      pagesFetched += 1;
      appendRows(rows, pipedriveRows(result.payload, priorCheckpoint));
      const nextStart = pipedriveNextStart(result.payload);
      if (nextStart === null) {
        pendingNextStart = null;
        break;
      }
      start = nextStart;
      pendingNextStart = nextStart;
    }
    hasMore = pendingNextStart !== null;
    nextCursor = hasMore
      ? { windowStartedAt, nextStart: pendingNextStart ?? start, pagesFetched }
      : {};
  } else {
    throw new Error("This connection receives leads by webhook and cannot be manually pulled.");
  }

  return {
    rows,
    cursor: nextCursor,
    checkpoint: hasMore ? (connection.sync_checkpoint ?? {}) : { modifiedAfter: windowStartedAt },
    hasMore,
    pagesFetched,
  };
}

async function pullConnectionRowsWithOAuthRetry(
  connection: ConnectionSecretRow,
): Promise<PullConnectionResult> {
  try {
    return await pullConnectionRows(connection);
  } catch (error) {
    if (
      !(error instanceof ProviderRequestError) ||
      error.status !== 401 ||
      connection.auth_method !== "oauth"
    ) {
      throw error;
    }
    const refreshed = await usableConnectionCredentials(connection, true);
    return pullConnectionRows(connection, refreshed);
  }
}

async function upsertConnectionNotification(
  connection: ConnectionSecretRow,
  severity: "info" | "warning" | "error",
  code: string,
  message: string,
) {
  const database = getDatabaseClient();
  const safeMessage = message.slice(0, 500);
  await database`
    insert into public.crm_connection_notifications (
      organization_id, connection_id, severity, code, message
    ) values (
      ${connection.organization_id}::uuid,
      ${connection.id}::uuid,
      ${severity},
      ${code},
      ${safeMessage}
    )
    on conflict (connection_id, code) where status = 'open'
    do update set severity = excluded.severity,
                  message = excluded.message,
                  occurrence_count = public.crm_connection_notifications.occurrence_count + 1,
                  last_occurred_at = now()
  `;

  await enqueueNotification({
    organizationId: connection.organization_id,
    recipientMembershipId: connection.created_by_membership_id,
    category: "integration_failure",
    severity,
    title: `${crmImportProviderLabels[connection.provider]} connection needs attention`,
    message: safeMessage,
    deepLink: "/crm?tab=imports",
    sourceModule: "crm",
    sourceEntityType: "crm_import_connection",
    sourceEntityId: connection.id,
    dedupeKey: `crm-connection:${connection.id}:${code}`,
    metadata: { connectionId: connection.id, code },
  }).catch(() => undefined);
}

async function resolveConnectionNotifications(connectionId: string, codes: string[]) {
  if (!codes.length) return;
  const database = getDatabaseClient();
  await database`
    update public.crm_connection_notifications
    set status = 'resolved', last_occurred_at = now()
    where connection_id = ${connectionId}::uuid
      and status = 'open'
      and code = any(${codes}::text[])
  `;
}

function safeSyncError(error: unknown): string {
  if (error instanceof ProviderRequestError) return error.message.slice(0, 500);
  if (error instanceof Error)
    return error.message.replace(/https?:\/\/\S+/g, "[provider-url]").slice(0, 500);
  return "CRM sync failed.";
}

async function claimConnectionSync(connectionId: string): Promise<boolean> {
  const database = getDatabaseClient();
  const rows = await database<{ id: string }[]>`
    update public.crm_import_connections
    set sync_claimed_until = now() + interval '5 minutes',
        last_sync_at = now(),
        last_error = null
    where id = ${connectionId}::uuid
      and (sync_claimed_until is null or sync_claimed_until < now())
    returning id
  `;
  return Boolean(rows[0]);
}

async function syncCrmConnectionCore(
  connection: ConnectionSecretRow,
  actor: ImportActor,
): Promise<CrmImportOutcome> {
  if (connection.mode !== "pull") {
    throw new Error("Webhook connections cannot be pulled manually.");
  }
  if (connection.status === "paused") throw new Error("Activate the connection before syncing it.");
  if (!(await claimConnectionSync(connection.id))) {
    throw new Error("This connection is already syncing. Try again shortly.");
  }

  const database = getDatabaseClient();
  try {
    const pulled = await pullConnectionRowsWithOAuthRetry(connection);
    const defaults = await defaultStageAndOwner(connection);
    const outcome = await importLeadRows(
      actor,
      {
        sourceType: connection.provider,
        sourceName: connection.name,
        connectionId: connection.id,
        stageId: defaults.stageId,
        ownerMembershipId: defaults.ownerMembershipId,
        duplicatePolicy: "merge",
      },
      pulled.rows,
    );
    await database`
      update public.crm_import_connections
      set status = 'active',
          last_success_at = now(),
          last_error = null,
          consecutive_failures = 0,
          backoff_until = null,
          sync_claimed_until = null,
          sync_checkpoint = ${database.json(toJsonValue(pulled.checkpoint))},
          sync_cursor = ${database.json(toJsonValue(pulled.cursor))},
          next_sync_at = case
            when sync_enabled = false then null
            when ${pulled.hasMore} then now()
            else now() + make_interval(mins => sync_interval_minutes)
          end,
          last_health_check_at = now(),
          last_health_status = 'healthy',
          last_health_message = ${
            pulled.hasMore
              ? `Imported ${pulled.pagesFetched} pages; continuation is queued.`
              : `Imported ${pulled.pagesFetched} pages and advanced the incremental checkpoint.`
          }
      where id = ${connection.id}::uuid
    `;
    await resolveConnectionNotifications(connection.id, [
      "sync_failed",
      "rate_limited",
      "credential_rejected",
      "health_check_failed",
    ]);
    return outcome;
  } catch (error) {
    const failures = connection.consecutive_failures + 1;
    const retryAfter = error instanceof ProviderRequestError ? error.retryAfterSeconds : null;
    const backoffSeconds = calculateCrmSyncBackoffSeconds(failures, retryAfter);
    const errorMessage = safeSyncError(error);
    const authFailure = error instanceof ProviderRequestError && [401, 403].includes(error.status);
    const rateLimited = error instanceof ProviderRequestError && error.status === 429;
    await database`
      update public.crm_import_connections
      set status = ${authFailure || failures >= 5 ? "error" : "active"},
          last_error = ${errorMessage},
          consecutive_failures = consecutive_failures + 1,
          backoff_until = now() + (${backoffSeconds} * interval '1 second'),
          next_sync_at = case
            when sync_enabled then now() + (${backoffSeconds} * interval '1 second')
            else null
          end,
          last_rate_limited_at = case when ${rateLimited} then now() else last_rate_limited_at end,
          sync_claimed_until = null,
          last_health_check_at = now(),
          last_health_status = ${authFailure ? "unhealthy" : "degraded"},
          last_health_message = ${errorMessage}
      where id = ${connection.id}::uuid
    `;
    await upsertConnectionNotification(
      connection,
      authFailure ? "error" : "warning",
      authFailure ? "credential_rejected" : rateLimited ? "rate_limited" : "sync_failed",
      authFailure
        ? "The provider rejected this connection. Reconnect OAuth or replace the client-managed credential."
        : rateLimited
          ? `The provider rate limit was reached. Automatic retry is delayed by ${backoffSeconds} seconds.`
          : `CRM sync failed and will retry after ${backoffSeconds} seconds.`,
    );
    throw error;
  }
}

export async function syncCrmImportConnection(
  context: CurrentPermissionContext,
  connectionId: string,
): Promise<CrmImportOutcome> {
  const connection = await readConnection(connectionId);
  if (connection.organization_id !== context.membership.organizationId) {
    throw new Error("CRM connection was not found.");
  }
  return syncCrmConnectionCore(connection, actorFromContext(context));
}

async function performCrmConnectionHealthCheck(connection: ConnectionSecretRow): Promise<string> {
  if (connection.provider === "google_ads") {
    if (!connection.webhook_key_hash) throw new Error("The Google webhook key is not configured.");
    return "Webhook key is configured.";
  }

  const credentials = await usableConnectionCredentials(connection);
  const token = credentials.accessToken;
  if (connection.provider === "meta_lead_ads") {
    const version = String(connection.configuration.apiVersion ?? "v23.0").replace(
      /[^v0-9.]/gi,
      "",
    );
    const url = new URL(`https://graph.facebook.com/${version}/me`);
    url.searchParams.set("fields", "id");
    url.searchParams.set("access_token", token);
    await fetchJson(url, {});
    return "Meta credentials are accepted.";
  }
  if (connection.provider === "hubspot") {
    const url = new URL("https://api.hubapi.com/crm/v3/objects/contacts");
    url.searchParams.set("limit", "1");
    await fetchJson(url, { headers: { Authorization: `Bearer ${token}` } });
    return connection.auth_method === "manual"
      ? "HubSpot private-app token is accepted."
      : "HubSpot OAuth credentials are accepted.";
  }
  if (connection.provider === "salesforce") {
    const instance = safeSalesforceInstance(
      String(connection.configuration.instanceUrl ?? credentials.apiDomain ?? ""),
    );
    const version = String(connection.configuration.apiVersion ?? "v61.0").replace(
      /[^v0-9.]/gi,
      "",
    );
    await fetchJson(new URL(`${instance}/services/data/${version}/limits`), {
      headers: { Authorization: `Bearer ${token}` },
    });
    return "Salesforce credentials are accepted.";
  }
  if (connection.provider === "zoho") {
    const url = new URL(
      `${safeZohoApiBase(String(connection.configuration.region ?? "us"))}/crm/v7/Leads`,
    );
    url.searchParams.set("fields", "id");
    url.searchParams.set("per_page", "1");
    await fetchJson(url, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
    return "Zoho CRM credentials are accepted.";
  }
  if (connection.provider === "pipedrive") {
    const apiOrigin = safePipedriveApiOrigin(
      connection.configuration.apiDomain ?? credentials.apiDomain,
    );
    const url = new URL("/api/v1/users/me", apiOrigin);
    const headers: Record<string, string> = {};
    if (connection.auth_method === "oauth") headers.Authorization = `Bearer ${token}`;
    else url.searchParams.set("api_token", token);
    await fetchJson(url, { headers });
    return "Pipedrive credentials are accepted.";
  }
  throw new Error("This provider does not support a health check.");
}

export async function checkCrmImportConnectionHealth(
  context: CurrentPermissionContext,
  connectionId: string,
): Promise<string> {
  const connection = await readConnection(connectionId);
  const actor = actorFromContext(context);
  if (connection.organization_id !== actor.organizationId)
    throw new Error("CRM connection was not found.");
  const database = getDatabaseClient();
  try {
    let message: string;
    try {
      message = await performCrmConnectionHealthCheck(connection);
    } catch (error) {
      if (
        !(error instanceof ProviderRequestError) ||
        error.status !== 401 ||
        connection.auth_method !== "oauth"
      ) {
        throw error;
      }
      await usableConnectionCredentials(connection, true);
      message = await performCrmConnectionHealthCheck(connection);
    }
    await database`
      update public.crm_import_connections
      set last_health_check_at = now(),
          last_health_status = 'healthy',
          last_health_message = ${message},
          last_error = null,
          status = case when status = 'paused' then status else 'active' end
      where id = ${connection.id}::uuid
    `;
    await resolveConnectionNotifications(connection.id, [
      "health_check_failed",
      "credential_rejected",
      "credential_expired",
    ]);
    await writeImportAudit(
      database,
      actor,
      "crm.connection.health_checked",
      "crm_import_connection",
      connection.id,
      { status: "healthy" },
    );
    return message;
  } catch (error) {
    const message = safeSyncError(error);
    const authFailure = error instanceof ProviderRequestError && [401, 403].includes(error.status);
    await database`
      update public.crm_import_connections
      set last_health_check_at = now(),
          last_health_status = ${authFailure ? "unhealthy" : "degraded"},
          last_health_message = ${message},
          last_error = ${message},
          status = case when ${authFailure} then 'error' else status end
      where id = ${connection.id}::uuid
    `;
    await upsertConnectionNotification(
      connection,
      authFailure ? "error" : "warning",
      authFailure ? "credential_rejected" : "health_check_failed",
      authFailure
        ? "The provider rejected the saved credentials. Reconnect OAuth or replace the client-managed credential."
        : "The connection health check failed. Review the provider and network status.",
    );
    throw error;
  }
}

export interface ScheduledCrmSyncSummary {
  attempted: number;
  succeeded: number;
  failed: number;
  skippedUnauthorized: number;
}

export async function runDueCrmConnectionSyncs(limit = 10): Promise<ScheduledCrmSyncSummary> {
  const boundedLimit = Math.max(1, Math.min(25, Math.trunc(limit)));
  const database = getDatabaseClient();
  const due = await database<{ id: string }[]>`
    select id
    from public.crm_import_connections
    where mode = 'pull'
      and sync_enabled = true
      and status <> 'paused'
      and encrypted_credentials is not null
      and coalesce(next_sync_at, now()) <= now()
      and coalesce(backoff_until, '-infinity'::timestamptz) <= now()
      and (sync_claimed_until is null or sync_claimed_until < now())
    order by coalesce(next_sync_at, created_at), id
    limit ${boundedLimit}
  `;

  const summary: ScheduledCrmSyncSummary = {
    attempted: due.length,
    succeeded: 0,
    failed: 0,
    skippedUnauthorized: 0,
  };
  for (const row of due) {
    const connection = await readConnection(row.id);
    const permissionRows = await database<{ allowed: boolean }[]>`
      select private.membership_has_permission(
        ${connection.created_by_membership_id}::uuid,
        'crm.import.execute'
      ) as allowed
    `;
    if (!permissionRows[0]?.allowed) {
      summary.skippedUnauthorized += 1;
      await database`
        update public.crm_import_connections
        set sync_enabled = false,
            next_sync_at = null,
            sync_claimed_until = null,
            last_error = 'Scheduled sync disabled because the connection owner no longer has import permission.',
            last_health_status = 'unhealthy',
            last_health_check_at = now(),
            last_health_message = 'Connection owner authorization failed.'
        where id = ${connection.id}::uuid
      `;
      await upsertConnectionNotification(
        connection,
        "error",
        "schedule_unauthorized",
        "Scheduled sync was disabled because the connection owner is inactive or no longer has CRM import permission.",
      );
      continue;
    }
    try {
      await syncCrmConnectionCore(connection, connectionActor(connection));
      summary.succeeded += 1;
    } catch {
      summary.failed += 1;
    }
  }
  return summary;
}

function fieldDataMap(fieldData: unknown): Record<string, string> {
  if (!Array.isArray(fieldData)) return {};
  return Object.fromEntries(
    fieldData.flatMap((field) => {
      if (!field || typeof field !== "object") return [];
      const name = "name" in field ? String(field.name) : "";
      const values = "values" in field && Array.isArray(field.values) ? field.values : [];
      return name ? [[name, values.map(String).join(", ")]] : [];
    }),
  );
}

function metaLeadRow(payload: unknown): CrmImportLeadRow {
  const record = payload as Record<string, unknown>;
  const fields = fieldDataMap(record.field_data);
  const first = fields.first_name ?? "";
  const last = fields.last_name ?? "";
  const fullName = fields.full_name ?? [first, last].filter(Boolean).join(" ");
  return {
    externalId: String(record.id ?? "") || null,
    name: fullName || fields.company_name || "Meta lead",
    leadType: fields.company_name ? "company" : "person",
    source: "Meta Lead Ads",
    email: fields.email ?? null,
    phone: fields.phone_number ?? fields.phone ?? null,
    companyName: fields.company_name ?? null,
    notes: fields.job_title ? `Job title: ${fields.job_title}` : null,
    extraFields: sanitizeCrmExtraFields({
      formFields: sanitizeCrmExtraFields(fields, [
        "first_name",
        "last_name",
        "full_name",
        "email",
        "phone_number",
        "phone",
        "company_name",
        "job_title",
      ]),
      providerMetadata: sanitizeCrmExtraFields(record, ["id", "field_data"]),
    }),
    raw: redactImportPayload(record),
  };
}

function googleLeadRow(payload: Record<string, unknown>): CrmImportLeadRow {
  const columns = Array.isArray(payload.user_column_data) ? payload.user_column_data : [];
  const values = Object.fromEntries(
    columns.flatMap((column) => {
      if (!column || typeof column !== "object") return [];
      const item = column as Record<string, unknown>;
      const key = String(item.column_id ?? item.column_name ?? "").toLowerCase();
      const value = String(item.string_value ?? item.column_value ?? "");
      return key ? [[key, value]] : [];
    }),
  );
  const first = values.first_name ?? "";
  const last = values.last_name ?? "";
  return {
    externalId: String(payload.lead_id ?? payload.google_key ?? "") || null,
    name:
      values.full_name ||
      [first, last].filter(Boolean).join(" ") ||
      values.company_name ||
      "Google Ads lead",
    leadType: values.company_name ? "company" : "person",
    source: "Google Ads",
    email: values.email ?? null,
    phone: values.phone_number ?? values.phone ?? null,
    companyName: values.company_name ?? null,
    extraFields: sanitizeCrmExtraFields({
      formFields: sanitizeCrmExtraFields(values, [
        "first_name",
        "last_name",
        "full_name",
        "email",
        "phone_number",
        "phone",
        "company_name",
      ]),
      providerMetadata: sanitizeCrmExtraFields(payload, [
        "lead_id",
        "google_key",
        "user_column_data",
      ]),
    }),
    raw: redactImportPayload(payload),
  };
}

async function recordWebhookDelivery(
  connection: ConnectionSecretRow,
  eventId: string,
  payload: unknown,
): Promise<boolean> {
  const database = getDatabaseClient();
  const rows = await database<{ id: string }[]>`
    insert into public.crm_webhook_deliveries (
      organization_id, connection_id, provider_event_id, payload_hash
    ) values (
      ${connection.organization_id}::uuid,
      ${connection.id}::uuid,
      ${eventId},
      ${stablePayloadHash(payload)}
    )
    on conflict (connection_id, provider_event_id) do nothing
    returning id
  `;
  return Boolean(rows[0]);
}

async function finishWebhookDelivery(
  connectionId: string,
  eventId: string,
  status: "processed" | "failed" | "duplicate",
  error?: string,
) {
  const database = getDatabaseClient();
  await database`
    update public.crm_webhook_deliveries
    set status = ${status}, processed_at = now(), error_message = ${error?.slice(0, 500) ?? null}
    where connection_id = ${connectionId}::uuid and provider_event_id = ${eventId}
  `;
}

export async function verifyMetaWebhook(
  connectionId: string,
  mode: string | null,
  token: string | null,
  challenge: string | null,
): Promise<string | null> {
  const connection = await readConnection(connectionId);
  if (connection.provider !== "meta_lead_ads" || connection.status !== "active") return null;
  const credentials = connection.encrypted_credentials
    ? decryptSecretObject(connection.encrypted_credentials)
    : {};
  if (
    mode === "subscribe" &&
    token &&
    challenge &&
    secureEquals(token, credentials.verifyToken ?? "")
  ) {
    return challenge;
  }
  return null;
}

export async function processCrmWebhook(
  connectionId: string,
  rawBody: string,
  headers: Headers,
): Promise<CrmImportOutcome[]> {
  const connection = await readConnection(connectionId);
  if (connection.status !== "active") throw new Error("CRM connection is not active.");
  if (rawBody.length > 512 * 1024) throw new Error("Webhook payload exceeded 512 KB.");
  const decoded: unknown = JSON.parse(rawBody);
  const outcomes: CrmImportOutcome[] = [];

  if (connection.provider === "google_ads") {
    const payload = crmGoogleAdsWebhookPayloadSchema.parse(decoded);
    const defaults = await defaultStageAndOwner(connection);
    const suppliedKey = String(payload.google_key ?? payload.webhook_key ?? "");
    if (
      !connection.webhook_key_hash ||
      !secureEquals(sha256(suppliedKey), connection.webhook_key_hash)
    ) {
      throw new Error("Google Ads webhook key did not match.");
    }
    const eventId = String(payload.lead_id ?? stablePayloadHash(payload));
    if (!(await recordWebhookDelivery(connection, eventId, payload))) return outcomes;
    try {
      outcomes.push(
        await importLeadRows(
          connectionActor(connection),
          {
            sourceType: "google_ads",
            sourceName: connection.name,
            connectionId: connection.id,
            stageId: defaults.stageId,
            ownerMembershipId: defaults.ownerMembershipId,
            duplicatePolicy: "merge",
          },
          [googleLeadRow(payload)],
        ),
      );
      await finishWebhookDelivery(connection.id, eventId, "processed");
    } catch (error) {
      await finishWebhookDelivery(
        connection.id,
        eventId,
        "failed",
        error instanceof Error ? error.message : "Import failed.",
      );
      throw error;
    }
    return outcomes;
  }

  if (connection.provider === "meta_lead_ads") {
    const body = crmMetaLeadAdsWebhookPayloadSchema.parse(decoded);
    const defaults = await defaultStageAndOwner(connection);
    const credentials = connection.encrypted_credentials
      ? decryptSecretObject(connection.encrypted_credentials)
      : {};
    const signature = headers.get("x-hub-signature-256") ?? "";
    const expected = `sha256=${createHmac("sha256", credentials.appSecret ?? "")
      .update(rawBody)
      .digest("hex")}`;
    if (!signature || !secureEquals(signature, expected))
      throw new Error("Meta webhook signature did not match.");
    for (const entry of body.entry) {
      for (const change of entry.changes ?? []) {
        const leadId = String(change.value?.leadgen_id ?? "");
        if (!leadId) continue;
        if (!(await recordWebhookDelivery(connection, leadId, change.value ?? {}))) continue;
        try {
          const version = String(connection.configuration.apiVersion ?? "v23.0").replace(
            /[^v0-9.]/gi,
            "",
          );
          const url = new URL(
            `https://graph.facebook.com/${version}/${encodeURIComponent(leadId)}`,
          );
          url.searchParams.set("fields", "id,created_time,field_data,form_id,ad_id");
          url.searchParams.set("access_token", credentials.accessToken ?? "");
          const leadPayload = await fetchJson(url, {});
          outcomes.push(
            await importLeadRows(
              connectionActor(connection),
              {
                sourceType: "meta_lead_ads",
                sourceName: connection.name,
                connectionId: connection.id,
                stageId: defaults.stageId,
                ownerMembershipId: defaults.ownerMembershipId,
                duplicatePolicy: "merge",
              },
              [metaLeadRow(leadPayload)],
            ),
          );
          await finishWebhookDelivery(connection.id, leadId, "processed");
        } catch (error) {
          await finishWebhookDelivery(
            connection.id,
            leadId,
            "failed",
            error instanceof Error ? error.message : "Import failed.",
          );
          throw error;
        }
      }
    }
    return outcomes;
  }

  throw new Error("This provider does not accept webhook delivery.");
}
