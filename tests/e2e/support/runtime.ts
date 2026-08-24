import { createHmac } from "node:crypto";

import type { Page, TestInfo } from "@playwright/test";

export interface BrowserAccount {
  name: string;
  email: string;
  password: string;
  mfaSecret?: string;
  routes?: string[];
}

export interface RuntimeFailures {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  serverErrors: string[];
}

export function parseBrowserAccounts(): BrowserAccount[] {
  const raw = process.env.AGENCYOS_E2E_ACCOUNTS_JSON;
  if (raw) {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("AGENCYOS_E2E_ACCOUNTS_JSON must be an array.");
    return parsed as BrowserAccount[];
  }

  const email = process.env.AGENCYOS_E2E_OWNER_EMAIL;
  const password = process.env.AGENCYOS_E2E_OWNER_PASSWORD;
  if (!email || !password) return [];
  return [{ name: "owner", email, password, routes: ["*"] }];
}

export function installFailureHooks(page: Page): RuntimeFailures {
  const failures: RuntimeFailures = {
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    serverErrors: [],
  };

  page.on("console", (message) => {
    if (message.type() === "error") failures.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => failures.pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    const url = request.url();
    if (url.startsWith("data:") || url.includes("favicon.ico")) return;
    failures.failedRequests.push(
      `${request.method()} ${url} ${request.failure()?.errorText ?? "request failed"}`,
    );
  });
  page.on("response", (response) => {
    if (response.status() >= 500)
      failures.serverErrors.push(`${response.status()} ${response.url()}`);
  });

  return failures;
}

export async function attachRuntimeEvidence(
  testInfo: TestInfo,
  page: Page,
  failures: RuntimeFailures,
): Promise<void> {
  const ariaSnapshot = await page
    .locator("body")
    .ariaSnapshot()
    .catch(() => "unavailable");
  await testInfo.attach("runtime-evidence.json", {
    body: JSON.stringify(
      {
        url: page.url(),
        viewport: page.viewportSize(),
        failures,
        ariaSnapshot,
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
}

function decodeBase32(value: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = value.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid TOTP secret.");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

export function generateTotp(secret: string, now = Date.now()): string {
  const counter = Math.floor(now / 30_000);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    (((digest[offset] & 0x7f) << 24) |
      ((digest[offset + 1] & 0xff) << 16) |
      ((digest[offset + 2] & 0xff) << 8) |
      (digest[offset + 3] & 0xff)) %
    1_000_000;
  return code.toString().padStart(6, "0");
}

export async function login(page: Page, account: BrowserAccount): Promise<void> {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(account.email);
  await page.getByLabel(/password/i).fill(account.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForLoadState("networkidle");

  if (page.url().includes("/mfa")) {
    if (!account.mfaSecret) {
      throw new Error(
        `MFA is required for ${account.name}; provide mfaSecret for the disposable account.`,
      );
    }
    await page.getByLabel(/authenticator code/i).fill(generateTotp(account.mfaSecret));
    await page.getByRole("button", { name: /verify code/i }).click();
    await page.waitForLoadState("networkidle");
    if (page.url().includes("/mfa"))
      throw new Error(`MFA verification failed for ${account.name}.`);
  }
}

export function routeAllowed(account: BrowserAccount, route: string): boolean {
  const allowed = account.routes ?? ["*"];
  return allowed.includes("*") || allowed.some((candidate) => route.startsWith(candidate));
}
