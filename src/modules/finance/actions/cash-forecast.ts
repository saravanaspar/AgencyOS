"use server";

import { revalidatePath } from "next/cache";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { writeAuditEvent } from "@/modules/audit/server/write-audit-event";
import { parseMoneyToMinor } from "@/modules/finance/calculations";
import { financePermissionKeys } from "@/modules/finance/finance";
import {
  cashForecastSettingsSchema,
  cashRecurringItemSchema,
  deleteCashRecurringItemSchema,
} from "@/modules/finance/schemas/cash-forecast";
import type { FinanceActionState } from "@/modules/finance/schemas/finance";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}
function success(message: string): FinanceActionState {
  return { status: "success", message };
}
function failure(message: string, fieldErrors?: Record<string, string[]>): FinanceActionState {
  return { status: "error", message, fieldErrors };
}

export async function saveCashForecastSettingsAction(
  _previous: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  const parsed = cashForecastSettingsSchema.safeParse({
    payrollDay: text(formData, "payrollDay"),
    pipelineEnabled: formData.get("pipelineEnabled") ?? false,
    historicalCollectionEnabled: formData.get("historicalCollectionEnabled") ?? false,
    baseCollectionDelayDays: text(formData, "baseCollectionDelayDays"),
    conservativeCollectionDelayDays: text(formData, "conservativeCollectionDelayDays"),
    optimisticCollectionDelayDays: text(formData, "optimisticCollectionDelayDays"),
    basePipelineMultiplierBps: text(formData, "basePipelineMultiplierBps"),
    conservativePipelineMultiplierBps: text(formData, "conservativePipelineMultiplierBps"),
    optimisticPipelineMultiplierBps: text(formData, "optimisticPipelineMultiplierBps"),
  });
  if (!parsed.success)
    return failure("Check the cash-forecast assumptions.", parsed.error.flatten().fieldErrors);
  const authorization = await authorizeCurrentUser([
    financePermissionKeys.workspace,
    financePermissionKeys.reportView,
    financePermissionKeys.cashForecastManage,
  ]);
  if (!authorization.allowed) return failure("You cannot manage cash-forecast assumptions.");
  const context = authorization.context;
  const value = parsed.data;
  try {
    await getDatabaseClient().begin(async (sql) => {
      await sql`
        insert into public.finance_cash_forecast_settings (
          organization_id, payroll_day, pipeline_enabled, historical_collection_enabled,
          base_collection_delay_days, conservative_collection_delay_days, optimistic_collection_delay_days,
          base_pipeline_multiplier_bps, conservative_pipeline_multiplier_bps, optimistic_pipeline_multiplier_bps,
          updated_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${value.payrollDay}, ${value.pipelineEnabled},
          ${value.historicalCollectionEnabled}, ${value.baseCollectionDelayDays},
          ${value.conservativeCollectionDelayDays}, ${value.optimisticCollectionDelayDays},
          ${value.basePipelineMultiplierBps}, ${value.conservativePipelineMultiplierBps},
          ${value.optimisticPipelineMultiplierBps}, ${context.membership.id}::uuid
        ) on conflict (organization_id) do update set
          payroll_day = excluded.payroll_day, pipeline_enabled = excluded.pipeline_enabled,
          historical_collection_enabled = excluded.historical_collection_enabled,
          base_collection_delay_days = excluded.base_collection_delay_days,
          conservative_collection_delay_days = excluded.conservative_collection_delay_days,
          optimistic_collection_delay_days = excluded.optimistic_collection_delay_days,
          base_pipeline_multiplier_bps = excluded.base_pipeline_multiplier_bps,
          conservative_pipeline_multiplier_bps = excluded.conservative_pipeline_multiplier_bps,
          optimistic_pipeline_multiplier_bps = excluded.optimistic_pipeline_multiplier_bps,
          updated_by_membership_id = excluded.updated_by_membership_id, updated_at = now()
      `;
      await writeAuditEvent(sql, context, {
        action: "finance.cash_forecast.settings_saved",
        entityType: "finance_cash_forecast_settings",
        entityId: context.membership.organizationId,
        afterState: value,
        changedFields: ["cash_forecast_settings"],
      });
    });
    revalidatePath("/finance");
    revalidatePath("/reports");
    return success("Cash-forecast assumptions saved.");
  } catch {
    return failure("Cash-forecast assumptions could not be saved.");
  }
}

export async function saveCashRecurringItemAction(
  _previous: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  const parsed = cashRecurringItemSchema.safeParse({
    recurringItemId: text(formData, "recurringItemId"),
    label: text(formData, "label"),
    direction: text(formData, "direction"),
    itemKind: text(formData, "itemKind"),
    amount: text(formData, "amount"),
    currency: text(formData, "currency"),
    cadence: text(formData, "cadence"),
    nextDueOn: text(formData, "nextDueOn"),
    endOn: text(formData, "endOn"),
    probabilityBps: text(formData, "probabilityBps"),
    projectId: text(formData, "projectId"),
    active: formData.get("active") ?? false,
  });
  if (!parsed.success)
    return failure("Check the recurring cash item.", parsed.error.flatten().fieldErrors);
  const authorization = await authorizeCurrentUser([
    financePermissionKeys.workspace,
    financePermissionKeys.reportView,
    financePermissionKeys.cashForecastManage,
  ]);
  if (!authorization.allowed) return failure("You cannot manage recurring cash items.");
  const context = authorization.context;
  const value = parsed.data;
  let amountMinor: number;
  try {
    amountMinor = parseMoneyToMinor(value.amount, value.currency);
  } catch {
    return failure("Enter a valid amount for the selected currency.");
  }
  try {
    const id = await getDatabaseClient().begin(async (sql) => {
      const rows = await sql<Array<{ id: string }>>`
        insert into public.finance_cash_recurring_items (
          id, organization_id, label, direction, item_kind, amount_minor, currency, cadence,
          next_due_on, end_on, probability_bps, project_id, active,
          created_by_membership_id, updated_by_membership_id
        ) values (
          coalesce(${value.recurringItemId}::uuid, gen_random_uuid()), ${context.membership.organizationId}::uuid,
          ${value.label}, ${value.direction}, ${value.itemKind}, ${amountMinor}, ${value.currency}, ${value.cadence},
          ${value.nextDueOn}::date, ${value.endOn}::date, ${value.probabilityBps}, ${value.projectId}::uuid, ${value.active},
          ${context.membership.id}::uuid, ${context.membership.id}::uuid
        ) on conflict (id) do update set
          label = excluded.label, direction = excluded.direction, item_kind = excluded.item_kind,
          amount_minor = excluded.amount_minor, currency = excluded.currency, cadence = excluded.cadence,
          next_due_on = excluded.next_due_on, end_on = excluded.end_on, probability_bps = excluded.probability_bps,
          project_id = excluded.project_id, active = excluded.active,
          updated_by_membership_id = excluded.updated_by_membership_id, updated_at = now()
        where finance_cash_recurring_items.organization_id = excluded.organization_id
        returning id
      `;
      const recurringId = rows[0]?.id;
      if (!recurringId) throw new Error("recurring-item-save-failed");
      await writeAuditEvent(sql, context, {
        action: "finance.cash_forecast.recurring_item_saved",
        entityType: "finance_cash_recurring_item",
        entityId: recurringId,
        afterState: { ...value, amountMinor },
        changedFields: ["recurring_item"],
      });
      return recurringId;
    });
    revalidatePath("/finance");
    revalidatePath("/reports");
    return success(`Recurring cash item ${id.slice(0, 8)} saved.`);
  } catch {
    return failure("Recurring cash item could not be saved.");
  }
}

export async function deleteCashRecurringItemAction(formData: FormData): Promise<void> {
  const parsed = deleteCashRecurringItemSchema.safeParse({
    recurringItemId: text(formData, "recurringItemId"),
  });
  if (!parsed.success) return;
  const authorization = await authorizeCurrentUser([
    financePermissionKeys.workspace,
    financePermissionKeys.cashForecastManage,
  ]);
  if (!authorization.allowed) return;
  const context = authorization.context;
  await getDatabaseClient().begin(async (sql) => {
    await sql`delete from public.finance_cash_recurring_items where id = ${parsed.data.recurringItemId}::uuid and organization_id = ${context.membership.organizationId}::uuid`;
    await writeAuditEvent(sql, context, {
      action: "finance.cash_forecast.recurring_item_deleted",
      entityType: "finance_cash_recurring_item",
      entityId: parsed.data.recurringItemId,
      changedFields: ["deleted"],
    });
  });
  revalidatePath("/finance");
  revalidatePath("/reports");
}
