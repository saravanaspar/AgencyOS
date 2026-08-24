import { z } from "zod";

import {
  approvalStatuses,
  expensePaymentStatuses,
  expenseTypes,
  financeItemTypes,
  paymentMethods,
  reconciliationStatuses,
} from "@/modules/finance/finance";

function emptyToNull(value: unknown): unknown {
  return value === undefined || (typeof value === "string" && value.trim() === "") ? null : value;
}

function checkbox(value: unknown): unknown {
  return value === "on" || value === "true" || value === true;
}

function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

const uuid = z.uuid("Select a valid record.");
const optionalUuid = z.preprocess(emptyToNull, uuid.nullable());
const optionalText = (maximum: number) =>
  z.preprocess(emptyToNull, z.string().trim().max(maximum).nullable());
const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Use a three-letter currency code.");
const decimal = z
  .union([z.string(), z.number()])
  .transform(String)
  .pipe(
    z
      .string()
      .trim()
      .regex(/^\d+(?:\.\d+)?$/, "Enter a non-negative number."),
  );
const optionalDate = z.preprocess(emptyToNull, z.iso.date().nullable());
const optionalPositiveDecimal = z.preprocess(
  emptyToNull,
  decimal.refine((value) => Number(value) > 0, "Enter a value greater than zero.").nullable(),
);

export const financeFiltersSchema = z.object({
  q: z.string().trim().max(120).catch(""),
  tab: z
    .enum(["catalog", "estimates", "invoices", "credit_notes", "payments", "expenses", "reports"])
    .catch("invoices"),
  status: z.preprocess(emptyToNull, z.string().trim().max(40).nullable()).catch(null),
  company: z.preprocess(emptyToNull, uuid.nullable()).catch(null),
  from: z.preprocess(emptyToNull, z.iso.date().nullable()).catch(null),
  to: z.preprocess(emptyToNull, z.iso.date().nullable()).catch(null),
});

export const financeLineSchema = z.object({
  catalogItemId: optionalUuid,
  description: z.string().trim().min(1, "Enter a line description.").max(500),
  quantity: decimal,
  unitRate: decimal,
  discountPercent: decimal.default("0"),
  taxPercent: decimal.default("0"),
});

const lines = z.preprocess(
  jsonValue,
  z
    .array(financeLineSchema)
    .min(1, "Add at least one line item.")
    .max(50, "Use at most 50 line items."),
);

export const catalogItemCreateSchema = z.object({
  itemType: z.enum(financeItemTypes).default("service"),
  name: z.string().trim().min(2, "Enter an item name.").max(180),
  sku: optionalText(80),
  description: optionalText(2_000),
  unit: z.string().trim().min(1).max(40).default("each"),
  standardRate: decimal,
  taxCategory: z.string().trim().min(1).max(80).default("standard"),
  taxPercent: decimal.default("0"),
  currency,
  isActive: z.preprocess(checkbox, z.boolean()).default(true),
  defaultInvoiceDescription: optionalText(500),
});

export const catalogItemUpdateSchema = catalogItemCreateSchema.extend({ itemId: uuid });

export const catalogItemStatusSchema = z.object({
  itemId: uuid,
  isActive: z.preprocess(checkbox, z.boolean()),
});

const baseDocument = z.object({
  companyId: uuid,
  contactId: optionalUuid,
  projectId: optionalUuid,
  currency,
  notes: optionalText(4_000),
  terms: optionalText(4_000),
  internalNotes: optionalText(4_000),
  lines,
});

export const estimateCreateSchema = baseDocument
  .extend({
    issueDate: z.iso.date(),
    expiryDate: optionalDate,
  })
  .superRefine((value, context) => {
    if (value.expiryDate && value.expiryDate < value.issueDate) {
      context.addIssue({
        code: "custom",
        path: ["expiryDate"],
        message: "Expiry date cannot be before the issue date.",
      });
    }
  });

export const invoiceCreateSchema = baseDocument
  .extend({
    sourceEstimateId: optionalUuid,
    purchaseOrderReference: optionalText(120),
    exchangeRate: optionalPositiveDecimal,
    issueDate: optionalDate,
    dueDate: optionalDate,
    servicePeriodStart: optionalDate,
    servicePeriodEnd: optionalDate,
    bankDetails: optionalText(2_000),
  })
  .superRefine((value, context) => {
    if (value.issueDate && value.dueDate && value.dueDate < value.issueDate) {
      context.addIssue({
        code: "custom",
        path: ["dueDate"],
        message: "Due date cannot be before the issue date.",
      });
    }
    if (
      value.servicePeriodStart &&
      value.servicePeriodEnd &&
      value.servicePeriodEnd < value.servicePeriodStart
    ) {
      context.addIssue({
        code: "custom",
        path: ["servicePeriodEnd"],
        message: "Service period end cannot be before its start.",
      });
    }
  });

export const financeApprovalDecisionSchema = z.object({
  entityId: uuid,
  entityType: z.enum(["estimate", "invoice", "credit_note"]),
  decision: z.literal("submit"),
});

export const estimateClientDecisionSchema = z.object({
  estimateId: uuid,
  decision: z.enum(["accepted", "rejected"]),
  note: z.string().trim().min(3, "Record the client decision evidence.").max(2_000),
});

export const estimateConvertSchema = z.object({
  estimateId: uuid,
  issueDate: z.iso.date(),
  dueDate: z.iso.date(),
  purchaseOrderReference: optionalText(120),
  bankDetails: optionalText(2_000),
});

export const financeDocumentSnapshotSchema = z.object({
  entityType: z.enum(["estimate", "invoice", "credit_note", "payment_receipt"]),
  entityId: uuid,
});

export const financeDocumentEmailSchema = financeDocumentSnapshotSchema
  .omit({ entityType: true })
  .extend({
    entityType: z.enum(["estimate", "invoice", "credit_note"]),
    requestToken: uuid,
    recipientEmail: z.string().trim().email().max(320),
    subject: z.string().trim().min(1).max(240),
  });

export const invoiceIssueSchema = z.object({
  invoiceId: uuid,
  issueDate: z.iso.date(),
  dueDate: z.iso.date(),
});

export const invoiceVoidSchema = z.object({
  invoiceId: uuid,
  reason: z.string().trim().min(5, "Explain why the invoice is being voided.").max(1_000),
});

export const invoiceRevisionSchema = z
  .object({
    invoiceId: uuid,
    reason: z.string().trim().min(5, "Explain the correction.").max(1_000),
    issueDate: z.iso.date(),
    dueDate: z.iso.date(),
  })
  .superRefine((value, context) => {
    if (value.dueDate < value.issueDate) {
      context.addIssue({
        code: "custom",
        path: ["dueDate"],
        message: "Due date cannot be before the issue date.",
      });
    }
  });

export const creditNoteCreateSchema = z.object({
  originalInvoiceId: uuid,
  reason: z.string().trim().min(5, "Explain why the credit is required.").max(2_000),
  internalNotes: optionalText(4_000),
  lines,
});

export const creditNoteIssueSchema = z.object({
  creditNoteId: uuid,
  issueDate: z.iso.date(),
});

export const creditNoteVoidSchema = z.object({
  creditNoteId: uuid,
  reason: z.string().trim().min(5, "Explain why the credit note is being voided.").max(1_000),
});

export const paymentCreateSchema = z.object({
  paymentDate: z.iso.date(),
  amount: decimal,
  currency,
  paymentMethod: z.enum(paymentMethods),
  transactionReference: optionalText(160),
  bankAccount: optionalText(160),
  companyId: uuid,
  notes: optionalText(2_000),
  allocations: z.preprocess(
    jsonValue,
    z
      .array(
        z.object({
          invoiceId: uuid,
          amount: decimal,
        }),
      )
      .min(1, "Allocate the payment to at least one invoice.")
      .max(50),
  ),
});

export const invoiceStatusActionSchema = z
  .object({
    invoiceId: uuid,
    action: z.enum(["viewed", "disputed", "resolve_dispute"]),
    reason: optionalText(2_000),
  })
  .superRefine((value, context) => {
    if (value.action !== "viewed" && !value.reason) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "Record the dispute evidence or resolution.",
      });
    }
  });

export const paymentRefundSchema = z.object({
  paymentId: uuid,
  refundDate: z.iso.date(),
  amount: decimal.refine((value) => Number(value) > 0, "Enter a refund greater than zero."),
  refundMethod: z.enum(paymentMethods),
  transactionReference: optionalText(160),
  reason: z.string().trim().min(5, "Explain why the refund is required.").max(2_000),
});

export const paymentReconciliationSchema = z.object({
  paymentId: uuid,
  reconciliationStatus: z.enum(reconciliationStatuses),
});

export const expenseCategoryCreateSchema = z.object({
  name: z.string().trim().min(2, "Enter a category name.").max(120),
  code: optionalText(40),
  description: optionalText(1_000),
  defaultTaxPercent: decimal.default("0"),
  isActive: z.preprocess(checkbox, z.boolean()).default(true),
});

export const expenseCategoryStatusSchema = z.object({
  categoryId: uuid,
  isActive: z.preprocess(checkbox, z.boolean()),
});

const expenseAllocations = z.preprocess(
  jsonValue,
  z
    .array(
      z.object({
        projectId: uuid,
        amount: decimal.refine((value) => Number(value) > 0, "Enter an allocation amount."),
      }),
    )
    .max(25, "Use at most 25 project allocations."),
);

export const expenseCreateSchema = z
  .object({
    expenseType: z.enum(expenseTypes),
    categoryId: uuid,
    employeeMembershipId: optionalUuid,
    vendorName: optionalText(180),
    vendorReference: optionalText(160),
    expenseDate: z.iso.date(),
    currency,
    amount: decimal.refine((value) => Number(value) > 0, "Enter an amount greater than zero."),
    tax: decimal.default("0"),
    isBillable: z.preprocess(checkbox, z.boolean()).default(false),
    isReimbursable: z.preprocess(checkbox, z.boolean()).default(false),
    notes: optionalText(2_000),
    allocations: expenseAllocations.default([]),
  })
  .superRefine((value, context) => {
    if (value.expenseType === "employee" && !value.employeeMembershipId) {
      context.addIssue({
        code: "custom",
        path: ["employeeMembershipId"],
        message: "Select the employee who incurred this expense.",
      });
    }
    if (value.expenseType === "vendor" && !value.vendorName) {
      context.addIssue({
        code: "custom",
        path: ["vendorName"],
        message: "Enter the vendor name.",
      });
    }
    if (value.expenseType === "project" && value.allocations.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["allocations"],
        message: "Allocate a project expense to at least one project.",
      });
    }
  });

export const expenseApprovalDecisionSchema = z.object({
  expenseId: uuid,
  decision: z.literal("submit"),
});

export const expensePaymentStateSchema = z.object({
  expenseId: uuid,
  paymentStatus: z.enum(expensePaymentStatuses),
  paymentReference: optionalText(160),
});

export const financeApprovalStatusSchema = z.enum(approvalStatuses);

export interface FinanceActionState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string[]>;
  entityId?: string;
  duplicateOfId?: string;
}

export type FinanceFilters = z.infer<typeof financeFiltersSchema>;
function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseFinanceFilters(
  raw: Record<string, string | string[] | undefined>,
): FinanceFilters {
  const parsed = financeFiltersSchema.parse({
    q: firstValue(raw.q),
    tab: firstValue(raw.tab),
    status: firstValue(raw.status),
    company: firstValue(raw.company),
    from: firstValue(raw.from),
    to: firstValue(raw.to),
  });

  if (parsed.from && parsed.to && parsed.from > parsed.to) {
    return { ...parsed, from: null, to: null };
  }
  return parsed;
}

export type FinanceLineInputSchema = z.infer<typeof financeLineSchema>;
