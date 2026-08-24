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
import { attachRuntimeEvidence, installFailureHooks } from "./support/runtime";

const matrix = JSON.parse(
  readFileSync(join(process.cwd(), "tests/browser/route-matrix.json"), "utf8"),
) as { public: Array<{ route: string; feature: string; testSection: string }> };

for (const entry of matrix.public) {
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
    const exercised = await exerciseVisibleControls(page, entry.route, { allowDestructive: false });
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
