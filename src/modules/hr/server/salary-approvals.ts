import "server-only";

import type { TransactionSql } from "postgres";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { submitApprovalForRecordAtomically } from "@/modules/approvals/server/approvals";
import type { CreateApprovalDefinitionInput } from "@/modules/approvals/schemas/approvals";
import { currencyMinorUnits } from "@/modules/finance/calculations";
import { ensureHrApprovalPolicy } from "@/modules/hr/actions/approval-policies";
import type { SalaryComponentInput } from "@/modules/hr/salary";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

const SALARY_REVISION_POLICY_KEY = "hr_salary_revision_default";

async function activeSalaryPolicy(
  context: CurrentPermissionContext,
): Promise<{ id: string; allow_self_approval: boolean } | null> {
  const rows = await getDatabaseClient()<Array<{ id: string; allow_self_approval: boolean }>>`
    select id, allow_self_approval
    from public.approval_definitions
    where organization_id = ${context.membership.organizationId}::uuid
      and key = ${SALARY_REVISION_POLICY_KEY}
      and source_module = 'hr'
      and entity_type = 'salary_revision'
      and status = 'active'
    limit 1
  `;
  return rows[0] ?? null;
}

async function preferredApproverRole(
  context: CurrentPermissionContext,
): Promise<"hr_manager" | "owner"> {
  const rows = await getDatabaseClient()<Array<{ template_key: "hr_manager" | "owner" }>>`
    select role.template_key
    from public.memberships membership
    join public.membership_roles assignment on assignment.membership_id = membership.id
    join public.roles role on role.id = assignment.role_id
      and role.organization_id = membership.organization_id
      and role.status = 'active'
    where membership.organization_id = ${context.membership.organizationId}::uuid
      and membership.status = 'active'
      and membership.id <> ${context.membership.id}::uuid
      and role.template_key in ('hr_manager', 'owner')
      and private.membership_has_permission(membership.id, 'approvals.request.approve')
    order by case role.template_key when 'hr_manager' then 0 else 1 end
    limit 1
  `;
  const role = rows[0]?.template_key;
  if (!role) {
    throw new Error(
      "Salary revision approval requires another active HR Manager or Owner with approval permission.",
    );
  }
  return role;
}

export async function ensureSalaryRevisionApprovalPolicy(
  context: CurrentPermissionContext,
): Promise<void> {
  const existing = await activeSalaryPolicy(context);
  if (existing) {
    if (existing.allow_self_approval)
      throw new Error("Salary revision approvals must not allow self-approval.");
    return;
  }
  const role = await preferredApproverRole(context);
  const definition: CreateApprovalDefinitionInput = {
    key: SALARY_REVISION_POLICY_KEY,
    name: "Salary revision approval",
    description:
      "Shared approval policy for salary changes. Self-approval is disabled and the approved request snapshot becomes the immutable salary revision input.",
    sourceModule: "hr",
    entityType: "salary_revision",
    allowSelfApproval: false,
    allowReassignment: true,
    steps: [
      {
        name: role === "hr_manager" ? "HR Manager review" : "Owner review",
        stageOrder: 1,
        sortOrder: 1,
        selectorType: "role",
        selectorRoleKey: role,
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
  await ensureHrApprovalPolicy(context, definition);
  const created = await activeSalaryPolicy(context);
  if (!created || created.allow_self_approval)
    throw new Error("A safe salary revision approval policy could not be established.");
}

function amountFromMinor(value: number, currency: string): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("Salary approval amount is invalid.");
  return value / 10 ** currencyMinorUnits(currency);
}

export async function submitSalaryRevisionApproval<T>(
  context: CurrentPermissionContext,
  input: {
    structureId: string;
    membershipId: string;
    employeeName: string;
    currency: string;
    baseSalaryMinor: number;
    effectiveFrom: string;
    notes: string | null;
    allowances: SalaryComponentInput[];
    deductions: SalaryComponentInput[];
  },
  mutate: (sql: TransactionSql, requestId: string) => Promise<T>,
): Promise<{ requestId: string; result: T }> {
  await ensureSalaryRevisionApprovalPolicy(context);
  return submitApprovalForRecordAtomically(
    context,
    {
      definitionKey: SALARY_REVISION_POLICY_KEY,
      title: `Salary revision: ${input.employeeName}`,
      sourceModule: "hr",
      entityType: "salary_revision",
      entityId: input.structureId,
      deepLink: `/hr?tab=salary&membership=${input.membershipId}`,
      departmentId: null,
      amount: amountFromMinor(input.baseSalaryMinor, input.currency),
      currency: input.currency,
      snapshot: {
        membershipId: input.membershipId,
        currency: input.currency,
        baseSalaryMinor: input.baseSalaryMinor,
        effectiveFrom: input.effectiveFrom,
        notes: input.notes ?? "",
        allowances: input.allowances,
        deductions: input.deductions,
      },
      dueAt: null,
    },
    mutate,
  );
}
