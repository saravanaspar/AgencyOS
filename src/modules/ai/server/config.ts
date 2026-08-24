import "server-only";

import type { AiProvider, AiProviderOption } from "@/modules/ai/ai";

const DEFAULT_MODELS: Record<AiProvider, string[]> = {
  gemini: ["gemini-3.5-flash", "gemini-3.1-pro-preview"],
  deepseek: ["deepseek-v4-flash", "deepseek-v4-pro"],
};

function modelsFromEnv(name: string, fallback: string[]): string[] {
  const values = (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^[a-zA-Z0-9._-]{2,100}$/.test(value));
  return values.length ? [...new Set(values)].slice(0, 12) : fallback;
}

export function getAiProviderOptions(): AiProviderOption[] {
  return [
    {
      id: "gemini",
      label: "Google Gemini",
      configured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      models: modelsFromEnv("GEMINI_MODELS", DEFAULT_MODELS.gemini),
    },
    {
      id: "deepseek",
      label: "DeepSeek",
      configured: Boolean(process.env.DEEPSEEK_API_KEY?.trim()),
      models: modelsFromEnv("DEEPSEEK_MODELS", DEFAULT_MODELS.deepseek),
    },
  ];
}

export function requireAiProvider(provider: AiProvider, model: string) {
  const option = getAiProviderOptions().find((candidate) => candidate.id === provider);
  if (!option?.configured) throw new Error(`${provider} is not configured.`);
  if (!option.models.includes(model)) throw new Error("The selected AI model is not allowed.");
  if (provider === "gemini") {
    return { provider, model, apiKey: process.env.GEMINI_API_KEY!.trim() } as const;
  }
  const baseUrl = (process.env.DEEPSEEK_API_URL ?? "https://api.deepseek.com").replace(/\/$/, "");
  if (!baseUrl.startsWith("https://")) throw new Error("DeepSeek API URL must use HTTPS.");
  return { provider, model, apiKey: process.env.DEEPSEEK_API_KEY!.trim(), baseUrl } as const;
}
