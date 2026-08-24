import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { validateMultipartContentLength } from "@/lib/server/multipart-content-length";
import { isAllowedApplicationOrigin } from "@/lib/server/request-origin";
import { parseMoneyToMinor } from "@/modules/finance/calculations";
import { hrPermissionKeys } from "@/modules/hr/hr";
import { calculateSalaryTotals } from "@/modules/hr/salary";
import { salarySlipUploadSchema } from "@/modules/hr/schemas/salary";
import { HrSalaryTargetError, requireHrSalaryTarget } from "@/modules/hr/server/salary";
import {
  createSalarySlipPrivateFile,
  HR_SALARY_SLIP_MAX_BYTES,
  salarySlipValidationMessage,
} from "@/modules/hr/server/salary-slip-service";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";

export const runtime = "nodejs";

const MAX_MULTIPART_OVERHEAD_BYTES = 512_000;

function jsonError(message: string, status = 400) {
  return NextResponse.json(
    { ok: false, message },
    { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } },
  );
}

function formText(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === "string" ? value : null;
}

function nullableText(formData: FormData, key: string): string | null {
  const value = formText(formData, key)?.trim();
  return value ? value : null;
}

function salaryInputErrorMessage(error: unknown): string | null {
  if (error instanceof HrSalaryTargetError) return error.message;
  if (!(error instanceof Error)) return null;
  return /(?:decimal places|non-negative decimal|outside the supported range|deductions cannot exceed gross salary|too large)/i.test(
    error.message,
  )
    ? error.message
    : null;
}

export async function POST(request: Request) {
  if (!isAllowedApplicationOrigin(request, { requireOrigin: true })) {
    return jsonError("Cross-origin salary-slip uploads are not allowed.", 403);
  }

  const authorization = await authorizeCurrentUser([
    hrPermissionKeys.workspace,
    hrPermissionKeys.salarySlipManage,
  ]);
  if (!authorization.allowed) {
    return jsonError(
      authorization.reason === "signed-out"
        ? "Sign in before uploading salary slips."
        : "You cannot upload salary slips.",
      authorization.reason === "signed-out" ? 401 : 403,
    );
  }

  const boundedLength = validateMultipartContentLength(
    request,
    HR_SALARY_SLIP_MAX_BYTES,
    MAX_MULTIPART_OVERHEAD_BYTES,
  );
  if (!boundedLength.ok && boundedLength.status === 411) {
    return jsonError("A bounded Content-Length header is required.", 411);
  }
  if (!boundedLength.ok) return jsonError("Salary slips are limited to 10 MB.", 413);

  try {
    const formData = await request.formData();
    const parsed = salarySlipUploadSchema.safeParse({
      membershipId: formText(formData, "membershipId"),
      periodStart: formText(formData, "periodStart"),
      periodEnd: formText(formData, "periodEnd"),
      currency: formText(formData, "currency"),
      baseSalary: formText(formData, "baseSalary"),
      allowances: formText(formData, "allowances") ?? "0",
      deductions: formText(formData, "deductions") ?? "0",
      bonus: formText(formData, "bonus") ?? "0",
      reimbursement: formText(formData, "reimbursement") ?? "0",
      extraDeduction: formText(formData, "extraDeduction") ?? "0",
      notes: nullableText(formData, "notes"),
    });
    if (!parsed.success) return jsonError("Check the salary-slip fields.");

    const uploadedFile = formData.get("file");
    if (!(uploadedFile instanceof File) || uploadedFile.size <= 0) {
      return jsonError("Choose a salary-slip PDF.");
    }
    if (uploadedFile.size > HR_SALARY_SLIP_MAX_BYTES) {
      return jsonError("Salary slips are limited to 10 MB.", 413);
    }
    if (
      !/\.pdf$/i.test(uploadedFile.name) ||
      !["application/pdf", ""].includes(uploadedFile.type)
    ) {
      return jsonError("Choose a valid PDF salary slip.");
    }

    const context = authorization.context;
    const values = parsed.data;
    await requireHrSalaryTarget(context, values.membershipId, hrPermissionKeys.salarySlipManage);

    const baseSalaryMinor = parseMoneyToMinor(values.baseSalary, values.currency);
    const allowancesMinor = parseMoneyToMinor(values.allowances, values.currency);
    const deductionsMinor = parseMoneyToMinor(values.deductions, values.currency);
    const bonusMinor = parseMoneyToMinor(values.bonus, values.currency);
    const reimbursementMinor = parseMoneyToMinor(values.reimbursement, values.currency);
    const extraDeductionMinor = parseMoneyToMinor(values.extraDeduction, values.currency);
    const totals = calculateSalaryTotals({
      baseSalaryMinor,
      allowanceAmounts: [allowancesMinor],
      deductionAmounts: [deductionsMinor],
      bonusMinor,
      reimbursementMinor,
      extraDeductionMinor,
    });

    const buffer = Buffer.from(await uploadedFile.arrayBuffer());
    const slipId = randomUUID();
    const file = new File(
      [new Uint8Array(buffer)],
      `salary-slip-${values.periodStart}-${values.periodEnd}-${slipId.slice(0, 8)}.pdf`,
      { type: "application/pdf" },
    );
    const result = await createSalarySlipPrivateFile(context, {
      id: slipId,
      membershipId: values.membershipId,
      salaryStructureId: null,
      periodStart: values.periodStart,
      periodEnd: values.periodEnd,
      currency: values.currency,
      totals,
      structureSnapshot: {
        sourceFileName: uploadedFile.name.slice(0, 255),
        baseSalaryMinor,
        allowancesMinor,
        deductionsMinor,
        bonusMinor,
        reimbursementMinor,
        extraDeductionMinor,
      },
      notes: values.notes,
      source: "uploaded",
      file,
      buffer,
    });

    revalidatePath("/hr");
    return NextResponse.json(
      {
        ok: true,
        duplicate: !result.created,
        message: result.created
          ? "Salary slip uploaded for security scanning."
          : "This exact salary slip is already uploaded or awaiting scanning.",
      },
      {
        status: result.created ? 202 : 200,
        headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
      },
    );
  } catch (error) {
    const validation = salarySlipValidationMessage(error);
    if (validation) return jsonError(validation, validation.includes("10 MB") ? 413 : 400);
    const inputError = salaryInputErrorMessage(error);
    return jsonError(inputError ?? "Salary slip could not be uploaded.", inputError ? 400 : 500);
  }
}
