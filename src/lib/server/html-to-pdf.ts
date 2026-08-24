import "server-only";

import { constants } from "node:fs";
import { access, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import chromium from "@sparticuz/chromium";
import puppeteer, { type Browser, type PDFOptions } from "puppeteer-core";

const DEFAULT_RENDER_TIMEOUT_MS = 30_000;
const MAX_PDF_BYTES = 8 * 1024 * 1024;
const BUNDLED_CHROMIUM_CACHE_PATH = join(tmpdir(), "chromium");
let bundledExecutablePromise: Promise<string> | null = null;

export interface HtmlPdfDocument {
  html: string;
  pageSize?: PDFOptions["format"];
  landscape?: boolean;
}

function renderTimeout(): number {
  const configured = Number(
    process.env.HTML_PDF_RENDER_TIMEOUT_MS ?? process.env.FINANCE_PDF_RENDER_TIMEOUT_MS,
  );
  return Number.isFinite(configured) && configured >= 5_000 && configured <= 120_000
    ? configured
    : DEFAULT_RENDER_TIMEOUT_MS;
}

async function executableIsUsable(executablePath: string): Promise<boolean> {
  try {
    const details = await stat(executablePath);
    if (!details.isFile() || details.size <= 0) return false;
    await access(executablePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function removeEmptyBundledExecutable(): Promise<void> {
  try {
    const details = await stat(BUNDLED_CHROMIUM_CACHE_PATH);
    if (!details.isFile() || details.size > 0) return;
    await unlink(BUNDLED_CHROMIUM_CACHE_PATH);
  } catch (error) {
    if (
      !error ||
      typeof error !== "object" ||
      !("code" in error) ||
      Reflect.get(error, "code") !== "ENOENT"
    ) {
      throw error;
    }
  }
}

async function inflateBundledChromium(): Promise<string> {
  try {
    const executablePath = await chromium.executablePath();
    if (await executableIsUsable(executablePath)) return executablePath;
  } catch {
    // Interrupted extractions can leave an empty cache file. Repair it once below.
  }

  await removeEmptyBundledExecutable();
  const executablePath = await chromium.executablePath();
  if (!(await executableIsUsable(executablePath))) {
    throw new Error("Bundled Chromium executable is missing, empty, or not executable.");
  }
  return executablePath;
}

async function resolveExecutablePath(configuredExecutable?: string): Promise<string> {
  if (configuredExecutable) {
    if (!(await executableIsUsable(configuredExecutable))) {
      throw new Error("Configured Chromium executable is missing, empty, or not executable.");
    }
    return configuredExecutable;
  }
  bundledExecutablePromise ??= inflateBundledChromium();
  try {
    return await bundledExecutablePromise;
  } catch (error) {
    bundledExecutablePromise = null;
    throw error;
  }
}

async function launchBrowser(): Promise<Browser> {
  const configuredExecutable = (
    process.env.HTML_PDF_CHROMIUM_PATH ?? process.env.FINANCE_PDF_CHROMIUM_PATH
  )?.trim();
  const executablePath = await resolveExecutablePath(configuredExecutable);
  const args = configuredExecutable
    ? await puppeteer.defaultArgs({ headless: true })
    : await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" });

  return puppeteer.launch({
    args,
    executablePath,
    headless: configuredExecutable ? true : "shell",
    defaultViewport: { width: 1280, height: 1800, deviceScaleFactor: 1 },
  });
}

export async function renderHtmlToPdf(document: HtmlPdfDocument): Promise<Buffer> {
  const timeout = renderTimeout();
  let browser: Browser | null = null;

  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    page.setDefaultTimeout(timeout);
    page.setDefaultNavigationTimeout(timeout);
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const url = request.url();
      if (url === "about:blank" || url.startsWith("data:") || url.startsWith("blob:")) {
        void request.continue();
      } else {
        void request.abort("blockedbyclient");
      }
    });

    await page.setContent(document.html, { waitUntil: "domcontentloaded", timeout });
    await page.evaluate(async () => {
      const fonts = (globalThis.document as Document & { fonts?: { ready: Promise<unknown> } })
        .fonts;
      if (fonts) await fonts.ready;
    });
    await page.emulateMediaType("print");

    const bytes = Buffer.from(
      await page.pdf({
        format: document.pageSize ?? "A4",
        landscape: document.landscape ?? false,
        printBackground: true,
        preferCSSPageSize: true,
        tagged: true,
        timeout,
      }),
    );
    if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      throw new Error("HTML renderer returned invalid PDF output.");
    }
    if (bytes.length > MAX_PDF_BYTES) throw new Error("Rendered PDF exceeds the supported size.");
    return bytes;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
