import { describe, expect, it } from "vitest";

import {
  legalAccessReviewCadenceDays,
  legalAccessReviewDueAt,
  legalAccessReviewIsOverdue,
  legalAccessReviewNextScheduledFor,
  legalAccessReviewPermissionKeys,
  legalAccessReviewWindowDays,
} from "@/modules/legal/access-review";
import {
  legalAccessReviewAttestationSchema,
  legalAccessReviewCompletionSchema,
} from "@/modules/legal/schemas/access-review";

describe("legal access review", () => {
  it("uses a 90-day cadence and fourteen-day attestation window", () => {
    expect(legalAccessReviewCadenceDays).toBe(90);
    expect(legalAccessReviewWindowDays).toBe(14);
    expect(legalAccessReviewNextScheduledFor("2026-01-01")).toBe("2026-04-01");
    expect(legalAccessReviewNextScheduledFor(null, "2026-08-24")).toBe("2026-08-24");
    expect(legalAccessReviewDueAt("2026-08-24T10:30:00.000Z").toISOString()).toBe(
      "2026-09-07T10:30:00.000Z",
    );
  });

  it("marks only incomplete campaigns past their deadline as overdue", () => {
    const now = Date.parse("2026-09-08T00:00:00.000Z");
    expect(legalAccessReviewIsOverdue("2026-09-07T23:59:59.000Z", null, now)).toBe(true);
    expect(
      legalAccessReviewIsOverdue("2026-09-07T23:59:59.000Z", "2026-09-07T12:00:00.000Z", now),
    ).toBe(false);
    expect(legalAccessReviewIsOverdue("2026-09-08T00:00:01.000Z", null, now)).toBe(false);
  });

  it("validates immutable retain/revoke attestations and explicit self-review evidence", () => {
    const base = {
      campaignId: "11111111-1111-4111-8111-111111111111",
      itemId: "22222222-2222-4222-8222-222222222222",
      snapshotDigest: "a".repeat(64),
      decision: "retain",
      rationale: "Access is required for current legal operations.",
      selfReviewAcknowledged: "on",
    };
    expect(legalAccessReviewAttestationSchema.parse(base)).toMatchObject({
      decision: "retain",
      selfReviewAcknowledged: true,
    });
    expect(
      legalAccessReviewAttestationSchema.safeParse({ ...base, decision: "delete" }).success,
    ).toBe(false);
    expect(
      legalAccessReviewAttestationSchema.safeParse({ ...base, rationale: "too short" }).success,
    ).toBe(false);
    expect(
      legalAccessReviewAttestationSchema.safeParse({ ...base, snapshotDigest: "bad" }).success,
    ).toBe(false);
    expect(
      legalAccessReviewCompletionSchema.safeParse({ campaignId: base.campaignId }).success,
    ).toBe(true);
  });

  it("exposes distinct sensitive view and organization access-management keys", () => {
    expect(legalAccessReviewPermissionKeys).toEqual({
      view: "legal.access_review.view",
      manage: "legal.access_review.manage_access",
    });
  });
});
