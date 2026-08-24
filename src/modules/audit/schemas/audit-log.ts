import { z } from "zod";

const firstValue = (value: unknown) => (Array.isArray(value) ? value[0] : value);

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

const optionalDateSchema = z
  .preprocess(firstValue, z.string().trim().optional().default(""))
  .refine(
    (value) => value === "" || isValidIsoDate(value),
    "Use a valid date in YYYY-MM-DD format.",
  );

export const auditLogFiltersSchema = z
  .object({
    q: z.preprocess(firstValue, z.string().trim().max(120).optional().default("")),
    action: z.preprocess(
      firstValue,
      z
        .string()
        .trim()
        .max(120)
        .regex(/^[a-z0-9_.-]*$/i, "Action contains unsupported characters.")
        .optional()
        .default(""),
    ),
    from: optionalDateSchema,
    to: optionalDateSchema,
    page: z.preprocess(
      firstValue,
      z.coerce.number().int().min(1).max(10_000).optional().default(1),
    ),
  })
  .refine((value) => value.from === "" || value.to === "" || value.from <= value.to, {
    message: "The start date must be on or before the end date.",
    path: ["to"],
  });

export type AuditLogFilters = z.infer<typeof auditLogFiltersSchema>;

export function parseAuditLogFilters(input: Record<string, unknown>): AuditLogFilters {
  return auditLogFiltersSchema.parse(input);
}
