import { describe, expect, it } from "vitest";

import {
  crmPullProviderAuthenticationMethods,
  crmPullProviderDefaultAuthenticationMethod,
  isCrmPullAuthenticationMethod,
  supportsCrmPullAuthenticationMethod,
} from "@/modules/crm/crm-import-providers";

describe("CRM client-managed authentication contract", () => {
  it("defaults HubSpot and Pipedrive to client API tokens", () => {
    expect(crmPullProviderDefaultAuthenticationMethod.hubspot).toBe("api_token");
    expect(crmPullProviderDefaultAuthenticationMethod.pipedrive).toBe("api_token");
  });

  it("defaults Salesforce and Zoho to client-owned OAuth apps", () => {
    expect(crmPullProviderDefaultAuthenticationMethod.salesforce).toBe("client_oauth");
    expect(crmPullProviderDefaultAuthenticationMethod.zoho).toBe("client_oauth");
  });

  it("does not advertise API tokens for providers that require OAuth", () => {
    expect(crmPullProviderAuthenticationMethods.salesforce).not.toContain("api_token");
    expect(crmPullProviderAuthenticationMethods.zoho).not.toContain("api_token");
    expect(supportsCrmPullAuthenticationMethod("salesforce", "api_token")).toBe(false);
    expect(supportsCrmPullAuthenticationMethod("hubspot", "api_token")).toBe(true);
  });

  it("rejects unknown authentication values", () => {
    expect(isCrmPullAuthenticationMethod("client_oauth")).toBe(true);
    expect(isCrmPullAuthenticationMethod("password")).toBe(false);
  });
});
