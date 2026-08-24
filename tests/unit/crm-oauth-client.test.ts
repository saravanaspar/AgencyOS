import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildCrmOAuthAuthorizationUrl } from "@/modules/crm/server/crm-oauth";

const originalEnvironment = { ...process.env };

describe("client-owned CRM OAuth configuration", () => {
  beforeEach(() => {
    process.env.APP_URL = "http://localhost:3000";
    delete process.env.HUBSPOT_OAUTH_CLIENT_ID;
    delete process.env.HUBSPOT_OAUTH_CLIENT_SECRET;
    delete process.env.SALESFORCE_OAUTH_CLIENT_ID;
    delete process.env.SALESFORCE_OAUTH_CLIENT_SECRET;
  });

  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  it("builds authorization URLs from client-owned credentials without provider env values", () => {
    const url = new URL(
      buildCrmOAuthAuthorizationUrl("hubspot", "single-use-state", {
        clientId: "client-owned-id",
        clientSecret: "client-owned-secret",
      }),
    );

    expect(url.origin).toBe("https://app.hubspot.com");
    expect(url.searchParams.get("client_id")).toBe("client-owned-id");
    expect(url.searchParams.get("state")).toBe("single-use-state");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/crm/oauth/hubspot/callback",
    );
    expect(url.toString()).not.toContain("client-owned-secret");
  });

  it("uses the client-selected Salesforce sandbox login origin", () => {
    const url = new URL(
      buildCrmOAuthAuthorizationUrl("salesforce", "state", {
        clientId: "sandbox-client-id",
        clientSecret: "sandbox-client-secret",
        salesforceLoginUrl: "https://test.salesforce.com",
      }),
    );

    expect(url.origin).toBe("https://test.salesforce.com");
    expect(url.pathname).toBe("/services/oauth2/authorize");
  });

  it("fails safely when neither client-owned nor agency-managed credentials exist", () => {
    expect(() => buildCrmOAuthAuthorizationUrl("hubspot", "state")).toThrow(
      "client-owned application credentials",
    );
  });
});
