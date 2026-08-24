import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { summarizeFinanceTaxes } from "@/modules/finance/calculations";
import { renderFinanceDocumentPdf } from "@/modules/finance/pdf";
import { buildFinanceDocumentEmailTemplate } from "@/modules/finance/server/document-delivery";
import {
  estimateClientDecisionSchema,
  estimateConvertSchema,
  financeDocumentEmailSchema,
} from "@/modules/finance/schemas/finance";

const estimateId = "11111111-1111-4111-8111-111111111111";
const requestToken = "22222222-2222-4222-8222-222222222222";

const lines = [
  {
    description: "Implementation services",
    quantityMilli: 2000,
    unitRateMinor: 10000,
    discountBps: 1000,
    taxBps: 1800,
    subtotalMinor: 20000,
    discountMinor: 2000,
    taxMinor: 3240,
    totalMinor: 21240,
  },
  {
    description: "Support",
    quantityMilli: 1000,
    unitRateMinor: 5000,
    discountBps: 0,
    taxBps: 1800,
    subtotalMinor: 5000,
    discountMinor: 0,
    taxMinor: 900,
    totalMinor: 5900,
  },
];

describe("finance document completion", () => {
  it("groups taxable values and tax by basis-point rate", () => {
    expect(summarizeFinanceTaxes(lines)).toEqual([
      { taxBps: 1800, taxableMinor: 23000, taxMinor: 4140 },
    ]);
  });

  it("renders a bounded PDF with a matching integrity hash", async () => {
    const rendered = await renderFinanceDocumentPdf({
      documentType: "Estimate",
      documentNumber: "EST-2026-0042",
      issueDate: "2026-07-16",
      expiryDate: "2026-08-15",
      currency: "USD",
      locale: "en-US",
      seller: { name: "AgencyOS Studio", taxIdentifiers: { VAT: "GB123" } },
      client: { name: "Client & Co", email: "billing@example.com" },
      contactName: "A. Client",
      paymentTerms: "30 days",
      lines,
      totals: {
        subtotalMinor: 25000,
        discountMinor: 2000,
        taxMinor: 4140,
        totalMinor: 27140,
        lineCount: 2,
      },
    });

    expect(rendered.fileName).toBe("EST-2026-0042.pdf");
    expect(rendered.bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(rendered.templateId).toBe("clean");
    expect(rendered.bytes.length).toBeLessThan(2 * 1024 * 1024);
    expect(createHash("sha256").update(rendered.bytes).digest("hex")).toBe(rendered.sha256);
  }, 60_000);

  it("requires evidence for a recorded client decision", () => {
    expect(
      estimateClientDecisionSchema.safeParse({
        estimateId,
        decision: "accepted",
        note: "ok",
      }).success,
    ).toBe(false);
    expect(
      estimateClientDecisionSchema.safeParse({
        estimateId,
        decision: "accepted",
        note: "Accepted by email on 16 July 2026.",
      }).success,
    ).toBe(true);
  });

  it("builds escaped calculated finance email templates", () => {
    const message = buildFinanceDocumentEmailTemplate({
      documentType: "Invoice",
      documentNumber: "INV-2026-0042",
      clientName: "Client <Billing>",
      currency: "USD",
      totalMinor: 27140,
      balanceMinor: 12000,
      dueDate: "2026-08-15",
    });

    expect(message.text).toContain("Total: $271.40.");
    expect(message.text).toContain("Balance due: $120.00.");
    expect(message.text).toContain("Due date: 2026-08-15.");
    expect(message.html).toContain("Client &lt;Billing&gt;");
    expect(message.html).not.toContain("Client <Billing>");
  });

  it("validates conversion dates and idempotent email request tokens", () => {
    expect(
      estimateConvertSchema.safeParse({
        estimateId,
        issueDate: "2026-07-16",
        dueDate: "2026-08-15",
      }).success,
    ).toBe(true);
    expect(
      financeDocumentEmailSchema.safeParse({
        entityType: "estimate",
        entityId: estimateId,
        requestToken,
        recipientEmail: "billing@example.com",
        subject: "Estimate EST-2026-0042",
      }).success,
    ).toBe(true);
    expect(
      financeDocumentEmailSchema.safeParse({
        entityType: "estimate",
        entityId: estimateId,
        requestToken: "retry-me",
        recipientEmail: "not-an-email",
        subject: "",
      }).success,
    ).toBe(false);
  });
});
