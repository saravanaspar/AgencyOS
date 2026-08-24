export const aiProviders = ["gemini", "deepseek"] as const;
export type AiProvider = (typeof aiProviders)[number];

export interface AiProviderOption {
  id: AiProvider;
  label: string;
  configured: boolean;
  models: string[];
}

export interface AiChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AiToolTrace {
  tool: string;
  status: "succeeded" | "approval_required" | "failed";
  summary: string;
}

export interface AiChatResponse {
  message: string;
  provider: AiProvider;
  model: string;
  tools: AiToolTrace[];
}
