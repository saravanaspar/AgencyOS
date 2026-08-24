import { describe, expect, it } from "vitest";

import {
  calculateFinanceDocument,
  calculateFinanceLine,
  currencyMinorUnits,
  formatMinorMoney,
  parseMoneyToMinor,
  parsePercentToBps,
  parseQuantityToMilli,
} from "@/modules/finance/calculations";
import {
  estimateCreateSchema,
  financeFiltersSchema,
  invoiceCreateSchema,
  paymentCreateSchema,
} from "@/modules/finance/schemas/finance";

const companyId = "11111111-1111-4111-8111-111111111111";
const invoiceId = "22222222-2222-4222-8222-222222222222";
const line = {
  catalogItemId: null,
  description: "Implementation services",
  quantity: "2.5",
  unitRate: "120.00",
  discountPercent: "10",
  taxPercent: "18",
};

describe("finance calculations and validation", () => {
  it("parses currencies using their correct minor-unit precision", () => {
    expect(currencyMinorUnits("USD")).toBe(2);
    expect(currencyMinorUnits("JPY")).toBe(0);
    expect(currencyMinorUnits("KWD")).toBe(3);
    expect(parseMoneyToMinor("19.95", "USD")).toBe(1995);
    expect(parseMoneyToMinor("19", "JPY")).toBe(19);
    expect(parseMoneyToMinor("19.125", "KWD")).toBe(19125);
    expect(() => parseMoneyToMinor("19.999", "USD")).toThrow(/at most 2 decimal places/i);
  });

  it("calculates quantity, discount, tax, and total with integer rounding", () => {
    const totals = calculateFinanceLine({
      quantityMilli: parseQuantityToMilli("2.5"),
      unitRateMinor: parseMoneyToMinor("120.00", "USD"),
      discountBps: parsePercentToBps("10"),
      taxBps: parsePercentToBps("18"),
    });

    expect(totals).toEqual({
      subtotalMinor: 30000,
      discountMinor: 3000,
      taxMinor: 4860,
      totalMinor: 31860,
    });
  });

  it("sums document totals from the same centralized line calculator", () => {
    const totals = calculateFinanceDocument([
      { quantityMilli: 1000, unitRateMinor: 10000, discountBps: 0, taxBps: 1800 },
      { quantityMilli: 500, unitRateMinor: 5000, discountBps: 1000, taxBps: 0 },
    ]);

    expect(totals).toEqual({
      subtotalMinor: 12500,
      discountMinor: 250,
      taxMinor: 1800,
      totalMinor: 14050,
      lineCount: 2,
    });
  });

  it("formats minor-unit totals without floating-point storage", () => {
    expect(formatMinorMoney(31860, "USD", "en-US")).toBe("$318.60");
  });

  it("rejects reversed estimate and invoice date ranges", () => {
    expect(
      estimateCreateSchema.safeParse({
        companyId,
        issueDate: "2026-08-10",
        expiryDate: "2026-08-09",
        currency: "USD",
        lines: [line],
      }).success,
    ).toBe(false);

    expect(
      invoiceCreateSchema.safeParse({
        companyId,
        issueDate: "2026-08-10",
        dueDate: "2026-08-09",
        servicePeriodStart: "2026-08-10",
        servicePeriodEnd: "2026-08-09",
        currency: "USD",
        lines: [line],
      }).success,
    ).toBe(false);
  });

  it("requires payments to include at least one bounded invoice allocation", () => {
    expect(
      paymentCreateSchema.safeParse({
        paymentDate: "2026-08-10",
        amount: "100.00",
        currency: "USD",
        paymentMethod: "bank_transfer",
        companyId,
        allocations: [],
      }).success,
    ).toBe(false);

    expect(
      paymentCreateSchema.safeParse({
        paymentDate: "2026-08-10",
        amount: "100.00",
        currency: "USD",
        paymentMethod: "bank_transfer",
        companyId,
        allocations: [{ invoiceId, amount: "100.00" }],
      }).success,
    ).toBe(true);
  });

  it("defaults finance filtering to invoices without trusting arbitrary tabs", () => {
    expect(financeFiltersSchema.parse({}).tab).toBe("invoices");
    expect(financeFiltersSchema.parse({ tab: "secrets" }).tab).toBe("invoices");
  });
});
