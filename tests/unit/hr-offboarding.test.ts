import { describe, expect, it } from "vitest";

import {
  deriveOffboardingPlanStatus,
  hrOffboardingItemDefinitions,
  offboardingProgress,
  type HrOffboardingItemStatus,
} from "@/modules/hr/offboarding";
import {
  createHrOffboardingPlanSchema,
  submitHrResignationSchema,
} from "@/modules/hr/schemas/offboarding";

const membershipId = "11111111-1111-4111-8111-111111111111";

function items(status: HrOffboardingItemStatus) {
  return hrOffboardingItemDefinitions.map((item) => ({ key: item.key, status }));
}

describe("HR offboarding workflow", () => {
  it("derives draft, ready, and completed states from the clearance checklist", () => {
    expect(deriveOffboardingPlanStatus(items("pending"))).toBe("draft");
    const ready = items("complete").map((item) =>
      item.key === "final_clearance" || item.key === "employee_archive"
        ? { ...item, status: "pending" as const }
        : item,
    );
    expect(deriveOffboardingPlanStatus(ready)).toBe("ready");
    expect(deriveOffboardingPlanStatus(items("complete"))).toBe("completed");
  });

  it("calculates bounded offboarding progress", () => {
    expect(offboardingProgress([])).toEqual({ completed: 0, total: 0, percent: 0 });
    expect(
      offboardingProgress([
        { status: "complete" },
        { status: "not_applicable" },
        { status: "blocked" },
      ]),
    ).toEqual({ completed: 2, total: 3, percent: 67 });
  });

  it("validates managed separation and own resignation date boundaries", () => {
    expect(
      createHrOffboardingPlanSchema.parse({
        membershipId,
        separationType: "resignation",
        noticeDate: "2026-08-01",
        lastWorkingDate: "2026-08-31",
        reason: "Career transition",
        replacementMembershipId: "",
        exitInterviewAt: null,
        exitInterviewDetails: null,
        notes: null,
      }),
    ).toMatchObject({ membershipId, separationType: "resignation" });

    expect(
      submitHrResignationSchema.safeParse({
        noticeDate: "2026-08-31",
        lastWorkingDate: "2026-08-01",
        reason: null,
      }).success,
    ).toBe(false);
  });
});
