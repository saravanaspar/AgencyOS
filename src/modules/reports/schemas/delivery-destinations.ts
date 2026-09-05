import { z } from "zod";

const optionalSecret = z.preprocess(
  (value) => (typeof value === "string" && value.trim() ? value.trim() : null),
  z.union([z.string().max(4096), z.null()]),
);

export const reportDeliveryDestinationSchema = z
  .object({
    destinationId: z.preprocess(
      (value) => (typeof value === "string" && value.trim() ? value.trim() : null),
      z.union([z.uuid(), z.null()]),
    ),
    name: z.string().trim().min(1).max(100),
    channel: z.enum(["slack", "telegram", "webhook"]),
    url: optionalSecret,
    botToken: optionalSecret,
    chatId: optionalSecret,
    bearerToken: optionalSecret,
  })
  .superRefine((value, context) => {
    if ((value.channel === "slack" || value.channel === "webhook") && !value.url) {
      context.addIssue({
        code: "custom",
        path: ["url"],
        message: "An HTTPS destination URL is required.",
      });
    }
    if (value.channel === "telegram" && (!value.botToken || !value.chatId)) {
      context.addIssue({
        code: "custom",
        path: ["botToken"],
        message: "Telegram bot token and chat ID are required.",
      });
    }
  });

export const reportDeliveryDestinationIdSchema = z.object({ destinationId: z.uuid() });
