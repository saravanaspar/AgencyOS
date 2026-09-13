import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (file: string) => readFileSync(join(root, file), "utf8");

describe("first-party authentication contracts", () => {
  it("stores only opaque session hashes and clears the browser cookie even if revocation fails", () => {
    const session = source("src/modules/identity/server/auth-session.ts");
    expect(session).toContain('randomBytes(32).toString("base64url")');
    expect(session).toContain('createHash("sha256")');
    expect(session).toContain("timingSafeEqual");
    expect(session).toContain("token_hash");
    expect(session).toContain("finally");
    expect(session).toContain("clearIdentitySessionCookie");
    expect(session).toContain("update public.security_sessions");
  });

  it("keeps password verification and new hashes inside pgcrypto bcrypt", () => {
    const credentials = source("src/modules/identity/server/credentials.ts");
    const migration = source("database/migrations/20260819006000_first_party_auth.sql");
    expect(credentials).toContain("extensions.crypt");
    expect(credentials).toContain("extensions.gen_salt('bf', 12)");
    expect(migration).toContain("source.encrypted_password ~ '^\\$2[aby]\\$'");
  });

  it("uses hashed single-use verification/reset tokens", () => {
    const tokens = source("src/modules/identity/server/verification-token.ts");
    expect(tokens).toContain("randomBytes(32)");
    expect(tokens).toContain('createHash("sha256")');
    expect(tokens).toContain("consumed_at is null");
    expect(tokens).toContain("expires_at > now()");
  });

  it("rate-limits authentication by account identity even when forwarded IP values change", () => {
    const security = source("src/modules/security/server/security.ts");
    expect(security).toContain("`security:${input.kind}:email`");
    expect(security).toContain("`security:${input.kind}:network`");
    expect(security).toContain("input.request.ipAddress");
    expect(security).toContain("Promise.resolve<RedisRateLimitResult>");
    expect(security).not.toContain("or ip_address = ${input.request.ipAddress}::inet");
  });

  it("rate-limits account creation before writing a new identity", () => {
    const actions = source("src/modules/identity/actions/auth.ts");
    const security = source("src/modules/security/server/security.ts");
    const rateLimit = actions.indexOf('kind: "sign-up"');
    const createIdentity = actions.indexOf("createLocalIdentity({");
    expect(rateLimit).toBeGreaterThan(-1);
    expect(createIdentity).toBeGreaterThan(rateLimit);
    expect(security).toContain(
      'AuthenticationRateLimitKind = "login" | "password-reset" | "sign-up"',
    );
    expect(security).toContain('input.kind === "sign-up"');
  });

  it("encrypts TOTP factors and rate-limits verification attempts", () => {
    const mfa = source("src/modules/security/actions/mfa.ts");
    expect(mfa).toContain('"AUTH_ENCRYPTION_KEY"');
    expect(mfa).toContain("encryptSecretObjectWithEnvironmentKey");
    expect(mfa).toContain("verifyTotpCode");
    expect(mfa).toContain("authenticationRateLimitAllows");
    expect(mfa).toContain('kind: "login_failure"');
  });

  it("has no hosted-auth runtime package or environment contract", () => {
    const packageJson = source("package.json");
    const environment = source(".env.example");
    const runtime = [
      source("src/modules/identity/actions/auth.ts"),
      source("src/modules/identity/server/get-current-access-context.ts"),
      source("src/integrations/auth/proxy.ts"),
      source("src/modules/security/actions/mfa.ts"),
    ].join("\n");
    expect(packageJson).not.toContain('"@supabase/');
    expect(environment).not.toContain("NEXT_PUBLIC_SUPABASE");
    expect(environment).not.toContain("SUPABASE_SECRET");
    expect(runtime).not.toContain("supabase");
  });
});
