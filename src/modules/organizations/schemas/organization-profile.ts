import { isIsoCountryCode } from "@/lib/locale-options";

import { z } from "zod";
import { getDateTimeFormatter } from "@/lib/intl-formatters";

function emptyStringToNull(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? null : value;
}

export function isValidIanaTimezone(value: string): boolean {
  try {
    getDateTimeFormatter("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export const organizationProfileUpdateSchema = z.object({
  legalName: z.string().trim().min(2, "Enter at least 2 characters.").max(160),
  displayName: z.preprocess(
    emptyStringToNull,
    z.string().trim().min(2, "Enter at least 2 characters.").max(160).nullable(),
  ),
  countryCode: z.preprocess(
    emptyStringToNull,
    z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, "Choose a valid country.")
      .refine(isIsoCountryCode, "Choose a valid country.")
      .nullable(),
  ),
  timezone: z
    .string()
    .trim()
    .min(1, "Choose a timezone.")
    .max(100)
    .refine(isValidIanaTimezone, "Enter a valid IANA timezone such as Asia/Kolkata."),
  defaultCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code such as USD or INR."),
  financialYearStartMonth: z.coerce.number().int().min(1).max(12),
  expectedUpdatedAt: z.iso.datetime(),
});

export interface OrganizationProfileActionState {
  status: "idle" | "error" | "success";
  message?: string;
  conflict?: boolean;
  fieldErrors?: Partial<
    Record<
      | "legalName"
      | "displayName"
      | "countryCode"
      | "timezone"
      | "defaultCurrency"
      | "financialYearStartMonth",
      string[]
    >
  >;
}

export type OrganizationProfileUpdateInput = z.infer<typeof organizationProfileUpdateSchema>;
