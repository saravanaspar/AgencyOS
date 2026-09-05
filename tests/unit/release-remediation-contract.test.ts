import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (file: string) => readFileSync(join(root, file), "utf8");

describe("release remediation contracts", () => {
  it("implements the salary-slip upload route used by the HR workspace", () => {
    const routePath = "src/app/api/hr/salary-slips/upload/route.ts";
    expect(existsSync(join(root, routePath))).toBe(true);
    const route = source(routePath);
    expect(route).toContain("salarySlipUploadSchema.safeParse");
    expect(route).toContain("createSalarySlipPrivateFile");
    expect(route).toContain("validateMultipartContentLength");
    expect(route).toContain("requireOrigin: true");
  });

  it("uses the real document-version route for vendor and purchase-order downloads", () => {
    const workspace = source("src/components/vendors/vendors-workspace.tsx");
    expect(workspace).toContain(
      "/api/documents/${document.id}/versions/${document.currentVersionId}",
    );
    expect(workspace).not.toContain(
      "/api/documents/${document.id}/versions/${document.currentVersionId}/download",
    );
  });

  it("guards every reported multipart parser before formData buffering", () => {
    for (const file of [
      "src/app/api/documents/upload/route.ts",
      "src/app/api/crm/imports/file/route.ts",
      "src/app/api/hr/document-templates/upload/route.ts",
    ]) {
      const route = source(file);
      expect(route.indexOf("validateMultipartContentLength"), file).toBeLessThan(
        route.indexOf("request.formData()"),
      );
      expect(route, file).toContain("bounded Content-Length header is required");
    }
  });

  it("rate-limits all expensive exports before loading their data", () => {
    for (const file of [
      "src/app/(workspace)/settings/audit/export/route.ts",
      "src/app/api/finance/reports/client-statement/route.ts",
    ]) {
      const route = source(file);
      expect(route, file).toContain('kind: "export"');
      expect(route.indexOf("authorizedRateLimitAllows"), file).toBeLessThan(
        route.indexOf(
          file.includes("audit") ? "getAuditExportData(" : "getFinanceClientStatementExport(",
        ),
      );
    }
  });

  it("uses a dedicated AI quota and bounds provider output and response bytes", () => {
    const route = source("src/app/api/ai/chat/route.ts");
    const agent = source("src/modules/ai/server/agent.ts");
    const migration = source("database/migrations/20260727005700_ai_rate_limits.sql");
    expect(route).toContain('kind: "ai"');
    expect(agent).toContain("readBoundedResponseText");
    expect(agent).toContain("MAX_PROVIDER_RESPONSE_BYTES");
    expect(agent).toContain("max_tokens: MAX_PROVIDER_OUTPUT_TOKENS");
    expect(agent).toContain("maxOutputTokens: MAX_PROVIDER_OUTPUT_TOKENS");
    expect(migration).toContain("ai_limit_per_minute");
  });

  it("enforces database and browser gates and ships versioned deployment manifests", () => {
    const packageJson = JSON.parse(source("package.json")) as { scripts: Record<string, string> };
    const pullRequestWorkflow = source(".github/workflows/react-doctor.yml");
    const releaseWorkflow = source(".github/workflows/release.yml");
    const objectStorage = source("compose.object-storage.yaml");
    const production = source("compose.production.yaml");
    const ingress = source("deploy/nginx/agencyos.conf");
    expect(packageJson.scripts["verify:release"]).toContain("db:test");
    expect(packageJson.scripts["verify:release"]).toContain("test:e2e");
    expect(pullRequestWorkflow).toContain("npm run test:e2e");
    expect(releaseWorkflow).toContain("npm run verify:release");
    expect(objectStorage).not.toContain("minio/minio:latest");
    expect(production).toContain("scripts/workers/run.mjs");
    expect(production).toContain("/api/health/ready");
    expect(ingress).toContain("client_max_body_size 28m");
  });

  it("repairs interrupted Chromium extraction and serializes PDF runtime tests", () => {
    const renderer = source("src/lib/server/html-to-pdf.ts");
    const vitest = source("vitest.config.ts");
    const playwright = source("playwright.config.ts");
    const browserAudit = source("tests/e2e/support/audit.ts");
    const browserRuntime = source("tests/e2e/support/runtime.ts");
    const styles = source("src/app/globals.css");
    const packageJson = JSON.parse(source("package.json")) as { scripts: Record<string, string> };
    expect(renderer).toContain("removeEmptyBundledExecutable");
    expect(renderer).toContain("Bundled Chromium executable is missing, empty, or not executable");
    expect(vitest).toContain("maxWorkers: 1");
    expect(playwright).toContain("--hostname 127.0.0.1");
    expect(playwright).toContain("APP_URL: baseURL");
    expect(playwright).toContain("timeout: 240_000");
    expect(playwright).toContain("fullyParallel: true");
    expect(playwright).toContain("workers: 2");
    expect(playwright).not.toContain("agencyos-public-browser-test-placeholder");
    expect(playwright).not.toContain("SUPABASE");
    expect(packageJson.scripts["test:e2e"]).toContain("--env-file-if-exists=.env.local");
    expect(browserAudit).toContain("log out|logout");
    expect(browserAudit).toContain("duplicateOrdinal");
    expect(browserAudit).not.toContain(".nth(control.index)");
    expect(browserAudit).toContain('outcome: "skipped-navigation"');
    expect(browserAudit).toContain('outcome: "skipped-cross-cutting"');
    expect(browserAudit).toContain('"skipped-mutation"');
    expect(browserAudit).toContain("const submitsForm");
    expect(browserAudit).toContain("formIsValid");
    expect(browserAudit).toContain("page.waitForResponse(");
    expect(browserAudit).toContain("restoreFinalSecondaryState");
    expect(browserAudit).toContain("const requiresFreshPage");
    expect(browserAudit).toContain("applicationFocusVisible");
    expect(browserAudit).toContain("zoomLayout.documentWidth");
    expect(browserAudit).toContain("await page.waitForTimeout(350)");
    expect(browserRuntime).toContain('url.pathname !== "/login"');
    expect(browserRuntime).toContain('errorText === "net::ERR_ABORTED"');
    expect(styles).toMatch(/\.finance-section__heading\s*\{[\s\S]*?flex-wrap:\s*wrap/);
    expect(styles).toMatch(
      /@media \(max-width: 700px\)[\s\S]*?\.finance-section__heading\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/,
    );
    expect(styles).toMatch(
      /\.hr-workspace,[\s\S]*?\.hr-section\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?max-width:\s*100%/,
    );
    expect(styles).toMatch(/\.hr-workspace\s*\{[\s\S]*?overflow-x:\s*clip/);
    expect(styles).toMatch(
      /\.settings-area-grid\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?max-width:\s*100%/,
    );
    expect(styles).toMatch(
      /\.table-wrap\s*\{[\s\S]*?overflow-x:\s*auto;[\s\S]*?contain:\s*inline-size paint/,
    );
    expect(styles).toMatch(
      /@media \(max-width: 960px\)[\s\S]*?\.automation-grid,[\s\S]*?\.automation-ai-grid,[\s\S]*?\.vaultwarden-form-grid\s*\{\s*grid-template-columns: 1fr/,
    );
    expect(styles).toMatch(/\.automation-warning > span\s*\{[\s\S]*?overflow-wrap: anywhere/);
  });
});
