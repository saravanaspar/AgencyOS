"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { writeAuditEvent } from "@/modules/audit/server/write-audit-event";
import { parseMoneyToMinor } from "@/modules/finance/calculations";
import {
  formText,
  HrActionError,
  isUniqueViolation,
  stateError,
} from "@/modules/hr/actions/action-utils";
import { hrPermissionKeys } from "@/modules/hr/hr";
import {
  calculateSalaryTotals,
  parseSalaryComponentLines,
  type SalaryComponentInput,
} from "@/modules/hr/salary";
import {
  salaryRevisionSchema,
  salarySlipGenerationSchema,
  salarySlipIdSchema,
} from "@/modules/hr/schemas/salary";
import type { HrActionState } from "@/modules/hr/schemas/hr";
import { renderSalarySlipPdf } from "@/modules/hr/server/salary-slip-pdf";
import { HrSalaryTargetError, requireHrSalaryTarget } from "@/modules/hr/server/salary";
import { createSalarySlipPrivateFile } from "@/modules/hr/server/salary-slip-service";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";

function salaryInputErrorMessage(error: unknown): string | null {
  if (error instanceof HrActionError || error instanceof HrSalaryTargetError) return error.message;
  if (!(error instanceof Error)) return null;
  return /(?:salary component|duplicate salary component|decimal places|non-negative decimal|outside the supported range|deductions cannot exceed gross salary|too large)/i.test(
    error.message,
  )
    ? error.message
    : null;
}

function nullableText(formData: FormData, key: string): string | null {
  const value = formText(formData, key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function saveSalaryRevisionAction(
  _previous: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const parsed = salaryRevisionSchema.safeParse({
    membershipId: formText(formData, "membershipId"),
    currency: formText(formData, "currency"),
    baseSalary: formText(formData, "baseSalary"),
    effectiveFrom: formText(formData, "effectiveFrom"),
    allowances: typeof formData.get("allowances") === "string" ? formData.get("allowances") : "",
    deductions: typeof formData.get("deductions") === "string" ? formData.get("deductions") : "",
    notes: nullableText(formData, "notes"),
  });
  if (!parsed.success) {
    return stateError("Check the salary revision fields.", parsed.error.flatten().fieldErrors);
  }
  const authorization = await authorizeCurrentUser([
    hrPermissionKeys.workspace,
    hrPermissionKeys.salaryManage,
  ]);
  if (!authorization.allowed) return stateError("You cannot manage salary structures.");

  try {
    const values = parsed.data;
    const context = authorization.context;
    await requireHrSalaryTarget(context, values.membershipId, hrPermissionKeys.salaryManage);
    const baseSalaryMinor = parseMoneyToMinor(values.baseSalary, values.currency);
    const allowances = parseSalaryComponentLines(
      values.allowances,
      values.currency,
      parseMoneyToMinor,
    );
    const deductions = parseSalaryComponentLines(
      values.deductions,
      values.currency,
      parseMoneyToMinor,
    );
    calculateSalaryTotals({
      baseSalaryMinor,
      allowanceAmounts: allowances.map((item) => item.amountMinor),
      deductionAmounts: deductions.map((item) => item.amountMinor),
    });

    const structureId = await getDatabaseClient().begin(async (sql) => {
      const rows = await sql<
        Array<{ id: string; revision_number: number; effective_to: string | null }>
      >`
        insert into public.hr_salary_structures (
          organization_id, membership_id, revision_number, currency, base_salary_minor,
          effective_from, notes, created_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${values.membershipId}::uuid, 1,
          ${values.currency}, ${baseSalaryMinor}, ${values.effectiveFrom}::date, ${values.notes},
          ${context.membership.id}::uuid
        )
        returning id, revision_number, effective_to::text
      `;
      const structure = rows[0];
      if (!structure) throw new Error("salary-revision-create-failed");
      const components = [
        ...allowances.map((item) => ({ ...item, type: "allowance" as const })),
        ...deductions.map((item) => ({ ...item, type: "deduction" as const })),
      ];
      let sortOrder = 0;
      for (const component of components) {
        sortOrder += 1;
        await sql`
          insert into public.hr_salary_structure_components (
            organization_id, salary_structure_id, component_type, name, amount_minor,
            taxable, sort_order
          ) values (
            ${context.membership.organizationId}::uuid, ${structure.id}::uuid,
            ${component.type}, ${component.name}, ${component.amountMinor},
            ${component.taxable}, ${sortOrder}
          )
        `;
      }
      await writeAuditEvent(sql, context, {
        action: "hr.salary_revision_created",
        entityType: "hr_salary_structure",
        entityId: structure.id,
        afterState: {
          membershipId: values.membershipId,
          revisionNumber: structure.revision_number,
          currency: values.currency,
          effectiveFrom: values.effectiveFrom,
          effectiveTo: structure.effective_to,
          allowanceCount: allowances.length,
          deductionCount: deductions.length,
        },
      });
      return structure.id;
    });
    revalidatePath("/hr");
    return { status: "success", message: `Salary revision ${structureId.slice(0, 8)} created.` };
  } catch (error) {
    if (isUniqueViolation(error))
      return stateError("A salary revision already starts on that date.");
    return stateError(salaryInputErrorMessage(error) ?? "Salary revision could not be created.");
  }
}

interface SalaryStructureRow {
  id: string;
  currency: string;
  base_salary_minor: string | number;
  revision_number: number;
  effective_from: string;
  effective_to: string | null;
  notes: string | null;
}

async function salaryComponents(structureId: string): Promise<{
  allowances: SalaryComponentInput[];
  deductions: SalaryComponentInput[];
}> {
  const rows = await getDatabaseClient()<
    Array<{
      component_type: "allowance" | "deduction";
      name: string;
      amount_minor: string | number;
      taxable: boolean;
    }>
  >`
    select component_type, name, amount_minor, taxable
    from public.hr_salary_structure_components
    where salary_structure_id = ${structureId}::uuid
    order by component_type, sort_order, lower(name)
  `;
  const allowances: SalaryComponentInput[] = [];
  const deductions: SalaryComponentInput[] = [];
  for (const row of rows) {
    const component = {
      name: row.name,
      amountMinor: Number(row.amount_minor),
      taxable: row.taxable,
    };
    if (row.component_type === "allowance") allowances.push(component);
    else deductions.push(component);
  }
  return { allowances, deductions };
}

export async function generateSalarySlipAction(
  _previous: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const parsed = salarySlipGenerationSchema.safeParse({
    membershipId: formText(formData, "membershipId"),
    periodStart: formText(formData, "periodStart"),
    periodEnd: formText(formData, "periodEnd"),
    bonus: formText(formData, "bonus") ?? "0",
    reimbursement: formText(formData, "reimbursement") ?? "0",
    extraDeduction: formText(formData, "extraDeduction") ?? "0",
    notes: nullableText(formData, "notes"),
  });
  if (!parsed.success) {
    return stateError("Check the salary-slip fields.", parsed.error.flatten().fieldErrors);
  }
  const authorization = await authorizeCurrentUser([
    hrPermissionKeys.workspace,
    hrPermissionKeys.salarySlipManage,
    hrPermissionKeys.salaryManage,
  ]);
  if (!authorization.allowed) return stateError("You cannot generate salary slips.");

  try {
    const context = authorization.context;
    const values = parsed.data;
    const employee = await requireHrSalaryTarget(
      context,
      values.membershipId,
      hrPermissionKeys.salarySlipManage,
    );
    const structures = await getDatabaseClient()<SalaryStructureRow[]>`
      select id, currency, base_salary_minor, revision_number, effective_from::text,
        effective_to::text, notes
      from public.hr_salary_structures
      where organization_id = ${context.membership.organizationId}::uuid
        and membership_id = ${values.membershipId}::uuid
        and effective_from <= ${values.periodStart}::date
        and (effective_to is null or effective_to >= ${values.periodEnd}::date)
      order by effective_from desc
      limit 1
    `;
    const structure = structures[0];
    if (!structure) throw new HrActionError("No salary structure covers the complete pay period.");
    const components = await salaryComponents(structure.id);
    const totals = calculateSalaryTotals({
      baseSalaryMinor: Number(structure.base_salary_minor),
      allowanceAmounts: components.allowances.map((item) => item.amountMinor),
      deductionAmounts: components.deductions.map((item) => item.amountMinor),
      bonusMinor: parseMoneyToMinor(values.bonus, structure.currency),
      reimbursementMinor: parseMoneyToMinor(values.reimbursement, structure.currency),
      extraDeductionMinor: parseMoneyToMinor(values.extraDeduction, structure.currency),
    });
    const slipId = randomUUID();
    const pdf = await renderSalarySlipPdf({
      organizationName: employee.organizationName,
      employeeName: employee.employeeName,
      employeeNumber: employee.employeeNumber,
      designationName: employee.designationName,
      periodStart: values.periodStart,
      periodEnd: values.periodEnd,
      currency: structure.currency,
      totals,
      allowances: components.allowances,
      deductions: components.deductions,
      notes: values.notes,
      salaryRevisionNumber: structure.revision_number,
    });
    const fileName = `salary-slip-${values.periodStart}-${values.periodEnd}-${slipId.slice(0, 8)}.pdf`;
    const file = new File([new Uint8Array(pdf)], fileName, { type: "application/pdf" });
    await createSalarySlipPrivateFile(context, {
      id: slipId,
      membershipId: values.membershipId,
      salaryStructureId: structure.id,
      periodStart: values.periodStart,
      periodEnd: values.periodEnd,
      currency: structure.currency,
      totals,
      structureSnapshot: {
        revisionNumber: structure.revision_number,
        effectiveFrom: structure.effective_from,
        effectiveTo: structure.effective_to,
        baseSalaryMinor: Number(structure.base_salary_minor),
        allowances: components.allowances,
        deductions: components.deductions,
      },
      notes: values.notes,
      source: "generated",
      file,
      buffer: pdf,
    });
    revalidatePath("/hr");
    return {
      status: "success",
      message: "Salary slip generated and queued for security scanning.",
    };
  } catch (error) {
    return stateError(salaryInputErrorMessage(error) ?? "Salary slip could not be generated.");
  }
}

export async function acknowledgeSalarySlipAction(
  _previous: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const parsed = salarySlipIdSchema.safeParse({ salarySlipId: formText(formData, "salarySlipId") });
  if (!parsed.success) return stateError("Salary slip was not found.");
  const authorization = await authorizeCurrentUser([
    hrPermissionKeys.workspace,
    hrPermissionKeys.salarySlipView,
    hrPermissionKeys.salarySlipAcknowledge,
  ]);
  if (!authorization.allowed) return stateError("You cannot acknowledge this salary slip.");
  const context = authorization.context;
  try {
    const updated = await getDatabaseClient().begin(async (sql) => {
      const rows = await sql<Array<{ id: string }>>`
        update public.hr_salary_slips as slip
        set acknowledged_at = now(), acknowledged_by_membership_id = ${context.membership.id}::uuid
        from public.private_files as file
        where slip.id = ${parsed.data.salarySlipId}::uuid
          and slip.organization_id = ${context.membership.organizationId}::uuid
          and slip.membership_id = ${context.membership.id}::uuid
          and slip.private_file_id = file.id
          and file.status = 'available'
          and slip.acknowledged_at is null
        returning slip.id
      `;
      if (!rows[0])
        throw new HrActionError(
          "Only an available, unacknowledged salary slip can be acknowledged.",
        );
      await writeAuditEvent(sql, context, {
        action: "hr.salary_slip_acknowledged",
        entityType: "hr_salary_slip",
        entityId: rows[0].id,
        afterState: { acknowledgedByMembershipId: context.membership.id },
      });
      return rows[0].id;
    });
    revalidatePath("/hr");
    return { status: "success", message: `Salary slip ${updated.slice(0, 8)} acknowledged.` };
  } catch (error) {
    return stateError(
      error instanceof HrActionError ? error.message : "Salary slip could not be acknowledged.",
    );
  }
}
