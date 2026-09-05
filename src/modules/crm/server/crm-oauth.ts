import "server-only";

import { readBoundedResponseText } from "@/lib/server/bounded-response";
import type { CrmImportProvider } from "@/modules/crm/crm-import-providers";

export const crmOAuthProviders = ["hubspot", "salesforce", "zoho", "pipedrive"] as const;
export type CrmOAuthProvider = (typeof crmOAuthProviders)[number];

export interface CrmOAuthCredentials {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresAt?: string;
  apiDomain?: string;
}

export interface CrmOAuthClientConfiguration {
  clientId?: string | null;
  clientSecret?: string | null;
  region?: string | null;
  salesforceLoginUrl?: string | null;
}

export interface CrmOAuthTokenResult {
  credentials: CrmOAuthCredentials;
  configuration: Record<string, string>;
  expiresAt: string | null;
}

interface CrmOAuthProviderConfig {
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  authorizationParameters?: Record<string, string>;
  tokenAuthentication: "body" | "basic";
}

const zohoAccountsHosts: Record<string, string> = {
  us: "accounts.zoho.com",
  eu: "accounts.zoho.eu",
  in: "accounts.zoho.in",
  au: "accounts.zoho.com.au",
  jp: "accounts.zoho.jp",
  ca: "accounts.zohocloud.ca",
};

function requiredOAuthCredential(
  configuredValue: string | null | undefined,
  environmentName: string,
): string {
  const value = configuredValue?.trim() || process.env[environmentName]?.trim();
  if (!value) {
    throw new Error(
      "This OAuth connection needs the client-owned application credentials or an agency-managed provider configuration.",
    );
  }
  return value;
}

function salesforceLoginOrigin(value?: string | null): string {
  const raw =
    value?.trim() ||
    process.env.SALESFORCE_OAUTH_LOGIN_URL?.trim() ||
    "https://login.salesforce.com";
  const url = new URL(raw);
  const allowed = new Set(["login.salesforce.com", "test.salesforce.com"]);
  if (url.protocol !== "https:" || !allowed.has(url.hostname) || url.pathname !== "/") {
    throw new Error(
      "Salesforce OAuth must use https://login.salesforce.com or https://test.salesforce.com.",
    );
  }
  return url.origin;
}

function getProviderConfig(
  provider: CrmOAuthProvider,
  client: CrmOAuthClientConfiguration = {},
): CrmOAuthProviderConfig {
  const clientId = requiredOAuthCredential(
    client.clientId,
    `${provider.toUpperCase()}_OAUTH_CLIENT_ID`,
  );
  const clientSecret = requiredOAuthCredential(
    client.clientSecret,
    `${provider.toUpperCase()}_OAUTH_CLIENT_SECRET`,
  );

  if (provider === "hubspot") {
    return {
      clientId,
      clientSecret,
      authorizationUrl: "https://app.hubspot.com/oauth/authorize",
      tokenUrl: "https://api.hubapi.com/oauth/v1/token",
      scopes: ["oauth", "crm.objects.contacts.read", "crm.schemas.contacts.read"],
      tokenAuthentication: "body",
    };
  }
  if (provider === "salesforce") {
    const origin = salesforceLoginOrigin(client.salesforceLoginUrl);
    return {
      clientId,
      clientSecret,
      authorizationUrl: `${origin}/services/oauth2/authorize`,
      tokenUrl: `${origin}/services/oauth2/token`,
      scopes: ["api", "refresh_token"],
      tokenAuthentication: "body",
    };
  }
  if (provider === "zoho") {
    const normalizedRegion = (client.region ?? "us").toLowerCase();
    const host = zohoAccountsHosts[normalizedRegion];
    if (!host) throw new Error("Choose a supported Zoho data center.");
    return {
      clientId,
      clientSecret,
      authorizationUrl: `https://${host}/oauth/v2/auth`,
      tokenUrl: `https://${host}/oauth/v2/token`,
      scopes: ["ZohoCRM.modules.leads.READ"],
      authorizationParameters: { access_type: "offline", prompt: "consent" },
      tokenAuthentication: "body",
    };
  }
  return {
    clientId,
    clientSecret,
    authorizationUrl: "https://oauth.pipedrive.com/oauth/authorize",
    tokenUrl: "https://oauth.pipedrive.com/oauth/token",
    scopes: [],
    tokenAuthentication: "basic",
  };
}

export function isCrmOAuthProvider(
  provider: CrmImportProvider | string,
): provider is CrmOAuthProvider {
  return crmOAuthProviders.includes(provider as CrmOAuthProvider);
}

export function crmOAuthRedirectUri(provider: CrmOAuthProvider): string {
  const appUrl = process.env.APP_URL?.trim();
  if (!appUrl) throw new Error("APP_URL is required for CRM OAuth callbacks.");
  const origin = new URL(appUrl);
  if (origin.protocol !== "https:" && origin.hostname !== "localhost") {
    throw new Error("CRM OAuth callbacks require HTTPS outside localhost.");
  }
  return new URL(`/api/crm/oauth/${provider}/callback`, origin.origin).toString();
}

export function buildCrmOAuthAuthorizationUrl(
  provider: CrmOAuthProvider,
  state: string,
  client: CrmOAuthClientConfiguration = {},
): string {
  const config = getProviderConfig(provider, client);
  const url = new URL(config.authorizationUrl);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", crmOAuthRedirectUri(provider));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  if (config.scopes.length) url.searchParams.set("scope", config.scopes.join(" "));
  Object.entries(config.authorizationParameters ?? {}).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return url.toString();
}

function tokenExpiry(expiresIn: unknown): string | undefined {
  const seconds = Number(expiresIn);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return new Date(Date.now() + Math.max(60, Math.trunc(seconds)) * 1_000).toISOString();
}

async function tokenRequest(
  provider: CrmOAuthProvider,
  body: URLSearchParams,
  client: CrmOAuthClientConfiguration = {},
): Promise<Record<string, unknown>> {
  const config = getProviderConfig(provider, client);
  const headers = new Headers({
    Accept: "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
  });
  if (config.tokenAuthentication === "basic") {
    headers.set(
      "Authorization",
      `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
    );
  } else {
    body.set("client_id", config.clientId);
    body.set("client_secret", config.clientSecret);
  }

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers,
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const text = await readBoundedResponseText(
    response,
    512_000,
    "OAuth provider response exceeded the safe limit.",
  );
  let payload: unknown = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    throw new Error("The provider rejected the OAuth token request. Reconnect the account.");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("The provider returned an invalid OAuth token response.");
  }
  return payload as Record<string, unknown>;
}

function normalizeTokenResult(
  provider: CrmOAuthProvider,
  payload: Record<string, unknown>,
  existingRefreshToken?: string,
): CrmOAuthTokenResult {
  const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
  if (!accessToken) throw new Error("The provider did not return an access token.");
  const refreshToken =
    typeof payload.refresh_token === "string" && payload.refresh_token
      ? payload.refresh_token
      : existingRefreshToken;
  const expiresAt = tokenExpiry(payload.expires_in);
  const apiDomain =
    typeof payload.api_domain === "string"
      ? payload.api_domain
      : typeof payload.instance_url === "string"
        ? payload.instance_url
        : undefined;
  const tokenType = typeof payload.token_type === "string" ? payload.token_type : "Bearer";
  const configuration: Record<string, string> = {};
  if (provider === "salesforce" && apiDomain) configuration.instanceUrl = apiDomain;
  if (provider === "pipedrive" && apiDomain) configuration.apiDomain = apiDomain;
  if (provider === "zoho" && apiDomain) configuration.apiDomain = apiDomain;

  return {
    credentials: {
      accessToken,
      ...(refreshToken ? { refreshToken } : {}),
      tokenType,
      ...(expiresAt ? { expiresAt } : {}),
      ...(apiDomain ? { apiDomain } : {}),
    },
    configuration,
    expiresAt: expiresAt ?? null,
  };
}

export async function exchangeCrmOAuthCode(
  provider: CrmOAuthProvider,
  code: string,
  client: CrmOAuthClientConfiguration = {},
): Promise<CrmOAuthTokenResult> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: crmOAuthRedirectUri(provider),
  });
  const payload = await tokenRequest(provider, body, client);
  return normalizeTokenResult(provider, payload);
}

export async function refreshCrmOAuthToken(
  provider: CrmOAuthProvider,
  refreshToken: string,
  client: CrmOAuthClientConfiguration = {},
): Promise<CrmOAuthTokenResult> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  if (provider === "hubspot") body.set("redirect_uri", crmOAuthRedirectUri(provider));
  const payload = await tokenRequest(provider, body, client);
  return normalizeTokenResult(provider, payload, refreshToken);
}
