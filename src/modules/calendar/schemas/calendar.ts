import { z } from "zod";

import {
  calendarRecurrenceFrequencies,
  calendarScopes,
  calendarViews,
  calendarVisibilityOptions,
  customCalendarEventTypes,
} from "@/modules/calendar/calendar";

const nullableUuid = z.preprocess(
  (value) => (typeof value === "string" && value.trim() ? value.trim() : null),
  z.uuid().nullable(),
);
const nullableText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() ? value.trim() : null),
    z.string().min(2).max(max).nullable(),
  );
const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const dateTimeText = z.iso.datetime({ offset: true });

export const calendarFiltersSchema = z.object({
  anchor: dateText.catch(new Date().toISOString().slice(0, 10)),
  view: z.enum(calendarViews).catch("month"),
  scope: z.enum(calendarScopes).or(z.literal("all")).catch("all"),
  type: z.enum(customCalendarEventTypes).or(z.string()).or(z.literal("all")).catch("all"),
  project: z.preprocess(
    (value) => (typeof value === "string" && value.trim() ? value.trim() : "all"),
    z.string(),
  ),
});

export const calendarEventSchema = z
  .object({
    title: z.string().trim().min(2).max(180),
    description: nullableText(4000),
    eventType: z.enum(customCalendarEventTypes),
    scope: z.enum(calendarScopes),
    visibility: z.enum(calendarVisibilityOptions),
    ownerMembershipId: nullableUuid,
    teamId: nullableUuid,
    departmentId: nullableUuid,
    projectId: nullableUuid,
    startsAt: dateTimeText,
    endsAt: dateTimeText,
    allDay: z.preprocess(
      (value) => value === true || value === "on" || value === "true",
      z.boolean(),
    ),
    timezone: z.string().trim().min(1).max(80),
    recurrenceFrequency: z.enum(calendarRecurrenceFrequencies),
    recurrenceInterval: z.coerce.number().int().min(1).max(52),
    recurrenceUntil: z.preprocess(
      (value) => (typeof value === "string" && value.trim() ? value.trim() : null),
      dateText.nullable(),
    ),
    location: nullableText(300),
    meetingUrl: z.preprocess(
      (value) => (typeof value === "string" && value.trim() ? value.trim() : null),
      z
        .url()
        .max(1000)
        .refine((value) => value.startsWith("https://"))
        .nullable(),
    ),
    attendeeMembershipIds: z.array(z.uuid()).max(100),
  })
  .superRefine((value, context) => {
    if (new Date(value.endsAt).getTime() < new Date(value.startsAt).getTime()) {
      context.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: "End must not precede start.",
      });
    }
    const target = {
      team: value.teamId,
      department: value.departmentId,
      project: value.projectId,
    } as const;
    if (value.scope in target && !target[value.scope as keyof typeof target]) {
      context.addIssue({
        code: "custom",
        path: [`${value.scope}Id`],
        message: `Select a ${value.scope}.`,
      });
    }
    if (value.recurrenceFrequency === "none" && value.recurrenceUntil) {
      context.addIssue({
        code: "custom",
        path: ["recurrenceUntil"],
        message: "A non-recurring event cannot have a recurrence end date.",
      });
    }
  });

export const cancelCalendarEventSchema = z.object({ eventId: z.uuid() });

export type CalendarFilters = z.infer<typeof calendarFiltersSchema>;
export type CalendarEventInput = z.infer<typeof calendarEventSchema>;
export type CalendarActionState = {
  status: "idle" | "success" | "error";
  message: string;
  fieldErrors?: Record<string, string[]>;
};
