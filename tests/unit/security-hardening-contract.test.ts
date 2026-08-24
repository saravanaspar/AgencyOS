import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createContentSecurityPolicy } from "@/lib/server/content-security-policy";

const root = process.cwd();
const source = (file: string) => readFileSync(join(root, file), "utf8");

describe("final security hardening contracts", () => {
  it("creates tenant-scoped session, event, incident, and restore evidence", () => {
    const migration = source(
      "database/migrations/20260718005000_final_security_operational_readiness.sql",
    );
    for (const table of [
      "organization_security_policies",
      "security_sessions",
      "security_events",
      "security_incidents",
      "security_incident_events",
      "security_restore_drills",
    ]) {
      expect(migration).toContain(`create table public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toContain(`revoke all on public.${table} from anon, authenticated`);
    }
    expect(migration).toContain("private.prevent_security_evidence_mutation");
    expect(migration).toContain("memberships_revoke_security_sessions");
    expect(migration).toContain(
      "private.effective_permission_scope(organization_id, 'settings.security.view') = 'organization'",
    );
    expect(migration).not.toContain("private.permission_scope(");
  });

  it("enforces privileged MFA and bounded session lifetime before module authorization", () => {
    const currentAccess = source("src/modules/identity/server/get-current-access-context.ts");
    const sessionSecurity = source("src/modules/security/server/session-security.ts");
    const sessionEvaluation = source(
      "database/migrations/20260722005600_fast_security_session_evaluation.sql",
    );
    const layout = source("src/app/(workspace)/layout.tsx");
    expect(currentAccess).toContain("evaluateCurrentSecuritySession");
    expect(currentAccess).toContain("has_privileged_role");
    expect(sessionSecurity).toContain("private.evaluate_security_session");
    expect(sessionSecurity).not.toContain("database.begin");
    expect(sessionEvaluation).toContain("require_privileged_mfa");
    expect(sessionEvaluation).toContain("'mfa-required'::text");
    expect(sessionEvaluation).toContain("absolute_expires_at");
    expect(sessionEvaluation).toContain("idle_expires_at");
    expect(layout).toContain("/mfa?next=/dashboard");
  });

  it("keeps AgencyOS sessions in secure HTTP-only cookies with encrypted TOTP factors", () => {
    const proxy = source("src/integrations/auth/proxy.ts");
    const session = source("src/modules/identity/server/auth-session.ts");
    const mfa = source("src/modules/security/actions/mfa.ts");
    const mfaPage = source("src/app/(public)/mfa/page.tsx");
    const signIn = source("src/modules/identity/actions/auth.ts");
    const notifications = source("src/components/notifications/notification-realtime-refresh.tsx");

    expect(session).toContain("httpOnly: true");
    expect(session).toContain('sameSite: "lax"');
    expect(session).toContain('process.env.NODE_ENV === "production"');
    expect(session).toContain('createHash("sha256")');
    expect(session).toContain("timingSafeEqual");
    expect(proxy).toContain("parseIdentitySessionToken");
    expect(mfa).toContain("verifyTotpCode");
    expect(mfa).toContain("authenticationRateLimitAllows");
    expect(mfa).toContain("recordAuthenticationEvent");
    expect(mfa).toContain("identity_mfa_factors");
    expect(mfa).toContain('"AUTH_ENCRYPTION_KEY"');
    expect(mfaPage).toContain("getCurrentIdentitySession");
    expect(signIn).toContain("verifyIdentityPassword");
    expect(signIn).toContain("createIdentitySession");
    expect(notifications).toContain("setInterval");
    expect(notifications).not.toContain("postgres_changes");
  });

  it("stores sanitized provider-specific CRM fields without changing canonical lead columns", () => {
    const migration = source("database/migrations/20260722005500_crm_lead_extra_fields.sql");
    const imports = source("src/modules/crm/server/imports.ts");
    const normalization = source("src/modules/crm/crm-imports.ts");
    const workspace = source("src/components/crm/crm-workspace.tsx");

    expect(migration).toContain("add column extra_fields jsonb");
    expect(migration).toContain("crm_leads_extra_fields_size");
    expect(imports).toContain("jsonb_set(");
    expect(imports).toContain("coalesce(extra_fields ->");
    expect(imports).toContain("hubSpotPropertyNames");
    expect(imports).toContain("salesforceFieldNames");
    expect(normalization).toContain("sanitizeCrmExtraFields");
    expect(workspace).toContain("flattenLeadExtraFields");
  });

  it("requires recent reauthentication for security, access, and role mutations", () => {
    const securityActions = source("src/modules/security/actions/security.ts");
    const accessActions = source("src/modules/identity/actions/access-management.ts");
    const roleActions = source("src/modules/permissions/actions/role-editor.ts");
    expect(securityActions).toContain("requireRecentReauthentication");
    expect(accessActions).toContain("await requireRecentReauthentication(authorization.context)");
    expect(roleActions).toContain("await requireRecentReauthentication(result.context)");
  });

  it("applies origin, nonce-based CSP, header, and high-risk route protections", () => {
    const proxy = source("src/integrations/auth/proxy.ts");
    const rootProxy = source("src/proxy.ts");
    const config = source("next.config.ts");
    const worker = source("src/lib/server/internal-worker.ts");
    const mcp = source("src/app/api/mcp/route.ts");
    const reportExport = source("src/app/api/reports/export/route.ts");
    expect(proxy).toContain("cross-origin-request-rejected");
    expect(proxy).toContain("hasAllowedOrigin");
    expect(rootProxy).toContain('requestHeaders.set("x-nonce", nonce)');
    const policy = createContentSecurityPolicy({
      nonce: "dGVzdC1ub25jZS0xMjM0NTY=",
      environment: "production",
    });
    expect(policy).toContain("'nonce-dGVzdC1ub25jZS0xMjM0NTY='");
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
    for (const header of [
      "Strict-Transport-Security",
      "X-Frame-Options",
      "Referrer-Policy",
      "X-Content-Type-Options",
      "Permissions-Policy",
    ]) {
      expect(config).toContain(header);
    }
    expect(worker).toContain("security:internal-worker");
    expect(mcp).toContain('kind: "mcp"');
    expect(reportExport).toContain('kind: "export"');
  });

  it("ships concise operations, recovery, incident, and security guidance", () => {
    const operations = source("docs/OPERATIONS.md");
    const security = source("docs/SECURITY.md");
    expect(operations).toContain("Backup and recovery");
    expect(operations).toContain("off the application host");
    expect(operations).toContain("MinIO");
    expect(security).toContain("Contain");
    expect(security).toContain("Evidence should be access-controlled");
    expect(security).toContain("Security acceptance matrix");
  });
});
