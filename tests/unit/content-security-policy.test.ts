import { describe, expect, it } from "vitest";

import { createContentSecurityPolicy } from "@/lib/server/content-security-policy";

describe("content security policy", () => {
  it("uses request-scoped nonces and same-origin browser connectivity in production", () => {
    const policy = createContentSecurityPolicy({
      nonce: "dGVzdC1ub25jZS0xMjM0NTY=",
      environment: "production",
    });

    expect(policy).toContain("script-src 'self' 'nonce-dGVzdC1ub25jZS0xMjM0NTY=' 'strict-dynamic'");
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).toContain("style-src 'self' 'nonce-dGVzdC1ub25jZS0xMjM0NTY='");
    expect(policy).toContain("style-src-attr 'unsafe-inline'");
    expect(policy).toContain("connect-src 'self'");
    expect(policy).not.toContain("supabase");
    expect(policy).toContain("upgrade-insecure-requests");
  });

  it("allows only the development eval capability required by the framework debugger", () => {
    const policy = createContentSecurityPolicy({
      nonce: "dGVzdC1ub25jZS0xMjM0NTY=",
      environment: "development",
    });
    expect(policy).toContain("'unsafe-eval'");
    expect(policy).toContain("style-src 'self' 'unsafe-inline'");
    expect(policy).not.toContain("style-src 'self' 'nonce-dGVzdC1ub25jZS0xMjM0NTY='");
    expect(policy).not.toContain("upgrade-insecure-requests");
  });
});
