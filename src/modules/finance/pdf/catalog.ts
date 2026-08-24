import {
  invoiceNinjaTemplateIds,
  type FinancePdfDocumentType,
  type FinancePdfStyle,
  type InvoiceNinjaTemplateId,
} from "@/modules/finance/pdf/types";

export type InvoiceNinjaTemplateKind =
  "document" | "refund" | "receipt" | "delivery_note" | "statement";

export interface InvoiceNinjaTemplateDefinition {
  id: InvoiceNinjaTemplateId;
  label: string;
  kind: InvoiceNinjaTemplateKind;
  compatibleDocumentTypes: readonly FinancePdfDocumentType[];
}

const allFinanceDocuments: readonly FinancePdfDocumentType[] = [
  "Estimate",
  "Invoice",
  "Credit Note",
  "Payment Receipt",
];
const invoiceDocuments: readonly FinancePdfDocumentType[] = ["Estimate", "Invoice", "Credit Note"];
const statementDocuments: readonly FinancePdfDocumentType[] = ["Statement"];

export const invoiceNinjaTemplateCatalog: readonly InvoiceNinjaTemplateDefinition[] = [
  { id: "plain", label: "Plain", kind: "document", compatibleDocumentTypes: allFinanceDocuments },
  { id: "clean", label: "Clean", kind: "document", compatibleDocumentTypes: allFinanceDocuments },
  { id: "bold", label: "Bold", kind: "document", compatibleDocumentTypes: allFinanceDocuments },
  { id: "modern", label: "Modern", kind: "document", compatibleDocumentTypes: allFinanceDocuments },
  {
    id: "business",
    label: "Business",
    kind: "document",
    compatibleDocumentTypes: allFinanceDocuments,
  },
  {
    id: "creative",
    label: "Creative",
    kind: "document",
    compatibleDocumentTypes: allFinanceDocuments,
  },
  {
    id: "elegant",
    label: "Elegant",
    kind: "document",
    compatibleDocumentTypes: allFinanceDocuments,
  },
  {
    id: "hipster",
    label: "Hipster",
    kind: "document",
    compatibleDocumentTypes: allFinanceDocuments,
  },
  {
    id: "playful",
    label: "Playful",
    kind: "document",
    compatibleDocumentTypes: allFinanceDocuments,
  },
  { id: "tech", label: "Tech", kind: "document", compatibleDocumentTypes: allFinanceDocuments },
  { id: "calm", label: "Calm", kind: "document", compatibleDocumentTypes: allFinanceDocuments },
  {
    id: "exact_refund",
    label: "Exact refund",
    kind: "refund",
    compatibleDocumentTypes: ["Credit Note"],
  },
  {
    id: "crisp_refund",
    label: "Crisp refund",
    kind: "refund",
    compatibleDocumentTypes: ["Credit Note"],
  },
  {
    id: "tidy_receipt",
    label: "Tidy receipt",
    kind: "receipt",
    compatibleDocumentTypes: ["Payment Receipt"],
  },
  {
    id: "swift_receipt",
    label: "Swift receipt",
    kind: "receipt",
    compatibleDocumentTypes: ["Payment Receipt"],
  },
  {
    id: "fluid_delivery_note",
    label: "Fluid delivery note",
    kind: "delivery_note",
    compatibleDocumentTypes: invoiceDocuments,
  },
  {
    id: "harmony_delivery_note",
    label: "Harmony delivery note",
    kind: "delivery_note",
    compatibleDocumentTypes: invoiceDocuments,
  },
  {
    id: "basic_statement",
    label: "Basic statement",
    kind: "statement",
    compatibleDocumentTypes: statementDocuments,
  },
  {
    id: "prime_statement",
    label: "Prime statement",
    kind: "statement",
    compatibleDocumentTypes: statementDocuments,
  },
  {
    id: "vertical_statement",
    label: "Vertical statement",
    kind: "statement",
    compatibleDocumentTypes: statementDocuments,
  },
] as const;

const definitions = new Map(invoiceNinjaTemplateCatalog.map((template) => [template.id, template]));
const templateIdSet = new Set<string>(invoiceNinjaTemplateIds);

const defaultTemplates: Record<FinancePdfDocumentType, InvoiceNinjaTemplateId> = {
  Estimate: "clean",
  Invoice: "clean",
  "Credit Note": "exact_refund",
  "Payment Receipt": "tidy_receipt",
  Statement: "basic_statement",
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function pageSizeValue(value: unknown): FinancePdfStyle["pageSize"] | undefined {
  return value === "A4" || value === "Letter" || value === "Legal" ? value : undefined;
}

function pageLayoutValue(value: unknown): FinancePdfStyle["pageLayout"] | undefined {
  return value === "portrait" || value === "landscape" ? value : undefined;
}

function styleValue(
  documentSettings: Record<string, unknown>,
  sharedStyle: Record<string, unknown>,
  camelCaseKey: string,
  snakeCaseKey: string,
): unknown {
  return (
    documentSettings[camelCaseKey] ??
    documentSettings[snakeCaseKey] ??
    sharedStyle[camelCaseKey] ??
    sharedStyle[snakeCaseKey]
  );
}

function documentSettingsKey(documentType: FinancePdfDocumentType): string {
  if (documentType === "Credit Note") return "creditNote";
  if (documentType === "Payment Receipt") return "paymentReceipt";
  return documentType.toLowerCase();
}

export function isInvoiceNinjaTemplateId(value: unknown): value is InvoiceNinjaTemplateId {
  return typeof value === "string" && templateIdSet.has(value);
}

export function getInvoiceNinjaTemplate(
  templateId: InvoiceNinjaTemplateId,
): InvoiceNinjaTemplateDefinition {
  const template = definitions.get(templateId);
  if (!template) throw new Error(`Unknown Invoice Ninja template: ${templateId}`);
  return template;
}

export function resolveInvoiceNinjaTemplateId(
  documentType: FinancePdfDocumentType,
  requestedTemplateId: unknown,
): InvoiceNinjaTemplateId {
  if (isInvoiceNinjaTemplateId(requestedTemplateId)) {
    const requested = getInvoiceNinjaTemplate(requestedTemplateId);
    if (requested.compatibleDocumentTypes.includes(documentType)) return requested.id;
  }
  return defaultTemplates[documentType];
}

export function financePdfStyleFromInvoiceSettings(
  invoiceSettings: unknown,
  documentType: FinancePdfDocumentType,
): FinancePdfStyle {
  const root = objectValue(invoiceSettings);
  const documentSettings = objectValue(root[documentSettingsKey(documentType)]);
  const sharedStyle = objectValue(root.pdfStyle ?? root.pdf_style);
  const templateId =
    documentSettings.templateId ??
    documentSettings.template_id ??
    root.templateId ??
    root.template_id ??
    root.design;

  const primaryColor = styleValue(documentSettings, sharedStyle, "primaryColor", "primary_color");
  const secondaryColor = styleValue(
    documentSettings,
    sharedStyle,
    "secondaryColor",
    "secondary_color",
  );
  const fontName = styleValue(documentSettings, sharedStyle, "fontName", "font_name");
  const fontSize = styleValue(documentSettings, sharedStyle, "fontSize", "font_size");
  const pageSize = styleValue(documentSettings, sharedStyle, "pageSize", "page_size");
  const pageLayout = styleValue(documentSettings, sharedStyle, "pageLayout", "page_layout");
  const globalMargin = styleValue(documentSettings, sharedStyle, "globalMargin", "global_margin");
  const companyLogoSize = styleValue(
    documentSettings,
    sharedStyle,
    "companyLogoSize",
    "company_logo_size",
  );
  const showPaidStamp = styleValue(
    documentSettings,
    sharedStyle,
    "showPaidStamp",
    "show_paid_stamp",
  );
  const direction = styleValue(documentSettings, sharedStyle, "direction", "direction");

  return {
    templateId: resolveInvoiceNinjaTemplateId(documentType, templateId),
    primaryColor: optionalString(primaryColor),
    secondaryColor: optionalString(secondaryColor),
    fontName: optionalString(fontName),
    fontSize: optionalString(fontSize),
    pageSize: pageSizeValue(pageSize),
    pageLayout: pageLayoutValue(pageLayout),
    globalMargin: optionalString(globalMargin),
    companyLogoSize: optionalString(companyLogoSize),
    showPaidStamp: typeof showPaidStamp === "boolean" ? showPaidStamp : undefined,
    direction: direction === "rtl" ? "rtl" : "ltr",
  };
}
