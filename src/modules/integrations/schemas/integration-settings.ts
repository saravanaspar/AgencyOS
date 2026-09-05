import { z } from "zod";

function checkbox(value: unknown): boolean {
  return value === true || value === "true" || value === "on" || value === "1";
}

const optionalText = (max: number) =>
  z.preprocess((value) => (typeof value === "string" ? value.trim() : value), z.string().max(max));

const modelList = optionalText(1_500).superRefine((value, context) => {
  const models = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!models.length || models.length > 12) {
    context.addIssue({ code: "custom", message: "Enter between 1 and 12 model names." });
  }
  if (models.some((model) => !/^[a-zA-Z0-9._-]{2,100}$/.test(model))) {
    context.addIssue({ code: "custom", message: "One or more model names are invalid." });
  }
});

export const integrationSettingsSchema = z
  .object({
    geminiApiKey: optionalText(500),
    clearGeminiApiKey: z.preprocess(checkbox, z.boolean()),
    geminiModels: modelList,
    deepseekApiKey: optionalText(500),
    clearDeepseekApiKey: z.preprocess(checkbox, z.boolean()),
    deepseekBaseUrl: z.url().max(500),
    deepseekModels: modelList,
    vapidPublicKey: optionalText(120),
    vapidPrivateKey: optionalText(120),
    clearVapidKeys: z.preprocess(checkbox, z.boolean()),
    vapidSubject: optionalText(500),
    vaultwardenUrl: optionalText(500),
  })
  .superRefine((value, context) => {
    if (value.deepseekBaseUrl && !value.deepseekBaseUrl.startsWith("https://")) {
      context.addIssue({
        code: "custom",
        path: ["deepseekBaseUrl"],
        message: "DeepSeek must use an HTTPS API URL.",
      });
    }
    if (value.vapidPublicKey && !/^[A-Za-z0-9_-]{80,100}$/.test(value.vapidPublicKey)) {
      context.addIssue({
        code: "custom",
        path: ["vapidPublicKey"],
        message: "Enter a valid VAPID public key.",
      });
    }
    if (value.vapidPrivateKey && !/^[A-Za-z0-9_-]{40,60}$/.test(value.vapidPrivateKey)) {
      context.addIssue({
        code: "custom",
        path: ["vapidPrivateKey"],
        message: "Enter a valid VAPID private key.",
      });
    }
    if (
      value.vapidSubject &&
      !value.vapidSubject.startsWith("mailto:") &&
      !value.vapidSubject.startsWith("https://")
    ) {
      context.addIssue({
        code: "custom",
        path: ["vapidSubject"],
        message: "Use a mailto: or HTTPS VAPID subject.",
      });
    }
    if (value.vaultwardenUrl && !value.vaultwardenUrl.startsWith("https://")) {
      context.addIssue({
        code: "custom",
        path: ["vaultwardenUrl"],
        message: "Vaultwarden must use an HTTPS URL.",
      });
    }
  });
