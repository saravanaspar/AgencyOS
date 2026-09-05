import { z } from "zod";

const bool = z.preprocess(
  (value) => value === true || value === "true" || value === "on",
  z.boolean(),
);
const optionalDate = z.preprocess(
  (value) => (typeof value === "string" && value.trim() ? value.trim() : null),
  z.union([z.iso.date(), z.null()]),
);
const optionalDateTime = z.preprocess(
  (value) => (typeof value === "string" && value.trim() ? new Date(value).toISOString() : null),
  z.union([z.iso.datetime({ offset: true }), z.null()]),
);

const allowedCollectionStageDays = new Set([0, 7, 14, 30, 45, 60, 90]);

export const collectionPolicySchema = z.object({
  preDueDays: z.coerce.number().int().min(0).max(30),
  overdueStageDays: z
    .array(z.coerce.number().int().min(0).max(90))
    .min(1)
    .max(7)
    .superRefine((values, context) => {
      if (new Set(values).size !== values.length)
        context.addIssue({ code: "custom", message: "Collection stages must be unique." });
      if (values.some((value) => !allowedCollectionStageDays.has(value)))
        context.addIssue({
          code: "custom",
          message: "Allowed overdue stages are 0, 7, 14, 30, 45, 60, and 90 days.",
        });
    }),
  founderEscalationDays: z.coerce.number().int().min(1).max(365),
  reminderChannels: z
    .array(z.enum(["email", "in_app"]))
    .min(1)
    .max(2),
  reminderSubjectTemplate: z.string().trim().min(1).max(200),
  reminderBodyTemplate: z.string().trim().min(1).max(4000),
});

export const collectionCaseUpdateSchema = z.object({
  caseId: z.uuid(),
  promiseToPayOn: optionalDate,
  disputeSuppressed: bool,
  nextActionAt: optionalDateTime,
  note: z.preprocess(
    (value) => (typeof value === "string" && value.trim() ? value.trim() : null),
    z.union([z.string().max(2000), z.null()]),
  ),
});

export const collectionCaseResolveSchema = z.object({ caseId: z.uuid() });
