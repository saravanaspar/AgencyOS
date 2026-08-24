import "server-only";

export interface AutomationIntegrationConfiguration {
  workerConfigured: boolean;
  vaultwardenBaseUrl: string | null;
}

function validSecret(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length >= 32 ? normalized : null;
}

function validInternalOrHttpsUrl(value: string | undefined): string | null {
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

function validVaultwardenUrl(value: string | undefined): string | null {
  const url = validInternalOrHttpsUrl(value);
  return url?.replace(/\/$/, "") ?? null;
}

export function getAutomationIntegrationConfiguration(): AutomationIntegrationConfiguration {
  return {
    workerConfigured: Boolean(validSecret(process.env.INTERNAL_WORKER_SECRET)),
    vaultwardenBaseUrl: validVaultwardenUrl(process.env.VAULTWARDEN_URL),
  };
}

export function buildVaultwardenItemUrl(itemReference: string): string | null {
  const baseUrl = getAutomationIntegrationConfiguration().vaultwardenBaseUrl;
  return baseUrl ? `${baseUrl}/#/vault?itemId=${encodeURIComponent(itemReference)}` : null;
}
