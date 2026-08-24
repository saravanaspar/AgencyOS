import { describe, expect, it } from "vitest";

import {
  CRM_SYNC_MAX_PAGES,
  CRM_SYNC_MAX_ROWS,
  calculateCrmSyncBackoffSeconds,
  checkpointDate,
  crmSyncIntervalOptions,
  hubSpotNextAfter,
  isCrmSyncInterval,
  parseRetryAfterSeconds,
  pipedriveNextStart,
  salesforceNextPath,
  zohoHasMoreRecords,
} from "@/modules/crm/crm-connector-sync";
import {
  crmConnectionCreateSchema,
  crmConnectionScheduleSchema,
} from "@/modules/crm/schemas/imports";

describe("CRM connector sync boundaries", () => {
  it("keeps each invocation bounded so cursors can continue later", () => {
    expect(CRM_SYNC_MAX_PAGES).toBeGreaterThan(0);
    expect(CRM_SYNC_MAX_PAGES).toBeLessThanOrEqual(5);
    expect(CRM_SYNC_MAX_ROWS).toBeGreaterThan(0);
    expect(CRM_SYNC_MAX_ROWS).toBeLessThanOrEqual(1_000);
  });

  it("uses bounded exponential backoff and honors a larger Retry-After value", () => {
    expect(calculateCrmSyncBackoffSeconds(1)).toBe(300);
    expect(calculateCrmSyncBackoffSeconds(2)).toBe(600);
    expect(calculateCrmSyncBackoffSeconds(20)).toBe(86_400);
    expect(calculateCrmSyncBackoffSeconds(1, 1_200)).toBe(1_200);
  });

  it("parses numeric and HTTP-date Retry-After values", () => {
    const now = Date.parse("2026-07-14T12:00:00Z");
    expect(parseRetryAfterSeconds("90", now)).toBe(90);
    expect(parseRetryAfterSeconds("Tue, 14 Jul 2026 12:02:00 GMT", now)).toBe(120);
    expect(parseRetryAfterSeconds("invalid", now)).toBeNull();
  });

  it("extracts provider pagination cursors without accepting unsafe values", () => {
    expect(hubSpotNextAfter({ paging: { next: { after: 200 } } })).toBe("200");
    expect(salesforceNextPath({ done: false, nextRecordsUrl: "/services/data/query/next" })).toBe(
      "/services/data/query/next",
    );
    expect(
      salesforceNextPath({ done: false, nextRecordsUrl: "https://evil.example/next" }),
    ).toBeNull();
    expect(zohoHasMoreRecords({ info: { more_records: true } })).toBe(true);
    expect(
      pipedriveNextStart({
        additional_data: {
          pagination: { more_items_in_collection: true, next_start: 100 },
        },
      }),
    ).toBe(100);
  });

  it("accepts only real checkpoint dates", () => {
    expect(checkpointDate("2026-07-14T12:00:00Z")?.toISOString()).toBe("2026-07-14T12:00:00.000Z");
    expect(checkpointDate("not-a-date")).toBeNull();
    expect(checkpointDate(null)).toBeNull();
  });
});

describe("CRM connector lifecycle schemas", () => {
  it("shares one supported schedule interval contract", () => {
    for (const option of crmSyncIntervalOptions) {
      expect(isCrmSyncInterval(option.minutes)).toBe(true);
      expect(
        crmConnectionScheduleSchema.safeParse({
          connectionId: "9f322b97-81dd-4bf2-9ca8-e5bca462e0cc",
          syncEnabled: true,
          syncIntervalMinutes: option.minutes,
        }).success,
      ).toBe(true);
    }
    expect(isCrmSyncInterval(1)).toBe(false);
  });

  it("accepts client-managed tokens only for providers with a real token flow", () => {
    const hubSpotPrivateApp = crmConnectionCreateSchema.safeParse({
      provider: "hubspot",
      name: "Client HubSpot",
      authenticationMethod: "api_token",
      accessToken: "client-owned-private-app-token",
      syncEnabled: true,
      syncIntervalMinutes: 60,
    });
    const pipedriveToken = crmConnectionCreateSchema.safeParse({
      provider: "pipedrive",
      name: "Client Pipedrive",
      authenticationMethod: "api_token",
      accessToken: "client-owned-api-token",
      syncEnabled: false,
      syncIntervalMinutes: 60,
    });
    const unsupportedSalesforceToken = crmConnectionCreateSchema.safeParse({
      provider: "salesforce",
      name: "Unsupported Salesforce token",
      authenticationMethod: "api_token",
      accessToken: "not-supported",
      syncEnabled: false,
      syncIntervalMinutes: 60,
    });

    expect(hubSpotPrivateApp.success).toBe(true);
    expect(pipedriveToken.success).toBe(true);
    expect(unsupportedSalesforceToken.success).toBe(false);
  });

  it("requires both client-owned OAuth application fields", () => {
    const complete = crmConnectionCreateSchema.safeParse({
      provider: "zoho",
      name: "Client Zoho",
      authenticationMethod: "client_oauth",
      oauthClientId: "client-id",
      oauthClientSecret: "client-secret",
      region: "eu",
      syncEnabled: true,
      syncIntervalMinutes: 60,
    });
    const missingSecret = crmConnectionCreateSchema.safeParse({
      provider: "zoho",
      name: "Incomplete Zoho",
      authenticationMethod: "client_oauth",
      oauthClientId: "client-id",
      region: "eu",
      syncEnabled: false,
      syncIntervalMinutes: 60,
    });

    expect(complete.success).toBe(true);
    expect(missingSecret.success).toBe(false);
  });
});
