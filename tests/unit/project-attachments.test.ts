import { describe, expect, it } from "vitest";

import {
  attachmentContentDisposition,
  attachmentDigest,
  normalizeAttachmentFileName,
  PROJECT_ATTACHMENT_MAX_BYTES,
  validateAttachmentContent,
  validateAttachmentFile,
} from "@/modules/projects/server/project-attachments";

describe("project attachment boundaries", () => {
  it("normalizes path traversal and control characters out of file names", () => {
    expect(normalizeAttachmentFileName("../../client\u0000 report (final).pdf")).toBe(
      "client report (final).pdf",
    );
    expect(normalizeAttachmentFileName("..")).toBe("attachment");
  });

  it("forces a safe attachment content disposition", () => {
    const header = attachmentContentDisposition('quarterly "report".csv');
    expect(header).toContain("attachment;");
    expect(header).not.toContain('filename="quarterly "report".csv"');
    expect(header).toContain("filename*=UTF-8''");
  });

  it("requires an allowed MIME and matching file extension", () => {
    expect(
      validateAttachmentFile(new File(["a,b"], "report.csv", { type: "text/csv" })),
    ).toBeNull();
    expect(
      validateAttachmentFile(new File(["not an image"], "report.exe", { type: "image/png" })),
    ).toMatch(/blocked/);
  });

  it("rejects files above the fixed ten megabyte limit", () => {
    const oversized = new File(
      [new Uint8Array(PROJECT_ATTACHMENT_MAX_BYTES + 1)],
      "oversized.pdf",
      { type: "application/pdf" },
    );
    expect(validateAttachmentFile(oversized)).toBe("Attachments are limited to 10 MB.");
  });

  it("uses stable SHA-256 digests for duplicate detection", () => {
    expect(attachmentDigest(Buffer.from("same-content"))).toBe(
      attachmentDigest(Buffer.from("same-content")),
    );
    expect(attachmentDigest(Buffer.from("same-content"))).not.toBe(
      attachmentDigest(Buffer.from("different-content")),
    );
  });

  it("verifies binary signatures instead of trusting the submitted MIME type", () => {
    const fakePng = new File(["not a png"], "image.png", { type: "image/png" });
    expect(validateAttachmentContent(fakePng, Buffer.from("not a png"))).toMatch(/do not match/);

    const pdfBytes = Buffer.from("%PDF-1.7\nsynthetic test file");
    const pdf = new File([pdfBytes], "report.pdf", { type: "application/pdf" });
    expect(validateAttachmentContent(pdf, pdfBytes)).toBeNull();
  });

  it("rejects binary payloads disguised as text attachments", () => {
    const text = new File(["safe text"], "notes.txt", { type: "text/plain" });
    expect(validateAttachmentContent(text, Buffer.from("safe text"))).toBeNull();
    expect(validateAttachmentContent(text, Buffer.from([0x41, 0, 0x42]))).toMatch(/do not match/);
  });
});
