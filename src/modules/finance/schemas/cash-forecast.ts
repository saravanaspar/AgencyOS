import { z } from "zod";

const optionalUuid = z.preprocess(
  (value) => (typeof value === "string" && value.trim() ? value.trim() : null),
  z.union([z.uuid(), z.null()]),
);
const optionalDate = z.preprocess(
  (value) => (typeof value === "string" && value.trim() ? value.trim() : null),
  z.union([z.iso.date(), z.null()]),
);

export const cashForecastSettingsSchema = z.object({
  payrollDay: z.coerce.number().int().min(1).max(28),
  pipelineEnabled: z.preprocess(
    (value) => value === "on" || value === "true" || value === true,
    z.boolean(),
  ),
  historicalCollectionEnabled: z.preprocess(
    (value) => value === "on" || value === "true" || value === true,
    z.boolean(),
  ),
  baseCollectionDelayDays: z.coerce.number().int().min(0).max(120),
  conservativeCollectionDelayDays: z.coerce.number().int().min(0).max(120),
  optimisticCollectionDelayDays: z.coerce.number().int().min(0).max(120),
  basePipelineMultiplierBps: z.coerce.number().int().min(0).max(20_000),
  conservativePipelineMultiplierBps: z.coerce.number().int().min(0).max(20_000),
  optimisticPipelineMultiplierBps: z.coerce.number().int().min(0).max(20_000),
});

export const cashRecurringItemSchema = z
  .object({
    recurringItemId: optionalUuid,
    label: z.string().trim().min(1).max(160),
    direction: z.enum(["inflow", "outflow"]),
    itemKind: z.enum([
      "retainer_income",
      "recurring_income",
      "operating_obligation",
      "tax_obligation",
      "other",
    ]),
    amount: z
      .string()
      .trim()
      .regex(/^\d{1,12}(?:\.\d{1,4})?$/),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/),
    cadence: z.enum(["weekly", "monthly", "quarterly", "annual"]),
    nextDueOn: z.iso.date(),
    endOn: optionalDate,
    probabilityBps: z.coerce.number().int().min(0).max(10_000),
    projectId: optionalUuid,
    active: z.preprocess(
      (value) => value === "on" || value === "true" || value === true,
      z.boolean(),
    ),
  })
  .superRefine((value, context) => {
    if (value.endOn && value.endOn < value.nextDueOn) {
      context.addIssue({
        code: "custom",
        path: ["endOn"],
        message: "End date cannot be before the next due date.",
      });
    }
  });

export const deleteCashRecurringItemSchema = z.object({ recurringItemId: z.uuid() });
