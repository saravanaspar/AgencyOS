import { describe, expect, it } from "vitest";

import { privateFileRetryDelaySeconds } from "@/modules/private-files/private-files";
import {
  buildPrivateFileStoragePaths,
  normalizePrivateFileName,
  privateFileContentDisposition,
  privateFileDigest,
  type PrivateFilePolicy,
  validatePrivateFileCandidate,
  validatePrivateFileContent,
} from "@/modules/private-files/server/file-policy";

const policy: PrivateFilePolicy = {
  maxBytes: 1024,
  allowedMimeTypes: new Map([
    ["application/pdf", new Set([".pdf"])],
    ["text/plain", new Set([".txt"])],
  ]),
  description: "Only PDF and TXT files are accepted.",
};

describe("shared private-file boundaries", () => {
  it("normalizes names while keeping original names out of storage keys", () => {
    const name = normalizePrivateFileName("../../client\u0000 contract.pdf");
    const paths = buildPrivateFileStoragePaths({
      organizationId: "11111111-1111-4111-8111-111111111111",
      fileId: "22222222-2222-4222-8222-222222222222",
      fileName: name,
    });
    expect(name).toBe("client contract.pdf");
    expect(paths.cleanPath).not.toContain("client");
    expect(paths.quarantinePath).toMatch(/\.quarantine$/);
    expect(paths.cleanPath).toMatch(/\.pdf$/);
  });

  it("blocks executable, script, HTML, and SVG uploads before storage", () => {
    expect(
      validatePrivateFileCandidate(
        { name: "payload.exe", type: "application/pdf", size: 8 },
        policy,
      ),
    ).toMatch(/blocked/);
    expect(
      validatePrivateFileCandidate({ name: "page.html", type: "text/html", size: 8 }, policy),
    ).toMatch(/blocked/);
    expect(
      validatePrivateFileCandidate({ name: "image.svg", type: "image/svg+xml", size: 8 }, policy),
    ).toMatch(/blocked/);
  });

  it("checks binary signatures and rejects active PDF JavaScript", () => {
    expect(
      validatePrivateFileContent("application/pdf", Buffer.from("%PDF-1.7\nplain")),
    ).toBeNull();
    expect(
      validatePrivateFileContent(
        "application/pdf",
        Buffer.from("%PDF-1.7\n1 0 obj << /JavaScript (alert(1)) >>"),
      ),
    ).toMatch(/do not match/);
    expect(
      validatePrivateFileContent("text/plain", Buffer.from("<script>alert(1)</script>")),
    ).toMatch(/do not match/);
    expect(
      validatePrivateFileContent(
        "text/plain",
        Buffer.from(`${"safe text ".repeat(600)}<script>alert(1)</script>`),
      ),
    ).toMatch(/do not match/);
    expect(
      validatePrivateFileContent(
        "application/pdf",
        Buffer.concat([
          Buffer.from("%PDF-1.7\n"),
          Buffer.alloc(2_100_000, 0x20),
          Buffer.from("/JS (alert(1))"),
        ]),
      ),
    ).toMatch(/do not match/);
    expect(
      validatePrivateFileContent(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        Buffer.concat([
          Buffer.from([0x50, 0x4b, 0x03, 0x04]),
          Buffer.from("[Content_Types].xml word/document.xml"),
        ]),
      ),
    ).toBeNull();
    expect(
      validatePrivateFileContent(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("generic/archive")]),
      ),
    ).toMatch(/do not match/);
    expect(
      validatePrivateFileContent(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        Buffer.from("not-a-zip"),
      ),
    ).toMatch(/do not match/);
  });

  it("uses stable checksums, safe forced-download headers, and capped backoff", () => {
    expect(privateFileDigest(Buffer.from("same"))).toBe(privateFileDigest(Buffer.from("same")));
    expect(privateFileContentDisposition('unsafe "name".pdf')).toContain("attachment;");
    expect(privateFileRetryDelaySeconds(1)).toBe(30);
    expect(privateFileRetryDelaySeconds(99)).toBeLessThanOrEqual(6 * 60 * 60);
  });
});
