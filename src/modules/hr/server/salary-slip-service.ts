import "server-only";

import type { TransactionSql } from "postgres";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { toJsonValue } from "@/lib/server/json-value";
import { writeAuditEvent } from "@/modules/audit/server/write-audit-event";
import { hrPermissionKeys } from "@/modules/hr/hr";
import type { SalarySlipSource, SalaryTotals } from "@/modules/hr/salary";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";
import type { PrivateFilePolicy } from "@/modules/private-files/server/file-policy";
import { createQuarantinedPrivateFile } from "@/modules/private-files/server/private-files";

export const HR_SALARY_SLIP_MAX_BYTES = 10 * 1024 * 1024;
export const HR_SALARY_SLIP_POLICY: PrivateFilePolicy = {
  maxBytes: HR_SALARY_SLIP_MAX_BYTES,
  allowedMimeTypes: new Map([["application/pdf", new Set([".pdf"])]]),
  description: "Salary slips must be PDF files.",
};

export interface SalarySlipCreateInput {
  id: string;
  membershipId: string;
  salaryStructureId: string | null;
  periodStart: string;
  periodEnd: string;
  currency: string;
  totals: SalaryTotals;
  structureSnapshot: Record<string, unknown>;
  notes: string | null;
  source: SalarySlipSource;
  file: File;
  buffer: Buffer;
}

export interface AuthorizedSalarySlip {
  id: string;
  organizationId: string;
  membershipId: string;
}

export async function createSalarySlipPrivateFile(
  context: CurrentPermissionContext,
  input: SalarySlipCreateInput,
): Promise<{ created: boolean; slipId: string }> {
  const result = await createQuarantinedPrivateFile({
    organizationId: context.membership.organizationId,
    uploadedByMembershipId: context.membership.id,
    moduleKey: "hr",
    entityType: "hr_salary_slip",
    entityId: input.id,
    classification: "restricted",
    file: input.file,
    buffer: input.buffer,
    policy: HR_SALARY_SLIP_POLICY,
    accessRules: {
      viewPermission: hrPermissionKeys.salarySlipView,
      managePermission: hrPermissionKeys.salarySlipManage,
      ownMembershipId: input.membershipId,
    },
    metadata: {
      salarySlipId: input.id,
      membershipId: input.membershipId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      source: input.source,
    },
    link: async (sql, privateFile) => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${context.membership.organizationId + ":" + input.membershipId + ":" + input.periodStart + ":" + input.periodEnd}, 0))`;
      const versions = await sql<Array<{ version: number }>>`
        select coalesce(max(version), 0) + 1 as version
        from public.hr_salary_slips
        where organization_id = ${context.membership.organizationId}::uuid
          and membership_id = ${input.membershipId}::uuid
          and period_start = ${input.periodStart}::date
          and period_end = ${input.periodEnd}::date
      `;
      const version = Number(versions[0]?.version ?? 1);
      await sql`
        insert into public.hr_salary_slips (
          id, organization_id, membership_id, salary_structure_id, version,
          period_start, period_end, currency, base_salary_minor, allowances_minor,
          deductions_minor, bonus_minor, reimbursement_minor, gross_minor, net_minor,
          structure_snapshot, notes, source, private_file_id, original_file_name,
          created_by_membership_id
        ) values (
          ${input.id}::uuid, ${context.membership.organizationId}::uuid,
          ${input.membershipId}::uuid, ${input.salaryStructureId}::uuid, ${version},
          ${input.periodStart}::date, ${input.periodEnd}::date, ${input.currency},
          ${input.totals.baseSalaryMinor}, ${input.totals.allowancesMinor},
          ${input.totals.deductionsMinor}, ${input.totals.bonusMinor},
          ${input.totals.reimbursementMinor}, ${input.totals.grossMinor},
          ${input.totals.netMinor}, ${sql.json(toJsonValue(input.structureSnapshot))}, ${input.notes},
          ${input.source}, ${privateFile.id}::uuid, ${privateFile.fileName},
          ${context.membership.id}::uuid
        )
      `;
      await writeAuditEvent(sql, context, {
        action:
          input.source === "generated" ? "hr.salary_slip_generated" : "hr.salary_slip_uploaded",
        entityType: "hr_salary_slip",
        entityId: input.id,
        afterState: {
          membershipId: input.membershipId,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          currency: input.currency,
          version,
          privateFileId: privateFile.id,
        },
      });
    },
  });
  return { created: result.created, slipId: input.id };
}

export async function getAuthorizedSalarySlip(
  context: CurrentPermissionContext,
  salarySlipId: string,
): Promise<AuthorizedSalarySlip | null> {
  const scope = context.permissionScopes.get(hrPermissionKeys.salarySlipView) ?? "own";
  const rows = await getDatabaseClient()<
    Array<{ id: string; organization_id: string; membership_id: string }>
  >`
    select slip.id, slip.organization_id, slip.membership_id
    from public.hr_salary_slips as slip
    where slip.id = ${salarySlipId}::uuid
      and slip.organization_id = ${context.membership.organizationId}::uuid
      and private.crm_scope_allows_membership(
        ${context.membership.id}::uuid, ${scope}, slip.membership_id, slip.membership_id
      )
    limit 1
  `;
  const row = rows[0];
  return row
    ? { id: row.id, organizationId: row.organization_id, membershipId: row.membership_id }
    : null;
}

export function salarySlipValidationMessage(error: unknown): string | null {
  if (!(error instanceof Error) || !error.message.startsWith("private-file-invalid:")) return null;
  if (error.message.includes("size")) return "Salary slips are limited to 10 MB.";
  return "Salary slips must be valid PDF files.";
}

export function salarySlipContentDisposition(fileName: string): string {
  const safe = fileName.replace(/[\r\n"\\]/g, "_").slice(0, 180) || "salary-slip.pdf";
  return `attachment; filename="${safe}"`;
}

export async function recordSalarySlipDownload(
  sql: TransactionSql,
  context: CurrentPermissionContext,
  input: { salarySlipId: string; privateFileId: string },
): Promise<void> {
  await writeAuditEvent(sql, context, {
    action: "hr.salary_slip_downloaded",
    entityType: "hr_salary_slip",
    entityId: input.salarySlipId,
    afterState: { privateFileId: input.privateFileId },
  });
}
