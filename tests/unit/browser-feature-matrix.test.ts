import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const matrix = JSON.parse(readFileSync(join(root, "tests/browser/route-matrix.json"), "utf8")) as {
  public: Array<{ route: string; feature: string; testSection: string }>;
  authenticated: Array<{ route: string; feature: string; testSection: string }>;
};
const documentedRoutes = new Set(
  [...matrix.public, ...matrix.authenticated].map((entry) => entry.route.split("?")[0]),
);

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function routeFromPage(path: string): string | null {
  const appRelative = relative(join(root, "src/app"), path).replaceAll("\\", "/");
  const segments = appRelative
    .replace(/(^|\/)page\.tsx$/, "")
    .split("/")
    .filter((segment) => segment && !segment.startsWith("("));
  if (segments.some((segment) => segment.startsWith("["))) return null;
  return `/${segments.join("/")}`.replace(/\/$/, "") || "/";
}

describe("browser feature route matrix", () => {
  it("covers every concrete application page and the dynamic AI module", () => {
    const pages = walk(join(root, "src/app")).filter((path) => path.endsWith("page.tsx"));
    const concreteRoutes = pages
      .map(routeFromPage)
      .filter((route): route is string => Boolean(route));

    expect([...documentedRoutes].sort()).toEqual([...new Set([...concreteRoutes, "/ai"])].sort());
  });

  it("links every browser route to a TEST.md feature section", () => {
    const testGuide = readFileSync(join(root, "TEST.md"), "utf8");
    for (const entry of [...matrix.public, ...matrix.authenticated]) {
      expect(entry.feature).not.toHaveLength(0);
      expect(entry.testSection).not.toHaveLength(0);
      expect(testGuide).toContain(entry.testSection);
    }
  });
});
