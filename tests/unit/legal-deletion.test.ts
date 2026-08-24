import { describe, expect, it } from "vitest";

import {
  legalDeletionLifecycleEligible,
  legalDeletionPurgeClaimStale,
  legalDeletionRetentionEligible,
  legalDeletionStatuses,
  legalDeletionTargetTypes,
} from "@/modules/legal/deletion";
import {
  legalDeletionPolicySchema,
  legalDeletionRequestSchema,
} from "@/modules/legal/schemas/deletion";

describe("controlled legal deletion", () => {
  it("allows only terminal legal lifecycle states", () => {
    expect(legalDeletionLifecycleEligible({ targetType: "contract", targetStatus: "active" })).toBe(
      false,
    );
    expect(
      legalDeletionLifecycleEligible({ targetType: "contract", targetStatus: "terminated" }),
    ).toBe(true);
    expect(
      legalDeletionLifecycleEligible({ targetType: "compliance_record", targetStatus: "active" }),
    ).toBe(false);
    expect(
      legalDeletionLifecycleEligible({ targetType: "compliance_record", targetStatus: "archived" }),
    ).toBe(true);
  });

  it("permits deletion only after a configured retention date has elapsed", () => {
    expect(legalDeletionRetentionEligible(null, "2026-07-18")).toBe(true);
    expect(legalDeletionRetentionEligible("2026-07-18", "2026-07-18")).toBe(true);
    expect(legalDeletionRetentionEligible("2026-07-19", "2026-07-18")).toBe(false);
  });

  it("allows recovery only after a purge execution claim becomes stale", () => {
    const now = Date.parse("2026-07-18T12:00:00.000Z");
    expect(legalDeletionPurgeClaimStale(null, now)).toBe(false);
    expect(legalDeletionPurgeClaimStale("2026-07-18T11:46:00.000Z", now)).toBe(false);
    expect(legalDeletionPurgeClaimStale("2026-07-18T11:45:00.000Z", now)).toBe(true);
  });

  it("validates deletion reasons and policy checkbox values", () => {
    expect(
      legalDeletionRequestSchema.safeParse({
        targetType: "contract",
        targetId: "11111111-1111-4111-8111-111111111111",
        reason: "The approved retention period has elapsed.",
      }).success,
    ).toBe(true);
    expect(
      legalDeletionRequestSchema.safeParse({
        targetType: "contract",
        targetId: "11111111-1111-4111-8111-111111111111",
        reason: "delete",
      }).success,
    ).toBe(false);
    expect(
      legalDeletionPolicySchema.parse({ secondApprovalRequired: "on" }).secondApprovalRequired,
    ).toBe(true);
    expect(
      legalDeletionPolicySchema.parse({ secondApprovalRequired: null }).secondApprovalRequired,
    ).toBe(false);
  });

  it("keeps a bounded target and request status catalogue", () => {
    expect(legalDeletionTargetTypes).toEqual(["contract", "compliance_record"]);
    expect(legalDeletionStatuses).toContain("pending_approval");
    expect(legalDeletionStatuses).toContain("purge_failed");
    expect(legalDeletionStatuses).toContain("completed");
  });
});
