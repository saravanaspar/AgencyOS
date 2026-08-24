import type { FinanceDocumentTotals } from "@/modules/finance/calculations";

export type FinancePdfDocumentType =
  "Estimate" | "Invoice" | "Credit Note" | "Payment Receipt" | "Statement";

export interface FinancePdfParty {
  name: string;
  address?: string | null;
  taxIdentifiers?: unknown;
  email?: string | null;
}

export interface FinancePdfLine {
  description: string;
  quantityMilli: number;
  unitRateMinor: number;
  discountBps: number;
  taxBps: number;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
}

export interface FinancePdfStyle {
  templateId?: string;
  primaryColor?: string;
  secondaryColor?: string;
  fontName?: string;
  fontSize?: string;
  pageSize?: "A4" | "Letter" | "Legal";
  pageLayout?: "portrait" | "landscape";
  globalMargin?: string;
  companyLogoSize?: string;
  companyLogoDataUri?: string | null;
  showPaidStamp?: boolean;
  direction?: "ltr" | "rtl";
}

export interface FinancePdfInput {
  documentType: FinancePdfDocumentType;
  documentNumber: string;
  issueDate: string;
  dueDate?: string | null;
  expiryDate?: string | null;
  currency: string;
  exchangeRate?: number | null;
  locale?: string;
  seller: FinancePdfParty;
  client: FinancePdfParty;
  contactName?: string | null;
  purchaseOrderReference?: string | null;
  reference?: string | null;
  paymentMethod?: string | null;
  paymentReference?: string | null;
  servicePeriod?: string | null;
  paymentTerms?: string | null;
  bankDetails?: string | null;
  notes?: string | null;
  terms?: string | null;
  lines: readonly FinancePdfLine[];
  totals: FinanceDocumentTotals;
  style?: FinancePdfStyle;
}

export interface CompiledFinanceDocument {
  html: string;
  templateId: InvoiceNinjaTemplateId;
  pageSize: "A4" | "Letter" | "Legal";
  landscape: boolean;
}

export interface RenderedFinancePdf {
  bytes: Buffer;
  sha256: string;
  fileName: string;
  templateId: InvoiceNinjaTemplateId;
}

export const invoiceNinjaTemplateIds = [
  "plain",
  "clean",
  "bold",
  "modern",
  "business",
  "creative",
  "elegant",
  "hipster",
  "playful",
  "tech",
  "calm",
  "exact_refund",
  "crisp_refund",
  "tidy_receipt",
  "swift_receipt",
  "fluid_delivery_note",
  "harmony_delivery_note",
  "basic_statement",
  "prime_statement",
  "vertical_statement",
] as const;

export type InvoiceNinjaTemplateId = (typeof invoiceNinjaTemplateIds)[number];
