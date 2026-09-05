import "server-only";

import { getDatabaseClient } from "@/integrations/postgres/database";
import type {
  CollectionCaseSummary,
  CollectionPolicy,
  CollectionsData,
} from "@/modules/finance/collections";
import { financePermissionKeys } from "@/modules/finance/finance";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

interface PolicyRow {
  pre_due_days: number;
  overdue_stage_days: number[];
  founder_escalation_days: number;
  reminder_channels: Array<"email" | "in_app">;
  reminder_subject_template: string;
  reminder_body_template: string;
}
interface CaseRow {
  id: string;
  invoice_id: string;
  invoice_number: string | null;
  company_name: string;
  amount_minor: string | number;
  currency: string;
  due_date: string | null;
  stage: CollectionCaseSummary["stage"];
  status: CollectionCaseSummary["status"];
  promise_to_pay_on: string | null;
  dispute_suppressed: boolean;
  next_action_at: Date | null;
  owner_membership_id: string | null;
  last_reminder_at: Date | null;
  last_reminder_stage: string | null;
  next_delivery_attempt_at: Date | null;
  last_delivery_error: string | null;
  last_delivery_type: "reminder_sent" | "delivery_failed" | null;
  last_delivery_at: Date | null;
  last_delivery_evidence: Record<string, unknown> | null;
}

export async function getCollectionsForContext(
  context: CurrentPermissionContext,
): Promise<CollectionsData> {
  if (!context.permissions.has(financePermissionKeys.reportView))
    throw new Error("Collections require finance report access.");
  const database = getDatabaseClient();
  const org = context.membership.organizationId;
  const [policyRows, caseRows] = await Promise.all([
    database<PolicyRow[]>`
      select pre_due_days, overdue_stage_days, founder_escalation_days, reminder_channels, reminder_subject_template, reminder_body_template
      from public.finance_collection_policies where organization_id = ${org}::uuid limit 1
    `,
    database<CaseRow[]>`
      select collection_case.id, invoice.id as invoice_id, invoice.invoice_number,
        coalesce(company.display_name, company.legal_name) as company_name,
        invoice.balance_minor as amount_minor, invoice.currency, invoice.due_date::text,
        collection_case.stage, collection_case.status, collection_case.promise_to_pay_on::text,
        collection_case.dispute_suppressed, collection_case.next_action_at,
        collection_case.owner_membership_id, collection_case.last_reminder_at, collection_case.last_reminder_stage,
        collection_case.next_delivery_attempt_at, collection_case.last_delivery_error,
        delivery.event_type as last_delivery_type, delivery.created_at as last_delivery_at, delivery.evidence as last_delivery_evidence
      from public.finance_collection_cases collection_case
      join public.finance_invoices invoice on invoice.id = collection_case.invoice_id
      join public.crm_companies company on company.id = invoice.company_id
      left join lateral (
        select event.event_type, event.created_at, event.evidence
        from public.finance_collection_events event
        where event.organization_id=${org}::uuid and event.case_id=collection_case.id
          and event.event_type in ('reminder_sent','delivery_failed')
        order by event.created_at desc limit 1
      ) delivery on true
      where collection_case.organization_id = ${org}::uuid
        and collection_case.status <> 'resolved'
      order by coalesce(collection_case.next_action_at, invoice.due_date::timestamptz, collection_case.updated_at), invoice.balance_minor desc
      limit 120
    `,
  ]);
  const policy: CollectionPolicy = policyRows[0]
    ? {
        preDueDays: policyRows[0].pre_due_days,
        overdueStageDays: policyRows[0].overdue_stage_days,
        founderEscalationDays: policyRows[0].founder_escalation_days,
        reminderChannels: policyRows[0].reminder_channels,
        reminderSubjectTemplate: policyRows[0].reminder_subject_template,
        reminderBodyTemplate: policyRows[0].reminder_body_template,
      }
    : {
        preDueDays: 3,
        overdueStageDays: [0, 7, 14, 30],
        founderEscalationDays: 30,
        reminderChannels: ["email"],
        reminderSubjectTemplate: "Invoice {{invoice}}: {{stage}}",
        reminderBodyTemplate:
          "Invoice {{invoice}} for {{company}} is {{stage}}. Due date: {{due_date}}. Please contact your account owner if payment is already arranged or the invoice is disputed.",
      };
  return {
    policy,
    cases: caseRows.map((row) => ({
      id: row.id,
      invoiceId: row.invoice_id,
      invoiceNumber: row.invoice_number ?? "Draft",
      companyName: row.company_name,
      amountMinor: Number(row.amount_minor),
      currency: row.currency,
      dueDate: row.due_date,
      stage: row.stage,
      status: row.status,
      promiseToPayOn: row.promise_to_pay_on,
      disputeSuppressed: row.dispute_suppressed,
      nextActionAt: row.next_action_at?.toISOString() ?? null,
      ownerMembershipId: row.owner_membership_id,
      lastReminderAt: row.last_reminder_at?.toISOString() ?? null,
      lastDeliveryStatus:
        row.last_delivery_type === "reminder_sent"
          ? "delivered"
          : row.last_delivery_type === "delivery_failed"
            ? "failed"
            : null,
      lastDeliveryAt: row.last_delivery_at?.toISOString() ?? null,
      lastDeliveryError:
        row.last_delivery_error ??
        (row.last_delivery_type === "delivery_failed" &&
        typeof row.last_delivery_evidence?.errorCode === "string"
          ? row.last_delivery_evidence.errorCode
          : null),
      retryPending: row.next_delivery_attempt_at !== null && row.last_reminder_stage !== row.stage,
    })),
  };
}
