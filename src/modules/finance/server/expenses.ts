import "server-only";

import type { Sql } from "postgres";

import {
  financePermissionKeys,
  type FinanceExpensePaymentStatus,
  type FinanceExpenseType,
} from "@/modules/finance/finance";
import type { FinanceFilters } from "@/modules/finance/schemas/finance";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

export interface FinanceExpenseCategory {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  defaultTaxBps: number;
  isActive: boolean;
}

export interface FinanceExpenseMember {
  id: string;
  displayName: string;
  email: string;
}

export interface FinanceExpenseAllocation {
  id: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  amountMinor: number;
}

export interface FinanceExpenseReceipt {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  downloadHref: string | null;
  createdAt: string;
}

export interface FinanceExpenseEvent {
  id: string;
  eventType: string;
  actorName: string | null;
  createdAt: string;
}

export interface FinanceExpense {
  id: string;
  expenseType: FinanceExpenseType;
  categoryId: string;
  categoryName: string;
  employeeMembershipId: string | null;
  employeeName: string | null;
  vendorName: string | null;
  vendorReference: string | null;
  expenseDate: string;
  currency: string;
  amountMinor: number;
  taxMinor: number;
  totalMinor: number;
  isBillable: boolean;
  isReimbursable: boolean;
  approvalStatus: "not_required" | "pending" | "approved" | "rejected";
  paymentStatus: FinanceExpensePaymentStatus;
  paymentReference: string | null;
  paidAt: string | null;
  notes: string | null;
  rejectionReason: string | null;
  createdByMembershipId: string;
  createdByName: string;
  createdAt: string;
  allocations: FinanceExpenseAllocation[];
  receipts: FinanceExpenseReceipt[];
  events: FinanceExpenseEvent[];
}

export interface FinanceExpenseData {
  expenseCategories: FinanceExpenseCategory[];
  expenseMembers: FinanceExpenseMember[];
  expenses: FinanceExpense[];
  expenseSummary: {
    totalThisMonthMinor: number;
    pendingApprovalMinor: number;
    reimbursableMinor: number;
    unpaidMinor: number;
  };
}

interface ExpenseRow {
  id: string;
  expense_type: FinanceExpenseType;
  category_id: string;
  category_name: string;
  employee_membership_id: string | null;
  employee_name: string | null;
  vendor_name: string | null;
  vendor_reference: string | null;
  expense_date: string;
  currency: string;
  amount_minor: string | number;
  tax_minor: string | number;
  total_minor: string | number;
  is_billable: boolean;
  is_reimbursable: boolean;
  approval_status: FinanceExpense["approvalStatus"];
  payment_status: FinanceExpensePaymentStatus;
  payment_reference: string | null;
  paid_at: Date | null;
  notes: string | null;
  rejection_reason: string | null;
  created_by_membership_id: string;
  created_by_name: string;
  created_at: Date;
}

export async function loadFinanceExpenseData(
  database: Sql,
  context: CurrentPermissionContext,
  filters: FinanceFilters,
): Promise<FinanceExpenseData> {
  if (filters.tab !== "expenses") {
    return {
      expenseCategories: [],
      expenseMembers: [],
      expenses: [],
      expenseSummary: {
        totalThisMonthMinor: 0,
        pendingApprovalMinor: 0,
        reimbursableMinor: 0,
        unpaidMinor: 0,
      },
    };
  }

  const organizationId = context.membership.organizationId;
  const canView = context.permissions.has(financePermissionKeys.expenseView);
  const canCreate = context.permissions.has(financePermissionKeys.expenseCreate);
  const canManageCategories = context.permissions.has(financePermissionKeys.expenseCategoryManage);
  const viewScope = context.permissionScopes.get(financePermissionKeys.expenseView) ?? "own";
  const createScope = context.permissionScopes.get(financePermissionKeys.expenseCreate) ?? "own";
  const search = filters.q ? `%${filters.q.replaceAll("%", "\\%").replaceAll("_", "\\_")}%` : null;

  const [
    categoryRows,
    memberRows,
    expenseRows,
    allocationRows,
    receiptRows,
    eventRows,
    summaryRows,
  ] = await Promise.all([
    canView || canManageCategories
      ? database<
          Array<{
            id: string;
            name: string;
            code: string | null;
            description: string | null;
            default_tax_bps: number;
            is_active: boolean;
          }>
        >`
            select id, name, code, description, default_tax_bps, is_active
            from public.finance_expense_categories
            where organization_id = ${organizationId}::uuid
            order by is_active desc, lower(name)
            limit 500
          `
      : Promise.resolve([]),
    canCreate
      ? database<Array<{ id: string; display_name: string; email: string }>>`
            select membership.id,
              coalesce(
                profile.display_name,
                nullif(auth_user.raw_user_meta_data ->> 'full_name', ''),
                split_part(coalesce(auth_user.email, ''), '@', 1),
                'AgencyOS user'
              ) as display_name,
              coalesce(auth_user.email, '') as email
            from public.memberships as membership
            join public.identity_accounts as auth_user on auth_user.id = membership.user_id
            left join public.profiles as profile on profile.id = membership.user_id
            where membership.organization_id = ${organizationId}::uuid
              and membership.status = 'active'
              and (${createScope} = 'organization' or membership.id = ${context.membership.id}::uuid)
            order by lower(coalesce(profile.display_name, auth_user.email, ''))
            limit 1000
          `
      : Promise.resolve([]),
    canView
      ? database<ExpenseRow[]>`
            select expense.id, expense.expense_type, expense.category_id,
              category.name as category_name, expense.employee_membership_id,
              case when employee.id is null then null else coalesce(
                employee_profile.display_name,
                nullif(employee_user.raw_user_meta_data ->> 'full_name', ''),
                split_part(coalesce(employee_user.email, ''), '@', 1),
                'AgencyOS user'
              ) end as employee_name,
              expense.vendor_name, expense.vendor_reference, expense.expense_date::text,
              expense.currency, expense.amount_minor, expense.tax_minor, expense.total_minor,
              expense.is_billable, expense.is_reimbursable, expense.approval_status,
              expense.payment_status, expense.payment_reference, expense.paid_at,
              expense.notes, expense.rejection_reason, expense.created_by_membership_id,
              coalesce(
                creator_profile.display_name,
                nullif(creator_user.raw_user_meta_data ->> 'full_name', ''),
                split_part(coalesce(creator_user.email, ''), '@', 1),
                'AgencyOS user'
              ) as created_by_name,
              expense.created_at
            from public.finance_expenses as expense
            join public.finance_expense_categories as category on category.id = expense.category_id
            left join public.memberships as employee on employee.id = expense.employee_membership_id
            left join public.identity_accounts as employee_user on employee_user.id = employee.user_id
            left join public.profiles as employee_profile on employee_profile.id = employee.user_id
            join public.memberships as creator on creator.id = expense.created_by_membership_id
            join public.identity_accounts as creator_user on creator_user.id = creator.user_id
            left join public.profiles as creator_profile on creator_profile.id = creator.user_id
            where expense.organization_id = ${organizationId}::uuid
              and private.crm_scope_allows_membership(
                ${context.membership.id}::uuid,
                ${viewScope},
                expense.employee_membership_id,
                expense.created_by_membership_id
              )
              and (
                ${filters.status}::text is null
                or expense.approval_status = ${filters.status}
                or expense.payment_status = ${filters.status}
                or expense.expense_type = ${filters.status}
              )
              and (${filters.currency}::text is null or expense.currency = ${filters.currency})
              and (${filters.from}::date is null or expense.expense_date >= ${filters.from}::date)
              and (${filters.to}::date is null or expense.expense_date <= ${filters.to}::date)
              and (
                ${search}::text is null
                or category.name ilike ${search} escape '\\'
                or expense.vendor_name ilike ${search} escape '\\'
                or expense.vendor_reference ilike ${search} escape '\\'
                or employee_profile.display_name ilike ${search} escape '\\'
                or employee_user.email ilike ${search} escape '\\'
              )
            order by expense.expense_date desc, expense.created_at desc
            limit 250
          `
      : Promise.resolve([]),
    canView
      ? database<
          Array<{
            id: string;
            expense_id: string;
            project_id: string;
            project_code: string;
            project_name: string;
            amount_minor: string | number;
          }>
        >`
            select allocation.id, allocation.expense_id, allocation.project_id,
              project.code as project_code, project.name as project_name, allocation.amount_minor
            from public.finance_expense_project_allocations as allocation
            join public.finance_expenses as expense on expense.id = allocation.expense_id
            join public.projects as project on project.id = allocation.project_id
            where allocation.organization_id = ${organizationId}::uuid
              and private.crm_scope_allows_membership(
                ${context.membership.id}::uuid,
                ${viewScope},
                expense.employee_membership_id,
                expense.created_by_membership_id
              )
            order by allocation.created_at
            limit 5000
          `
      : Promise.resolve([]),
    canView
      ? database<
          Array<{
            id: string;
            expense_id: string;
            file_name: string;
            mime_type: string;
            size_bytes: string | number;
            status: string;
            created_at: Date;
          }>
        >`
            select receipt.id, receipt.expense_id, receipt.file_name, receipt.mime_type,
              receipt.size_bytes, private_file.status, receipt.created_at
            from public.finance_expense_receipts as receipt
            join public.finance_expenses as expense on expense.id = receipt.expense_id
            join public.private_files as private_file on private_file.id = receipt.private_file_id
            where receipt.organization_id = ${organizationId}::uuid
              and private.crm_scope_allows_membership(
                ${context.membership.id}::uuid,
                ${viewScope},
                expense.employee_membership_id,
                expense.created_by_membership_id
              )
            order by receipt.created_at desc
            limit 2500
          `
      : Promise.resolve([]),
    canView
      ? database<
          Array<{
            id: string;
            expense_id: string;
            event_type: string;
            actor_name: string | null;
            created_at: Date;
          }>
        >`
            select event.id, event.expense_id, event.event_type,
              case when actor.id is null then null else coalesce(
                profile.display_name,
                nullif(auth_user.raw_user_meta_data ->> 'full_name', ''),
                split_part(coalesce(auth_user.email, ''), '@', 1),
                'AgencyOS user'
              ) end as actor_name,
              event.created_at
            from public.finance_expense_events as event
            join public.finance_expenses as expense on expense.id = event.expense_id
            left join public.memberships as actor on actor.id = event.actor_membership_id
            left join public.identity_accounts as auth_user on auth_user.id = actor.user_id
            left join public.profiles as profile on profile.id = actor.user_id
            where event.organization_id = ${organizationId}::uuid
              and private.crm_scope_allows_membership(
                ${context.membership.id}::uuid,
                ${viewScope},
                expense.employee_membership_id,
                expense.created_by_membership_id
              )
            order by event.created_at desc
            limit 5000
          `
      : Promise.resolve([]),
    canView
      ? database<
          Array<{
            total_this_month_minor: string | number;
            pending_approval_minor: string | number;
            reimbursable_minor: string | number;
            unpaid_minor: string | number;
          }>
        >`
            select
              coalesce(sum(total_minor) filter (
                where expense_date >= date_trunc('month', current_date)::date
              ), 0)::bigint as total_this_month_minor,
              coalesce(sum(total_minor) filter (where approval_status = 'pending'), 0)::bigint
                as pending_approval_minor,
              coalesce(sum(total_minor) filter (
                where is_reimbursable and payment_status not in ('reimbursed', 'waived')
              ), 0)::bigint as reimbursable_minor,
              coalesce(sum(total_minor) filter (
                where payment_status in ('unpaid', 'scheduled')
              ), 0)::bigint as unpaid_minor
            from public.finance_expenses as expense
            where expense.organization_id = ${organizationId}::uuid
              and expense.currency = (
                select default_currency from public.organizations where id = ${organizationId}::uuid
              )
              and private.crm_scope_allows_membership(
                ${context.membership.id}::uuid,
                ${viewScope},
                expense.employee_membership_id,
                expense.created_by_membership_id
              )
          `
      : Promise.resolve([]),
  ]);

  const allocationsByExpense = new Map<string, FinanceExpenseAllocation[]>();
  for (const row of allocationRows) {
    const values = allocationsByExpense.get(row.expense_id) ?? [];
    values.push({
      id: row.id,
      projectId: row.project_id,
      projectCode: row.project_code,
      projectName: row.project_name,
      amountMinor: Number(row.amount_minor),
    });
    allocationsByExpense.set(row.expense_id, values);
  }

  const receiptsByExpense = new Map<string, FinanceExpenseReceipt[]>();
  for (const row of receiptRows) {
    const values = receiptsByExpense.get(row.expense_id) ?? [];
    values.push({
      id: row.id,
      fileName: row.file_name,
      mimeType: row.mime_type,
      sizeBytes: Number(row.size_bytes),
      status: row.status,
      downloadHref: row.status === "available" ? `/api/finance/expense-receipts/${row.id}` : null,
      createdAt: row.created_at.toISOString(),
    });
    receiptsByExpense.set(row.expense_id, values);
  }

  const eventsByExpense = new Map<string, FinanceExpenseEvent[]>();
  for (const row of eventRows) {
    const values = eventsByExpense.get(row.expense_id) ?? [];
    values.push({
      id: row.id,
      eventType: row.event_type,
      actorName: row.actor_name,
      createdAt: row.created_at.toISOString(),
    });
    eventsByExpense.set(row.expense_id, values);
  }

  const summary = summaryRows[0];
  return {
    expenseCategories: categoryRows.map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      description: row.description,
      defaultTaxBps: row.default_tax_bps,
      isActive: row.is_active,
    })),
    expenseMembers: memberRows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      email: row.email,
    })),
    expenses: expenseRows.map((row) => ({
      id: row.id,
      expenseType: row.expense_type,
      categoryId: row.category_id,
      categoryName: row.category_name,
      employeeMembershipId: row.employee_membership_id,
      employeeName: row.employee_name,
      vendorName: row.vendor_name,
      vendorReference: row.vendor_reference,
      expenseDate: row.expense_date,
      currency: row.currency,
      amountMinor: Number(row.amount_minor),
      taxMinor: Number(row.tax_minor),
      totalMinor: Number(row.total_minor),
      isBillable: row.is_billable,
      isReimbursable: row.is_reimbursable,
      approvalStatus: row.approval_status,
      paymentStatus: row.payment_status,
      paymentReference: row.payment_reference,
      paidAt: row.paid_at?.toISOString() ?? null,
      notes: row.notes,
      rejectionReason: row.rejection_reason,
      createdByMembershipId: row.created_by_membership_id,
      createdByName: row.created_by_name,
      createdAt: row.created_at.toISOString(),
      allocations: allocationsByExpense.get(row.id) ?? [],
      receipts: receiptsByExpense.get(row.id) ?? [],
      events: eventsByExpense.get(row.id) ?? [],
    })),
    expenseSummary: {
      totalThisMonthMinor: Number(summary?.total_this_month_minor ?? 0),
      pendingApprovalMinor: Number(summary?.pending_approval_minor ?? 0),
      reimbursableMinor: Number(summary?.reimbursable_minor ?? 0),
      unpaidMinor: Number(summary?.unpaid_minor ?? 0),
    },
  };
}
