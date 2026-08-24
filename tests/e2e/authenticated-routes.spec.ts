import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import {
  assertAccessibility,
  assertKeyboardAndResponsiveBasics,
  collectInteractiveCoverage,
  exerciseVisibleControls,
  openSecondaryStates,
} from "./support/audit";
import {
  attachRuntimeEvidence,
  installFailureHooks,
  login,
  parseBrowserAccounts,
  routeAllowed,
} from "./support/runtime";

const matrix = JSON.parse(
  readFileSync(join(process.cwd(), "tests/browser/route-matrix.json"), "utf8"),
) as { authenticated: Array<{ route: string; feature: string; testSection: string }> };
const accounts = parseBrowserAccounts();
const isolated = process.env.AGENCYOS_E2E_CONFIRM_ISOLATED === "1";

test.describe("authenticated route evidence", () => {
  test.skip(!isolated || accounts.length === 0, "Requires disposable accounts and isolation flag.");

  for (const account of accounts) {
    test.describe(account.name, () => {
      test.beforeEach(async ({ page }) => login(page, account));

      for (const entry of matrix.authenticated.filter((candidate) =>
        routeAllowed(account, candidate.route),
      )) {
        test(`${entry.testSection}: ${entry.feature}`, async ({ page }, testInfo) => {
          const failures = installFailureHooks(page);
          const response = await page.goto(entry.route, { waitUntil: "networkidle" });
          expect(response?.status() ?? 200).toBeLessThan(500);
          await openSecondaryStates(page);
          const controls = await collectInteractiveCoverage(page);
          await testInfo.attach("ui-controls.json", {
            body: JSON.stringify(controls, null, 2),
            contentType: "application/json",
          });
          const exercised = await exerciseVisibleControls(page, entry.route, {
            allowDestructive: process.env.AGENCYOS_E2E_CLICK_DESTRUCTIVE === "1",
          });
          await testInfo.attach("exercised-controls.json", {
            body: JSON.stringify(exercised, null, 2),
            contentType: "application/json",
          });
          expect(controls.filter((control) => control.visible && !control.name)).toEqual([]);
          await page.goto(entry.route, { waitUntil: "networkidle" });
          await openSecondaryStates(page);
          await assertKeyboardAndResponsiveBasics(page);
          await assertAccessibility(page, testInfo);
          await attachRuntimeEvidence(testInfo, page, failures);
          expect(failures).toEqual({
            consoleErrors: [],
            pageErrors: [],
            failedRequests: [],
            serverErrors: [],
          });
        });
      }
    });
  }
});
