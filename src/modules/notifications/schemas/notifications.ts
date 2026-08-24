import { z } from "zod";

import { notificationCategories } from "@/modules/notifications/notifications";

export const notificationFiltersSchema = z.object({
  status: z.enum(["all", "unread", "read"]).catch("all"),
  category: z.enum(notificationCategories).or(z.literal("")).catch(""),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

export const notificationIdSchema = z.object({
  notificationId: z.uuid(),
});

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const notificationPreferencesSchema = z.object({
  enabledCategories: z.array(z.enum(notificationCategories)).max(notificationCategories.length),
  emailEnabled: z.boolean(),
  browserPushEnabled: z.boolean(),
  digest: z.enum(["none", "daily", "weekly"]),
  quietHoursEnabled: z.boolean(),
  quietHoursStart: timeSchema,
  quietHoursEnd: timeSchema,
});

const pushKeySchema = z.string().min(20).max(512);

export const notificationPushSubscriptionSchema = z.object({
  endpoint: z.url().max(2_048).nullable(),
  expirationTime: z.number().int().nonnegative().nullable().optional(),
  keys: z
    .object({
      p256dh: pushKeySchema,
      auth: pushKeySchema,
    })
    .optional(),
});

export interface NotificationActionState {
  status: "idle" | "success" | "error";
  message?: string;
}
