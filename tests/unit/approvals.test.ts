import { describe, expect, it } from "vitest";

import { approvalStatusTone, safeApprovalDeepLink } from "@/modules/approvals/approvals";
import {
  approvalSnapshotHash,
  validateApprovalSnapshot,
} from "@/modules/approvals/approval-snapshot";

describe("approval snapshots", () => {
  it("hashes equivalent JSON independently of property order", () => {
    const left = { amount: 1250, vendor: { id: "v-1", name: "Acme" }, lines: [1, 2] };
    const right = { lines: [1, 2], vendor: { name: "Acme", id: "v-1" }, amount: 1250 };
    expect(approvalSnapshotHash(left)).toBe(approvalSnapshotHash(right));
  });

  it("rejects sensitive, non-finite, non-JSON, circular, oversized, and deeply nested values", () => {
    expect(() => validateApprovalSnapshot({ clientSecret: "do-not-store" })).toThrow(/sensitive/i);
    expect(() => validateApprovalSnapshot({ amount: Number.POSITIVE_INFINITY })).toThrow(
      /invalid number/i,
    );
    expect(() => validateApprovalSnapshot({ createdAt: new Date() })).toThrow(/non-JSON/i);

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => validateApprovalSnapshot(circular)).toThrow(/circular/i);

    let nested: Record<string, unknown> = {};
    for (let index = 0; index < 22; index += 1) nested = { child: nested };
    expect(() => validateApprovalSnapshot(nested)).toThrow(/nesting/i);

    expect(() => approvalSnapshotHash({ body: "x".repeat(70 * 1024) })).toThrow(/64 KB/i);
  });

  it("rejects credential-like keys across common naming styles", () => {
    for (const key of [
      "password",
      "access_token",
      "refresh-token",
      "apiKey",
      "privateKey",
      "authorization",
      "cookie",
      "sessionToken",
    ]) {
      expect(() => validateApprovalSnapshot({ [key]: "secret" })).toThrow(/sensitive/i);
    }
  });
});

describe("approval presentation safety", () => {
  it("accepts only safe internal deep links", () => {
    expect(safeApprovalDeepLink("/approvals?view=inbox")).toBe("/approvals?view=inbox");
    expect(safeApprovalDeepLink("https://example.com")).toBeNull();
    expect(safeApprovalDeepLink("//example.com/path")).toBeNull();
    expect(safeApprovalDeepLink("/\\evil")).toBeNull();
    expect(safeApprovalDeepLink("/ok\u0000bad")).toBeNull();
  });

  it("maps terminal and actionable states to consistent tones", () => {
    expect(approvalStatusTone("approved")).toBe("success");
    expect(approvalStatusTone("pending")).toBe("info");
    expect(approvalStatusTone("revision_requested")).toBe("warning");
    expect(approvalStatusTone("rejected")).toBe("error");
    expect(approvalStatusTone("waiting")).toBe("neutral");
  });
});
