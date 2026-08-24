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
    const minio = source("compose.minio.yaml");
    const production = source("compose.production.yaml");
    const ingress = source("deploy/nginx/agencyos.conf");
    expect(packageJson.scripts["verify:release"]).toContain("db:test");
    expect(packageJson.scripts["verify:release"]).toContain("test:e2e");
    expect(pullRequestWorkflow).toContain("npm run test:e2e");
    expect(releaseWorkflow).toContain("npm run verify:release");
    expect(minio).not.toContain("minio/minio:latest");
    expect(production).toContain("scripts/workers/run.mjs");
    expect(production).toContain("/api/health/ready");
    expect(ingress).toContain("client_max_body_size 28m");
  });

  it("repairs interrupted Chromium extraction and serializes PDF runtime tests", () => {
    const renderer = source("src/lib/server/html-to-pdf.ts");
    const vitest = source("vitest.config.ts");
    const playwright = source("playwright.config.ts");
    expect(renderer).toContain("removeEmptyBundledExecutable");
    expect(renderer).toContain("Bundled Chromium executable is missing, empty, or not executable");
    expect(vitest).toContain("maxWorkers: 1");
    expect(playwright).toContain("--hostname 127.0.0.1");
    expect(playwright).toContain("NEXT_PUBLIC_APP_URL: baseURL");
    expect(playwright).not.toContain("agencyos-public-browser-test-placeholder");
    expect(playwright).not.toContain("SUPABASE");
  });
});
