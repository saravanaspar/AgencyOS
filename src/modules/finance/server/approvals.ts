import "server-only";

import type { TransactionSql } from "postgres";

import { getDatabaseClient } from "@/integrations/postgres/database";
import {
  createApprovalDefinition,
  submitApprovalForRecordAtomically,
} from "@/modules/approvals/server/approvals";
import type { CreateApprovalDefinitionInput } from "@/modules/approvals/schemas/approvals";
import { currencyMinorUnits } from "@/modules/finance/calculations";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

export const financeApprovalEntityTypes = ["estimate", "invoice", "credit_note", "expense"] as const;
export type FinanceApprovalEntityType = (typeof financeApprovalEntityTypes)[number];

const approvalPolicyByEntity: Record<
  FinanceApprovalEntityType,
  { key: string; name: string; deepLink: string }
> = {
  estimate: {
    key: "finance_estimate_default",
    name: "Estimate approval",
    deepLink: "/finance?tab=estimates",
  },
  invoice: {
    key: "finance_invoice_default",
    name: "Invoice approval",
    deepLink: "/finance?tab=invoices",
  },
  credit_note: {
    key: "finance_credit_note_default",
    name: "Credit note approval",
    deepLink: "/finance?tab=credit-notes",
  },
  expense: {
    key: "finance_expense_default",
    name: "Expense approval",
    deepLink: "/finance?tab=expenses",
  },
};

interface ActiveFinancePolicyRow {
  id: string;
  allow_self_approval: boolean;
}

async function activeFinancePolicy(
  context: CurrentPermissionContext,
  entityType: FinanceApprovalEntityType,
): Promise<ActiveFinancePolicyRow | null> {
  const policy = approvalPolicyByEntity[entityType];
  const rows = await getDatabaseClient()<ActiveFinancePolicyRow[]>`
    select id, allow_self_approval
    from public.approval_definitions
    where organization_id = ${context.membership.organizationId}::uuid
      and key = ${policy.key}
      and source_module = 'finance'
      and entity_type = ${entityType}
      and status = 'active'
    limit 1
  `;
  return rows[0] ?? null;
}

async function defaultFinanceApproverRole(
  context: CurrentPermissionContext,
): Promise<"finance_manager" | "owner"> {
  const rows = await getDatabaseClient()<{ template_key: "finance_manager" | "owner" }[]>`
    select role.template_key
    from public.memberships as membership
    join public.membership_roles as assignment on assignment.membership_id = membership.id
    join public.roles as role
      on role.id = assignment.role_id
     and role.organization_id = membership.organization_id
     and role.status = 'active'
    where membership.organization_id = ${context.membership.organizationId}::uuid
      and membership.status = 'active'
      and membership.id <> ${context.membership.id}::uuid
      and role.template_key in ('finance_manager', 'owner')
      and private.membership_has_permission(membership.id, 'approvals.request.approve')
    order by case role.template_key when 'finance_manager' then 0 else 1 end
    limit 1
  `;
  const role = rows[0]?.template_key;
  if (!role) {
    throw new Error(
      "Finance approval requires another active Finance Manager or Owner with approval permission.",
    );
  }
  return role;
}

export async function ensureFinanceApprovalPolicy(
  context: CurrentPermissionContext,
  entityType: FinanceApprovalEntityType,
): Promise<string> {
  const existing = await activeFinancePolicy(context, entityType);
  if (existing) {
    if (existing.allow_self_approval) {
      throw new Error("Finance approval policies must not allow self-approval.");
    }
    return existing.id;
  }

  const policy = approvalPolicyByEntity[entityType];
  const approverRole = await defaultFinanceApproverRole(context);
  const definition: CreateApprovalDefinitionInput = {
    key: policy.key,
    name: policy.name,
    description:
      "Default separation-of-duties policy. Configure minimum and maximum amount conditions in Approvals when threshold-based routing is required.",
    sourceModule: "finance",
    entityType,
    allowSelfApproval: false,
    allowReassignment: true,
    steps: [
      {
        name: approverRole === "finance_manager" ? "Finance Manager review" : "Owner review",
        stageOrder: 1,
        sortOrder: 1,
        selectorType: "role",
        selectorRoleKey: approverRole,
        selectorMembershipId: null,
        decisionMode: "any",
        conditions: {},
        commentRequired: false,
        reminderAfterHours: 24,
        escalationAfterHours: 72,
        expiresAfterHours: 168,
      },
    ],
  };

  let id: string;
  try {
    id = await createApprovalDefinition(context, definition);
  } catch (error) {
    const raced = await activeFinancePolicy(context, entityType);
    if (!raced) throw error;
    id = raced.id;
  }

  const created = await activeFinancePolicy(context, entityType);
  if (!created || created.id !== id || created.allow_self_approval) {
    throw new Error("A safe active finance approval policy could not be established.");
  }
  return id;
}

export function financeApprovalAmountFromMinor(amountMinor: number, currency: string): number {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new Error("Finance approval amount must be a non-negative safe integer in minor units.");
  }
  return amountMinor / 10 ** currencyMinorUnits(currency);
}

export async function submitFinanceApprovalForRecord<T>(
  context: CurrentPermissionContext,
  input: {
    entityType: FinanceApprovalEntityType;
    entityId: string;
    title: string;
    amountMinor: number;
    currency: string;
    snapshot: Record<string, unknown>;
  },
  mutate: (sql: TransactionSql, requestId: string) => Promise<T>,
): Promise<{ requestId: string; result: T }> {
  const policy = approvalPolicyByEntity[input.entityType];
  await ensureFinanceApprovalPolicy(context, input.entityType);
  return submitApprovalForRecordAtomically(
    context,
    {
      definitionKey: policy.key,
      title: input.title,
      sourceModule: "finance",
      entityType: input.entityType,
      entityId: input.entityId,
      deepLink: `${policy.deepLink}&approval=${input.entityId}`,
      departmentId: null,
      amount: financeApprovalAmountFromMinor(input.amountMinor, input.currency),
      currency: input.currency,
      snapshot: input.snapshot,
      dueAt: null,
    },
    mutate,
  );
}
