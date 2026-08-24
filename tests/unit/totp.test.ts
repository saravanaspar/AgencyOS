import { describe, expect, it } from "vitest";

import { buildTotpUri, generateTotpSecret, verifyTotpCode } from "@/modules/security/totp";

describe("AgencyOS TOTP", () => {
  it("generates a base32 secret and a provider-independent otpauth URI", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(secret.length).toBeGreaterThanOrEqual(32);
    const uri = buildTotpUri({ secret, email: "owner@example.test" });
    expect(uri).toContain("otpauth://totp/");
    expect(uri).toContain("secret=");
    expect(uri).toContain("issuer=AgencyOS");
  });

  it("matches the RFC 6238 SHA-1 vector truncated to six digits", () => {
    const rfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    expect(verifyTotpCode(rfcSecret, "287082", 59_000)).toBe(true);
    expect(verifyTotpCode(rfcSecret, "287083", 59_000)).toBe(false);
  });

  it("rejects malformed codes without throwing", () => {
    const secret = generateTotpSecret();
    expect(verifyTotpCode(secret, "abc123")).toBe(false);
    expect(verifyTotpCode(secret, "12345")).toBe(false);
  });
});
