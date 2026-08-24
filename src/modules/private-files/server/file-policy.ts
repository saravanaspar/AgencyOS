import "server-only";

import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

export const SHARED_PRIVATE_FILE_MAX_BYTES = 25 * 1024 * 1024;

const blockedExtensions = new Set([
  ".apk",
  ".app",
  ".bat",
  ".cmd",
  ".com",
  ".cpl",
  ".dll",
  ".dmg",
  ".exe",
  ".hta",
  ".htm",
  ".html",
  ".iso",
  ".jar",
  ".js",
  ".jse",
  ".lnk",
  ".mjs",
  ".msi",
  ".pif",
  ".ps1",
  ".scr",
  ".sh",
  ".svg",
  ".vbs",
  ".wsf",
]);

const blockedMimeTypes = new Set([
  "application/javascript",
  "application/x-dosexec",
  "application/x-executable",
  "application/x-msdownload",
  "application/x-sh",
  "image/svg+xml",
  "text/html",
  "text/javascript",
]);

export interface PrivateFilePolicy {
  maxBytes: number;
  allowedMimeTypes: ReadonlyMap<string, ReadonlySet<string>>;
  description: string;
}

export interface PrivateFileCandidate {
  name: string;
  type: string;
  size: number;
}

export function normalizePrivateFileName(fileName: string): string {
  const baseName = path
    .basename(fileName)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  const normalized = baseName
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9._() -]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-{2,}/g, "-")
    .slice(0, 180);
  return normalized && normalized !== "." && normalized !== ".." ? normalized : "attachment";
}

export function validatePrivateFileCandidate(
  file: PrivateFileCandidate,
  policy: PrivateFilePolicy,
): string | null {
  if (file.size <= 0) return "Choose a non-empty file.";
  if (file.size > policy.maxBytes) {
    return `Files are limited to ${Math.ceil(policy.maxBytes / 1024 / 1024)} MB.`;
  }

  const extension = path.extname(file.name).toLowerCase();
  if (blockedExtensions.has(extension) || blockedMimeTypes.has(file.type.toLowerCase())) {
    return "Executable, script, HTML, and SVG uploads are blocked.";
  }

  const allowedExtensions = policy.allowedMimeTypes.get(file.type);
  if (!allowedExtensions || !allowedExtensions.has(extension)) return policy.description;
  return null;
}

function validateUtf8Text(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    const normalized = decoded.toLowerCase();
    const prefix = normalized.trimStart();
    return !(
      prefix.startsWith("<!doctype html") ||
      prefix.startsWith("<html") ||
      normalized.includes("<script") ||
      normalized.includes("javascript:")
    );
  } catch {
    return false;
  }
}

export function validatePrivateFileContent(mimeType: string, buffer: Buffer): string | null {
  const matches =
    mimeType === "image/png"
      ? buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : mimeType === "image/jpeg"
        ? buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
        : mimeType === "application/pdf"
          ? buffer.subarray(0, 5).toString("ascii") === "%PDF-" &&
            !/\/(?:JavaScript|JS)\b/i.test(buffer.toString("latin1"))
          : mimeType ===
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
              mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            ? buffer.length >= 4 &&
              buffer[0] === 0x50 &&
              buffer[1] === 0x4b &&
              [0x03, 0x05, 0x07].includes(buffer[2] ?? -1) &&
              [0x04, 0x06, 0x08].includes(buffer[3] ?? -1) &&
              buffer.includes(Buffer.from("[Content_Types].xml")) &&
              buffer.includes(
                Buffer.from(mimeType.endsWith("wordprocessingml.document") ? "word/" : "xl/"),
              )
            : mimeType === "text/plain" || mimeType === "text/csv"
              ? validateUtf8Text(buffer)
              : false;

  return matches ? null : "The file contents do not match the selected safe file type.";
}

export function privateFileDigest(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function buildPrivateFileStoragePaths(input: {
  organizationId: string;
  fileId: string;
  fileName: string;
}): { quarantinePath: string; cleanPath: string } {
  const extension = path.extname(input.fileName).toLowerCase();
  const objectId = randomUUID();
  const prefix = `${input.organizationId}/${input.fileId}`;
  return {
    quarantinePath: `${prefix}/${objectId}.quarantine`,
    cleanPath: `${prefix}/${objectId}${extension}`,
  };
}

export function privateFileContentDisposition(fileName: string): string {
  const safe = normalizePrivateFileName(fileName);
  const ascii = safe.replace(/[^\x20-\x7E]/g, "-").replace(/["\\]/g, "-");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}
