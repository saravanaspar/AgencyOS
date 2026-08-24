import { describe, expect, it } from "vitest";

import { documentPublicationState } from "@/modules/documents/documents";
import {
  documentPublicationSchema,
  documentPublicationWithdrawSchema,
} from "@/modules/documents/schemas/documents";

const documentId = "11111111-1111-4111-8111-111111111111";
const departmentId = "22222222-2222-4222-8222-222222222222";

describe("document approval and publication rules", () => {
  it("derives scheduled, published, expired, superseded, and withdrawn release states", () => {
    const now = new Date("2026-07-17T10:00:00Z");
    expect(
      documentPublicationState({
        status: "active",
        effectiveAt: "2026-07-18T10:00:00Z",
        expiresAt: null,
        now,
      }),
    ).toBe("scheduled");
    expect(
      documentPublicationState({
        status: "active",
        effectiveAt: "2026-07-16T10:00:00Z",
        expiresAt: null,
        now,
      }),
    ).toBe("published");
    expect(
      documentPublicationState({
        status: "active",
        effectiveAt: "2026-07-15T10:00:00Z",
        expiresAt: "2026-07-16T10:00:00Z",
        now,
      }),
    ).toBe("expired");
    expect(
      documentPublicationState({
        status: "superseded",
        effectiveAt: "2026-07-15T10:00:00Z",
        expiresAt: null,
        now,
      }),
    ).toBe("superseded");
    expect(
      documentPublicationState({
        status: "withdrawn",
        effectiveAt: "2026-07-15T10:00:00Z",
        expiresAt: null,
        now,
      }),
    ).toBe("withdrawn");
  });

  it("requires at least one controlled audience and valid effective ordering", () => {
    const base = {
      documentId,
      effectiveAt: "2026-08-01T09:00",
      expiresAt: "",
      releaseNote: "Initial controlled release",
      organizationWide: false,
      departmentIds: [departmentId],
      teamIds: [],
      membershipIds: [],
    };
    const parsed = documentPublicationSchema.parse(base);
    expect(parsed.effectiveAt).toBe("2026-08-01T09:00:00Z");
    expect(parsed.departmentIds).toEqual([departmentId]);
    expect(
      documentPublicationSchema.safeParse({
        ...base,
        departmentIds: [],
      }).success,
    ).toBe(false);
    expect(
      documentPublicationSchema.safeParse({
        ...base,
        expiresAt: "2026-08-01T08:59",
      }).success,
    ).toBe(false);
  });

  it("requires a bounded withdrawal reason", () => {
    expect(
      documentPublicationWithdrawSchema.safeParse({
        documentId,
        publicationId: departmentId,
        reason: "Policy replaced",
      }).success,
    ).toBe(true);
    expect(
      documentPublicationWithdrawSchema.safeParse({
        documentId,
        publicationId: departmentId,
        reason: "x",
      }).success,
    ).toBe(false);
  });
});
