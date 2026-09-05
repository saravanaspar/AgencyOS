import { expect, test } from "@playwright/test";

import {
  attachRuntimeEvidence,
  installFailureHooks,
  login,
  parseBrowserAccounts,
} from "./support/runtime";

const account = parseBrowserAccounts()[0];
const isolated = process.env.AGENCYOS_E2E_CONFIRM_ISOLATED === "1";

test("F31-SEARCH: command palette searches once without rate-limit errors", async ({
  page,
}, testInfo) => {
  test.skip(!isolated || !account, "Requires a disposable account and isolation flag.");
  await login(page, account!);
  const failures = installFailureHooks(page);

  await page.getByRole("button", { name: /search records and modules/i }).click();
  const search = page.getByRole("textbox", { name: "Search AgencyOS" });
  await expect(search).toBeVisible();
  const responsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/search" && response.request().method() === "GET",
  );
  await search.fill("E2E");
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  await expect(page.getByRole("dialog", { name: "Search AgencyOS" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Search AgencyOS" })).not.toBeVisible();

  await attachRuntimeEvidence(testInfo, page, failures);
  expect(failures).toEqual({
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    serverErrors: [],
  });
});
