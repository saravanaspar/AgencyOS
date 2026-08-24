import { z } from "zod";

const entityId = z.uuid();
const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/);
const moneyText = z
  .string()
  .trim()
  .regex(/^\d+(?:\.\d{1,3})?$/)
  .max(30);

export const salaryRevisionSchema = z.object({
  membershipId: entityId,
  currency,
  baseSalary: moneyText,
  effectiveFrom: z.iso.date(),
  allowances: z.string().max(6000).default(""),
  deductions: z.string().max(6000).default(""),
  notes: z.string().trim().max(2000).nullable(),
});

export const salarySlipGenerationSchema = z
  .object({
    membershipId: entityId,
    periodStart: z.iso.date(),
    periodEnd: z.iso.date(),
    bonus: moneyText.default("0"),
    reimbursement: moneyText.default("0"),
    extraDeduction: moneyText.default("0"),
    notes: z.string().trim().max(1000).nullable(),
  })
  .superRefine((value, context) => {
    if (value.periodEnd < value.periodStart) {
      context.addIssue({
        code: "custom",
        path: ["periodEnd"],
        message: "Pay period ends before it starts.",
      });
    }
    const start = new Date(`${value.periodStart}T00:00:00Z`);
    const end = new Date(`${value.periodEnd}T00:00:00Z`);
    if ((end.getTime() - start.getTime()) / 86_400_000 > 62) {
      context.addIssue({
        code: "custom",
        path: ["periodEnd"],
        message: "Pay periods are limited to 63 days.",
      });
    }
  });

export const salarySlipUploadSchema = salarySlipGenerationSchema.extend({
  currency,
  baseSalary: moneyText,
  allowances: moneyText.default("0"),
  deductions: moneyText.default("0"),
});

export const salarySlipIdSchema = z.object({ salarySlipId: entityId });
