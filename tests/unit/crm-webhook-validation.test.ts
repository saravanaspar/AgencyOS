import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  crmConnectionIdSchema,
  crmGoogleAdsWebhookPayloadSchema,
  crmMetaLeadAdsWebhookPayloadSchema,
  crmWebhookPayloadSchema,
} from "@/modules/crm/schemas/imports";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

describe("CRM webhook boundary validation", () => {
  const googlePayload = {
    lead_id: "lead-123",
    api_version: "1.0",
    form_id: "form-123",
    campaign_id: "campaign-123",
    adgroup_id: "ad-group-123",
    creative_id: "creative-123",
    gcl_id: "google-click-id",
    google_key: "configured-webhook-key",
    is_test: false,
    lead_event_time: "2026-08-24T10:00:00Z",
    user_column_data: [
      { column_id: "FULL_NAME", column_name: "Full Name", string_value: "Ada Lovelace" },
      { column_id: "EMAIL", column_name: "Email", string_value: "ada@example.test" },
    ],
  };

  const metaPayload = {
    object: "page" as const,
    entry: [
      {
        id: "page-123",
        time: 1_787_566_400,
        changes: [
          {
            field: "leadgen" as const,
            value: {
              leadgen_id: "lead-456",
              page_id: "page-123",
              form_id: "form-456",
              ad_id: "ad-456",
              created_time: 1_787_566_400,
            },
          },
        ],
      },
    ],
  };

  it("accepts bounded documented Google Ads and Meta Lead Ads payloads", () => {
    expect(crmGoogleAdsWebhookPayloadSchema.safeParse(googlePayload).success).toBe(true);
    expect(crmMetaLeadAdsWebhookPayloadSchema.safeParse(metaPayload).success).toBe(true);
    expect(crmWebhookPayloadSchema.safeParse(googlePayload).success).toBe(true);
    expect(crmWebhookPayloadSchema.safeParse(metaPayload).success).toBe(true);
  });

  it("rejects malformed secrets, oversized provider arrays, and unknown fields", () => {
    expect(
      crmGoogleAdsWebhookPayloadSchema.safeParse({ ...googlePayload, google_key: "" }).success,
    ).toBe(false);
    expect(
      crmGoogleAdsWebhookPayloadSchema.safeParse({
        ...googlePayload,
        user_column_data: Array.from({ length: 201 }, () => ({
          column_id: "EMAIL",
          string_value: "person@example.test",
        })),
      }).success,
    ).toBe(false);
    expect(
      crmMetaLeadAdsWebhookPayloadSchema.safeParse({ ...metaPayload, unexpected: true }).success,
    ).toBe(false);
  });

  it("requires a UUID route parameter and provider-specific server parsing before mutation", () => {
    expect(
      crmConnectionIdSchema.safeParse({ connectionId: "f47ac10b-58cc-4372-a567-0e02b2c3d479" })
        .success,
    ).toBe(true);
    expect(crmConnectionIdSchema.safeParse({ connectionId: "not-a-uuid" }).success).toBe(false);

    const route = source("src/app/api/crm/connectors/[connectionId]/webhook/route.ts");
    expect(route).toContain("crmConnectionIdSchema.safeParse(await context.params)");
    expect(route).toContain("readBoundedRequestJson(request, 512 * 1024)");
    expect(route).toContain("crmWebhookPayloadSchema.safeParse(bounded.value)");

    const server = source("src/modules/crm/server/imports.ts");
    const webhookBoundary = server.slice(server.indexOf("export async function processCrmWebhook"));
    expect(webhookBoundary).toContain("crmGoogleAdsWebhookPayloadSchema.parse(decoded)");
    expect(webhookBoundary).toContain("crmMetaLeadAdsWebhookPayloadSchema.parse(decoded)");
    expect(webhookBoundary.indexOf("crmGoogleAdsWebhookPayloadSchema.parse(decoded)")).toBeLessThan(
      webhookBoundary.indexOf("recordWebhookDelivery(connection, eventId, payload)"),
    );
  });
});
