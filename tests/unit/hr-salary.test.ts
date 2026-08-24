import { describe, expect, it } from "vitest";

import { parseMoneyToMinor } from "@/modules/finance/calculations";
import { calculateSalaryTotals, parseSalaryComponentLines } from "@/modules/hr/salary";
import { renderSalarySlipPdf } from "@/modules/hr/server/salary-slip-pdf";
import {
  salaryRevisionSchema,
  salarySlipGenerationSchema,
  salarySlipUploadSchema,
} from "@/modules/hr/schemas/salary";

const membershipId = "22222222-2222-4222-8222-222222222222";

describe("HR salary calculations and validation", () => {
  it("calculates gross and net salary using integer minor units", () => {
    expect(
      calculateSalaryTotals({
        baseSalaryMinor: 500_000,
        allowanceAmounts: [120_000, 30_000],
        deductionAmounts: [25_000],
        bonusMinor: 50_000,
        reimbursementMinor: 10_000,
        extraDeductionMinor: 5_000,
      }),
    ).toEqual({
      baseSalaryMinor: 500_000,
      allowancesMinor: 150_000,
      deductionsMinor: 30_000,
      bonusMinor: 50_000,
      reimbursementMinor: 10_000,
      grossMinor: 710_000,
      netMinor: 680_000,
    });
  });

  it("rejects deductions greater than gross salary", () => {
    expect(() =>
      calculateSalaryTotals({
        baseSalaryMinor: 10_000,
        allowanceAmounts: [],
        deductionAmounts: [10_001],
      }),
    ).toThrow("Deductions cannot exceed gross salary");
  });

  it("parses reusable allowance and deduction lines without duplicate names", () => {
    expect(
      parseSalaryComponentLines(
        "Housing | 1200.50 | yes\nTransport | 300 | no",
        "USD",
        parseMoneyToMinor,
      ),
    ).toEqual([
      { name: "Housing", amountMinor: 120_050, taxable: true },
      { name: "Transport", amountMinor: 30_000, taxable: false },
    ]);
    expect(() =>
      parseSalaryComponentLines("Housing | 10\nhousing | 20", "USD", parseMoneyToMinor),
    ).toThrow("Duplicate salary component");
  });

  it("renders a bounded private salary-slip PDF with escaped employee data", async () => {
    const bytes = await renderSalarySlipPdf({
      organizationName: "Agency <OS>",
      employeeName: "Asha & Omar العربية",
      employeeNumber: "EMP-7",
      designationName: "Engineer",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      currency: "INR",
      totals: calculateSalaryTotals({
        baseSalaryMinor: 5000000,
        allowanceAmounts: [1200000],
        deductionAmounts: [250000],
      }),
      allowances: [{ name: "Housing", amountMinor: 1200000, taxable: true }],
      deductions: [{ name: "Provident fund", amountMinor: 250000, taxable: false }],
      notes: "Private payroll record",
      salaryRevisionNumber: 1,
    });
    expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(1000);
    expect(bytes.length).toBeLessThan(8 * 1024 * 1024);
  });

  it("validates revisions and bounded pay periods", () => {
    expect(
      salaryRevisionSchema.safeParse({
        membershipId,
        currency: "inr",
        baseSalary: "50000.00",
        effectiveFrom: "2026-07-01",
        allowances: "Housing | 12000 | yes",
        deductions: "Tax | 2000 | yes",
        notes: null,
      }).success,
    ).toBe(true);
    expect(
      salarySlipGenerationSchema.safeParse({
        membershipId,
        periodStart: "2026-01-01",
        periodEnd: "2026-04-30",
        bonus: "0",
        reimbursement: "0",
        extraDeduction: "0",
        notes: null,
      }).success,
    ).toBe(false);
    expect(
      salarySlipUploadSchema.safeParse({
        membershipId,
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        currency: "inr",
        baseSalary: "50000.00",
        allowances: "12000",
        deductions: "2000",
        bonus: "1000",
        reimbursement: "500",
        extraDeduction: "0",
        notes: "Imported payroll record",
      }).success,
    ).toBe(true);
  });
});
