import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BUTTON_TAGS = new Set(["button", "Button"]);
const LINK_TAGS = new Set(["a", "Link"]);
const FORM_CONTROL_TAGS = new Set(["input", "select", "textarea"]);
const INTERACTIVE_ROLES = new Set([
  "button",
  "checkbox",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
]);

function walk(directory) {
  return readdirSync(directory)
    .flatMap((entry) => {
      const path = join(directory, entry);
      const stats = statSync(path);
      return stats.isDirectory() ? walk(path) : [path];
    })
    .filter((path) => path.endsWith(".tsx"));
}

function jsxTagName(tagName) {
  if (ts.isIdentifier(tagName)) return tagName.text;
  return tagName.getText();
}

function attributeMap(attributes) {
  const map = new Map();
  let hasSpread = false;

  for (const property of attributes.properties) {
    if (ts.isJsxSpreadAttribute(property)) {
      hasSpread = true;
      continue;
    }

    map.set(property.name.getText(), property.initializer ?? true);
  }

  return { map, hasSpread };
}

function staticAttributeValue(initializer) {
  if (typeof initializer === "string") return initializer;
  if (initializer === true) return "true";
  if (ts.isStringLiteral(initializer)) return initializer.text;
  if (ts.isJsxExpression(initializer)) {
    const expression = initializer.expression;
    if (!expression) return "";
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
      return expression.text;
    }
    if (expression.kind === ts.SyntaxKind.TrueKeyword) return "true";
    if (expression.kind === ts.SyntaxKind.FalseKeyword) return "false";
    return `{${expression.getText()}}`;
  }
  return initializer.getText();
}

function hasMeaningfulChild(children) {
  return children.some((child) => {
    if (ts.isJsxText(child)) return child.getText().trim().length > 0;
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
      const tag = jsxTagName(ts.isJsxElement(child) ? child.openingElement.tagName : child.tagName);
      if (["svg", "Icon", "LoaderCircle"].includes(tag)) return false;
      return true;
    }
    if (ts.isJsxExpression(child)) {
      if (!child.expression) return false;
      if (ts.isStringLiteral(child.expression)) return child.expression.text.trim().length > 0;
      return true;
    }
    return false;
  });
}

function controlKind(node, tag, attributes) {
  const role = staticAttributeValue(attributes.map.get("role") ?? "").toLowerCase();
  if (role && INTERACTIVE_ROLES.has(role)) return role;
  if (BUTTON_TAGS.has(tag)) return "button";
  if (LINK_TAGS.has(tag)) return "link";
  if (tag === "summary") return "disclosure";
  if (tag === "select") return "select";
  if (tag === "textarea") return "textbox";
  if (tag === "input") {
    const type = staticAttributeValue(attributes.map.get("type") ?? "text").toLowerCase();
    if (type === "hidden") return null;
    if (["button", "submit", "reset", "image"].includes(type)) return "button";
    if (["checkbox", "radio", "range"].includes(type)) return type;
    return "textbox";
  }
  if (attributes.map.has("onClick") || attributes.map.has("onKeyDown")) return "custom";
  return null;
}

function determineLabel(node, tag, attributes) {
  const ariaLabel = attributes.map.get("aria-label");
  if (ariaLabel) return { kind: "aria-label", value: staticAttributeValue(ariaLabel) };

  const labelledBy = attributes.map.get("aria-labelledby");
  if (labelledBy) return { kind: "aria-labelledby", value: staticAttributeValue(labelledBy) };

  if (tag === "input") {
    const value = attributes.map.get("value");
    const placeholder = attributes.map.get("placeholder");
    if (value) return { kind: "value", value: staticAttributeValue(value) };
    if (placeholder) return { kind: "placeholder", value: staticAttributeValue(placeholder) };
  }

  if (ts.isJsxElement(node) && hasMeaningfulChild(node.children)) {
    return { kind: "children", value: "rendered child content" };
  }

  const title = attributes.map.get("title");
  if (title) return { kind: "title", value: staticAttributeValue(title) };

  const id = attributes.map.get("id");
  if (id && FORM_CONTROL_TAGS.has(tag)) {
    return { kind: "associated-label", value: `label[for=${staticAttributeValue(id)}]` };
  }

  if (attributes.hasSpread) return { kind: "spread", value: "provided by spread props" };

  return null;
}

function determineAction(tag, attributes, kind) {
  const type = staticAttributeValue(attributes.map.get("type") ?? "").toLowerCase();
  if (type === "submit") return "submit";
  if (type === "reset") return "reset";
  if (attributes.map.has("href")) return "navigate";
  if (tag === "summary") return "toggle";
  if (attributes.map.has("onClick")) return "onClick";
  if (attributes.map.has("onChange")) return "onChange";
  if (attributes.map.has("onInput")) return "onInput";
  if (attributes.map.has("onKeyDown")) return "onKeyDown";
  if (attributes.map.has("formAction")) return "formAction";
  if (attributes.map.has("disabled")) return "disabled";
  if (attributes.map.has("aria-disabled")) return "aria-disabled";
  if (attributes.hasSpread) return "spread";
  if (["textbox", "checkbox", "radio", "range", "select", "slider", "spinbutton"].includes(kind)) {
    return "form-control";
  }
  return "none";
}

export function collectUiControlInventory(root = ROOT) {
  const sourceRoot = join(root, "src");
  const controls = [];
  const violations = [];
  const files = walk(sourceRoot);

  for (const absolutePath of files) {
    const code = readFileSync(absolutePath, "utf8");
    const sourceFile = ts.createSourceFile(
      absolutePath,
      code,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );

    function visit(node) {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const opening = ts.isJsxElement(node) ? node.openingElement : node;
        const tag = jsxTagName(opening.tagName);
        const attributes = attributeMap(opening.attributes);
        const kind = controlKind(node, tag, attributes);

        if (kind) {
          const position = sourceFile.getLineAndCharacterOfPosition(opening.getStart(sourceFile));
          const file = relative(root, absolutePath).replaceAll("\\", "/");
          const label = determineLabel(node, tag, attributes);
          const action = determineAction(tag, attributes, kind);
          const control = {
            file,
            line: position.line + 1,
            column: position.character + 1,
            tag,
            kind,
            label,
            action,
          };
          controls.push(control);

          const needsDirectAccessibleName = [
            "button",
            "link",
            "tab",
            "menuitem",
            "menuitemcheckbox",
            "menuitemradio",
            "disclosure",
            "custom",
          ].includes(kind);
          if (needsDirectAccessibleName && (!label || !label.value || label.value === "{}")) {
            violations.push({
              ...control,
              rule: "accessible-name",
              message:
                "Interactive controls need rendered text, aria-label, aria-labelledby, a title, or an associated label.",
            });
          }

          if (action === "none") {
            violations.push({
              ...control,
              rule: "action",
              message:
                "Enabled interactive controls need navigation, an event handler, form behavior, or an explicit disabled state.",
            });
          }

          if (tag === "button" && !attributes.map.has("type")) {
            violations.push({
              ...control,
              rule: "explicit-type",
              message:
                "Raw button elements must declare type to prevent accidental form submission.",
            });
          }
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  const controlCountByKind = Object.fromEntries(
    [...new Set(controls.map((control) => control.kind))]
      .sort()
      .map((kind) => [kind, controls.filter((control) => control.kind === kind).length]),
  );

  return {
    generatedAt: new Date().toISOString(),
    sourceFileCount: files.length,
    controlCount: controls.length,
    controlCountByKind,
    controls,
    violations,
  };
}

function renderTextReport(inventory) {
  const breakdown = Object.entries(inventory.controlCountByKind)
    .map(([kind, count]) => `${kind}=${count}`)
    .join(", ");
  const lines = [
    `UI control inventory: ${inventory.controlCount} controls across ${inventory.sourceFileCount} TSX files.`,
    `Control kinds: ${breakdown}.`,
    `Violations: ${inventory.violations.length}.`,
  ];

  for (const violation of inventory.violations) {
    lines.push(
      `- ${violation.file}:${violation.line}:${violation.column} [${violation.rule}] ${violation.message}`,
    );
  }

  return lines.join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inventory = collectUiControlInventory(ROOT);
  const outputArgIndex = process.argv.indexOf("--output");
  if (outputArgIndex >= 0) {
    const outputPath = resolve(
      ROOT,
      process.argv[outputArgIndex + 1] ?? "test-results/ui-controls.json",
    );
    const outputDirectory = dirname(outputPath);
    if (!existsSync(outputDirectory)) {
      const { mkdirSync } = await import("node:fs");
      mkdirSync(outputDirectory, { recursive: true });
    }
    writeFileSync(outputPath, `${JSON.stringify(inventory, null, 2)}\n`);
  }

  console.log(renderTextReport(inventory));
  if (process.argv.includes("--check") && inventory.violations.length > 0) process.exitCode = 1;
}
