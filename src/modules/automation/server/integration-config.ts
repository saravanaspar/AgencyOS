import "server-only";

import { getOrganizationIntegrationConfiguration } from "@/modules/integrations/server/integration-settings";

export interface AutomationIntegrationConfiguration {
  workerConfigured: boolean;
  vaultwardenBaseUrl: string | null;
}

function validSecret(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length >= 32 ? normalized : null;
}

function validInternalOrHttpsUrl(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  if (!normalized) return null;
  try {
    const parsed = new URL(normalized);
    const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (parsed.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && local)) {
      return null;
    }
    if (parsed.username || parsed.password) return null;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function validVaultwardenUrl(value: string | null | undefined): string | null {
  const url = validInternalOrHttpsUrl(value);
  return url?.replace(/\/$/, "") ?? null;
}

export async function getAutomationIntegrationConfiguration(
  organizationId?: string | null,
): Promise<AutomationIntegrationConfiguration> {
  const settings = await getOrganizationIntegrationConfiguration(organizationId);
  return {
    workerConfigured: Boolean(validSecret(process.env.INTERNAL_WORKER_SECRET)),
    vaultwardenBaseUrl: validVaultwardenUrl(settings.vaultwardenUrl),
  };
}

export function buildVaultwardenItemUrl(
  itemReference: string,
  baseUrl: string | null,
): string | null {
  return baseUrl ? `${baseUrl}/#/vault?itemId=${encodeURIComponent(itemReference)}` : null;
}
