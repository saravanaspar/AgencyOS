import { currencyMinorUnits } from "@/modules/finance/calculations";

export const salaryComponentTypes = ["allowance", "deduction"] as const;
export const salarySlipSources = ["generated", "uploaded"] as const;

export type SalaryComponentType = (typeof salaryComponentTypes)[number];
export type SalarySlipSource = (typeof salarySlipSources)[number];

export interface SalaryComponentInput {
  name: string;
  amountMinor: number;
  taxable: boolean;
}

export interface SalaryTotals {
  baseSalaryMinor: number;
  allowancesMinor: number;
  deductionsMinor: number;
  bonusMinor: number;
  reimbursementMinor: number;
  grossMinor: number;
  netMinor: number;
}

const MAX_SALARY_MINOR = 9_000_000_000_000;

function safeAmount(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_SALARY_MINOR) {
    throw new Error(`${label} is outside the supported range.`);
  }
  return value;
}

export function calculateSalaryTotals(input: {
  baseSalaryMinor: number;
  allowanceAmounts: readonly number[];
  deductionAmounts: readonly number[];
  bonusMinor?: number;
  reimbursementMinor?: number;
  extraDeductionMinor?: number;
}): SalaryTotals {
  const baseSalaryMinor = safeAmount(input.baseSalaryMinor, "Base salary");
  const allowancesMinor = input.allowanceAmounts.reduce(
    (sum, value) => safeAmount(sum + safeAmount(value, "Allowance"), "Allowances"),
    0,
  );
  const recurringDeductions = input.deductionAmounts.reduce(
    (sum, value) => safeAmount(sum + safeAmount(value, "Deduction"), "Deductions"),
    0,
  );
  const bonusMinor = safeAmount(input.bonusMinor ?? 0, "Bonus");
  const reimbursementMinor = safeAmount(input.reimbursementMinor ?? 0, "Reimbursement");
  const deductionsMinor = safeAmount(
    recurringDeductions + safeAmount(input.extraDeductionMinor ?? 0, "Extra deduction"),
    "Deductions",
  );
  const grossMinor = safeAmount(
    baseSalaryMinor + allowancesMinor + bonusMinor + reimbursementMinor,
    "Gross salary",
  );
  if (deductionsMinor > grossMinor) throw new Error("Deductions cannot exceed gross salary.");
  return {
    baseSalaryMinor,
    allowancesMinor,
    deductionsMinor,
    bonusMinor,
    reimbursementMinor,
    grossMinor,
    netMinor: grossMinor - deductionsMinor,
  };
}

export function parseSalaryComponentLines(
  value: string,
  currency: string,
  parseMoney: (value: string, currency: string) => number,
): SalaryComponentInput[] {
  const result: SalaryComponentInput[] = [];
  const seen = new Set<string>();
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const [rawName, rawAmount, rawTaxable] = line.split("|").map((part) => part.trim());
    if (!rawName || !rawAmount) {
      throw new Error("Each salary component must use Name | Amount | Taxable.");
    }
    if (rawName.length > 120)
      throw new Error("Salary component names are limited to 120 characters.");
    const normalizedName = rawName.toLowerCase();
    if (seen.has(normalizedName)) throw new Error(`Duplicate salary component: ${rawName}.`);
    seen.add(normalizedName);
    result.push({
      name: rawName,
      amountMinor: parseMoney(rawAmount, currency),
      taxable: rawTaxable ? !/^(?:no|false|0)$/i.test(rawTaxable) : true,
    });
  }
  if (result.length > 40) throw new Error("A salary structure supports at most 40 components.");
  return result;
}

export function minorAmountToDecimal(amountMinor: number, currency: string): string {
  const scale = currencyMinorUnits(currency);
  const divisor = 10 ** scale;
  return (amountMinor / divisor).toFixed(scale);
}
