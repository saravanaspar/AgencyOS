import { describe, expect, it } from "vitest";

import { hasValidBearerSecret } from "@/lib/server/bearer-auth";
import { handlesOwnApiAuthentication } from "@/lib/server/self-authenticated-api-paths";

describe("self-authenticated internal worker boundaries", () => {
  it("bypasses browser-session handling only for exact independently authenticated routes", () => {
    expect(handlesOwnApiAuthentication("/api/internal/workers/run", "POST")).toBe(true);
    expect(handlesOwnApiAuthentication("/api/internal/workers/run", "GET")).toBe(false);
    expect(handlesOwnApiAuthentication("/api/mcp", "GET")).toBe(true);
    expect(handlesOwnApiAuthentication("/api/mcp", "POST")).toBe(true);
    expect(handlesOwnApiAuthentication("/api/metrics", "GET")).toBe(true);
    expect(handlesOwnApiAuthentication("/api/metrics", "POST")).toBe(false);
    expect(handlesOwnApiAuthentication("/api/health/live", "GET")).toBe(true);
    expect(handlesOwnApiAuthentication("/api/health/live", "POST")).toBe(false);
    expect(handlesOwnApiAuthentication("/api/health/ready", "GET")).toBe(true);
    expect(handlesOwnApiAuthentication("/api/health/ready", "POST")).toBe(false);
    expect(handlesOwnApiAuthentication("/api/crm/connectors/connection-id/webhook", "POST")).toBe(
      true,
    );
    expect(
      handlesOwnApiAuthentication("/api/crm/connectors/connection-id/oauth/start", "GET"),
    ).toBe(false);

    expect(handlesOwnApiAuthentication("/api/internal/unknown")).toBe(false);
    expect(handlesOwnApiAuthentication("/api/internal/workers/run/extra")).toBe(false);
    expect(handlesOwnApiAuthentication("/api/crm/imports/file")).toBe(false);
  });

  it("accepts only the exact configured bearer secret", () => {
    const valid = new Request("https://agency.example.test/api/internal/workers/run", {
      headers: { authorization: "Bearer worker-secret" },
    });
    const wrong = new Request("https://agency.example.test/api/internal/workers/run", {
      headers: { authorization: "Bearer worker-secreu" },
    });
    const malformed = new Request("https://agency.example.test/api/internal/workers/run", {
      headers: { authorization: "Basic worker-secret" },
    });

    expect(hasValidBearerSecret(valid, "worker-secret")).toBe(true);
    expect(hasValidBearerSecret(wrong, "worker-secret")).toBe(false);
    expect(hasValidBearerSecret(malformed, "worker-secret")).toBe(false);
    expect(hasValidBearerSecret(valid, undefined)).toBe(false);
  });
});
