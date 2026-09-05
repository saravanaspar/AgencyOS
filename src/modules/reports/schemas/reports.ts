import { z } from "zod";

import {
  reportComparisons,
  reportPeriodModes,
  reportSections,
  reportViewVisibilities,
} from "@/modules/reports/reports";

const optionalUuid = z.preprocess(
  (value) => (typeof value === "string" && value.trim() ? value.trim() : null),
  z.union([z.uuid(), z.null()]),
);

const optionalStatus = z.preprocess(
  (value) => (typeof value === "string" && value.trim() ? value.trim().slice(0, 60) : null),
  z.union([z.string().regex(/^[a-z0-9_-]+$/), z.null()]),
);

function isoDateOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : undefined;
}

export const reportsFiltersSchema = z.object({
  from: z.preprocess(isoDateOrUndefined, z.iso.date().optional()),
  to: z.preprocess(isoDateOrUndefined, z.iso.date().optional()),
  comparison: z.enum(reportComparisons).catch("none"),
  section: z.enum(reportSections).catch("overview"),
  owner: optionalUuid,
  team: optionalUuid,
  department: optionalUuid,
  project: optionalUuid,
  client: optionalUuid,
  status: optionalStatus,
});

export type ReportsFilters = z.infer<typeof reportsFiltersSchema>;

export function parseReportsFilters(input: Record<string, unknown>): ReportsFilters {
  return reportsFiltersSchema.parse(input);
}

const boundedName = z.string().trim().min(1).max(100);
const boundedDescription = z.preprocess(
  (value) => (typeof value === "string" && value.trim() ? value.trim() : null),
  z.union([z.string().max(500), z.null()]),
);
const widgetKeysSchema = z.array(z.string().trim().min(1).max(80)).min(1).max(12);

export const savedReportViewSchema = z
  .object({
    viewId: z.preprocess(
      (value) => (typeof value === "string" && value.trim() ? value.trim() : null),
      z.union([z.uuid(), z.null()]),
    ),
    name: boundedName,
    description: boundedDescription,
    periodMode: z.enum(reportPeriodModes).default("custom"),
    visibility: z.enum(reportViewVisibilities).default("private"),
    visibilityDepartmentId: optionalUuid,
    namedRecipientIds: z.array(z.uuid()).max(100).default([]),
    filters: reportsFiltersSchema,
    widgetKeys: widgetKeysSchema,
  })
  .superRefine((value, context) => {
    if (value.visibility === "department" && !value.visibilityDepartmentId) {
      context.addIssue({
        code: "custom",
        path: ["visibilityDepartmentId"],
        message: "Choose a department for department visibility.",
      });
    }
    if (value.visibility === "named" && value.namedRecipientIds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["namedRecipientIds"],
        message: "Choose at least one recipient for named visibility.",
      });
    }
  });

export const reportViewIdSchema = z.object({ viewId: z.uuid() });

export const reportScheduleSchema = z
  .object({
    savedViewId: z.uuid(),
    cadence: z.enum(["daily", "weekly", "monthly"]),
    localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    timezone: z.string().trim().min(1).max(100),
    weekday: z.preprocess(
      (value) => (value === "" || value == null ? null : Number(value)),
      z.union([z.number().int().min(0).max(6), z.null()]),
    ),
    monthDay: z.preprocess(
      (value) => (value === "" || value == null ? null : Number(value)),
      z.union([z.number().int().min(1).max(28), z.null()]),
    ),
    format: z.enum(["csv", "pdf"]),
    audience: z.enum(["owner", "named", "view_access", "section_access"]).default("owner"),
    deliveryChannels: z
      .array(z.enum(["in_app", "email", "slack", "telegram", "webhook"]))
      .min(1)
      .max(5)
      .default(["in_app"]),
    recipientIds: z.array(z.uuid()).max(100).default([]),
    graceSeconds: z.coerce.number().int().min(0).max(30).default(5),
  })
  .superRefine((value, context) => {
    if (value.cadence === "weekly" && value.weekday == null) {
      context.addIssue({ code: "custom", path: ["weekday"], message: "Choose a weekday." });
    }
    if (value.cadence === "monthly" && value.monthDay == null) {
      context.addIssue({ code: "custom", path: ["monthDay"], message: "Choose a month day." });
    }
    if (value.audience === "named" && value.recipientIds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["recipientIds"],
        message: "Choose at least one recipient.",
      });
    }
  });

export const reportDeliveryUndoSchema = z.object({ batchId: z.uuid() });

export const reportSnapshotRequestSchema = z.object({
  savedViewId: z.uuid(),
  format: z.enum(["csv", "pdf"]),
});

export type ReportActionState = {
  status: "idle" | "success" | "error";
  message: string;
  fieldErrors?: Record<string, string[]>;
};
