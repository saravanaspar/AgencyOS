import "server-only";

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import * as cheerio from "cheerio";

import { readMinioObject } from "@/integrations/minio/object-storage";
import {
  getHrBuiltinDocumentTemplate,
  isSupportedHrDocumentPlaceholder,
  type HrDocumentTemplateSource,
  type HrDocumentType,
} from "@/modules/hr/documents";
import { escapeHtml } from "@/modules/finance/pdf/html";

export const HR_DOCUMENT_TEMPLATE_MAX_BYTES = 512 * 1024;

const builtinDirectory = path.join(
  process.cwd(),
  "src",
  "modules",
  "hr",
  "document-templates",
  "builtin",
);
const builtinCache = new Map<string, Promise<string>>();
const allowedElements = new Set([
  "address",
  "article",
  "b",
  "blockquote",
  "body",
  "br",
  "code",
  "col",
  "colgroup",
  "dd",
  "div",
  "dl",
  "dt",
  "em",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "header",
  "hr",
  "html",
  "i",
  "li",
  "main",
  "meta",
  "ol",
  "p",
  "pre",
  "section",
  "small",
  "span",
  "strong",
  "style",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "title",
  "tr",
  "u",
  "ul",
]);
const allowedGlobalAttributes = new Set([
  "aria-hidden",
  "aria-label",
  "class",
  "dir",
  "id",
  "lang",
  "role",
  "style",
  "title",
]);
const allowedElementAttributes: Readonly<Record<string, ReadonlySet<string>>> = {
  col: new Set(["span"]),
  colgroup: new Set(["span"]),
  html: new Set(["dir", "lang"]),
  li: new Set(["value"]),
  meta: new Set(["charset"]),
  ol: new Set(["reversed", "start", "type"]),
  td: new Set(["colspan", "headers", "rowspan"]),
  th: new Set(["colspan", "headers", "rowspan", "scope"]),
};
const placeholderPattern = /\{\{\s*([a-z][a-z0-9_.]{0,100})\s*\}\}/gi;

function containsUnsafeCss(value: string): boolean {
  return (
    /url\s*\(|image-set\s*\(|expression\s*\(|javascript:|vbscript:|-moz-binding|behavior\s*:/i.test(
      value,
    ) ||
    /(?:https?:|file:|data:|blob:|\\\\)/i.test(value) ||
    /@(?!page\b)[a-z-]+/i.test(value)
  );
}

export interface HrResolvedTemplate {
  source: HrDocumentTemplateSource;
  key: string;
  id: string | null;
  name: string;
  version: number;
  documentType: HrDocumentType;
  html: string;
  sha256: string;
}

export interface HrTemplateRecord {
  id: string;
  name: string;
  version: number;
  documentType: HrDocumentType;
  storageBucket: string;
  storagePath: string;
  sha256: string;
}

export interface HrDocumentRenderValues {
  [key: string]: string;
}

function digest(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function decodeTemplate(buffer: Buffer): string {
  if (!buffer.length || buffer.length > HR_DOCUMENT_TEMPLATE_MAX_BYTES) {
    throw new Error("hr-document-template-size-invalid");
  }
  if (buffer.includes(0)) throw new Error("hr-document-template-encoding-invalid");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error("hr-document-template-encoding-invalid");
  }
}

function extractPlaceholders(html: string): string[] {
  const keys = new Set<string>();
  for (const match of html.matchAll(placeholderPattern)) {
    const key = match[1]?.toLowerCase();
    if (key) keys.add(key);
  }
  return [...keys].sort();
}

export function validateAndNormalizeHrTemplateHtml(input: string): {
  html: string;
  placeholders: string[];
} {
  if (!input.trim()) throw new Error("hr-document-template-empty");
  if (Buffer.byteLength(input, "utf8") > HR_DOCUMENT_TEMPLATE_MAX_BYTES) {
    throw new Error("hr-document-template-size-invalid");
  }
  const lower = input.toLowerCase();
  if (
    lower.includes("javascript:") ||
    lower.includes("vbscript:") ||
    lower.includes("@import") ||
    /url\s*\(|image-set\s*\(|expression\s*\(|-moz-binding|behavior\s*:/i.test(input)
  ) {
    throw new Error("hr-document-template-unsafe-css-or-url");
  }

  const $ = cheerio.load(input, { xmlMode: false });
  $("*").each((_, element) => {
    if (!("tagName" in element) || typeof element.tagName !== "string") return;
    const tagName = element.tagName.toLowerCase();
    if (!allowedElements.has(tagName)) {
      throw new Error(`hr-document-template-blocked-element:${tagName}`);
    }
    for (const attribute of [
      ...((element as unknown as { attribs?: Record<string, string> }).attribs
        ? Object.keys((element as unknown as { attribs: Record<string, string> }).attribs)
        : []),
    ]) {
      const normalized = attribute.toLowerCase();
      const value = $(element).attr(attribute) ?? "";
      const allowedForElement = allowedElementAttributes[tagName];
      if (
        !allowedGlobalAttributes.has(normalized) &&
        !(allowedForElement?.has(normalized) ?? false)
      ) {
        throw new Error(`hr-document-template-blocked-attribute:${normalized}`);
      }
      if (value.length > 2_048) {
        throw new Error(`hr-document-template-attribute-too-long:${normalized}`);
      }
      if (value.includes("{{")) {
        throw new Error("hr-document-template-placeholder-in-attribute");
      }
      if (normalized === "style" && containsUnsafeCss(value)) {
        throw new Error("hr-document-template-unsafe-inline-style");
      }
    }
  });

  $("style").each((_, element) => {
    if (containsUnsafeCss($(element).html() ?? "")) {
      throw new Error("hr-document-template-unsafe-style");
    }
  });

  if (
    $("style")
      .toArray()
      .some((element) => $(element).html()?.includes("{{"))
  ) {
    throw new Error("hr-document-template-placeholder-in-style");
  }

  if (!$("html").length) {
    throw new Error("hr-document-template-html-root-required");
  }
  if (!$("body").length) throw new Error("hr-document-template-body-required");
  if (!$("meta[charset]").length) $("head").prepend('<meta charset="utf-8">');

  const html = `<!doctype html>${$.html()}`;
  const placeholders = extractPlaceholders(html);
  const unsupported = placeholders.filter((key) => !isSupportedHrDocumentPlaceholder(key));
  if (unsupported.length) {
    throw new Error(`hr-document-template-unsupported-placeholder:${unsupported.join(",")}`);
  }
  if (!placeholders.includes("employee.legal_name")) {
    throw new Error("hr-document-template-employee-placeholder-required");
  }
  if (!placeholders.includes("organization.legal_name")) {
    throw new Error("hr-document-template-organization-placeholder-required");
  }
  return { html, placeholders };
}

async function loadBuiltinHtml(key: string): Promise<string> {
  const definition = getHrBuiltinDocumentTemplate(key);
  const existing = builtinCache.get(definition.fileName);
  if (existing) return existing;
  const loading = readFile(path.join(builtinDirectory, definition.fileName), "utf8");
  builtinCache.set(definition.fileName, loading);
  return loading;
}

export async function resolveBuiltinHrTemplate(key: string): Promise<HrResolvedTemplate> {
  const definition = getHrBuiltinDocumentTemplate(key);
  const source = await loadBuiltinHtml(key);
  const normalized = validateAndNormalizeHrTemplateHtml(source);
  return {
    source: "builtin",
    key: definition.key,
    id: null,
    name: definition.name,
    version: 1,
    documentType: definition.documentType,
    html: normalized.html,
    sha256: digest(normalized.html),
  };
}

export async function resolveMinioHrTemplate(
  record: HrTemplateRecord,
): Promise<HrResolvedTemplate> {
  const buffer = await readMinioObject(record.storageBucket, record.storagePath, {
    maxBytes: HR_DOCUMENT_TEMPLATE_MAX_BYTES,
  });
  const actualDigest = digest(buffer);
  if (actualDigest !== record.sha256) throw new Error("hr-document-template-integrity-mismatch");
  const normalized = validateAndNormalizeHrTemplateHtml(decodeTemplate(buffer));
  return {
    source: "minio",
    key: record.id,
    id: record.id,
    name: record.name,
    version: record.version,
    documentType: record.documentType,
    html: normalized.html,
    sha256: actualDigest,
  };
}

export function compileHrDocumentTemplate(
  template: HrResolvedTemplate,
  values: HrDocumentRenderValues,
): string {
  const required = extractPlaceholders(template.html);
  const missing = required.filter((key) => !(key in values));
  if (missing.length) throw new Error(`hr-document-template-missing-values:${missing.join(",")}`);
  const output = template.html.replace(placeholderPattern, (_match, rawKey: string) => {
    const key = rawKey.toLowerCase();
    return escapeHtml(values[key] ?? "");
  });
  if (placeholderPattern.test(output))
    throw new Error("hr-document-template-unresolved-placeholder");
  return output;
}
