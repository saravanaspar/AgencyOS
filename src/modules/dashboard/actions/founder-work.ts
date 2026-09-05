"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { writeAuditEvent } from "@/modules/audit/server/write-audit-event";
import { enqueueNotification } from "@/modules/notifications/server/notifications";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";

const internalHref = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine(
    (value) => value.startsWith("/") && !value.startsWith("//"),
    "Use an internal AgencyOS link.",
  );

const workStateSchema = z
  .object({
    itemKey: z.string().trim().min(3).max(220),
    itemTitle: z.string().trim().min(1).max(240),
    sourceHref: internalHref,
    sourceReason: z.string().trim().min(1).max(1000),
    sourceMeta: z.string().trim().max(1000),
    sourceBucket: z.enum(["critical", "today", "this_week"]),
    sourceTone: z.enum(["neutral", "success", "warning", "danger"]),
    sourceDueAt: z.preprocess(
      (value) => (typeof value === "string" && value.trim() ? value.trim() : null),
      z.union([z.iso.date(), z.iso.datetime({ offset: true }), z.null()]),
    ),
    sourceAmountMinor: z.preprocess(
      (value) => (typeof value === "string" && value.trim() ? Number(value) : null),
      z.union([z.number().int().safe(), z.null()]),
    ),
    sourceCurrency: z.preprocess(
      (value) => (typeof value === "string" && value.trim() ? value.trim() : null),
      z.union([z.string().regex(/^[A-Z]{3}$/), z.null()]),
    ),
    state: z.enum(["active", "snoozed", "delegated", "handled"]),
    snoozeDays: z.preprocess(
      (value) => (typeof value === "string" && value.trim() ? Number(value) : null),
      z.union([z.literal(1), z.literal(7), z.null()]),
    ),
    delegatedToMembershipId: z.preprocess(
      (value) => (typeof value === "string" && value.trim() ? value.trim() : null),
      z.union([z.uuid(), z.null()]),
    ),
    note: z.preprocess(
      (value) => (typeof value === "string" && value.trim() ? value.trim() : null),
      z.union([z.string().max(1000), z.null()]),
    ),
  })
  .superRefine((value, context) => {
    if (value.state === "snoozed" && !value.snoozeDays)
      context.addIssue({
        code: "custom",
        path: ["snoozeDays"],
        message: "Choose when to resume the item.",
      });
    if (value.state === "delegated" && !value.delegatedToMembershipId)
      context.addIssue({
        code: "custom",
        path: ["delegatedToMembershipId"],
        message: "Choose a delegate.",
      });
    if ((value.sourceAmountMinor === null) !== (value.sourceCurrency === null)) {
      context.addIssue({
        code: "custom",
        path: ["sourceCurrency"],
        message: "Money-at-risk amount and currency must be provided together.",
      });
    }
  });

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function updateFounderWorkItemAction(formData: FormData): Promise<void> {
  const parsed = workStateSchema.safeParse({
    itemKey: text(formData, "itemKey"),
    itemTitle: text(formData, "itemTitle"),
    sourceHref: text(formData, "sourceHref"),
    sourceReason: text(formData, "sourceReason"),
    sourceMeta: text(formData, "sourceMeta"),
    sourceBucket: text(formData, "sourceBucket"),
    sourceTone: text(formData, "sourceTone"),
    sourceDueAt: text(formData, "sourceDueAt"),
    sourceAmountMinor: text(formData, "sourceAmountMinor"),
    sourceCurrency: text(formData, "sourceCurrency"),
    state: text(formData, "state"),
    snoozeDays: text(formData, "snoozeDays"),
    delegatedToMembershipId: text(formData, "delegatedToMembershipId"),
    note: text(formData, "note"),
  });
  if (!parsed.success) return;
  const authorization = await authorizeCurrentUser(["reports.founder_pack.view"]);
  if (!authorization.allowed) return;
  const context = authorization.context;
  const value = parsed.data;
  if (value.delegatedToMembershipId === context.membership.id) return;
  const database = getDatabaseClient();
  await database.begin(async (sql) => {
    if (value.delegatedToMembershipId) {
      const delegateRows = await sql<Array<{ id: string }>>`
        select id from public.memberships where id=${value.delegatedToMembershipId}::uuid
          and organization_id=${context.membership.organizationId}::uuid and status='active' limit 1
      `;
      if (!delegateRows[0]) throw new Error("founder-work-delegate-invalid");
    }
    await sql`
      insert into public.founder_work_item_states (
        organization_id, owner_membership_id, item_key, item_title, source_href, source_reason, source_meta,
        source_bucket, source_tone, source_due_at, source_amount_minor, source_currency,
        state, snoozed_until, delegated_to_membership_id, handled_at, note, updated_by_membership_id
      ) values (
        ${context.membership.organizationId}::uuid, ${context.membership.id}::uuid, ${value.itemKey},
        ${value.itemTitle}, ${value.sourceHref}, ${value.sourceReason}, ${value.sourceMeta},
        ${value.sourceBucket}, ${value.sourceTone}, ${value.sourceDueAt}::timestamptz,
        ${value.sourceAmountMinor}, ${value.sourceCurrency}, ${value.state},
        case when ${value.state} = 'snoozed' then now() + make_interval(days => ${value.snoozeDays}) else null end,
        ${value.state === "delegated" ? value.delegatedToMembershipId : null}::uuid,
        ${value.state === "handled" ? new Date().toISOString() : null}::timestamptz,
        ${value.note}, ${context.membership.id}::uuid
      ) on conflict (organization_id, owner_membership_id, item_key) do update set
        item_title=excluded.item_title, source_href=excluded.source_href, source_reason=excluded.source_reason,
        source_meta=excluded.source_meta, source_bucket=excluded.source_bucket, source_tone=excluded.source_tone,
        source_due_at=excluded.source_due_at, source_amount_minor=excluded.source_amount_minor,
        source_currency=excluded.source_currency, state=excluded.state, snoozed_until=excluded.snoozed_until,
        delegated_to_membership_id=excluded.delegated_to_membership_id, handled_at=excluded.handled_at,
        note=excluded.note, updated_by_membership_id=excluded.updated_by_membership_id, updated_at=now()
    `;
    await writeAuditEvent(sql, context, {
      action: "dashboard.founder_work.updated",
      entityType: "founder_work_item",
      entityId: value.itemKey,
      afterState: {
        state: value.state,
        snoozeDays: value.snoozeDays,
        delegatedToMembershipId: value.delegatedToMembershipId,
      },
      changedFields: ["state"],
    });
  });
  if (value.state === "delegated" && value.delegatedToMembershipId) {
    await enqueueNotification({
      organizationId: context.membership.organizationId,
      recipientMembershipId: value.delegatedToMembershipId,
      category: "assignment",
      severity: "info",
      title: `Founder work: ${value.itemTitle}`.slice(0, 160),
      message: value.sourceReason,
      deepLink: value.sourceHref,
      sourceModule: "dashboard",
      sourceEntityType: "founder_work_item",
      sourceEntityId: value.itemKey,
      dedupeKey: `founder-work-delegated:${context.membership.id}:${value.itemKey}:${value.delegatedToMembershipId}`,
      externalDelivery: true,
    }).catch(() => undefined);
  }
  revalidatePath("/dashboard");
}
