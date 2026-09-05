import "server-only";

import { createHash } from "node:crypto";

import { sendEmailWithResend } from "@/integrations/email/resend";
import { getDatabaseClient } from "@/integrations/postgres/database";
import type { CollectionStage } from "@/modules/finance/collections";
import { notificationRetryDelaySeconds } from "@/modules/notifications/notification-delivery";
import { getNotificationDeliveryConfiguration } from "@/modules/notifications/server/delivery-config";
import { enqueueNotification } from "@/modules/notifications/server/notifications";

const MAX_INVOICES_PER_RUN = 100;

interface DueInvoiceRow {
  organization_id: string;
  invoice_id: string;
  invoice_number: string | null;
  due_date: string;
  balance_minor: string | number;
  currency: string;
  invoice_status: string;
  is_disputed: boolean;
  company_id: string;
  company_name: string;
  company_email: string | null;
  billing_email: string | null;
  owner_membership_id: string | null;
  fallback_owner_membership_id: string;
  pre_due_days: number;
  overdue_stage_days: number[];
  founder_escalation_days: number;
  reminder_channels: Array<"email" | "in_app">;
  reminder_subject_template: string;
  reminder_body_template: string;
}

interface ReminderDelivery {
  attempted: boolean;
  delivered: boolean;
  errorCode?: string;
  providerReference?: string;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ??
      character,
  );
}

function stageLabel(stage: CollectionStage): string {
  if (stage === "pre_due") return "upcoming";
  if (stage === "due_today") return "due today";
  if (stage === "open") return "overdue";
  return `${stage.replace("overdue_", "overdue ").replaceAll("_", " ")} days`;
}

function renderReminderTemplate(
  template: string,
  row: DueInvoiceRow,
  stage: CollectionStage,
): string {
  const values: Record<string, string> = {
    invoice: row.invoice_number ?? row.invoice_id.slice(0, 8),
    company: row.company_name,
    stage: stageLabel(stage),
    due_date: row.due_date,
  };
  return template.replace(
    /\{\{(invoice|company|stage|due_date)\}\}/g,
    (_match, key: string) => values[key] ?? "",
  );
}

function stageFor(
  dueDate: string,
  policy: Pick<DueInvoiceRow, "pre_due_days" | "overdue_stage_days">,
): { stage: CollectionStage | null; daysOverdue: number } {
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const dueUtc = new Date(`${dueDate}T00:00:00Z`).getTime();
  const daysOverdue = Math.floor((todayUtc - dueUtc) / 86_400_000);
  if (daysOverdue < 0)
    return Math.abs(daysOverdue) <= policy.pre_due_days
      ? { stage: "pre_due", daysOverdue }
      : { stage: null, daysOverdue };
  if (daysOverdue === 0)
    return policy.overdue_stage_days.includes(0)
      ? { stage: "due_today", daysOverdue }
      : { stage: null, daysOverdue };
  const supported = [...policy.overdue_stage_days]
    .filter((day) => day > 0 && day <= daysOverdue)
    .sort((a, b) => b - a)[0];
  if (supported === undefined) return { stage: null, daysOverdue };
  return { stage: `overdue_${supported}` as CollectionStage, daysOverdue };
}

async function sendClientReminder(
  row: DueInvoiceRow,
  stage: CollectionStage,
): Promise<ReminderDelivery> {
  if (!row.reminder_channels.includes("email")) return { attempted: false, delivered: true };
  const email = row.billing_email ?? row.company_email;
  if (!email) return { attempted: true, delivered: false, errorCode: "client_email_unavailable" };
  const configuration = getNotificationDeliveryConfiguration().email;
  if (!configuration.configured || !configuration.resendApiKey || !configuration.from) {
    return { attempted: true, delivered: false, errorCode: "email_not_configured" };
  }
  const subject = renderReminderTemplate(row.reminder_subject_template, row, stage).slice(0, 200);
  const body = renderReminderTemplate(row.reminder_body_template, row, stage);
  const result = await sendEmailWithResend(
    { apiKey: configuration.resendApiKey, from: configuration.from },
    {
      to: email,
      subject,
      text: body,
      html: `<p>${escapeHtml(body).replaceAll("\n", "<br>")}</p>`,
      idempotencyKey: createHash("sha256")
        .update(`collection:${row.invoice_id}:${stage}`)
        .digest("hex"),
    },
  );
  return result.delivered
    ? { attempted: true, delivered: true, providerReference: result.providerReference }
    : { attempted: true, delivered: false, errorCode: result.errorCode };
}

async function processInvoice(row: DueInvoiceRow): Promise<"processed" | "suppressed" | "skipped"> {
  const calculated = stageFor(row.due_date, row);
  if (!calculated.stage) return "skipped";
  const database = getDatabaseClient();
  const stage = calculated.stage;
  const caseResult = await database.begin(async (sql) => {
    const cases = await sql<
      Array<{
        id: string;
        promise_to_pay_on: string | null;
        dispute_suppressed: boolean;
        last_reminder_stage: string | null;
      }>
    >`
      insert into public.finance_collection_cases (
        organization_id, invoice_id, owner_membership_id, stage, status, next_action_at
      ) values (
        ${row.organization_id}::uuid, ${row.invoice_id}::uuid,
        coalesce(${row.owner_membership_id}::uuid, ${row.fallback_owner_membership_id}::uuid),
        ${stage}, ${row.is_disputed ? "disputed" : "open"}, now()
      ) on conflict (organization_id, invoice_id) do update set
        owner_membership_id = coalesce(finance_collection_cases.owner_membership_id, excluded.owner_membership_id),
        stage = excluded.stage,
        status = case
          when finance_collection_cases.status in ('promise_to_pay','suppressed') then finance_collection_cases.status
          when ${row.is_disputed} then 'disputed'
          else 'open'
        end,
        delivery_attempt_count = case
          when finance_collection_cases.stage is distinct from excluded.stage then 0
          else finance_collection_cases.delivery_attempt_count
        end,
        next_delivery_attempt_at = case
          when finance_collection_cases.stage is distinct from excluded.stage then null
          else finance_collection_cases.next_delivery_attempt_at
        end,
        last_delivery_error = case
          when finance_collection_cases.stage is distinct from excluded.stage then null
          else finance_collection_cases.last_delivery_error
        end,
        updated_at = now()
      returning id, promise_to_pay_on::text, dispute_suppressed, last_reminder_stage
    `;
    const collectionCase = cases[0];
    if (!collectionCase) throw new Error("collection-case-upsert-failed");
    const stageEvents = await sql<Array<{ id: string }>>`
      insert into public.finance_collection_events (
        organization_id, case_id, invoice_id, event_type, stage, evidence
      ) values (
        ${row.organization_id}::uuid, ${collectionCase.id}::uuid, ${row.invoice_id}::uuid,
        'stage_changed', ${stage}, ${sql.json({ daysOverdue: calculated.daysOverdue })}
      )
      on conflict (case_id, stage) where event_type = 'stage_changed' do nothing
      returning id
    `;
    const stageChanged = Boolean(stageEvents[0]);
    if (stageChanged) {
      await sql`
        insert into public.crm_activities (
          organization_id, company_id, activity_type, subject, details, due_at, created_by_membership_id
        ) values (
          ${row.organization_id}::uuid, ${row.company_id}::uuid, 'follow_up',
          ${`Collection follow-up: ${row.invoice_number ?? row.invoice_id.slice(0, 8)}`},
          ${`Collection stage ${stage}; outstanding ${row.currency} ${row.balance_minor}.`},
          now() + interval '3 days', coalesce(${row.owner_membership_id}::uuid, ${row.fallback_owner_membership_id}::uuid)
        )
      `;
    }
    return collectionCase;
  });

  const owner = row.owner_membership_id ?? row.fallback_owner_membership_id;
  if (row.reminder_channels.includes("in_app")) {
    const notification = await enqueueNotification({
      organizationId: row.organization_id,
      recipientMembershipId: owner,
      category: "task_due",
      severity: calculated.daysOverdue >= 30 ? "warning" : "info",
      title: `Collection action: ${row.company_name}`,
      message: `Invoice ${row.invoice_number ?? row.invoice_id.slice(0, 8)} is at ${stage.replaceAll("_", " ")} stage.`,
      deepLink: "/finance?tab=reports",
      sourceModule: "finance",
      sourceEntityType: "finance_collection_case",
      sourceEntityId: caseResult.id,
      dedupeKey: `collection-owner:${row.invoice_id}:${stage}`,
      externalDelivery: false,
    }).catch(() => null);
    if (notification) {
      await database`
        insert into public.finance_collection_events (
          organization_id, case_id, invoice_id, event_type, stage, evidence
        ) values (
          ${row.organization_id}::uuid, ${caseResult.id}::uuid, ${row.invoice_id}::uuid,
          'reminder_sent', ${stage}, ${database.json({ channel: "in_app" })}
        )
        on conflict (case_id, stage, (evidence ->> 'channel'))
          where event_type = 'reminder_sent' do nothing
      `;
    }
  }

  const promiseInFuture =
    caseResult.promise_to_pay_on &&
    caseResult.promise_to_pay_on >= new Date().toISOString().slice(0, 10);
  const suppressed = caseResult.dispute_suppressed || row.is_disputed || Boolean(promiseInFuture);
  if (suppressed) return "suppressed";
  if (caseResult.last_reminder_stage === stage) return "skipped";

  const claims = await database<Array<{ delivery_attempt_count: number }>>`
    update public.finance_collection_cases
    set delivery_attempt_count = least(delivery_attempt_count + 1, 100),
      next_delivery_attempt_at = now() + interval '10 minutes', updated_at = now()
    where id = ${caseResult.id}::uuid and organization_id = ${row.organization_id}::uuid
      and last_reminder_stage is distinct from ${stage}
      and (next_delivery_attempt_at is null or next_delivery_attempt_at <= now())
      and status not in ('resolved','suppressed','promise_to_pay')
    returning delivery_attempt_count
  `;
  const attemptCount = claims[0]?.delivery_attempt_count;
  if (!attemptCount) return "skipped";

  const delivery: ReminderDelivery = await sendClientReminder(row, stage).catch(
    (error: unknown): ReminderDelivery => ({
      attempted: true,
      delivered: false,
      errorCode: error instanceof Error ? error.message.slice(0, 100) : "email_delivery_error",
    }),
  );
  await database.begin(async (sql) => {
    if (delivery.delivered) {
      await sql`
        update public.finance_collection_cases set last_reminder_at=now(), last_reminder_stage=${stage},
          delivery_attempt_count=0, next_delivery_attempt_at=null, last_delivery_error=null,
          next_action_at = case when ${calculated.daysOverdue} >= 0 then now() + interval '3 days' else invoice.due_date::timestamptz end,
          updated_at=now()
        from public.finance_invoices invoice
        where finance_collection_cases.id=${caseResult.id}::uuid
          and finance_collection_cases.organization_id=${row.organization_id}::uuid
          and invoice.id=finance_collection_cases.invoice_id and invoice.organization_id=${row.organization_id}::uuid
      `;
      if (delivery.attempted) {
        await sql`
          insert into public.finance_collection_events (
            organization_id, case_id, invoice_id, event_type, stage, evidence
          ) values (
            ${row.organization_id}::uuid, ${caseResult.id}::uuid, ${row.invoice_id}::uuid,
            'reminder_sent', ${stage}, ${sql.json({ channel: "email", providerReference: delivery.providerReference ?? null })}
          )
          on conflict (case_id, stage, (evidence ->> 'channel'))
            where event_type = 'reminder_sent' do nothing
        `;
      }
    } else if (delivery.attempted) {
      const retryDelaySeconds = notificationRetryDelaySeconds(attemptCount);
      await sql`
        update public.finance_collection_cases
        set next_delivery_attempt_at=now() + make_interval(secs => ${retryDelaySeconds}),
          last_delivery_error=${delivery.errorCode ?? "not_delivered"}, updated_at=now()
        where id=${caseResult.id}::uuid and organization_id=${row.organization_id}::uuid
          and last_reminder_stage is distinct from ${stage}
      `;
      await sql`
        insert into public.finance_collection_events (
          organization_id, case_id, invoice_id, event_type, stage, evidence
        ) values (
          ${row.organization_id}::uuid, ${caseResult.id}::uuid, ${row.invoice_id}::uuid,
          'delivery_failed', ${stage}, ${sql.json({ channel: "email", errorCode: delivery.errorCode ?? "not_delivered" })}
        )
      `;
    }
  });
  if (calculated.daysOverdue >= row.founder_escalation_days) {
    const founders = await database<Array<{ id: string }>>`
      select membership.id from public.memberships membership
      where membership.organization_id=${row.organization_id}::uuid and membership.status='active'
        and private.membership_has_permission(membership.id, 'reports.founder_pack.view')
      order by membership.created_at limit 20
    `;
    await Promise.allSettled(
      founders.map((founder) =>
        enqueueNotification({
          organizationId: row.organization_id,
          recipientMembershipId: founder.id,
          category: "task_due",
          severity: "warning",
          title: `Collection escalation: ${row.company_name}`,
          message: `Invoice ${row.invoice_number ?? row.invoice_id.slice(0, 8)} is ${calculated.daysOverdue} days overdue.`,
          deepLink: "/finance?tab=reports",
          sourceModule: "finance",
          sourceEntityType: "finance_collection_case",
          sourceEntityId: caseResult.id,
          dedupeKey: `collection-founder:${row.invoice_id}:${stage}`,
          externalDelivery: false,
        }),
      ),
    );
  }
  return delivery.delivered ? "processed" : "skipped";
}

export async function runFinanceCollectionsWorker(
  limit = MAX_INVOICES_PER_RUN,
): Promise<{ processed: number; suppressed: number; skipped: number }> {
  const database = getDatabaseClient();
  await database`
    update public.finance_collection_cases collection_case
    set status='resolved', promise_to_pay_on=null, dispute_suppressed=false, next_action_at=null, updated_at=now()
    from public.finance_invoices invoice
    where invoice.id=collection_case.invoice_id and invoice.organization_id=collection_case.organization_id
      and collection_case.status <> 'resolved'
      and (invoice.balance_minor <= 0 or invoice.status in ('paid','void','credited'))
  `;
  const rows = await database<DueInvoiceRow[]>`
    select invoice.organization_id, invoice.id as invoice_id, invoice.invoice_number,
      invoice.due_date::text, invoice.balance_minor, invoice.currency, invoice.status as invoice_status,
      (invoice.status = 'disputed' and invoice.disputed_at is not null and invoice.dispute_resolved_at is null) as is_disputed,
      company.id as company_id, coalesce(company.display_name, company.legal_name) as company_name,
      company.email as company_email,
      (select contact.email from public.crm_contacts contact where contact.company_id=company.id and contact.status='active'
        and contact.email is not null order by contact.is_billing_contact desc, contact.created_at limit 1) as billing_email,
      case when collection_owner.id = company.account_owner_membership_id then collection_owner.id else null end as owner_membership_id,
      collection_owner.id as fallback_owner_membership_id,
      coalesce(policy.pre_due_days,3)::int as pre_due_days,
      coalesce(policy.overdue_stage_days,array[0,7,14,30]::smallint[])::int[] as overdue_stage_days,
      coalesce(policy.founder_escalation_days,30)::int as founder_escalation_days,
      coalesce(policy.reminder_channels,array['email']::text[]) as reminder_channels,
      coalesce(policy.reminder_subject_template,'Invoice {{invoice}}: {{stage}}') as reminder_subject_template,
      coalesce(policy.reminder_body_template,'Invoice {{invoice}} for {{company}} is {{stage}}. Due date: {{due_date}}. Please contact your account owner if payment is already arranged or the invoice is disputed.') as reminder_body_template
    from public.finance_invoices invoice
    join public.crm_companies company on company.id=invoice.company_id
    left join public.finance_collection_policies policy on policy.organization_id=invoice.organization_id
    left join lateral (
      select membership.id
      from public.memberships membership
      where membership.organization_id = invoice.organization_id and membership.status = 'active'
        and (
          membership.id = company.account_owner_membership_id
          or membership.id = invoice.created_by_membership_id
          or private.membership_has_permission(membership.id, 'finance.collection.manage')
          or private.membership_has_permission(membership.id, 'reports.founder_pack.view')
        )
      order by
        case
          when membership.id = company.account_owner_membership_id then 0
          when membership.id = invoice.created_by_membership_id then 1
          when private.membership_has_permission(membership.id, 'finance.collection.manage') then 2
          else 3
        end,
        membership.created_at, membership.id
      limit 1
    ) collection_owner on true
    where collection_owner.id is not null
      and invoice.issued_at is not null and invoice.balance_minor > 0
      and invoice.status not in ('paid','void','credited') and invoice.due_date is not null
      and invoice.due_date <= current_date + coalesce(policy.pre_due_days,3)
    order by invoice.due_date, invoice.balance_minor desc
    limit ${Math.max(1, Math.min(500, limit))}
  `;
  const outcomes = { processed: 0, suppressed: 0, skipped: 0 };
  for (const row of rows) outcomes[await processInvoice(row)] += 1;
  return outcomes;
}
