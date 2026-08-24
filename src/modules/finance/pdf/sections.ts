import { formatMinorMoney, summarizeFinanceTaxes } from "@/modules/finance/calculations";
import { escapeHtml, paragraphs } from "@/modules/finance/pdf/html";
import type { FinancePdfInput } from "@/modules/finance/pdf/types";

function formatQuantity(quantityMilli: number, locale: string): string {
  return (quantityMilli / 1_000).toLocaleString(locale, { maximumFractionDigits: 3 });
}

function formatRate(bps: number): string {
  return `${(bps / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}

function formatTaxIdentifiers(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => formatTaxIdentifiers(entry));
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
      const text = entry === null || entry === undefined ? "" : String(entry).trim();
      return text ? [`${key}: ${text}`] : [];
    });
  }
  return [String(value)];
}

function partyDetails(input: FinancePdfInput, party: "seller" | "client"): string {
  const value = input[party];
  const rows = [`<p><strong>${escapeHtml(value.name)}</strong></p>`];
  if (party === "client" && input.contactName) rows.push(`<p>${escapeHtml(input.contactName)}</p>`);
  if (value.email) rows.push(`<p>${escapeHtml(value.email)}</p>`);
  for (const identifier of formatTaxIdentifiers(value.taxIdentifiers)) {
    rows.push(`<p>${escapeHtml(identifier)}</p>`);
  }
  return rows.join("");
}

function entityDetails(input: FinancePdfInput): string {
  const rows: Array<[string, string | number | null | undefined]> = [
    [`${input.documentType} #`, input.documentNumber],
    ["Issue date", input.issueDate],
    [
      input.documentType === "Estimate" ? "Expiry date" : "Due date",
      input.expiryDate ?? input.dueDate,
    ],
    ["Purchase order", input.purchaseOrderReference],
    ["Reference", input.reference],
    ["Service period", input.servicePeriod],
    ["Currency", input.currency],
    ["Exchange rate", input.exchangeRate],
  ];

  return `<tbody>${rows
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim())
    .map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join("")}</tbody>`;
}

function productTable(input: FinancePdfInput): string {
  const locale = input.locale ?? "en-US";
  return `<thead><tr><th data-ref="product_table-product.description-th">Description</th><th>Quantity</th><th>Rate</th><th>Discount</th><th>Tax</th><th class="right-radius">Amount</th></tr></thead><tbody>${input.lines
    .map(
      (line) => `<tr>
<td data-ref="product_table-product.description-td">${escapeHtml(line.description)}</td>
<td>${escapeHtml(formatQuantity(line.quantityMilli, locale))}</td>
<td>${escapeHtml(formatMinorMoney(line.unitRateMinor, input.currency, locale))}</td>
<td>${escapeHtml(formatRate(line.discountBps))}</td>
<td>${escapeHtml(formatRate(line.taxBps))}</td>
<td class="right-radius" data-ref="product_table-product.line_total-td">${escapeHtml(formatMinorMoney(line.totalMinor, input.currency, locale))}</td>
</tr>`,
    )
    .join("")}</tbody>`;
}

function totals(input: FinancePdfInput): string {
  const locale = input.locale ?? "en-US";
  const leftRows = [
    input.notes
      ? `<div data-ref="total_table-public_notes"><strong>Notes</strong>${paragraphs(input.notes)}</div>`
      : "",
    input.terms
      ? `<div data-ref="total_table-terms"><strong data-ref="total_table-terms-label">Terms</strong>${paragraphs(input.terms)}</div>`
      : "",
    input.paymentTerms
      ? `<div><strong>Payment terms</strong>${paragraphs(input.paymentTerms)}</div>`
      : "",
    input.bankDetails
      ? `<div><strong>Payment details</strong>${paragraphs(input.bankDetails)}</div>`
      : "",
  ].join("");

  const rightRows: Array<[string, number]> = [
    ["Subtotal", input.totals.subtotalMinor],
    ["Discount", input.totals.discountMinor],
    ["Tax", input.totals.taxMinor],
    ["Total", input.totals.totalMinor],
  ];

  const taxes = summarizeFinanceTaxes(input.lines)
    .map(
      (tax) =>
        `<div><span>${escapeHtml(formatRate(tax.taxBps))} tax on ${escapeHtml(formatMinorMoney(tax.taxableMinor, input.currency, locale))}</span><span>${escapeHtml(formatMinorMoney(tax.taxMinor, input.currency, locale))}</span></div>`,
    )
    .join("");

  return `<div class="totals-table-left-side">${leftRows}</div><div class="totals-table-right-side">${rightRows
    .map(
      ([label, amount]) =>
        `<div data-ref="total_table-${label.toLowerCase()}"><span>${escapeHtml(label)}</span><span><strong>${escapeHtml(formatMinorMoney(amount, input.currency, locale))}</strong></span></div>`,
    )
    .join("")}${taxes}</div>`;
}

function deliveryTable(input: FinancePdfInput): string {
  const locale = input.locale ?? "en-US";
  return `<table class="agencyos-delivery-table"><thead><tr><th>Item #</th><th>Description</th><th>Quantity</th></tr></thead><tbody>${input.lines
    .map(
      (line, index) =>
        `<tr><td>${index + 1}</td><td>${escapeHtml(line.description)}</td><td>${escapeHtml(formatQuantity(line.quantityMilli, locale))}</td></tr>`,
    )
    .join("")}</tbody></table>`;
}

function statementTable(input: FinancePdfInput): string {
  const locale = input.locale ?? "en-US";
  return `<table class="agencyos-statement-table"><thead><tr><th>Date</th><th>Description</th><th>Amount</th></tr></thead><tbody>${input.lines
    .map(
      (line) =>
        `<tr><td>${escapeHtml(input.issueDate)}</td><td>${escapeHtml(line.description)}</td><td>${escapeHtml(formatMinorMoney(line.totalMinor, input.currency, locale))}</td></tr>`,
    )
    .join(
      "",
    )}</tbody><tfoot><tr><th colspan="2">Balance</th><th>${escapeHtml(formatMinorMoney(input.totals.totalMinor, input.currency, locale))}</th></tr></tfoot></table>`;
}

export interface FinancePdfSections {
  companyDetails: string;
  companyAddress: string;
  clientDetails: string;
  shippingDetails: string;
  entityDetails: string;
  productTable: string;
  tableTotals: string;
  footer: string;
  fallbackSummary: string;
  deliveryTable: string;
  statementTable: string;
}

export function buildFinancePdfSections(input: FinancePdfInput): FinancePdfSections {
  const fallbackSummary = `<section class="agencyos-document-summary">
<h2>${escapeHtml(input.documentType)} ${escapeHtml(input.documentNumber)}</h2>
<table class="agencyos-entity-details">${entityDetails(input)}</table>
<table class="agencyos-product-table">${productTable(input)}</table>
<div class="agencyos-table-totals">${totals(input)}</div>
</section>`;

  return {
    companyDetails: partyDetails(input, "seller"),
    companyAddress: paragraphs(input.seller.address),
    clientDetails: partyDetails(input, "client"),
    shippingDetails: paragraphs(input.client.address),
    entityDetails: entityDetails(input),
    productTable: productTable(input),
    tableTotals: totals(input),
    footer: "Generated from an immutable AgencyOS finance snapshot.",
    fallbackSummary,
    deliveryTable: deliveryTable(input),
    statementTable: statementTable(input),
  };
}
