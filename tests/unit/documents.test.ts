import { describe, expect, it } from "vitest";

import { documentRetentionState, documentReviewState } from "@/modules/documents/documents";
import {
  documentAccessGrantSchema,
  documentUploadMetadataSchema,
} from "@/modules/documents/schemas/documents";

const membershipId = "11111111-1111-4111-8111-111111111111";

describe("document library rules", () => {
  it("derives review and retention states deterministically", () => {
    expect(
      documentReviewState({ reviewDate: "2026-07-17", expiryDate: null, today: "2026-07-17" }),
    ).toBe("review_due");
    expect(
      documentReviewState({ reviewDate: null, expiryDate: "2026-07-16", today: "2026-07-17" }),
    ).toBe("expired");
    expect(
      documentRetentionState({
        legalHold: true,
        retentionUntil: "2020-01-01",
        today: "2026-07-17",
      }),
    ).toBe("hold");
    expect(
      documentRetentionState({
        legalHold: false,
        retentionUntil: "2026-07-16",
        today: "2026-07-17",
      }),
    ).toBe("expired");
  });

  it("validates bounded metadata, paired entity links, and retention ordering", () => {
    const valid = documentUploadMetadataSchema.parse({
      documentId: "",
      title: "Client agreement",
      description: "Reviewed commercial agreement",
      folderId: "",
      categoryId: "",
      classification: "confidential",
      ownerMembershipId: membershipId,
      expiryDate: "2027-01-01",
      reviewDate: "2026-12-01",
      retentionUntil: "2034-01-01",
      versionNote: "Original",
      tagIds: [],
      entityType: "client",
      entityId: "22222222-2222-4222-8222-222222222222",
    });
    expect(valid.title).toBe("Client agreement");
    expect(documentUploadMetadataSchema.safeParse({ ...valid, entityId: null }).success).toBe(
      false,
    );
    expect(
      documentUploadMetadataSchema.safeParse({ ...valid, retentionUntil: "2026-01-01" }).success,
    ).toBe(false);
  });

  it("normalizes browser datetime-local access expiry values", () => {
    expect(
      documentAccessGrantSchema.parse({
        documentId: "22222222-2222-4222-8222-222222222222",
        membershipId,
        accessLevel: "viewer",
        expiresAt: "2026-08-01T09:30",
      }).expiresAt,
    ).toBe("2026-08-01T09:30:00Z");
  });
});
