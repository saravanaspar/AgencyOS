import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo } from "@playwright/test";

const interactiveSelector = [
  "a[href]",
  "button",
  "summary",
  "input:not([type=hidden])",
  "select",
  "textarea",
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
].join(",");

export async function openSecondaryStates(page: Page): Promise<void> {
  const summaries = page.locator("details:not([open]) > summary:visible");
  for (let index = 0; index < (await summaries.count()); index += 1) {
    await summaries
      .nth(index)
      .press("Enter")
      .catch(() => undefined);
  }

  const tabs = page.getByRole("tab");
  for (let index = 0; index < (await tabs.count()); index += 1) {
    const tab = tabs.nth(index);
    if (await tab.isVisible()) await tab.click().catch(() => undefined);
  }
}

export async function assertAccessibility(page: Page, testInfo: TestInfo): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  await testInfo.attach("axe-results.json", {
    body: JSON.stringify(results, null, 2),
    contentType: "application/json",
  });
  expect(results.violations, "Axe accessibility violations").toEqual([]);
}

export interface InteractiveControlEvidence {
  index: number;
  tag: string;
  role: string | null;
  name: string;
  visible: boolean;
  disabled: boolean;
  width: number;
  height: number;
  href: string | null;
}

export async function collectInteractiveCoverage(
  page: Page,
): Promise<InteractiveControlEvidence[]> {
  return page.locator(interactiveSelector).evaluateAll((elements) =>
    elements.map((element, index) => {
      const html = element as HTMLElement;
      const rect = html.getBoundingClientRect();
      const style = window.getComputedStyle(html);
      const visible =
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        rect.width > 0 &&
        rect.height > 0;
      const associatedLabel =
        element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement
          ? element.labels?.[0]?.textContent
          : null;
      const name = (
        element.getAttribute("aria-label") ||
        associatedLabel ||
        element.getAttribute("title") ||
        element.textContent ||
        (element instanceof HTMLInputElement ? element.value || element.placeholder : "")
      )
        .replace(/\s+/g, " ")
        .trim();
      return {
        index,
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute("role"),
        name,
        visible,
        disabled:
          element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true",
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        href: element instanceof HTMLAnchorElement ? element.href : null,
      };
    }),
  );
}

export async function assertKeyboardAndResponsiveBasics(page: Page): Promise<void> {
  await page.keyboard.press("Tab");
  const focused = page.locator(":focus");
  await expect(focused).toBeVisible();

  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(horizontalOverflow, "Page should not have horizontal viewport overflow").toBe(false);

  const originalViewport = page.viewportSize();
  if (!originalViewport) throw new Error("A fixed viewport is required for responsive tests.");
  await page.setViewportSize({
    width: Math.max(320, Math.floor(originalViewport.width / 2)),
    height: originalViewport.height,
  });
  const overflowAtZoom = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  await page.setViewportSize(originalViewport);
  expect(overflowAtZoom, "Page should reflow at 200% zoom").toBe(false);
}

const destructivePattern =
  /\b(delete|remove|archive|void|cancel|revoke|reject|disable|terminate|reset mfa|sign out)\b/i;

export interface ExercisedControlEvidence {
  name: string;
  tag: string;
  outcome:
    "clicked" | "filled" | "selected" | "toggled" | "skipped-destructive" | "skipped-unavailable";
  finalUrl: string;
}

export async function exerciseVisibleControls(
  page: Page,
  route: string,
  options: { allowDestructive: boolean },
): Promise<ExercisedControlEvidence[]> {
  await page.goto(route, { waitUntil: "networkidle" });
  await openSecondaryStates(page);
  const baseline = await collectInteractiveCoverage(page);
  const evidence: ExercisedControlEvidence[] = [];

  for (const control of baseline) {
    if (!control.visible || control.disabled || !control.name) continue;
    if (destructivePattern.test(control.name) && !options.allowDestructive) {
      evidence.push({
        name: control.name,
        tag: control.tag,
        outcome: "skipped-destructive",
        finalUrl: page.url(),
      });
      continue;
    }

    await page.goto(route, { waitUntil: "networkidle" });
    await openSecondaryStates(page);
    const locator = page.locator(interactiveSelector).nth(control.index);
    if (!(await locator.isVisible().catch(() => false))) {
      evidence.push({
        name: control.name,
        tag: control.tag,
        outcome: "skipped-unavailable",
        finalUrl: page.url(),
      });
      continue;
    }

    const tag = await locator.evaluate((element) => element.tagName.toLowerCase());
    const type = await locator.getAttribute("type");
    let outcome: ExercisedControlEvidence["outcome"] = "clicked";
    try {
      if (
        tag === "textarea" ||
        (tag === "input" &&
          !["button", "submit", "reset", "checkbox", "radio", "file"].includes(type ?? "text"))
      ) {
        const fillValue =
          type === "email"
            ? "e2e-control@example.test"
            : type === "number"
              ? "1"
              : "E2E control audit";
        await locator.fill(
          fillValue.slice(0, Number(await locator.getAttribute("maxlength")) || 80),
        );
        outcome = "filled";
      } else if (tag === "select") {
        const option = locator.locator("option:not([disabled])").nth(1);
        const value = await option.getAttribute("value").catch(() => null);
        if (value != null) await locator.selectOption(value);
        outcome = "selected";
      } else if (type === "checkbox" || type === "radio") {
        await locator.click({ timeout: 5_000 });
        outcome = "toggled";
      } else if (type === "file") {
        outcome = "skipped-unavailable";
      } else {
        const navigation = page
          .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 2_000 })
          .catch(() => null);
        await locator.click({ timeout: 5_000 });
        await navigation;
        await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
      }
    } catch {
      outcome = "skipped-unavailable";
    }
    evidence.push({ name: control.name, tag: control.tag, outcome, finalUrl: page.url() });
  }
  return evidence;
}
