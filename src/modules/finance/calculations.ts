import { getNumberFormatter } from "@/lib/intl-formatters";
const MAX_SAFE_MINOR = 9_000_000_000_000;
const MAX_SAFE_QUANTITY_MILLI = 1_000_000_000;

const zeroDecimalCurrencies = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "ISK",
  "JPY",
  "KMF",
  "KRW",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);
const threeDecimalCurrencies = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);

export interface FinanceLineInput {
  quantityMilli: number;
  unitRateMinor: number;
  discountBps: number;
  taxBps: number;
}

export interface FinanceLineTotals {
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
}

export interface FinanceDocumentTotals extends FinanceLineTotals {
  lineCount: number;
}

export interface FinanceTaxSummaryLine {
  taxBps: number;
  taxableMinor: number;
  taxMinor: number;
}

export function currencyMinorUnits(currency: string): number {
  const normalized = currency.trim().toUpperCase();
  if (zeroDecimalCurrencies.has(normalized)) return 0;
  if (threeDecimalCurrencies.has(normalized)) return 3;
  return 2;
}

function scaledInteger(
  value: string | number,
  scale: number,
  maximum: number,
  label: string,
): number {
  const raw = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(raw)) {
    throw new Error(`${label} must be a non-negative decimal number.`);
  }

  const [wholePart, decimalPart = ""] = raw.split(".");
  const padded = decimalPart.padEnd(scale, "0");
  if (padded.length > scale && /[1-9]/.test(padded.slice(scale))) {
    throw new Error(`${label} supports at most ${scale} decimal places.`);
  }
  const normalizedDecimals = padded.slice(0, scale);
  const multiplier = BigInt(10) ** BigInt(scale);
  const result = BigInt(wholePart) * multiplier + BigInt(normalizedDecimals || "0");

  if (result > BigInt(maximum)) throw new Error(`${label} is too large.`);
  return Number(result);
}

export function parseMoneyToMinor(value: string | number, currency: string): number {
  return scaledInteger(value, currencyMinorUnits(currency), MAX_SAFE_MINOR, "Amount");
}

export function parseQuantityToMilli(value: string | number): number {
  return scaledInteger(value, 3, MAX_SAFE_QUANTITY_MILLI, "Quantity");
}

export function parsePercentToBps(value: string | number): number {
  const basisPoints = scaledInteger(value, 2, 100_000, "Percentage");
  if (basisPoints > 100_000) throw new Error("Percentage is too large.");
  return basisPoints;
}

function roundedDivide(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / BigInt(2)) / denominator;
}

function safeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Calculated amount is too large.");
  return Number(value);
}

export function calculateFinanceLine(input: FinanceLineInput): FinanceLineTotals {
  if (!Number.isSafeInteger(input.quantityMilli) || input.quantityMilli <= 0) {
    throw new Error("Quantity must be greater than zero.");
  }
  if (!Number.isSafeInteger(input.unitRateMinor) || input.unitRateMinor < 0) {
    throw new Error("Rate cannot be negative.");
  }
  if (
    !Number.isSafeInteger(input.discountBps) ||
    input.discountBps < 0 ||
    input.discountBps > 10_000
  ) {
    throw new Error("Discount must be between 0 and 100 percent.");
  }
  if (!Number.isSafeInteger(input.taxBps) || input.taxBps < 0 || input.taxBps > 100_000) {
    throw new Error("Tax rate must be between 0 and 1,000 percent.");
  }

  const subtotal = roundedDivide(
    BigInt(input.quantityMilli) * BigInt(input.unitRateMinor),
    BigInt(1_000),
  );
  const discount = roundedDivide(subtotal * BigInt(input.discountBps), BigInt(10_000));
  const taxable = subtotal - discount;
  const tax = roundedDivide(taxable * BigInt(input.taxBps), BigInt(10_000));
  const total = taxable + tax;

  return {
    subtotalMinor: safeNumber(subtotal),
    discountMinor: safeNumber(discount),
    taxMinor: safeNumber(tax),
    totalMinor: safeNumber(total),
  };
}

export function calculateFinanceDocument(
  lines: readonly FinanceLineInput[],
): FinanceDocumentTotals {
  if (lines.length === 0) throw new Error("Add at least one line item.");

  return lines.reduce<FinanceDocumentTotals>(
    (totals, line) => {
      const calculated = calculateFinanceLine(line);
      totals.subtotalMinor += calculated.subtotalMinor;
      totals.discountMinor += calculated.discountMinor;
      totals.taxMinor += calculated.taxMinor;
      totals.totalMinor += calculated.totalMinor;
      totals.lineCount += 1;
      if (totals.totalMinor > MAX_SAFE_MINOR) throw new Error("Document total is too large.");
      return totals;
    },
    { subtotalMinor: 0, discountMinor: 0, taxMinor: 0, totalMinor: 0, lineCount: 0 },
  );
}

export function formatMinorMoney(amountMinor: number, currency: string, locale = "en-US"): string {
  const divisor = 10 ** currencyMinorUnits(currency);
  return getNumberFormatter(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: currencyMinorUnits(currency),
    maximumFractionDigits: currencyMinorUnits(currency),
  }).format(amountMinor / divisor);
}

export function summarizeFinanceTaxes(
  lines: readonly (Pick<FinanceLineTotals, "subtotalMinor" | "discountMinor" | "taxMinor"> & {
    taxBps: number;
  })[],
): FinanceTaxSummaryLine[] {
  const grouped = new Map<number, FinanceTaxSummaryLine>();
  for (const line of lines) {
    const current = grouped.get(line.taxBps) ?? {
      taxBps: line.taxBps,
      taxableMinor: 0,
      taxMinor: 0,
    };
    current.taxableMinor += line.subtotalMinor - line.discountMinor;
    current.taxMinor += line.taxMinor;
    grouped.set(line.taxBps, current);
  }
  return [...grouped.values()].sort((left, right) => left.taxBps - right.taxBps);
}
