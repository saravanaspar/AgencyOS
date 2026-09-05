import "server-only";

import type { AiProvider, AiProviderOption } from "@/modules/ai/ai";
import { getOrganizationIntegrationConfiguration } from "@/modules/integrations/server/integration-settings";
import type { OrganizationIntegrationConfiguration } from "@/modules/integrations/integration-settings";

function providerOptions(configuration: OrganizationIntegrationConfiguration): AiProviderOption[] {
  return [
    {
      id: "gemini",
      label: "Google Gemini",
      configured: Boolean(configuration.ai.geminiApiKey),
      models: configuration.ai.geminiModels,
    },
    {
      id: "deepseek",
      label: "DeepSeek",
      configured: Boolean(configuration.ai.deepseekApiKey),
      models: configuration.ai.deepseekModels,
    },
  ];
}

export async function getAiProviderOptions(organizationId: string): Promise<AiProviderOption[]> {
  return providerOptions(await getOrganizationIntegrationConfiguration(organizationId));
}

export async function requireAiProvider(
  organizationId: string,
  provider: AiProvider,
  model: string,
) {
  const configuration = await getOrganizationIntegrationConfiguration(organizationId);
  const option = providerOptions(configuration).find((candidate) => candidate.id === provider);
  if (!option?.configured) throw new Error(`${provider} is not configured.`);
  if (!option.models.includes(model)) throw new Error("The selected AI model is not allowed.");
  if (provider === "gemini") {
    return { provider, model, apiKey: configuration.ai.geminiApiKey! } as const;
  }
  const baseUrl = configuration.ai.deepseekBaseUrl.replace(/\/$/, "");
  if (!baseUrl.startsWith("https://")) throw new Error("DeepSeek API URL must use HTTPS.");
  return { provider, model, apiKey: configuration.ai.deepseekApiKey!, baseUrl } as const;
}
