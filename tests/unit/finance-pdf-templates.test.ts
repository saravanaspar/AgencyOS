import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  compileFinanceDocumentHtml,
  financePdfStyleFromInvoiceSettings,
  invoiceNinjaTemplateCatalog,
} from "@/modules/finance/pdf";
import { invoiceNinjaTemplateIds, type FinancePdfInput } from "@/modules/finance/pdf/types";

const templateDirectory = path.join(
  process.cwd(),
  "src",
  "modules",
  "finance",
  "pdf",
  "templates",
  "invoice-ninja",
);

const sampleInput: FinancePdfInput = {
  documentType: "Invoice",
  documentNumber: "INV-2026-0042",
  issueDate: "2026-07-17",
  dueDate: "2026-08-16",
  currency: "INR",
  locale: "en-IN",
  seller: {
    name: "एजेंसी ओएस प्राइवेट लिमिटेड",
    address: "नई दिल्ली, भारत",
    taxIdentifiers: { GSTIN: "07AAAAA0000A1Z5" },
  },
  client: {
    name: "عميل دولي <script>alert(1)</script>",
    address: "دبي، الإمارات العربية المتحدة",
    email: "billing@example.com",
  },
  contactName: "José Client",
  paymentTerms: "30 days",
  paymentMethod: "bank_transfer",
  paymentReference: "BANK-REF-2026-42",
  notes: "Unicode stays intact: नमस्ते — مرحباً — café.",
  lines: [
    {
      description: "خدمات التصميم / Design services",
      quantityMilli: 1000,
      unitRateMinor: 125_000,
      discountBps: 0,
      taxBps: 1800,
      subtotalMinor: 125_000,
      discountMinor: 0,
      taxMinor: 22_500,
      totalMinor: 147_500,
    },
  ],
  totals: {
    subtotalMinor: 125_000,
    discountMinor: 0,
    taxMinor: 22_500,
    totalMinor: 147_500,
    lineCount: 1,
  },
};

describe("Invoice Ninja finance PDF templates", () => {
  it("ships every copied Invoice Ninja design with an integrity manifest", async () => {
    const manifest = JSON.parse(
      await readFile(path.join(templateDirectory, "SOURCE-MANIFEST.json"), "utf8"),
    ) as {
      version: string;
      commit: string;
      assets: Record<string, { sha256: string; bytes: number }>;
    };

    expect(manifest.version).toBe("v5.13.26");
    expect(manifest.commit).toBe("9a5325bd10141fe62b5d88f46d7acbe91b559e30");
    expect(invoiceNinjaTemplateCatalog.map((template) => template.id)).toEqual([
      ...invoiceNinjaTemplateIds,
    ]);

    for (const templateId of invoiceNinjaTemplateIds) {
      const fileName = `${templateId}.html`;
      const bytes = await readFile(path.join(templateDirectory, fileName));
      expect(manifest.assets[fileName]).toEqual({
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.length,
      });
    }

    for (const fileName of [
      "Roboto-Regular.ttf",
      "tech-hero-image.jpg",
      "ELASTIC-LICENSE-2.0.txt",
    ]) {
      const bytes = await readFile(path.join(templateDirectory, fileName));
      expect(manifest.assets[fileName]).toEqual({
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.length,
      });
    }
  });

  it("compiles Unicode content without creating an HTML injection sink", async () => {
    const compiled = await compileFinanceDocumentHtml({
      ...sampleInput,
      style: { templateId: "clean", direction: "rtl" },
    });

    expect(compiled.templateId).toBe("clean");
    expect(compiled.html).toContain("एजेंसी ओएस");
    expect(compiled.html).toContain("مرحباً");
    expect(compiled.html).toContain("café");
    expect(compiled.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(compiled.html).not.toContain("<script>alert(1)</script>");
    expect(compiled.html).not.toMatch(/\{[%{]|[%}]\}/);
  });

  it.each([
    ...invoiceNinjaTemplateCatalog
      .filter((template) => template.compatibleDocumentTypes.length > 0)
      .map((template) => [template.id, template.compatibleDocumentTypes[0]] as const),
  ])(
    "compiles the %s design for a supported finance document",
    async (templateId, documentType) => {
      const compiled = await compileFinanceDocumentHtml({
        ...sampleInput,
        documentType,
        style: { templateId },
      });

      expect(compiled.templateId).toBe(templateId);
      expect(compiled.html).toContain("INV-2026-0042");
      expect(compiled.html).not.toMatch(/\{[%{]|[%}]\}/);
    },
  );

  it("adapts native receipt, delivery-note, and statement content without a parallel renderer", async () => {
    const receipt = await compileFinanceDocumentHtml({
      ...sampleInput,
      documentType: "Payment Receipt",
      style: { templateId: "tidy_receipt" },
    });
    const deliveryNote = await compileFinanceDocumentHtml({
      ...sampleInput,
      style: { templateId: "fluid_delivery_note" },
    });
    const statement = await compileFinanceDocumentHtml({
      ...sampleInput,
      documentType: "Statement",
      style: { templateId: "vertical_statement" },
    });

    expect(receipt.html).toContain("bank transfer");
    expect(receipt.html).toContain("BANK-REF-2026-42");
    expect(receipt.html).toContain("agencyos-receipt-row");
    expect(deliveryNote.html).toContain("agencyos-delivery-table");
    expect(statement.html).toContain("agencyos-statement-table");
  });

  it("uses document-specific designs from the existing organization invoice settings", () => {
    const settings = {
      pdfStyle: { primaryColor: "#112233", pageSize: "Letter" },
      invoice: { templateId: "modern", direction: "rtl" },
      creditNote: { templateId: "crisp_refund" },
      paymentReceipt: { templateId: "swift_receipt" },
    };

    expect(financePdfStyleFromInvoiceSettings(settings, "Invoice")).toMatchObject({
      templateId: "modern",
      primaryColor: "#112233",
      pageSize: "Letter",
      direction: "rtl",
    });
    expect(financePdfStyleFromInvoiceSettings(settings, "Credit Note").templateId).toBe(
      "crisp_refund",
    );
    expect(financePdfStyleFromInvoiceSettings(settings, "Payment Receipt").templateId).toBe(
      "swift_receipt",
    );
    expect(financePdfStyleFromInvoiceSettings(settings, "Estimate").templateId).toBe("clean");
  });
});
