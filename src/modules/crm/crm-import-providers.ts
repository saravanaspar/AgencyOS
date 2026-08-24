export const crmImportProviders = [
  "meta_lead_ads",
  "google_ads",
  "hubspot",
  "salesforce",
  "zoho",
  "pipedrive",
] as const;

export type CrmImportProvider = (typeof crmImportProviders)[number];
export type CrmImportSourceType = CrmImportProvider | "csv" | "xlsx";
export type CrmDuplicatePolicy = "skip" | "merge";
export type CrmPullProvider = Extract<
  CrmImportProvider,
  "hubspot" | "salesforce" | "zoho" | "pipedrive"
>;

export const crmPullAuthenticationMethods = ["api_token", "client_oauth", "agency_oauth"] as const;
export type CrmPullAuthenticationMethod = (typeof crmPullAuthenticationMethods)[number];

export const crmImportProviderLabels: Record<CrmImportProvider, string> = {
  meta_lead_ads: "Meta Lead Ads",
  google_ads: "Google Ads lead forms",
  hubspot: "HubSpot",
  salesforce: "Salesforce",
  zoho: "Zoho CRM",
  pipedrive: "Pipedrive",
};

export const crmImportProviderModes: Record<CrmImportProvider, "webhook" | "pull"> = {
  meta_lead_ads: "webhook",
  google_ads: "webhook",
  hubspot: "pull",
  salesforce: "pull",
  zoho: "pull",
  pipedrive: "pull",
};

export const crmPullProviderAuthenticationMethods: Record<
  CrmPullProvider,
  readonly CrmPullAuthenticationMethod[]
> = {
  hubspot: ["api_token", "client_oauth", "agency_oauth"],
  salesforce: ["client_oauth", "agency_oauth"],
  zoho: ["client_oauth", "agency_oauth"],
  pipedrive: ["api_token", "client_oauth", "agency_oauth"],
};

export const crmPullProviderDefaultAuthenticationMethod: Record<
  CrmPullProvider,
  Exclude<CrmPullAuthenticationMethod, "agency_oauth">
> = {
  hubspot: "api_token",
  salesforce: "client_oauth",
  zoho: "client_oauth",
  pipedrive: "api_token",
};

export const crmPullAuthenticationMethodLabels: Record<CrmPullAuthenticationMethod, string> = {
  api_token: "Client-managed API token",
  client_oauth: "Client-owned OAuth app",
  agency_oauth: "Agency-managed OAuth",
};

export function isCrmPullProvider(provider: CrmImportProvider): provider is CrmPullProvider {
  return crmImportProviderModes[provider] === "pull";
}

export function isCrmPullAuthenticationMethod(
  value: unknown,
): value is CrmPullAuthenticationMethod {
  return crmPullAuthenticationMethods.includes(value as CrmPullAuthenticationMethod);
}

export function supportsCrmPullAuthenticationMethod(
  provider: CrmPullProvider,
  method: CrmPullAuthenticationMethod,
): boolean {
  return crmPullProviderAuthenticationMethods[provider].includes(method);
}
