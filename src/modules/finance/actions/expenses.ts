"use server";

import { revalidatePath } from "next/cache";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { toJsonValue } from "@/lib/server/json-value";
import { parseMoneyToMinor, parsePercentToBps } from "@/modules/finance/calculations";
import { financePermissionKeys } from "@/modules/finance/finance";
import {
  expenseApprovalDecisionSchema,
  expenseCategoryCreateSchema,
  expenseCategoryStatusSchema,
  expenseCreateSchema,
  expensePaymentStateSchema,
  type FinanceActionState,
} from "@/modules/finance/schemas/finance";
import { writeAuditEvent } from "@/modules/audit/server/write-audit-event";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

class ExpenseActionError extends Error {}

function values(formData: FormData): Record<string, FormDataEntryValue> {
  return Object.fromEntries(formData.entries());
}

function errorState(message: string, fieldErrors?: Record<string, string[]>): FinanceActionState {
  return { status: "error", message, fieldErrors };
}

function successState(message: string, entityId?: string): FinanceActionState {
  return { status: "success", message, entityId };
}

function refreshFinance(): void {
  revalidatePath("/finance");
  revalidatePath("/dashboard");
}

async function authorizeExpense(permission: string): Promise<CurrentPermissionContext> {
  const result = await authorizeCurrentUser([permission]);
  if (!result.allowed) {
    throw new ExpenseActionError(
      result.reason === "insufficient-permission"
        ? "You do not have permission to perform this expense action."
        : "Your session or organization access is no longer active.",
    );
  }
  return result.context;
}

function failure(error: unknown, fallback: string): FinanceActionState {
  if (error instanceof ExpenseActionError) return errorState(error.message);
  const code =
    error && typeof error === "object" && "code" in error
      ? String(Reflect.get(error, "code"))
      : null;
  const constraint =
    error && typeof error === "object" && "constraint_name" in error
      ? String(Reflect.get(error, "constraint_name"))
      : null;
  console.warn("[AgencyOS] Expense action failed.", { code, constraint });
  if (code === "23505")
    return errorState("A matching expense category or allocation already exists.");
  if (code === "23514" || code === "23503") {
    return errorState("One or more expense fields are invalid or outside this organization.");
  }
  return errorState(fallback);
}

async function assertExpenseScope(
  context: CurrentPermissionContext,
  permission: string,
  expenseId: string,
): Promise<void> {
  const scope = context.permissionScopes.get(permission) ?? "own";
  const rows = await getDatabaseClient()<Array<{ allowed: boolean }>>`
    select private.crm_scope_allows_membership(
      ${context.membership.id}::uuid,
      ${scope},
      expense.employee_membership_id,
      expense.created_by_membership_id
    ) as allowed
    from public.finance_expenses as expense
    where expense.id = ${expenseId}::uuid
      and expense.organization_id = ${context.membership.organizationId}::uuid
    limit 1
  `;
  if (!rows[0]?.allowed)
    throw new ExpenseActionError("Expense was not found in your permission scope.");
}

export async function createExpenseCategoryAction(
  _previousState: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  const parsed = expenseCategoryCreateSchema.safeParse(values(formData));
  if (!parsed.success) {
    return errorState("Check the expense category fields.", parsed.error.flatten().fieldErrors);
  }

  try {
    const context = await authorizeExpense(financePermissionKeys.expenseCategoryManage);
    const rows = await getDatabaseClient()<Array<{ id: string }>>`
      insert into public.finance_expense_categories (
        organization_id, name, code, description, default_tax_bps, is_active,
        created_by_membership_id, created_by
      ) values (
        ${context.membership.organizationId}::uuid,
        ${parsed.data.name},
        ${parsed.data.code},
        ${parsed.data.description},
        ${parsePercentToBps(parsed.data.defaultTaxPercent)},
        ${parsed.data.isActive},
        ${context.membership.id}::uuid,
        ${context.user.id}::uuid
      )
      returning id
    `;
    const id = rows[0]?.id;
    if (!id) throw new ExpenseActionError("The expense category could not be created.");
    await writeAuditEvent(getDatabaseClient(), context, {
      action: "finance.expense_category.created",
      entityType: "finance_expense_category",
      entityId: id,
      afterState: {
        name: parsed.data.name,
        code: parsed.data.code,
        defaultTaxBps: parsePercentToBps(parsed.data.defaultTaxPercent),
      },
    });
    refreshFinance();
    return successState("Expense category created.", id);
  } catch (error) {
    return failure(error, "The expense category could not be created.");
  }
}

export async function setExpenseCategoryStatusAction(
  _previousState: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  const parsed = expenseCategoryStatusSchema.safeParse(values(formData));
  if (!parsed.success) return errorState("Choose a valid expense category.");

  try {
    const context = await authorizeExpense(financePermissionKeys.expenseCategoryManage);
    const rows = await getDatabaseClient()<Array<{ id: string }>>`
      update public.finance_expense_categories
      set is_active = ${parsed.data.isActive}
      where id = ${parsed.data.categoryId}::uuid
        and organization_id = ${context.membership.organizationId}::uuid
      returning id
    `;
    if (!rows[0]) throw new ExpenseActionError("Expense category was not found.");
    await writeAuditEvent(getDatabaseClient(), context, {
      action: "finance.expense_category.status_updated",
      entityType: "finance_expense_category",
      entityId: parsed.data.categoryId,
      afterState: { isActive: parsed.data.isActive },
    });
    refreshFinance();
    return successState(
      parsed.data.isActive ? "Expense category activated." : "Expense category deactivated.",
      parsed.data.categoryId,
    );
  } catch (error) {
    return failure(error, "The expense category status could not be updated.");
  }
}

export async function createExpenseAction(
  _previousState: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  const parsed = expenseCreateSchema.safeParse(values(formData));
  if (!parsed.success) {
    return errorState("Check the expense fields.", parsed.error.flatten().fieldErrors);
  }

  try {
    const context = await authorizeExpense(financePermissionKeys.expenseCreate);
    const createScope = context.permissionScopes.get(financePermissionKeys.expenseCreate) ?? "own";
    if (
      parsed.data.employeeMembershipId &&
      createScope !== "organization" &&
      parsed.data.employeeMembershipId !== context.membership.id
    ) {
      throw new ExpenseActionError("Your expense permission only allows records for yourself.");
    }

    const amountMinor = parseMoneyToMinor(parsed.data.amount, parsed.data.currency);
    const taxMinor = parseMoneyToMinor(parsed.data.tax, parsed.data.currency);
    const totalMinor = amountMinor + taxMinor;
    const allocations = parsed.data.allocations.map((allocation) => ({
      projectId: allocation.projectId,
      amountMinor: parseMoneyToMinor(allocation.amount, parsed.data.currency),
    }));
    const projectIds = new Set(allocations.map((allocation) => allocation.projectId));
    if (projectIds.size !== allocations.length) {
      throw new ExpenseActionError("Each project can appear only once in an expense allocation.");
    }
    const allocatedMinor = allocations.reduce((sum, allocation) => sum + allocation.amountMinor, 0);
    if (allocatedMinor > totalMinor) {
      throw new ExpenseActionError("Project allocations cannot exceed the expense total.");
    }
    if (parsed.data.expenseType === "project" && allocatedMinor !== totalMinor) {
      throw new ExpenseActionError("Project expenses must be fully allocated.");
    }

    const database = getDatabaseClient();
    const expenseId = await database.begin(async (sql) => {
      const categoryRows = await sql<Array<{ id: string }>>`
        select id from public.finance_expense_categories
        where id = ${parsed.data.categoryId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
          and is_active
        limit 1
      `;
      if (!categoryRows[0]) throw new ExpenseActionError("Choose an active expense category.");

      if (parsed.data.employeeMembershipId) {
        const memberRows = await sql<Array<{ id: string }>>`
          select id from public.memberships
          where id = ${parsed.data.employeeMembershipId}::uuid
            and organization_id = ${context.membership.organizationId}::uuid
            and status = 'active'
          limit 1
        `;
        if (!memberRows[0]) throw new ExpenseActionError("Choose an active employee.");
      }

      if (allocations.length) {
        const validProjects = await sql<Array<{ id: string }>>`
          select id from public.projects
          where organization_id = ${context.membership.organizationId}::uuid
            and id = any(${[...projectIds]}::uuid[])
            and archived_at is null
            and closure_status <> 'closed'
        `;
        if (validProjects.length !== projectIds.size) {
          throw new ExpenseActionError("Choose active projects in this organization.");
        }
      }

      const rows = await sql<Array<{ id: string }>>`
        insert into public.finance_expenses (
          organization_id, expense_type, category_id, employee_membership_id,
          vendor_name, vendor_reference, expense_date, currency, amount_minor, tax_minor,
          is_billable, is_reimbursable, notes, created_by_membership_id, created_by
        ) values (
          ${context.membership.organizationId}::uuid,
          ${parsed.data.expenseType},
          ${parsed.data.categoryId}::uuid,
          ${parsed.data.employeeMembershipId}::uuid,
          ${parsed.data.vendorName},
          ${parsed.data.vendorReference},
          ${parsed.data.expenseDate}::date,
          ${parsed.data.currency},
          ${amountMinor},
          ${taxMinor},
          ${parsed.data.isBillable},
          ${parsed.data.isReimbursable},
          ${parsed.data.notes},
          ${context.membership.id}::uuid,
          ${context.user.id}::uuid
        )
        returning id
      `;
      const id = rows[0]?.id;
      if (!id) throw new ExpenseActionError("The expense could not be created.");

      for (const allocation of allocations) {
        await sql`
          insert into public.finance_expense_project_allocations (
            organization_id, expense_id, project_id, amount_minor, created_by_membership_id
          ) values (
            ${context.membership.organizationId}::uuid,
            ${id}::uuid,
            ${allocation.projectId}::uuid,
            ${allocation.amountMinor},
            ${context.membership.id}::uuid
          )
        `;
      }

      await sql`
        insert into public.finance_expense_events (
          organization_id, expense_id, event_type, event_data, actor_membership_id
        ) values (
          ${context.membership.organizationId}::uuid,
          ${id}::uuid,
          'created',
          ${sql.json(
            toJsonValue({
              expenseType: parsed.data.expenseType,
              amountMinor,
              taxMinor,
              allocatedMinor,
              currency: parsed.data.currency,
            }),
          )},
          ${context.membership.id}::uuid
        )
      `;
      await writeAuditEvent(sql, context, {
        action: "finance.expense.created",
        entityType: "finance_expense",
        entityId: id,
        afterState: {
          expenseType: parsed.data.expenseType,
          categoryId: parsed.data.categoryId,
          employeeMembershipId: parsed.data.employeeMembershipId,
          amountMinor,
          taxMinor,
          totalMinor,
          currency: parsed.data.currency,
          projectIds: [...projectIds],
        },
      });
      return id;
    });

    refreshFinance();
    return successState("Expense recorded.", expenseId);
  } catch (error) {
    return failure(error, "The expense could not be recorded.");
  }
}

export async function decideExpenseApprovalAction(
  _previousState: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  const parsed = expenseApprovalDecisionSchema.safeParse(values(formData));
  if (!parsed.success) {
    return errorState("Check the approval decision.", parsed.error.flatten().fieldErrors);
  }

  try {
    const permission =
      parsed.data.decision === "submit"
        ? financePermissionKeys.expenseCreate
        : financePermissionKeys.expenseApprove;
    const context = await authorizeExpense(permission);
    await assertExpenseScope(context, permission, parsed.data.expenseId);

    const database = getDatabaseClient();
    await database.begin(async (sql) => {
      const rows = await sql<
        Array<{ id: string; approval_status: string; payment_status: string }>
      >`
        select id, approval_status, payment_status
        from public.finance_expenses
        where id = ${parsed.data.expenseId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      const expense = rows[0];
      if (!expense) throw new ExpenseActionError("Expense was not found.");
      if (expense.payment_status !== "unpaid") {
        throw new ExpenseActionError("Approval cannot change after payment processing begins.");
      }

      let nextStatus: "pending" | "approved" | "rejected";
      if (parsed.data.decision === "submit") {
        if (!["not_required", "rejected"].includes(expense.approval_status)) {
          throw new ExpenseActionError("Only an unsubmitted or rejected expense can be submitted.");
        }
        nextStatus = "pending";
      } else {
        if (expense.approval_status !== "pending") {
          throw new ExpenseActionError("Only a pending expense can be approved or rejected.");
        }
        nextStatus = parsed.data.decision === "approve" ? "approved" : "rejected";
      }

      await sql`
        update public.finance_expenses
        set approval_status = ${nextStatus},
          approved_by_membership_id = case when ${nextStatus} = 'approved' then ${context.membership.id}::uuid else null end,
          approved_at = case when ${nextStatus} = 'approved' then now() else null end,
          rejection_reason = case when ${nextStatus} = 'rejected' then ${parsed.data.reason} else null end
        where id = ${expense.id}::uuid
      `;
      await sql`
        insert into public.finance_expense_events (
          organization_id, expense_id, event_type, event_data, actor_membership_id
        ) values (
          ${context.membership.organizationId}::uuid,
          ${expense.id}::uuid,
          ${parsed.data.decision === "submit" ? "approval_submitted" : nextStatus},
          ${sql.json(toJsonValue({ reason: parsed.data.reason }))},
          ${context.membership.id}::uuid
        )
      `;
      await writeAuditEvent(sql, context, {
        action: `finance.expense.${parsed.data.decision}`,
        entityType: "finance_expense",
        entityId: expense.id,
        beforeState: { approvalStatus: expense.approval_status },
        afterState: { approvalStatus: nextStatus, reason: parsed.data.reason },
      });
    });

    refreshFinance();
    return successState(
      parsed.data.decision === "submit"
        ? "Expense submitted for approval."
        : parsed.data.decision === "approve"
          ? "Expense approved."
          : "Expense rejected.",
      parsed.data.expenseId,
    );
  } catch (error) {
    return failure(error, "The expense approval could not be updated.");
  }
}

export async function updateExpensePaymentStateAction(
  _previousState: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  const parsed = expensePaymentStateSchema.safeParse(values(formData));
  if (!parsed.success)
    return errorState("Check the payment state.", parsed.error.flatten().fieldErrors);

  try {
    const context = await authorizeExpense(financePermissionKeys.expensePay);
    await assertExpenseScope(context, financePermissionKeys.expensePay, parsed.data.expenseId);
    const database = getDatabaseClient();
    await database.begin(async (sql) => {
      const rows = await sql<
        Array<{
          id: string;
          approval_status: string;
          payment_status: string;
          is_reimbursable: boolean;
        }>
      >`
        select id, approval_status, payment_status, is_reimbursable
        from public.finance_expenses
        where id = ${parsed.data.expenseId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      const expense = rows[0];
      if (!expense) throw new ExpenseActionError("Expense was not found.");
      if (["pending", "rejected"].includes(expense.approval_status)) {
        throw new ExpenseActionError("Approve the expense before changing its payment state.");
      }
      if (parsed.data.paymentStatus === "reimbursed" && !expense.is_reimbursable) {
        throw new ExpenseActionError("Only reimbursable expenses can be marked reimbursed.");
      }

      const isSettled = ["paid", "reimbursed", "waived"].includes(parsed.data.paymentStatus);
      await sql`
        update public.finance_expenses
        set payment_status = ${parsed.data.paymentStatus},
          payment_reference = ${parsed.data.paymentReference},
          paid_at = case when ${isSettled} then now() else null end
        where id = ${expense.id}::uuid
      `;
      await sql`
        insert into public.finance_expense_events (
          organization_id, expense_id, event_type, event_data, actor_membership_id
        ) values (
          ${context.membership.organizationId}::uuid,
          ${expense.id}::uuid,
          ${parsed.data.paymentStatus},
          ${sql.json(toJsonValue({ paymentReference: parsed.data.paymentReference }))},
          ${context.membership.id}::uuid
        )
      `;
      await writeAuditEvent(sql, context, {
        action: "finance.expense.payment_status_updated",
        entityType: "finance_expense",
        entityId: expense.id,
        beforeState: { paymentStatus: expense.payment_status },
        afterState: {
          paymentStatus: parsed.data.paymentStatus,
          paymentReference: parsed.data.paymentReference,
        },
      });
    });

    refreshFinance();
    return successState(
      `Expense payment state updated to ${parsed.data.paymentStatus.replaceAll("_", " ")}.`,
      parsed.data.expenseId,
    );
  } catch (error) {
    return failure(error, "The expense payment state could not be updated.");
  }
}
