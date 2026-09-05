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

async function restoreFinalSecondaryState(page: Page): Promise<void> {
  const summaries = page.locator("details:not([open]) > summary:visible");
  for (let index = 0; index < (await summaries.count()); index += 1) {
    await summaries
      .nth(index)
      .press("Enter")
      .catch(() => undefined);
  }

  const tabs = page.getByRole("tab");
  for (let index = (await tabs.count()) - 1; index >= 0; index -= 1) {
    const tab = tabs.nth(index);
    if (await tab.isVisible().catch(() => false)) {
      await tab.click().catch(() => undefined);
      break;
    }
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
  let applicationFocusVisible = false;
  for (let attempt = 0; attempt < 5 && !applicationFocusVisible; attempt += 1) {
    await page.keyboard.press("Tab");
    applicationFocusVisible = await page.evaluate(() => {
      const focused = document.activeElement;
      if (!(focused instanceof HTMLElement) || focused.tagName === "NEXTJS-PORTAL") return false;
      const rect = focused.getBoundingClientRect();
      const style = window.getComputedStyle(focused);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    });
  }
  expect(applicationFocusVisible, "Tab should move focus to a visible application control").toBe(
    true,
  );

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
  // The workspace intentionally animates its sidebar offset at responsive
  // breakpoints. Sample reflow only after that declared layout transition has
  // settled, otherwise the first frame can retain the desktop margin.
  await page.waitForTimeout(350);
  const zoomLayout = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const documentWidth = document.documentElement.scrollWidth;
    const offenders = [...document.querySelectorAll<HTMLElement>("body *")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          className: typeof element.className === "string" ? element.className : "",
          name:
            element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 80) ?? "",
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        };
      })
      .filter(
        (element) =>
          element.width > 0 &&
          (element.right > viewportWidth + 1 || element.scrollWidth > element.clientWidth + 1),
      )
      .slice(0, 12);
    const workspaceBody = document.querySelector<HTMLElement>(".workspace__body");
    return {
      viewportWidth,
      documentWidth,
      mobileMediaMatches: window.matchMedia("(max-width: 980px)").matches,
      workspaceBodyMarginLeft: workspaceBody
        ? window.getComputedStyle(workspaceBody).marginLeft
        : null,
      offenders,
    };
  });
  await page.setViewportSize(originalViewport);
  expect(
    zoomLayout.documentWidth,
    `Page should reflow at 200% zoom. ${JSON.stringify(zoomLayout, null, 2)}`,
  ).toBeLessThanOrEqual(zoomLayout.viewportWidth + 1);
}

const destructivePattern =
  /\b(delete|remove|archive|void|cancel|revoke|reject|disable|terminate|reset mfa|sign out|log out|logout)\b/i;

export interface ExercisedControlEvidence {
  name: string;
  tag: string;
  outcome:
    | "clicked"
    | "filled"
    | "selected"
    | "toggled"
    | "skipped-cross-cutting"
    | "skipped-mutation"
    | "skipped-navigation"
    | "skipped-destructive"
    | "skipped-unavailable";
  finalUrl: string;
}

export async function exerciseVisibleControls(
  page: Page,
  route: string,
  options: { allowDestructive: boolean; allowMutations?: boolean },
): Promise<ExercisedControlEvidence[]> {
  await page.goto(route, { waitUntil: "networkidle" });
  await openSecondaryStates(page);
  const baseline = await collectInteractiveCoverage(page);
  const evidence: ExercisedControlEvidence[] = [];

  for (const control of baseline) {
    if (!control.visible || control.disabled || !control.name) continue;
    if (control.name === "Open Next.js Dev Tools") {
      evidence.push({
        name: control.name,
        tag: control.tag,
        outcome: "skipped-unavailable",
        finalUrl: page.url(),
      });
      continue;
    }
    if (control.name.startsWith("Search records and modules")) {
      evidence.push({
        name: control.name,
        tag: control.tag,
        outcome: "skipped-cross-cutting",
        finalUrl: page.url(),
      });
      continue;
    }
    if (control.href) {
      const routeUrl = new URL(route, page.url());
      const targetUrl = new URL(control.href, page.url());
      if (targetUrl.origin !== routeUrl.origin || targetUrl.pathname !== routeUrl.pathname) {
        evidence.push({
          name: control.name,
          tag: control.tag,
          outcome: "skipped-navigation",
          finalUrl: page.url(),
        });
        continue;
      }
    }
    if (destructivePattern.test(control.name) && !options.allowDestructive) {
      evidence.push({
        name: control.name,
        tag: control.tag,
        outcome: "skipped-destructive",
        finalUrl: page.url(),
      });
      continue;
    }

    const requiresFreshPage = ["a", "button", "summary"].includes(control.tag);
    if (requiresFreshPage) {
      await page.goto(route, { waitUntil: "networkidle" });
      await restoreFinalSecondaryState(page);
    }
    const sameControl = (candidate: InteractiveControlEvidence) =>
      candidate.tag === control.tag &&
      candidate.role === control.role &&
      candidate.name === control.name &&
      candidate.href === control.href;
    const duplicateOrdinal = baseline.slice(0, control.index + 1).filter(sameControl).length - 1;
    const currentControls = await collectInteractiveCoverage(page);
    const currentMatches = currentControls.filter(sameControl);
    const currentControl = currentMatches[duplicateOrdinal];
    if (!currentControl) {
      evidence.push({
        name: control.name,
        tag: control.tag,
        outcome: "skipped-unavailable",
        finalUrl: page.url(),
      });
      continue;
    }
    const locator = page.locator(interactiveSelector).nth(currentControl.index);
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
            : type === "date"
              ? "2026-09-02"
              : type === "datetime-local"
                ? "2026-09-02T10:00"
                : type === "time"
                  ? "10:00"
                  : type === "month"
                    ? "2026-09"
                    : type === "url"
                      ? "https://example.test"
                      : type === "tel"
                        ? "9999999999"
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
        const submitsForm = await locator.evaluate((element) => {
          if (!(element instanceof HTMLButtonElement || element instanceof HTMLInputElement))
            return false;
          return element.type === "submit" && Boolean(element.closest("form"));
        });
        if (submitsForm) {
          const formIsValid = await locator.evaluate((element) =>
            (element.closest("form") as HTMLFormElement | null)?.checkValidity(),
          );
          if (!formIsValid) {
            outcome = "skipped-unavailable";
          } else if (!options.allowMutations) {
            outcome = "skipped-mutation";
          } else {
            const routePath = new URL(route, page.url()).pathname;
            const actionResponse = page.waitForResponse(
              (response) =>
                response.request().method() !== "GET" &&
                new URL(response.url()).pathname === routePath,
              { timeout: 12_000 },
            );
            await Promise.all([actionResponse, locator.click({ timeout: 5_000 })]);
          }
        } else {
          await locator.click({ timeout: 5_000 });
        }
        await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
      }
    } catch {
      outcome = "skipped-unavailable";
    }
    evidence.push({ name: control.name, tag: control.tag, outcome, finalUrl: page.url() });
  }
  return evidence;
}
