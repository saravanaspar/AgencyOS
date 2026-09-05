"use server";

import { revalidatePath } from "next/cache";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { toJsonValue } from "@/lib/server/json-value";
import { writeAuditEvent } from "@/modules/audit/server/write-audit-event";
import { financePermissionKeys } from "@/modules/finance/finance";
import {
  collectionCaseResolveSchema,
  collectionCaseUpdateSchema,
  collectionPolicySchema,
} from "@/modules/finance/schemas/collections";
import type { FinanceActionState } from "@/modules/finance/schemas/finance";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}
function failure(message: string, fieldErrors?: Record<string, string[]>): FinanceActionState {
  return { status: "error", message, fieldErrors };
}

export async function saveCollectionPolicyAction(
  _previous: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  const stages = text(formData, "overdueStageDays")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const channels = formData
    .getAll("reminderChannels")
    .filter((value): value is string => typeof value === "string");
  const parsed = collectionPolicySchema.safeParse({
    preDueDays: text(formData, "preDueDays"),
    overdueStageDays: stages,
    founderEscalationDays: text(formData, "founderEscalationDays"),
    reminderChannels: channels,
    reminderSubjectTemplate: text(formData, "reminderSubjectTemplate"),
    reminderBodyTemplate: text(formData, "reminderBodyTemplate"),
  });
  if (!parsed.success)
    return failure("Check the collection policy.", parsed.error.flatten().fieldErrors);
  const authorization = await authorizeCurrentUser([
    financePermissionKeys.workspace,
    financePermissionKeys.collectionManage,
  ]);
  if (!authorization.allowed) return failure("You cannot manage collection policy.");
  const context = authorization.context;
  const value = parsed.data;
  try {
    await getDatabaseClient().begin(async (sql) => {
      await sql`
        insert into public.finance_collection_policies (
          organization_id, pre_due_days, overdue_stage_days, founder_escalation_days, reminder_channels, reminder_subject_template, reminder_body_template, updated_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${value.preDueDays}, ${value.overdueStageDays},
          ${value.founderEscalationDays}, ${value.reminderChannels}, ${value.reminderSubjectTemplate}, ${value.reminderBodyTemplate}, ${context.membership.id}::uuid
        ) on conflict (organization_id) do update set
          pre_due_days = excluded.pre_due_days, overdue_stage_days = excluded.overdue_stage_days,
          founder_escalation_days = excluded.founder_escalation_days, reminder_channels = excluded.reminder_channels,
          reminder_subject_template = excluded.reminder_subject_template, reminder_body_template = excluded.reminder_body_template,
          updated_by_membership_id = excluded.updated_by_membership_id, updated_at = now()
      `;
      await writeAuditEvent(sql, context, {
        action: "finance.collection.policy_saved",
        entityType: "finance_collection_policy",
        entityId: context.membership.organizationId,
        afterState: value,
        changedFields: ["collection_policy"],
      });
    });
    revalidatePath("/finance");
    return { status: "success", message: "Collection policy saved." };
  } catch {
    return failure("Collection policy could not be saved.");
  }
}

export async function updateCollectionCaseAction(
  _previous: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  const parsed = collectionCaseUpdateSchema.safeParse({
    caseId: text(formData, "caseId"),
    promiseToPayOn: text(formData, "promiseToPayOn"),
    disputeSuppressed: formData.get("disputeSuppressed") ?? false,
    nextActionAt: text(formData, "nextActionAt"),
    note: text(formData, "note"),
  });
  if (!parsed.success)
    return failure("Check the collection update.", parsed.error.flatten().fieldErrors);
  const authorization = await authorizeCurrentUser([
    financePermissionKeys.workspace,
    financePermissionKeys.collectionManage,
  ]);
  if (!authorization.allowed) return failure("You cannot manage collections.");
  const context = authorization.context;
  const value = parsed.data;
  try {
    await getDatabaseClient().begin(async (sql) => {
      const rows = await sql<
        Array<{
          invoice_id: string;
          previous_promise: string | null;
          previous_suppressed: boolean;
          previous_next_action: Date | null;
        }>
      >`
        select invoice_id, promise_to_pay_on::text as previous_promise, dispute_suppressed as previous_suppressed,
          next_action_at as previous_next_action
        from public.finance_collection_cases
        where id = ${value.caseId}::uuid and organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      const row = rows[0];
      if (!row) throw new Error("collection-case-not-found");
      const status = value.disputeSuppressed
        ? "suppressed"
        : value.promiseToPayOn
          ? "promise_to_pay"
          : "open";
      await sql`
        update public.finance_collection_cases set promise_to_pay_on = ${value.promiseToPayOn}::date,
          dispute_suppressed = ${value.disputeSuppressed}, next_action_at = ${value.nextActionAt}::timestamptz,
          delivery_attempt_count = case
            when promise_to_pay_on is distinct from ${value.promiseToPayOn}::date
              or dispute_suppressed is distinct from ${value.disputeSuppressed} then 0
            else delivery_attempt_count end,
          next_delivery_attempt_at = case
            when promise_to_pay_on is distinct from ${value.promiseToPayOn}::date
              or dispute_suppressed is distinct from ${value.disputeSuppressed} then null
            else next_delivery_attempt_at end,
          last_delivery_error = case
            when promise_to_pay_on is distinct from ${value.promiseToPayOn}::date
              or dispute_suppressed is distinct from ${value.disputeSuppressed} then null
            else last_delivery_error end,
          status = ${status}, updated_at = now()
        where id = ${value.caseId}::uuid and organization_id = ${context.membership.organizationId}::uuid
      `;
      const events: Array<{
        type: string;
        note: string | null;
        evidence: Record<string, unknown>;
      }> = [];
      if (row.previous_promise !== value.promiseToPayOn)
        events.push({
          type: value.promiseToPayOn ? "promise_set" : "promise_cleared",
          note: value.note,
          evidence: { promiseToPayOn: value.promiseToPayOn },
        });
      if (row.previous_suppressed !== value.disputeSuppressed)
        events.push({
          type: value.disputeSuppressed ? "dispute_suppressed" : "dispute_resumed",
          note: value.note,
          evidence: {},
        });
      if ((row.previous_next_action?.toISOString() ?? null) !== value.nextActionAt)
        events.push({
          type: "next_action_set",
          note: value.note,
          evidence: { nextActionAt: value.nextActionAt },
        });
      if (value.note && events.length === 0)
        events.push({ type: "note_added", note: value.note, evidence: {} });
      for (const event of events)
        await sql`
        insert into public.finance_collection_events (organization_id, case_id, invoice_id, actor_membership_id, event_type, note, evidence)
        values (${context.membership.organizationId}::uuid, ${value.caseId}::uuid, ${row.invoice_id}::uuid,
          ${context.membership.id}::uuid, ${event.type}, ${event.note}, ${sql.json(toJsonValue(event.evidence))})
      `;
      await writeAuditEvent(sql, context, {
        action: "finance.collection.case_updated",
        entityType: "finance_collection_case",
        entityId: value.caseId,
        afterState: {
          promiseToPayOn: value.promiseToPayOn,
          disputeSuppressed: value.disputeSuppressed,
          nextActionAt: value.nextActionAt,
        },
        changedFields: ["collection_case"],
      });
    });
    revalidatePath("/finance");
    return { status: "success", message: "Collection case updated." };
  } catch {
    return failure("Collection case could not be updated.");
  }
}

export async function resolveCollectionCaseAction(formData: FormData): Promise<void> {
  const parsed = collectionCaseResolveSchema.safeParse({ caseId: text(formData, "caseId") });
  if (!parsed.success) return;
  const authorization = await authorizeCurrentUser([
    financePermissionKeys.workspace,
    financePermissionKeys.collectionManage,
  ]);
  if (!authorization.allowed) return;
  const context = authorization.context;
  await getDatabaseClient().begin(async (sql) => {
    const rows = await sql<Array<{ invoice_id: string }>>`
      update public.finance_collection_cases set status='resolved', promise_to_pay_on=null, dispute_suppressed=false,
        next_action_at=null, delivery_attempt_count=0, next_delivery_attempt_at=null,
        last_delivery_error=null, updated_at=now()
      where id=${parsed.data.caseId}::uuid and organization_id=${context.membership.organizationId}::uuid
      returning invoice_id
    `;
    if (!rows[0]) return;
    await sql`insert into public.finance_collection_events (organization_id, case_id, invoice_id, actor_membership_id, event_type)
      values (${context.membership.organizationId}::uuid, ${parsed.data.caseId}::uuid, ${rows[0].invoice_id}::uuid, ${context.membership.id}::uuid, 'resolved')`;
    await writeAuditEvent(sql, context, {
      action: "finance.collection.case_resolved",
      entityType: "finance_collection_case",
      entityId: parsed.data.caseId,
      changedFields: ["status"],
    });
  });
  revalidatePath("/finance");
}
