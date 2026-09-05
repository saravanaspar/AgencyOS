import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";

import { sendEmailWithResend } from "@/integrations/email/resend";
import { getDatabaseClient } from "@/integrations/postgres/database";
import { toJsonValue } from "@/lib/server/json-value";
import { getApplicationEnv } from "@/lib/validation/env";
import {
  activeReportDeliveryDestination,
  resolveSafeExternalReportUrl,
} from "@/modules/reports/server/delivery-destinations";
import { notificationRetryDelaySeconds } from "@/modules/notifications/notification-delivery";
import { getNotificationDeliveryConfiguration } from "@/modules/notifications/server/delivery-config";
import { enqueueNotification } from "@/modules/notifications/server/notifications";
import { getEffectivePermissionGrants } from "@/modules/permissions/server/effective-permissions";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";
import { reportsPermissionKeys } from "@/modules/reports/reports";
import {
  downloadReportSnapshotBytes,
  generateReportSnapshot,
  type StoredReportSnapshot,
} from "@/modules/reports/server/report-snapshots";

const MAX_SCHEDULES_PER_RUN = 12;
const MAX_BATCHES_PER_RUN = 8;
const MAX_RECIPIENTS_PER_BATCH = 200;
const MAX_DELIVERY_ATTEMPTS = 6;

interface ClaimedSchedule {
  id: string;
  lock_token: string;
  organization_id: string;
  saved_view_id: string;
  owner_membership_id: string;
  format: "csv" | "pdf";
  cadence: "daily" | "weekly" | "monthly";
  local_time: string;
  timezone: string;
  weekday: number | null;
  month_day: number | null;
  next_run_at: Date;
  consecutive_failure_count: number;
  audience: "owner" | "named" | "view_access" | "section_access";
  delivery_channels: Array<"in_app" | "email" | "slack" | "telegram" | "webhook">;
  grace_seconds: number;
}

interface ClaimedBatch {
  id: string;
  lock_token: string;
  organization_id: string;
  schedule_id: string;
  saved_view_id: string;
  owner_membership_id: string;
  scheduled_for: Date;
  recipient_count: number;
  format: "csv" | "pdf";
  consecutive_failure_count: number;
}

interface DeliveryRow {
  id: string;
  recipient_membership_id: string;
  channel: "in_app" | "email" | "slack" | "telegram" | "webhook";
  status: "queued" | "failed";
  attempt_count: number;
}

interface RecipientRow {
  membership_id: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}

async function claimSchedules(limit: number): Promise<ClaimedSchedule[]> {
  const token = randomUUID();
  return getDatabaseClient()<ClaimedSchedule[]>`
    with due as (
      select schedule.id
      from public.report_schedules schedule
      join public.report_saved_views saved_view on saved_view.id = schedule.saved_view_id
      join public.memberships owner on owner.id = schedule.owner_membership_id
      where schedule.status = 'active'
        and schedule.next_run_at <= now()
        and (schedule.locked_at is null or schedule.locked_at < now() - interval '10 minutes')
        and saved_view.status = 'active'
        and owner.status = 'active'
      order by schedule.next_run_at, schedule.created_at
      for update of schedule skip locked
      limit ${Math.min(MAX_SCHEDULES_PER_RUN, Math.max(1, limit))}
    ), claimed as (
      update public.report_schedules schedule
      set locked_at = now(), lock_token = ${token}::uuid
      from due
      where schedule.id = due.id
      returning schedule.*
    )
    select id, lock_token, organization_id, saved_view_id, owner_membership_id, format,
      cadence, local_time::text, timezone, weekday, month_day, next_run_at,
      consecutive_failure_count, audience, delivery_channels, grace_seconds
    from claimed
  `;
}

async function loadMembershipContext(
  organizationId: string,
  membershipId: string,
): Promise<CurrentPermissionContext> {
  const database = getDatabaseClient();
  const members = await database<Array<{ user_id: string; email: string }>>`
    select membership.user_id, coalesce(auth_user.email, '') as email
    from public.memberships membership
    left join public.identity_accounts auth_user on auth_user.id = membership.user_id
    where membership.id = ${membershipId}::uuid
      and membership.organization_id = ${organizationId}::uuid
      and membership.status = 'active'
    limit 1
  `;
  const member = members[0];
  if (!member) throw new Error("report-recipient-inactive");
  const grants = await getEffectivePermissionGrants(database, membershipId, organizationId);
  return {
    user: { id: member.user_id, email: member.email, metadata: {} },
    membership: { id: membershipId, organizationId },
    unreadNotificationCount: 0,
    pendingApprovalCount: 0,
    permissionRows: [],
    permissions: new Set(grants.keys()),
    permissionScopes: grants,
    security: {
      sessionId: null,
      assuranceLevel: "aal2",
      privileged: true,
      recentReauthentication: false,
    },
  };
}

async function validateScheduleOwner(schedule: ClaimedSchedule): Promise<CurrentPermissionContext> {
  const context = await loadMembershipContext(
    schedule.organization_id,
    schedule.owner_membership_id,
  );
  for (const permission of [
    reportsPermissionKeys.workspace,
    reportsPermissionKeys.scheduleManage,
    reportsPermissionKeys.snapshotCreate,
  ]) {
    if (!context.permissions.has(permission)) throw new Error("report-schedule-permission-revoked");
  }
  return context;
}

async function resolveAudience(schedule: ClaimedSchedule): Promise<string[]> {
  const database = getDatabaseClient();
  if (schedule.audience === "owner") return [schedule.owner_membership_id];

  const rows = await database<RecipientRow[]>`
    select membership.id as membership_id
    from public.memberships membership
    join public.report_saved_views view on view.id = ${schedule.saved_view_id}::uuid
    where membership.organization_id = ${schedule.organization_id}::uuid
      and membership.status = 'active'
      and private.membership_has_permission(membership.id, 'reports.workspace.view')
      and private.membership_has_permission(
        membership.id, private.report_section_permission(view.section)
      )
      and (
        (${schedule.audience} = 'named' and exists (
          select 1 from public.report_schedule_recipients recipient
          where recipient.schedule_id = ${schedule.id}::uuid
            and recipient.membership_id = membership.id
        ))
        or (${schedule.audience} = 'view_access' and private.report_saved_view_access_allowed(
          ${schedule.saved_view_id}::uuid, membership.id
        ))
        or ${schedule.audience} = 'section_access'
      )
    order by membership.created_at, membership.id
    limit ${MAX_RECIPIENTS_PER_BATCH + 1}
  `;
  if (rows.length > MAX_RECIPIENTS_PER_BATCH) throw new Error("report-delivery-audience-too-large");
  return rows.map((row) => row.membership_id);
}

async function failScheduleClaim(
  schedule: ClaimedSchedule,
  errorCode: string,
): Promise<"failed" | "paused"> {
  const database = getDatabaseClient();
  const failures = Math.min(20, schedule.consecutive_failure_count + 1);
  const paused =
    failures >= 5 || /permission-revoked|owner-inactive|view-not-found/.test(errorCode);
  await database.begin(async (sql) => {
    await sql`
      update public.report_schedules
      set status = ${paused ? "paused" : "active"},
          consecutive_failure_count = ${failures},
          next_run_at = case
            when ${paused} then next_run_at
            else now() + make_interval(mins => least(360, 15 * (2 ^ least(${failures}, 4))::integer))
          end,
          locked_at = null,
          lock_token = null
      where id = ${schedule.id}::uuid and lock_token = ${schedule.lock_token}::uuid
    `;
    await sql`
      insert into public.report_schedule_runs (
        organization_id, schedule_id, saved_view_id, owner_membership_id,
        scheduled_for, completed_at, outcome, error_code, evidence
      ) values (
        ${schedule.organization_id}::uuid, ${schedule.id}::uuid,
        ${schedule.saved_view_id}::uuid, ${schedule.owner_membership_id}::uuid,
        ${schedule.next_run_at}::timestamptz, now(), ${paused ? "paused" : "failed"},
        ${errorCode.slice(0, 100)},
        ${sql.json(toJsonValue({ failureCount: failures, retryable: !paused, phase: "queue" }))}
      )
      on conflict (schedule_id, scheduled_for) do nothing
    `;
  });
  if (paused) {
    await enqueueNotification({
      organizationId: schedule.organization_id,
      recipientMembershipId: schedule.owner_membership_id,
      category: "integration_failure",
      severity: "warning",
      title: "Scheduled report paused",
      message: "Report delivery could not be queued and needs attention.",
      deepLink: `/reports?view=${schedule.saved_view_id}`,
      sourceModule: "reports",
      sourceEntityType: "report_schedule",
      sourceEntityId: schedule.id,
      dedupeKey: `report-schedule-paused:${schedule.id}`,
      externalDelivery: false,
    }).catch(() => undefined);
  }
  return paused ? "paused" : "failed";
}

async function queueSchedule(schedule: ClaimedSchedule): Promise<"queued" | "failed" | "paused"> {
  try {
    await validateScheduleOwner(schedule);
    const recipients = await resolveAudience(schedule);
    if (recipients.length === 0) throw new Error("report-delivery-audience-empty");
    const database = getDatabaseClient();
    const requestedBatchId = randomUUID();
    const graceSeconds = Math.max(0, Math.min(30, schedule.grace_seconds));
    let batchId: string = requestedBatchId;
    await database.begin(async (sql) => {
      const batches = await sql<Array<{ id: string }>>`
        insert into public.report_delivery_batches (
          id, organization_id, schedule_id, saved_view_id, owner_membership_id,
          scheduled_for, status, send_after, undo_until, recipient_count
        ) values (
          ${requestedBatchId}::uuid, ${schedule.organization_id}::uuid, ${schedule.id}::uuid,
          ${schedule.saved_view_id}::uuid, ${schedule.owner_membership_id}::uuid,
          ${schedule.next_run_at}::timestamptz, 'queued',
          now() + make_interval(secs => ${graceSeconds}),
          now() + make_interval(secs => ${graceSeconds}), ${recipients.length}
        )
        on conflict (schedule_id, scheduled_for) do update
          set recipient_count = excluded.recipient_count
        returning id
      `;
      batchId = batches[0]?.id ?? requestedBatchId;
      for (const channel of schedule.delivery_channels) {
        await sql`
          insert into public.report_delivery_recipients (
            batch_id, organization_id, recipient_membership_id, channel, status, next_attempt_at
          )
          select ${batchId}::uuid, ${schedule.organization_id}::uuid,
            recipient_id::uuid, ${channel}, 'queued', now() + make_interval(secs => ${graceSeconds})
          from unnest(${recipients}::text[]) recipient_id
          on conflict (batch_id, recipient_membership_id, channel) do nothing
        `;
      }
      await sql`
        update public.report_schedules
        set last_run_at = now(),
            next_run_at = private.report_schedule_next_run(
              cadence, local_time, timezone, weekday, month_day, now()
            ),
            locked_at = null,
            lock_token = null
        where id = ${schedule.id}::uuid and lock_token = ${schedule.lock_token}::uuid
      `;
    });
    await enqueueNotification({
      organizationId: schedule.organization_id,
      recipientMembershipId: schedule.owner_membership_id,
      category: "assignment",
      title: "Scheduled report queued",
      message: `Delivery to ${recipients.length} recipient${recipients.length === 1 ? "" : "s"} is queued${graceSeconds ? ` with a ${graceSeconds}-second undo window` : ""}.`,
      deepLink: `/reports?view=${schedule.saved_view_id}&delivery=${batchId}`,
      sourceModule: "reports",
      sourceEntityType: "report_delivery_batch",
      sourceEntityId: batchId,
      dedupeKey: `report-delivery-queued:${batchId}`,
      externalDelivery: false,
    }).catch(() => undefined);
    return "queued";
  } catch (error) {
    const code = error instanceof Error ? error.message : "report-delivery-queue-failed";
    return failScheduleClaim(schedule, code);
  }
}

async function claimDeliveryBatches(limit: number): Promise<ClaimedBatch[]> {
  const database = getDatabaseClient();
  const token = randomUUID();
  return database<ClaimedBatch[]>`
    with due as (
      select batch.id
      from public.report_delivery_batches batch
      where batch.cancelled_at is null
        and batch.send_after <= now()
        and (
          batch.status = 'queued'
          or (batch.status = 'delivering' and (batch.locked_at is null or batch.locked_at < now() - interval '10 minutes'))
        )
      order by batch.send_after, batch.created_at
      for update skip locked
      limit ${Math.min(MAX_BATCHES_PER_RUN, Math.max(1, limit))}
    ), claimed as (
      update public.report_delivery_batches batch
      set status = 'delivering', started_at = coalesce(started_at, now()),
          locked_at = now(), lock_token = ${token}::uuid
      from due where batch.id = due.id
      returning batch.*
    )
    select claimed.id, claimed.lock_token, claimed.organization_id,
      claimed.schedule_id, claimed.saved_view_id, claimed.owner_membership_id,
      claimed.scheduled_for, claimed.recipient_count, schedule.format,
      schedule.consecutive_failure_count
    from claimed
    join public.report_schedules schedule on schedule.id = claimed.schedule_id
  `;
}

async function dueDeliveryRows(batchId: string): Promise<DeliveryRow[]> {
  return getDatabaseClient()<DeliveryRow[]>`
    select id, recipient_membership_id, channel, status, attempt_count
    from public.report_delivery_recipients
    where batch_id = ${batchId}::uuid
      and status in ('queued', 'failed')
      and coalesce(next_attempt_at, created_at) <= now()
      and attempt_count < ${MAX_DELIVERY_ATTEMPTS}
    order by created_at, recipient_membership_id, channel
  `;
}

async function markDelivery(
  id: string,
  input: {
    outcome: "delivered" | "failed" | "suppressed";
    attemptCount: number;
    providerReference?: string | null;
    snapshotId?: string | null;
    errorCode?: string | null;
    retryAfterSeconds?: number | null;
  },
): Promise<void> {
  const nextAttempt =
    input.outcome === "failed" && input.retryAfterSeconds
      ? new Date(Date.now() + input.retryAfterSeconds * 1_000)
      : null;
  await getDatabaseClient()`
    update public.report_delivery_recipients
    set status = ${input.outcome},
      attempt_count = ${input.attemptCount},
      snapshot_id = coalesce(${input.snapshotId ?? null}::uuid, snapshot_id),
      provider_reference = ${input.providerReference ?? null},
      error_code = ${input.errorCode ?? null},
      next_attempt_at = ${nextAttempt},
      delivered_at = case when ${input.outcome} = 'delivered' then now() else delivered_at end
    where id = ${id}::uuid
  `;
}

async function deliverInApp(
  batch: ClaimedBatch,
  row: DeliveryRow,
  context: CurrentPermissionContext,
  snapshot: StoredReportSnapshot,
): Promise<void> {
  const deepLink = context.permissions.has(reportsPermissionKeys.snapshotDownload)
    ? `/api/reports/snapshots/${snapshot.id}`
    : `/reports?view=${batch.saved_view_id}`;
  const notificationId = await enqueueNotification({
    organizationId: batch.organization_id,
    recipientMembershipId: row.recipient_membership_id,
    category: "assignment",
    title: "Scheduled report is ready",
    message: `${snapshot.format.toUpperCase()} report generated from data you are permitted to view.`,
    deepLink,
    sourceModule: "reports",
    sourceEntityType: "report_snapshot",
    sourceEntityId: snapshot.id,
    dedupeKey: `report-delivery:${batch.id}:${row.recipient_membership_id}`,
    externalDelivery: false,
  });
  if (!notificationId) throw new Error("report-notification-create-failed");
  await markDelivery(row.id, {
    outcome: "delivered",
    attemptCount: row.attempt_count + 1,
    snapshotId: snapshot.id,
    providerReference: notificationId,
  });
}

async function deliverEmail(
  batch: ClaimedBatch,
  row: DeliveryRow,
  context: CurrentPermissionContext,
  snapshot: StoredReportSnapshot,
): Promise<void> {
  const config = (await getNotificationDeliveryConfiguration(batch.organization_id)).email;
  if (!context.user.email) {
    await markDelivery(row.id, {
      outcome: "suppressed",
      attemptCount: row.attempt_count + 1,
      snapshotId: snapshot.id,
      errorCode: "recipient_email_missing",
    });
    return;
  }
  if (!config.configured || !config.resendApiKey || !config.from) {
    await markDelivery(row.id, {
      outcome: "failed",
      attemptCount: row.attempt_count + 1,
      snapshotId: snapshot.id,
      errorCode: "report_email_not_configured",
      retryAfterSeconds: 3_600,
    });
    return;
  }
  const bytes = await downloadReportSnapshotBytes(snapshot);
  const subject = `AgencyOS scheduled report: ${snapshot.fileName.replace(/\.(pdf|csv)$/i, "")}`;
  const result = await sendEmailWithResend(
    { apiKey: config.resendApiKey, from: config.from },
    {
      to: context.user.email,
      subject,
      text: "Your scheduled AgencyOS report is attached. It was generated using only the data your account is allowed to view.",
      html: `<p>Your scheduled AgencyOS report is attached.</p><p>It was generated using only the data your account is allowed to view.</p><p><strong>${escapeHtml(snapshot.fileName)}</strong></p>`,
      idempotencyKey: createHash("sha256")
        .update(`report:${batch.id}:${row.recipient_membership_id}:email`)
        .digest("hex"),
      attachments: [{ fileName: snapshot.fileName, content: bytes }],
    },
  );
  if (result.delivered) {
    await markDelivery(row.id, {
      outcome: "delivered",
      attemptCount: row.attempt_count + 1,
      snapshotId: snapshot.id,
      providerReference: result.providerReference,
    });
    return;
  }
  const nextAttempt = row.attempt_count + 1;
  await markDelivery(row.id, {
    outcome: result.retryable && nextAttempt < MAX_DELIVERY_ATTEMPTS ? "failed" : "suppressed",
    attemptCount: nextAttempt,
    snapshotId: snapshot.id,
    errorCode: result.errorCode,
    retryAfterSeconds:
      result.retryable && nextAttempt < MAX_DELIVERY_ATTEMPTS
        ? (result.retryAfterSeconds ?? notificationRetryDelaySeconds(nextAttempt))
        : null,
  });
}

async function externalFetch(url: URL | string, init: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
}

async function pinnedExternalPost(
  destination: Awaited<ReturnType<typeof resolveSafeExternalReportUrl>>,
  headers: HeadersInit,
  body: string | Uint8Array,
): Promise<Response> {
  const lookup: LookupFunction = (_hostname, _options, callback) => {
    callback(null, destination.address, destination.family);
  };
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      destination.url,
      {
        method: "POST",
        headers: Object.fromEntries(new Headers(headers).entries()),
        lookup,
        servername: isIP(destination.hostname) ? undefined : destination.hostname,
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk: Buffer | Uint8Array | string) =>
          chunks.push(Buffer.from(chunk)),
        );
        incoming.on("end", () => {
          const status = incoming.statusCode ?? 500;
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(incoming.headers)) {
            if (Array.isArray(value)) for (const item of value) responseHeaders.append(name, item);
            else if (value !== undefined) responseHeaders.set(name, value);
          }
          resolve(
            new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), {
              status,
              statusText: incoming.statusMessage,
              headers: responseHeaders,
            }),
          );
        });
      },
    );
    request.setTimeout(10_000, () => request.destroy(new Error("report-external-timeout")));
    request.on("error", reject);
    request.end(body);
  });
}

function reportDeepLink(snapshot: StoredReportSnapshot): string {
  const app = new URL(getApplicationEnv().appUrl);
  return new URL(`/api/reports/snapshots/${snapshot.id}`, app).toString();
}

async function deliverExternal(
  batch: ClaimedBatch,
  row: DeliveryRow,
  snapshot: StoredReportSnapshot,
): Promise<void> {
  if (row.channel === "in_app" || row.channel === "email") return;
  const destination = await activeReportDeliveryDestination(
    batch.organization_id,
    row.recipient_membership_id,
    row.channel,
  );
  if (!destination) {
    await markDelivery(row.id, {
      outcome: "suppressed",
      attemptCount: row.attempt_count + 1,
      snapshotId: snapshot.id,
      errorCode: `report_${row.channel}_destination_missing`,
    });
    return;
  }
  const idempotencyKey = createHash("sha256")
    .update(`report:${batch.id}:${row.recipient_membership_id}:${row.channel}`)
    .digest("hex");
  let response: Response;
  if (row.channel === "slack") {
    const resolved = await resolveSafeExternalReportUrl(destination.config.url ?? "", "slack");
    response = await pinnedExternalPost(
      resolved,
      { "content-type": "application/json" },
      JSON.stringify({
        text: `AgencyOS scheduled report: ${snapshot.fileName}\n${reportDeepLink(snapshot)}\nOpen the link while signed in to AgencyOS.`,
      }),
    );
  } else if (row.channel === "telegram") {
    const botToken = destination.config.botToken ?? "";
    const chatId = destination.config.chatId ?? "";
    if (!/^\d{6,12}:[A-Za-z0-9_-]{20,}$/.test(botToken) || !/^-?\d{5,30}$/.test(chatId)) {
      throw new Error("report-telegram-destination-invalid");
    }
    const bytes = await downloadReportSnapshotBytes(snapshot);
    const form = new FormData();
    form.set("chat_id", chatId);
    form.set("caption", `AgencyOS scheduled report · ${snapshot.fileName}`);
    form.set(
      "document",
      new Blob([new Uint8Array(bytes)], {
        type: snapshot.format === "pdf" ? "application/pdf" : "text/csv",
      }),
      snapshot.fileName,
    );
    response = await externalFetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
      method: "POST",
      body: form,
    });
  } else {
    const resolved = await resolveSafeExternalReportUrl(destination.config.url ?? "", "webhook");
    const bytes = await downloadReportSnapshotBytes(snapshot);
    const headers: Record<string, string> = {
      "content-type": snapshot.format === "pdf" ? "application/pdf" : "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${snapshot.fileName.replace(/[\r\n"]+/g, "_")}"`,
      "x-agencyos-report-snapshot": snapshot.id,
      "x-agencyos-report-file": snapshot.fileName,
      "idempotency-key": idempotencyKey,
    };
    if (destination.config.bearerToken)
      headers.authorization = `Bearer ${destination.config.bearerToken}`;
    response = await pinnedExternalPost(resolved, headers, new Uint8Array(bytes));
  }
  if (!response.ok) throw new Error(`report-${row.channel}-http-${response.status}`);
  await markDelivery(row.id, {
    outcome: "delivered",
    attemptCount: row.attempt_count + 1,
    snapshotId: snapshot.id,
    providerReference: `${destination.id}:${response.status}:${idempotencyKey.slice(0, 12)}`,
  });
}

async function processDeliveryRow(
  batch: ClaimedBatch,
  row: DeliveryRow,
  snapshots: Map<string, StoredReportSnapshot>,
  contexts: Map<string, CurrentPermissionContext>,
): Promise<void> {
  try {
    let context = contexts.get(row.recipient_membership_id);
    if (!context) {
      context = await loadMembershipContext(batch.organization_id, row.recipient_membership_id);
      contexts.set(row.recipient_membership_id, context);
    }
    if (!context.permissions.has(reportsPermissionKeys.workspace)) {
      await markDelivery(row.id, {
        outcome: "suppressed",
        attemptCount: row.attempt_count + 1,
        errorCode: "report-recipient-permission-revoked",
      });
      return;
    }
    let snapshot = snapshots.get(row.recipient_membership_id);
    if (!snapshot) {
      snapshot = await generateReportSnapshot(context, {
        savedViewId: batch.saved_view_id,
        format: batch.format,
        scheduleId: batch.schedule_id,
        scheduledFor: batch.scheduled_for,
        systemDelivery: true,
      });
      snapshots.set(row.recipient_membership_id, snapshot);
    }
    if (row.channel === "in_app") await deliverInApp(batch, row, context, snapshot);
    else if (row.channel === "email") await deliverEmail(batch, row, context, snapshot);
    else await deliverExternal(batch, row, snapshot);
  } catch (error) {
    const attemptCount = row.attempt_count + 1;
    const errorCode =
      error instanceof Error ? error.message.slice(0, 100) : "report-delivery-error";
    const terminal =
      attemptCount >= MAX_DELIVERY_ATTEMPTS ||
      /permission|inactive|view-not-found|source-permission/.test(errorCode);
    await markDelivery(row.id, {
      outcome: terminal ? "suppressed" : "failed",
      attemptCount,
      errorCode,
      retryAfterSeconds: terminal ? null : notificationRetryDelaySeconds(attemptCount),
    });
  }
}

async function finalizeBatch(
  batch: ClaimedBatch,
): Promise<"queued" | "delivered" | "partially_failed" | "failed"> {
  const database = getDatabaseClient();
  const rows = await database<
    Array<{
      total: number;
      delivered: number;
      failed: number;
      suppressed: number;
      pending_retry: number;
      next_attempt_at: Date | null;
      owner_snapshot_id: string | null;
    }>
  >`
    select count(*)::int as total,
      count(*) filter (where status = 'delivered')::int as delivered,
      count(*) filter (where status = 'failed')::int as failed,
      count(*) filter (where status = 'suppressed')::int as suppressed,
      count(*) filter (
        where status = 'failed' and attempt_count < ${MAX_DELIVERY_ATTEMPTS} and next_attempt_at is not null
      )::int as pending_retry,
      min(next_attempt_at) filter (
        where status = 'failed' and attempt_count < ${MAX_DELIVERY_ATTEMPTS} and next_attempt_at is not null
      ) as next_attempt_at,
      min(snapshot_id::text) filter (
        where recipient_membership_id = ${batch.owner_membership_id}::uuid and snapshot_id is not null
      ) as owner_snapshot_id
    from public.report_delivery_recipients
    where batch_id = ${batch.id}::uuid
  `;
  const summary = rows[0] ?? {
    total: 0,
    delivered: 0,
    failed: 0,
    suppressed: 0,
    pending_retry: 0,
    next_attempt_at: null,
    owner_snapshot_id: null,
  };

  if (summary.pending_retry > 0) {
    await database`
      update public.report_delivery_batches
      set status = 'queued', send_after = coalesce(${summary.next_attempt_at}, now() + interval '1 minute'),
        delivered_count = ${summary.delivered}, failed_count = ${summary.failed},
        suppressed_count = ${summary.suppressed}, locked_at = null, lock_token = null
      where id = ${batch.id}::uuid and status = 'delivering'
        and lock_token = ${batch.lock_token}::uuid
    `;
    return "queued";
  }

  const outcome =
    summary.delivered === summary.total && summary.total > 0
      ? "delivered"
      : summary.delivered > 0
        ? "partially_failed"
        : "failed";
  const failures = outcome === "failed" ? Math.min(20, batch.consecutive_failure_count + 1) : 0;
  const pause = outcome === "failed" && failures >= 5;
  await database.begin(async (sql) => {
    await sql`
      update public.report_delivery_batches
      set status = ${outcome}, completed_at = now(),
        delivered_count = ${summary.delivered}, failed_count = ${summary.failed},
        suppressed_count = ${summary.suppressed},
        error_code = ${outcome === "delivered" ? null : "report_delivery_incomplete"},
        locked_at = null, lock_token = null
      where id = ${batch.id}::uuid and status = 'delivering'
        and lock_token = ${batch.lock_token}::uuid
    `;
    await sql`
      update public.report_schedules
      set status = ${pause ? "paused" : "active"},
        consecutive_failure_count = ${failures}
      where id = ${batch.schedule_id}::uuid
    `;
    await sql`
      insert into public.report_schedule_runs (
        organization_id, schedule_id, saved_view_id, owner_membership_id,
        scheduled_for, completed_at, outcome, snapshot_id, error_code, evidence
      ) values (
        ${batch.organization_id}::uuid, ${batch.schedule_id}::uuid,
        ${batch.saved_view_id}::uuid, ${batch.owner_membership_id}::uuid,
        ${batch.scheduled_for}::timestamptz, now(), ${pause ? "paused" : outcome},
        ${summary.owner_snapshot_id}::uuid,
        ${outcome === "delivered" ? null : "report_delivery_incomplete"},
        ${sql.json(
          toJsonValue({
            batchId: batch.id,
            channels: summary.total,
            delivered: summary.delivered,
            failed: summary.failed,
            suppressed: summary.suppressed,
          }),
        )}
      ) on conflict (schedule_id, scheduled_for) do nothing
    `;
  });

  const title =
    outcome === "delivered"
      ? "Scheduled report delivered"
      : outcome === "partially_failed"
        ? "Scheduled report partially delivered"
        : pause
          ? "Scheduled report paused after failures"
          : "Scheduled report delivery failed";
  await enqueueNotification({
    organizationId: batch.organization_id,
    recipientMembershipId: batch.owner_membership_id,
    category: outcome === "delivered" ? "assignment" : "integration_failure",
    severity: outcome === "delivered" ? "info" : "warning",
    title,
    message: `${summary.delivered} delivery channel(s) succeeded; ${summary.failed + summary.suppressed} did not.`,
    deepLink: `/reports?view=${batch.saved_view_id}&delivery=${batch.id}`,
    sourceModule: "reports",
    sourceEntityType: "report_delivery_batch",
    sourceEntityId: batch.id,
    dedupeKey: `report-delivery-final:${batch.id}`,
    externalDelivery: false,
  }).catch(() => undefined);

  return outcome;
}

async function processBatch(
  batch: ClaimedBatch,
): Promise<"queued" | "delivered" | "partially_failed" | "failed"> {
  const rows = await dueDeliveryRows(batch.id);
  const snapshots = new Map<string, StoredReportSnapshot>();
  const contexts = new Map<string, CurrentPermissionContext>();
  for (let index = 0; index < rows.length; index += 4) {
    await Promise.all(
      rows
        .slice(index, index + 4)
        .map((row) => processDeliveryRow(batch, row, snapshots, contexts)),
    );
  }
  return finalizeBatch(batch);
}

export async function runReportDeliveryWorker(limit = MAX_SCHEDULES_PER_RUN): Promise<{
  claimed: number;
  queued: number;
  delivered: number;
  partiallyFailed: number;
  failed: number;
  paused: number;
}> {
  const schedules = await claimSchedules(limit);
  const queueOutcomes = await Promise.all(schedules.map(queueSchedule));
  const batches = await claimDeliveryBatches(MAX_BATCHES_PER_RUN);
  const batchOutcomes = await Promise.all(batches.map(processBatch));
  return {
    claimed: schedules.length + batches.length,
    queued:
      queueOutcomes.filter((outcome) => outcome === "queued").length +
      batchOutcomes.filter((outcome) => outcome === "queued").length,
    delivered: batchOutcomes.filter((outcome) => outcome === "delivered").length,
    partiallyFailed: batchOutcomes.filter((outcome) => outcome === "partially_failed").length,
    failed:
      queueOutcomes.filter((outcome) => outcome === "failed").length +
      batchOutcomes.filter((outcome) => outcome === "failed").length,
    paused: queueOutcomes.filter((outcome) => outcome === "paused").length,
  };
}
