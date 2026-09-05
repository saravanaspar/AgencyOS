#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import ts from "typescript";

const root = resolve(process.argv[2] ?? process.cwd());
const sourceRoot = join(root, "src");
const hrRoot = join(sourceRoot, "modules", "hr");
const migrationsRoot = join(root, "database", "migrations");
const compilerPath = join(hrRoot, "server", "document-template-compiler.ts");
const storagePath = join(hrRoot, "server", "document-template-storage.ts");

async function filesUnder(directory, extensions) {
  const out = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (extensions.has(extname(entry.name))) out.push(full);
    }
  }
  await walk(directory);
  return out;
}

const failures = [];
const runtimeFiles = await filesUnder(sourceRoot, new Set([".ts", ".tsx", ".js", ".jsx"]));
const htmlInjectionPatterns = [
  ["dangerouslySetInnerHTML", /\bdangerouslySetInnerHTML\b/],
  ["innerHTML assignment", /\.innerHTML\s*=/],
  ["outerHTML assignment", /\.outerHTML\s*=/],
  ["insertAdjacentHTML", /\.insertAdjacentHTML\s*\(/],
  ["document.write", /\bdocument\.write\s*\(/],
];
for (const file of runtimeFiles) {
  const text = await readFile(file, "utf8");
  for (const [label, pattern] of htmlInjectionPatterns) {
    if (pattern.test(text)) failures.push(`${relative(root, file)} uses ${label}`);
  }
}

const compiler = await readFile(compilerPath, "utf8");
const storage = await readFile(storagePath, "utf8");
for (const marker of [
  "const allowedElements = new Set",
  "const allowedGlobalAttributes = new Set",
  "const allowedElementAttributes",
  "containsUnsafeCss",
  "validateAndNormalizeHrTemplateHtml",
  "hr-document-template-blocked-element",
  "hr-document-template-blocked-attribute",
  "hr-document-template-placeholder-in-attribute",
]) {
  if (!compiler.includes(marker)) failures.push(`HR HTML allowlist marker missing: ${marker}`);
}
if (!storage.includes("validateAndNormalizeHrTemplateHtml(decoded)")) {
  failures.push("Uploaded HR HTML templates are not routed through the shared allowlist validator");
}

const medicalNames = new Set([
  "medical",
  "diagnosis",
  "diagnoses",
  "allergy",
  "allergies",
  "medication",
  "medications",
  "bloodtype",
  "healthrecord",
  "medicalcondition",
  "disability",
  "disabilities",
]);
function normalizedName(value) {
  return String(value)
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}
function isMedicalName(value) {
  const normalized = normalizedName(value);
  return (
    medicalNames.has(normalized) || [...medicalNames].some((name) => normalized.startsWith(name))
  );
}
function nameText(name) {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))
    return name.text;
  return null;
}

let dedicatedMedicalCodeFound = false;
for (const file of await filesUnder(hrRoot, new Set([".ts", ".tsx"]))) {
  const source = ts.createSourceFile(
    file,
    await readFile(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const dedicated = relative(hrRoot, file).split(/[\\/]/).includes("medical");
  function visit(node) {
    if (
      (ts.isPropertySignature(node) ||
        ts.isPropertyDeclaration(node) ||
        ts.isPropertyAssignment(node) ||
        ts.isParameter(node) ||
        ts.isVariableDeclaration(node)) &&
      isMedicalName(nameText(node.name) ?? "")
    ) {
      if (!dedicated) {
        const pos = source.getLineAndCharacterOfPosition(node.getStart(source));
        failures.push(
          `${relative(root, file)}:${pos.line + 1} adds medical data outside src/modules/hr/medical`,
        );
      } else {
        dedicatedMedicalCodeFound = true;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

let dedicatedMedicalTableFound = false;
const sqlFiles = await filesUnder(migrationsRoot, new Set([".sql"]));
const columnPattern =
  /^\s*(medical(?:_[a-z0-9_]+)?|diagnos(?:is|es)(?:_[a-z0-9_]+)?|allerg(?:y|ies)(?:_[a-z0-9_]+)?|medications?(?:_[a-z0-9_]+)?|blood_type|health_record(?:_[a-z0-9_]+)?|medical_condition(?:_[a-z0-9_]+)?|disabilit(?:y|ies)(?:_[a-z0-9_]+)?)\s+(?:text|varchar|jsonb|uuid|date|boolean|integer|bigint|numeric|timestamp|timestamptz)\b/i;
const addColumnPattern =
  /alter\s+table\s+public\.([a-z0-9_]+)[\s\S]{0,500}?add\s+column(?:\s+if\s+not\s+exists)?\s+(medical(?:_[a-z0-9_]+)?|diagnos(?:is|es)(?:_[a-z0-9_]+)?|allerg(?:y|ies)(?:_[a-z0-9_]+)?|medications?(?:_[a-z0-9_]+)?|blood_type|health_record(?:_[a-z0-9_]+)?|medical_condition(?:_[a-z0-9_]+)?|disabilit(?:y|ies)(?:_[a-z0-9_]+)?)/gi;
for (const file of sqlFiles) {
  const text = await readFile(file, "utf8");
  const tableBlocks = [
    ...text.matchAll(/create\s+table\s+public\.([a-z0-9_]+)\s*\(([\s\S]*?)\n\);/gi),
  ];
  for (const [, table, body] of tableBlocks) {
    for (const line of body.split(/\r?\n/)) {
      if (!columnPattern.test(line)) continue;
      if (!table.startsWith("hr_medical_")) {
        failures.push(`${relative(root, file)} adds a medical column to general table ${table}`);
      } else dedicatedMedicalTableFound = true;
    }
  }
  for (const match of text.matchAll(addColumnPattern)) {
    const table = match[1];
    if (!table.startsWith("hr_medical_"))
      failures.push(`${relative(root, file)} adds medical column ${match[2]} to ${table}`);
    else dedicatedMedicalTableFound = true;
  }
}

if (dedicatedMedicalCodeFound || dedicatedMedicalTableFound) {
  const permissionDefined = (
    await Promise.all(sqlFiles.map((file) => readFile(file, "utf8")))
  ).some((text) => /\('hr'\s*,\s*'medical'\s*,\s*'(?:view|manage)'/i.test(text));
  if (!permissionDefined)
    failures.push("Dedicated HR medical data exists without hr.medical.* permissions");
}

if (failures.length) {
  console.error("Sensitive content boundary check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(
  `Sensitive content boundaries: PASS (${runtimeFiles.length} runtime files, ${sqlFiles.length} migrations)`,
);
console.log(
  "Rich HTML rendering remains allowlist-only; medical fields cannot enter the general HR model.",
);
