import * as cheerio from "cheerio";

import { formatMinorMoney } from "@/modules/finance/calculations";
import {
  getInvoiceNinjaTemplate,
  resolveInvoiceNinjaTemplateId,
  type InvoiceNinjaTemplateKind,
} from "@/modules/finance/pdf/catalog";
import {
  escapeHtml,
  safeCssColor,
  safeCssLength,
  safeFontFamily,
} from "@/modules/finance/pdf/html";
import { buildFinancePdfSections } from "@/modules/finance/pdf/sections";
import {
  loadInvoiceNinjaFontDataUri,
  loadInvoiceNinjaTechHeroDataUri,
  loadInvoiceNinjaTemplate,
} from "@/modules/finance/pdf/template-loader";
import type {
  CompiledFinanceDocument,
  FinancePdfInput,
  InvoiceNinjaTemplateId,
} from "@/modules/finance/pdf/types";

const transparentLogo =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIHZpZXdCb3g9IjAgMCAxIDEiPjwvc3ZnPg==";
const safeLogoPattern = /^data:image\/(?:png|jpeg|jpg|webp);base64,[a-z0-9+/=]+$/i;

function removeNinjaBlocks(template: string): string {
  let output = template;
  let previous = "";
  while (output !== previous) {
    previous = output;
    output = output.replace(/<ninja\b[^>]*>(?:(?!<ninja\b)[\s\S])*?<\/ninja>/gi, "");
  }
  return output.replace(/<\/?ninja\b[^>]*>/gi, "");
}

function replaceVariables(template: string, values: Readonly<Record<string, string>>): string {
  const tokens = Object.keys(values).sort((left, right) => right.length - left.length);
  let output = template;
  for (const token of tokens) output = output.replaceAll(token, values[token] ?? "");
  return output.replace(/\$[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/g, "");
}

function variableValues(
  input: FinancePdfInput,
  templateId: InvoiceNinjaTemplateId,
  fontDataUri: string,
  techHeroDataUri: string,
): Record<string, string> {
  const locale = input.locale ?? "en-US";
  const style = input.style ?? {};
  const primaryColor = safeCssColor(style.primaryColor, "#1f3c88");
  const secondaryColor = safeCssColor(style.secondaryColor, "#dbe5f7");
  const fontName = safeFontFamily(style.fontName);
  const fontSize = safeCssLength(style.fontSize, "10px");
  const pageSize = ["A4", "Letter", "Legal"].includes(style.pageSize ?? "")
    ? String(style.pageSize)
    : "A4";
  const pageLayout = style.pageLayout === "landscape" ? "landscape" : "portrait";
  const companyLogo =
    style.companyLogoDataUri && safeLogoPattern.test(style.companyLogoDataUri)
      ? style.companyLogoDataUri
      : transparentLogo;
  const fontCss = `@font-face{font-family:${JSON.stringify(fontName)};src:url(${fontDataUri}) format('truetype');font-style:normal;font-weight:100 900;font-display:swap;}`;
  const fontUrl = `data:text/css;charset=utf-8,${encodeURIComponent(fontCss)}`;
  const amount = formatMinorMoney(input.totals.totalMinor, input.currency, locale);
  const dueDate = input.dueDate ?? input.expiryDate ?? "";
  const vatNumber = (() => {
    if (!input.seller.taxIdentifiers || typeof input.seller.taxIdentifiers !== "object") return "";
    const values = Object.values(input.seller.taxIdentifiers as Record<string, unknown>);
    return values.find((value) => typeof value === "string")?.toString() ?? "";
  })();

  return {
    "$company.logo": companyLogo,
    "$company.name": escapeHtml(input.seller.name),
    "$client.name": escapeHtml(input.client.name),
    "$client.number": "",
    "$invoice.date": escapeHtml(input.issueDate),
    "$invoice.po_number": escapeHtml(input.purchaseOrderReference ?? ""),
    "$invoice.public_notes": escapeHtml(input.notes ?? ""),
    "$payment.date": escapeHtml(input.issueDate),
    "$payment.method": escapeHtml(input.paymentMethod ?? ""),
    "$payment.transaction_reference": escapeHtml(input.paymentReference ?? ""),
    $font_url: fontUrl,
    $font_name: fontName,
    $font_sizepx: fontSize,
    $font_size: fontSize,
    $primary_color: primaryColor,
    $secondary_color: secondaryColor,
    $company_logo_size: safeCssLength(style.companyLogoSize, "120px"),
    $global_margin: safeCssLength(style.globalMargin, "15mm"),
    $page_size: pageSize,
    $page_layout: pageLayout,
    $dir_text_align: style.direction === "rtl" ? "right" : "left",
    $dir: style.direction === "rtl" ? "rtl" : "ltr",
    $show_shipping_address_visibility: input.client.address ? "visible" : "hidden",
    $show_shipping_address_block: input.client.address ? "block" : "none",
    $show_shipping_address: input.client.address ? "flex" : "none",
    $show_paid_stamp: style.showPaidStamp ? "block" : "none",
    $status_logo: "",
    $entity_images: "",
    $verifactu_qr_code: "",
    $entity_footer: "Generated from an immutable AgencyOS finance snapshot.",
    $entity_label: escapeHtml(input.documentType),
    $entity_issued_to_label: escapeHtml(`${input.documentType} issued to`),
    $entity_number: escapeHtml(input.documentNumber),
    $entity_number_label: escapeHtml(`${input.documentType} #`),
    $number: escapeHtml(input.documentNumber),
    $date: escapeHtml(input.issueDate),
    $due_date: escapeHtml(dueDate),
    $payment_due: escapeHtml(dueDate),
    $balance_due: escapeHtml(amount),
    $amount_due: escapeHtml(amount),
    $amount: escapeHtml(amount),
    $public_notes: escapeHtml(input.notes ?? ""),
    $vat_number: escapeHtml(vatNumber),
    $tech_hero_image: techHeroDataUri,
    $start_date: escapeHtml(input.issueDate),
    $end_date: escapeHtml(dueDate || input.issueDate),
    $receipt_label: "Receipt",
    $refund_label: "Credit Note",
    $delivery_note_label: "Delivery Note",
    $statement_label: "Statement",
    $from_label: "from",
    $to_label: "To",
    $client_label: "Client",
    $ship_to_label: "Ship to",
    $shipping_label: "Shipping",
    $details_label: "Details",
    $date_label: "Date",
    $payment_due_label: "Payment due",
    $amount_due_label: "Amount due",
    $amount_paid_label: "Amount paid",
    $amount_label: "Amount",
    $number_label: "Number",
    $method_label: "Method",
    $reference_label: "Reference",
    $total_label: "Total",
    $invoice_label: "Invoice",
    $invoices_label: "Invoices",
    $item_label: "Item",
    $description_label: "Description",
    $quantity_label: "Quantity",
    $notes_label: "Notes",
    $order_number_label: "Order number",
    $vat_number_label: "Tax number",
    $refunded_label: "Refunded",
    $payments_label: "Payments",
    $credit_label: "Credit",
    $net_label: "Net",
    $balance_label: "Balance",
    $payment: templateId.includes("receipt") ? amount : "",
  };
}

function setHtml($: cheerio.CheerioAPI, selector: string, html: string): boolean {
  const element = $(selector);
  if (!element.length) return false;
  element.first().html(html);
  return true;
}

function normalizedPaymentMethod(input: FinancePdfInput): string {
  return (input.paymentMethod ?? "").replaceAll("_", " ").trim();
}

function insertReceiptContent($: cheerio.CheerioAPI, input: FinancePdfInput): void {
  const locale = input.locale ?? "en-US";
  const amount = formatMinorMoney(input.totals.totalMinor, input.currency, locale);
  const paymentMethod = normalizedPaymentMethod(input) || "Not specified";
  const receiptRow = `<div class="four-col-grid bottom-border agencyos-receipt-row" style="padding:2px;">
<div><p class="primary-color-highlight">#${escapeHtml(input.documentNumber)}</p></div>
<div><p>${escapeHtml(input.issueDate)}</p></div>
<div><p>${escapeHtml(paymentMethod)}</p></div>
<div><p>${escapeHtml(amount)}</p></div>
</div>`;
  const receiptHeader = $(".four-col-grid")
    .filter((_, element) => {
      const text = $(element).text();
      return text.includes("Number") && text.includes("Date") && text.includes("Amount");
    })
    .first();

  if (receiptHeader.length) {
    const referenceRow = input.paymentReference
      ? `<div class="agencyos-receipt-reference">Reference: ${escapeHtml(input.paymentReference)}</div>`
      : "";
    receiptHeader.after(`${receiptRow}${referenceRow}`);
    if (!$("h1").length) {
      $("body").prepend(
        `<h1 class="agencyos-special-title primary-color-highlight">${escapeHtml(input.documentType)} #${escapeHtml(input.documentNumber)}</h1>`,
      );
    }
    return;
  }

  const methodLabel = $("td")
    .filter((_, element) => $(element).text().trim().toLowerCase() === "method")
    .first();
  const methodTable = methodLabel.closest("table");
  const methodValue = methodTable.find("tbody > tr").eq(1).find("td").first();
  if (methodValue.length) methodValue.text(paymentMethod);

  const detailPanel = `<section class="agencyos-receipt-panel">
<strong>${escapeHtml(input.documentNumber)}</strong> · ${escapeHtml(input.issueDate)} · ${escapeHtml(amount)}
${input.paymentReference ? `<div>Reference: ${escapeHtml(input.paymentReference)}</div>` : ""}
</section>`;
  $("body").append(detailPanel);
}

function insertSpecialTemplateContent(
  $: cheerio.CheerioAPI,
  kind: InvoiceNinjaTemplateKind,
  input: FinancePdfInput,
  sections: ReturnType<typeof buildFinancePdfSections>,
): boolean {
  if (kind === "receipt") {
    insertReceiptContent($, input);
    return true;
  }

  if (kind === "refund") {
    if (!$("h1").length) {
      $("body").prepend(
        `<h1 class="agencyos-special-title primary-color-highlight">${escapeHtml(input.documentType)} #${escapeHtml(input.documentNumber)}</h1>`,
      );
    }
    return false;
  }

  if (kind === "delivery_note") {
    const notesContainer = $(".container").first();
    if (notesContainer.length) notesContainer.before(sections.deliveryTable);
    else $("body").append(sections.deliveryTable);
    return true;
  }

  if (kind === "statement") {
    const verticalContent = $(".vertical-second > div").last();
    if (verticalContent.length) verticalContent.append(sections.statementTable);
    else {
      const statementDetails = $("#statement-details").first();
      if (statementDetails.length) statementDetails.after(sections.statementTable);
      else $("body").append(sections.statementTable);
    }
    return true;
  }

  return false;
}

function removeEmptyOptionalSections($: cheerio.CheerioAPI): void {
  for (const selector of [
    "#vendor-details",
    "#task-table",
    "#delivery-note-table",
    "#statement-invoice-table",
    "#statement-payment-table",
    "#statement-credit-table",
    "#statement-aging-table",
    "#statement-unapplied-payment-table",
    "[data-ref='statement-totals']",
  ]) {
    $(selector).each((_, element) => {
      if (!$(element).text().trim() && !$(element).children().length) $(element).remove();
    });
  }
}

function addAgencyOsPrintStyles($: cheerio.CheerioAPI): void {
  const css = `
*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;box-sizing:border-box}
html,body{max-width:100%;overflow-wrap:anywhere}
.agencyos-document-summary{margin:24px auto;max-width:900px;padding:0 24px;font-family:Roboto,Helvetica,sans-serif;color:#1f2937}
.agencyos-document-summary h2{margin:0 0 16px}
.agencyos-entity-details,.agencyos-product-table{width:100%;border-collapse:collapse;margin-bottom:16px}
.agencyos-entity-details th,.agencyos-entity-details td,.agencyos-product-table th,.agencyos-product-table td{padding:8px;border-bottom:1px solid #d1d5db;text-align:left;vertical-align:top}
.agencyos-table-totals{display:grid;grid-template-columns:minmax(0,1fr) minmax(240px,.6fr);gap:24px}
.agencyos-table-totals .totals-table-right-side>div{display:grid;grid-template-columns:1fr auto;gap:16px;padding:4px 0}
.agencyos-special-title{margin:0 0 18px;font-family:Roboto,Helvetica,sans-serif}
.agencyos-receipt-panel{margin:24px auto;max-width:720px;padding:16px;border:1px solid #d1d5db;border-radius:6px;text-align:center;font-family:Roboto,Helvetica,sans-serif}
.agencyos-receipt-reference{padding:6px 2px;text-align:right}
.agencyos-delivery-table,.agencyos-statement-table{width:100%;border-collapse:collapse;margin:20px 0}
.agencyos-delivery-table th,.agencyos-delivery-table td,.agencyos-statement-table th,.agencyos-statement-table td{padding:8px;border-bottom:1px solid #d1d5db;text-align:left}
`;
  $("head").append(`<style id="agencyos-print-style">${css}</style>`);
}

export async function compileFinanceDocumentHtml(
  input: FinancePdfInput,
): Promise<CompiledFinanceDocument> {
  if (!input.lines.length) throw new Error("Finance PDF requires at least one line item.");

  const templateId = resolveInvoiceNinjaTemplateId(input.documentType, input.style?.templateId);
  const definition = getInvoiceNinjaTemplate(templateId);
  const [template, fontDataUri, techHeroDataUri] = await Promise.all([
    loadInvoiceNinjaTemplate(templateId),
    loadInvoiceNinjaFontDataUri(),
    loadInvoiceNinjaTechHeroDataUri(),
  ]);
  const replaced = replaceVariables(
    template,
    variableValues(input, templateId, fontDataUri, techHeroDataUri),
  );
  const templateWithoutNinjaBlocks = removeNinjaBlocks(replaced);
  const $ = cheerio.load(templateWithoutNinjaBlocks);
  const sections = buildFinancePdfSections(input);

  $("ninja").remove();
  setHtml($, "#company-details", sections.companyDetails);
  setHtml($, "#company-address", sections.companyAddress);
  setHtml($, "#client-details", sections.clientDetails);
  setHtml($, "#shipping-details", sections.shippingDetails);
  setHtml($, "#entity-details", sections.entityDetails);
  const productTableInjected = setHtml($, "#product-table", sections.productTable);
  setHtml($, "#table-totals", sections.tableTotals);
  $("[data-ref='total_table-footer'],[data-ref='footer_content']").html(
    escapeHtml(sections.footer),
  );

  const specialContentInjected = insertSpecialTemplateContent($, definition.kind, input, sections);
  if (!productTableInjected && !specialContentInjected) {
    $("body").append(sections.fallbackSummary);
  }

  removeEmptyOptionalSections($);
  addAgencyOsPrintStyles($);
  $("head").prepend(`<meta charset="utf-8"><title>${escapeHtml(input.documentNumber)}</title>`);
  $("html").attr("lang", input.locale?.split("-")[0] ?? "en");
  $("html").attr("dir", input.style?.direction === "rtl" ? "rtl" : "ltr");

  const html = `<!doctype html>${$.html()}`;
  if (/\{[%{]|[%}]\}/.test(html))
    throw new Error("Invoice Ninja template contains unresolved markup.");

  return {
    html,
    templateId,
    pageSize: input.style?.pageSize ?? "A4",
    landscape: input.style?.pageLayout === "landscape",
  };
}
