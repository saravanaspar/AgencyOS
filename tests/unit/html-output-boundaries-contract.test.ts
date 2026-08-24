import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const sourceRoot = path.join(projectRoot, "src");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const absolute = path.join(directory, entry);
    if (statSync(absolute).isDirectory()) return sourceFiles(absolute);
    return /\.(?:js|jsx|ts|tsx)$/.test(entry) ? [absolute] : [];
  });
}

describe("HTML output boundaries", () => {
  it("has no raw browser HTML injection sinks in application source", () => {
    const forbiddenSinks = [
      /dangerouslySetInnerHTML/,
      /\.innerHTML\s*=/,
      /\.outerHTML\s*=/,
      /insertAdjacentHTML\s*\(/,
      /document\.write\s*\(/,
    ];
    const violations = sourceFiles(sourceRoot).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return forbiddenSinks
        .filter((pattern) => pattern.test(source))
        .map((pattern) => `${path.relative(projectRoot, file)}:${pattern.source}`);
    });

    expect(violations).toEqual([]);
  });

  it("keeps uploaded document HTML behind positive element and attribute allowlists", () => {
    const compiler = readFileSync(
      path.join(sourceRoot, "modules/hr/server/document-template-compiler.ts"),
      "utf8",
    );
    const renderer = readFileSync(path.join(sourceRoot, "lib/server/html-to-pdf.ts"), "utf8");

    expect(compiler).toContain("const allowedElements = new Set");
    expect(compiler).toContain("const allowedGlobalAttributes = new Set");
    expect(compiler).toContain("hr-document-template-blocked-element");
    expect(compiler).toContain("hr-document-template-blocked-attribute");
    expect(compiler).toContain("hr-document-template-placeholder-in-attribute");
    expect(renderer).toContain("setJavaScriptEnabled(false)");
    expect(renderer).toContain('request.abort("blockedbyclient")');
  });
});
