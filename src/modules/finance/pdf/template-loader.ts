import { readFile } from "node:fs/promises";
import path from "node:path";

import { getInvoiceNinjaTemplate } from "@/modules/finance/pdf/catalog";
import type { InvoiceNinjaTemplateId } from "@/modules/finance/pdf/types";

const templateDirectory = path.join(
  process.cwd(),
  "src",
  "modules",
  "finance",
  "pdf",
  "templates",
  "invoice-ninja",
);

const textCache = new Map<string, Promise<string>>();
const bufferCache = new Map<string, Promise<Buffer>>();

function cachedText(fileName: string): Promise<string> {
  const existing = textCache.get(fileName);
  if (existing) return existing;
  const loading = readFile(path.join(templateDirectory, fileName), "utf8");
  textCache.set(fileName, loading);
  return loading;
}

function cachedBuffer(fileName: string): Promise<Buffer> {
  const existing = bufferCache.get(fileName);
  if (existing) return existing;
  const loading = readFile(path.join(templateDirectory, fileName));
  bufferCache.set(fileName, loading);
  return loading;
}

export async function loadInvoiceNinjaTemplate(
  templateId: InvoiceNinjaTemplateId,
): Promise<string> {
  getInvoiceNinjaTemplate(templateId);
  return cachedText(`${templateId}.html`);
}

export async function loadInvoiceNinjaFontDataUri(): Promise<string> {
  const bytes = await cachedBuffer("Roboto-Regular.ttf");
  return `data:font/ttf;base64,${bytes.toString("base64")}`;
}

export async function loadInvoiceNinjaTechHeroDataUri(): Promise<string> {
  const bytes = await cachedBuffer("tech-hero-image.jpg");
  return `data:image/jpeg;base64,${bytes.toString("base64")}`;
}
