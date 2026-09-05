"use server";

import { revalidatePath } from "next/cache";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { encryptSecretObjectWithEnvironmentKey } from "@/lib/security/secret-envelope";
import { writeAuditEvent } from "@/modules/audit/server/write-audit-event";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";
import { reportsPermissionKeys } from "@/modules/reports/reports";
import {
  reportDeliveryDestinationIdSchema,
  reportDeliveryDestinationSchema,
} from "@/modules/reports/schemas/delivery-destinations";
import {
  assertSafeExternalReportUrl,
  reportDeliveryDestinationEncryption,
} from "@/modules/reports/server/delivery-destinations";
import type { ReportActionState } from "@/modules/reports/schemas/reports";

const ok = (message: string): ReportActionState => ({ status: "success", message });
const bad = (message: string): ReportActionState => ({ status: "error", message });
const text = (data: FormData, key: string) =>
  typeof data.get(key) === "string" ? String(data.get(key)) : "";

export async function saveReportDeliveryDestinationAction(
  _previous: ReportActionState,
  formData: FormData,
): Promise<ReportActionState> {
  const parsed = reportDeliveryDestinationSchema.safeParse({
    destinationId: text(formData, "destinationId"),
    name: text(formData, "name"),
    channel: text(formData, "channel"),
    url: text(formData, "url"),
    botToken: text(formData, "botToken"),
    chatId: text(formData, "chatId"),
    bearerToken: text(formData, "bearerToken"),
  });
  if (!parsed.success) return bad("Check the delivery destination fields.");
  const authorization = await authorizeCurrentUser([
    reportsPermissionKeys.workspace,
    reportsPermissionKeys.deliveryDestinationManage,
  ]);
  if (!authorization.allowed) return bad("You cannot manage report delivery destinations.");
  const context = authorization.context;
  const value = parsed.data;
  try {
    const config: Record<string, string> = {};
    if (value.channel === "slack")
      config.url = (await assertSafeExternalReportUrl(value.url!, "slack")).toString();
    if (value.channel === "webhook") {
      config.url = (await assertSafeExternalReportUrl(value.url!, "webhook")).toString();
      if (value.bearerToken) config.bearerToken = value.bearerToken;
    }
    if (value.channel === "telegram") {
      config.botToken = value.botToken!;
      config.chatId = value.chatId!;
    }
    const encrypted = encryptSecretObjectWithEnvironmentKey(
      config,
      reportDeliveryDestinationEncryption.environmentVariable,
      reportDeliveryDestinationEncryption.purpose,
    );
    await getDatabaseClient().begin(async (sql) => {
      await sql`
        update public.report_delivery_destinations set status='disabled', updated_by_membership_id=${context.membership.id}::uuid
        where organization_id=${context.membership.organizationId}::uuid and membership_id=${context.membership.id}::uuid
          and channel=${value.channel} and status='active'
          and (${value.destinationId}::uuid is null or id <> ${value.destinationId}::uuid)
      `;
      const rows = value.destinationId
        ? await sql<
            Array<{ id: string }>
          >`update public.report_delivery_destinations set name=${value.name}, channel=${value.channel}, encrypted_config=${encrypted}, status='active', updated_by_membership_id=${context.membership.id}::uuid where id=${value.destinationId}::uuid and organization_id=${context.membership.organizationId}::uuid and membership_id=${context.membership.id}::uuid returning id`
        : await sql<
            Array<{ id: string }>
          >`insert into public.report_delivery_destinations (organization_id,membership_id,channel,name,encrypted_config,created_by_membership_id,updated_by_membership_id) values (${context.membership.organizationId}::uuid,${context.membership.id}::uuid,${value.channel},${value.name},${encrypted},${context.membership.id}::uuid,${context.membership.id}::uuid) returning id`;
      const id = rows[0]?.id;
      if (!id) throw new Error("report-destination-save-failed");
      await writeAuditEvent(sql, context, {
        action: "reports.delivery_destination.saved",
        entityType: "report_delivery_destination",
        entityId: id,
        afterState: { channel: value.channel, name: value.name },
        changedFields: ["report_delivery_destination"],
      });
    });
    revalidatePath("/reports");
    return ok("Report delivery destination saved.");
  } catch (error) {
    return bad(error instanceof Error ? error.message : "Delivery destination could not be saved.");
  }
}

export async function disableReportDeliveryDestinationAction(
  _previous: ReportActionState,
  formData: FormData,
): Promise<ReportActionState> {
  const parsed = reportDeliveryDestinationIdSchema.safeParse({
    destinationId: text(formData, "destinationId"),
  });
  if (!parsed.success) return bad("Invalid delivery destination.");
  const authorization = await authorizeCurrentUser([
    reportsPermissionKeys.workspace,
    reportsPermissionKeys.deliveryDestinationManage,
  ]);
  if (!authorization.allowed) return bad("You cannot manage report delivery destinations.");
  const context = authorization.context;
  await getDatabaseClient().begin(async (sql) => {
    await sql`update public.report_delivery_destinations set status='disabled', updated_by_membership_id=${context.membership.id}::uuid where id=${parsed.data.destinationId}::uuid and organization_id=${context.membership.organizationId}::uuid and membership_id=${context.membership.id}::uuid`;
    await writeAuditEvent(sql, context, {
      action: "reports.delivery_destination.disabled",
      entityType: "report_delivery_destination",
      entityId: parsed.data.destinationId,
      changedFields: ["status"],
    });
  });
  revalidatePath("/reports");
  return ok("Delivery destination disabled.");
}
