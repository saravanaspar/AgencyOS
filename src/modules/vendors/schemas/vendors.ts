import { z } from "zod";

import {
  purchaseOrderStatuses,
  purchaseRequestStatuses,
  receiptConditions,
  receiptStatuses,
  vendorBillStatuses,
  vendorContractRelationshipTypes,
  vendorNoteTypes,
  vendorRiskClassifications,
  vendorStatuses,
} from "@/modules/vendors/vendors";

const nullableUuid = z.preprocess((value) => (value === "" ? null : value), z.uuid().nullable());
const nullableString = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() ? value.trim() : null),
    z.string().max(max).nullable(),
  );
const nullableDate = z.preprocess(
  (value) => (value === "" ? null : value),
  z.iso.date().nullable(),
);
const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/);
const countrySchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() ? value.trim().toUpperCase() : null),
  z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable(),
);
const nonNegativeInteger = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positiveDecimal = z.coerce.number().positive().max(1_000_000);

export const vendorCategorySchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: nullableString(500),
});

export const vendorSchema = z.object({
  vendorId: nullableUuid,
  legalName: z.string().trim().min(2).max(180),
  displayName: z.string().trim().min(2).max(160),
  primaryCategoryId: nullableUuid,
  categoryIds: z.array(z.uuid()).max(30),
  status: z.enum(vendorStatuses),
  riskClassification: z.enum(vendorRiskClassifications),
  ownerMembershipId: nullableUuid,
  website: nullableString(500),
  email: nullableString(320),
  phone: nullableString(80),
  address: nullableString(1000),
  countryCode: countrySchema,
  defaultCurrency: currencySchema,
  paymentTermsDays: z.coerce.number().int().min(0).max(365),
  onboardingDate: nullableDate,
  nextReviewDate: nullableDate,
  taxCountryCode: countrySchema,
  taxIdentifier: nullableString(120),
  taxRegistrationName: nullableString(180),
  bankName: nullableString(160),
  bankAccountName: nullableString(160),
  bankAccountLastFour: z.preprocess(
    (value) => (typeof value === "string" && value.trim() ? value.trim() : null),
    z
      .string()
      .regex(/^[A-Za-z0-9]{2,8}$/)
      .nullable(),
  ),
  bankRoutingReference: nullableString(120),
  paymentInstructions: nullableString(2000),
});

export const vendorContactSchema = z.object({
  vendorId: z.uuid(),
  name: z.string().trim().min(2).max(160),
  roleTitle: nullableString(120),
  email: nullableString(320),
  phone: nullableString(80),
  isPrimary: z.boolean(),
});

export const vendorNoteSchema = z.object({
  vendorId: z.uuid(),
  noteType: z.enum(vendorNoteTypes),
  rating: z.preprocess(
    (value) => (value === "" || value === null ? null : value),
    z.coerce.number().int().min(1).max(5).nullable(),
  ),
  content: z.string().trim().min(3).max(4000),
});

export const vendorContractLinkSchema = z.object({
  vendorId: z.uuid(),
  contractId: z.uuid(),
  relationshipType: z.enum(vendorContractRelationshipTypes),
});

export const vendorDocumentLinkSchema = z.object({
  vendorId: z.uuid(),
  documentId: z.uuid(),
});

const purchaseRequestItemSchema = z.object({
  description: z.string().trim().min(2).max(500),
  specifications: nullableString(2000),
  quantity: z.number().positive().max(1_000_000),
  unit: z.string().trim().min(1).max(40),
  estimatedUnitPriceMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

export const purchaseRequestSchema = z.object({
  title: z.string().trim().min(3).max(180),
  businessJustification: z.string().trim().min(10).max(4000),
  departmentId: nullableUuid,
  projectId: nullableUuid,
  budgetMinor: nonNegativeInteger,
  currency: currencySchema,
  requiredByDate: nullableDate,
  items: z.array(purchaseRequestItemSchema).min(1).max(100),
});

export const purchaseRequestIdSchema = z.object({ purchaseRequestId: z.uuid() });

export const quotationSchema = z.object({
  purchaseRequestId: z.uuid(),
  vendorId: z.uuid(),
  quotationReference: z.string().trim().min(1).max(120),
  quotedOn: z.iso.date(),
  validUntil: nullableDate,
  subtotalMinor: nonNegativeInteger,
  taxMinor: nonNegativeInteger,
  shippingMinor: nonNegativeInteger,
  currency: currencySchema,
  leadTimeDays: z.preprocess(
    (value) => (value === "" || value === null ? null : value),
    z.coerce.number().int().min(0).max(3650).nullable(),
  ),
  paymentTerms: nullableString(1000),
  notes: nullableString(4000),
  sourceDocumentId: nullableUuid,
});

export const quotationSelectionSchema = z.object({
  purchaseRequestId: z.uuid(),
  quotationId: z.uuid(),
});

export const purchaseOrderSchema = z.object({
  purchaseRequestId: z.uuid(),
  issueDate: z.iso.date(),
  expectedDeliveryDate: nullableDate,
  contractId: nullableUuid,
  paymentTerms: nullableString(1000),
  deliveryAddress: nullableString(2000),
});

const receiptItemSchema = z.object({
  purchaseOrderItemId: z.uuid(),
  quantityReceived: positiveDecimal,
  condition: z.enum(receiptConditions),
  notes: nullableString(1000),
});

export const goodsReceiptSchema = z.object({
  purchaseOrderId: z.uuid(),
  receivedAt: z.iso.datetime({ offset: true }),
  deliveryReference: nullableString(160),
  status: z.enum(receiptStatuses),
  notes: nullableString(4000),
  items: z.array(receiptItemSchema).min(1).max(200),
});

export const vendorBillSchema = z.object({
  purchaseOrderId: z.uuid(),
  billReference: z.string().trim().min(1).max(160),
  invoiceDate: z.iso.date(),
  dueDate: nullableDate,
  subtotalMinor: nonNegativeInteger,
  taxMinor: nonNegativeInteger,
  currency: currencySchema,
  sourceDocumentId: nullableUuid,
});

export const vendorBillApprovalSchema = z.object({ billId: z.uuid() });

export const vendorBillPaymentSchema = z.object({
  billId: z.uuid(),
  status: z.enum(vendorBillStatuses),
  paymentReference: nullableString(200),
});

export const purchaseOrderDocumentLinkSchema = z.object({
  purchaseOrderId: z.uuid(),
  documentId: z.uuid(),
});

export const vendorFiltersSchema = z.object({
  q: z.string().trim().max(120).catch(""),
  vendorStatus: z.enum(["all", ...vendorStatuses]).catch("all"),
  requestStatus: z.enum(["all", ...purchaseRequestStatuses]).catch("all"),
  purchaseOrderStatus: z.enum(["all", ...purchaseOrderStatuses]).catch("all"),
});

export interface VendorActionState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string[]>;
}

export type VendorInput = z.infer<typeof vendorSchema>;
export type PurchaseRequestInput = z.infer<typeof purchaseRequestSchema>;
export type QuotationInput = z.infer<typeof quotationSchema>;
export type PurchaseOrderInput = z.infer<typeof purchaseOrderSchema>;
export type GoodsReceiptInput = z.infer<typeof goodsReceiptSchema>;
export type VendorBillInput = z.infer<typeof vendorBillSchema>;
