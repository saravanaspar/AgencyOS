import { describe, expect, it } from "vitest";

import {
  deriveOnboardingPlanStatus,
  hrOnboardingItemDefinitions,
  onboardingProgress,
  type HrOnboardingItemStatus,
} from "@/modules/hr/onboarding";
import { createHrOnboardingPlanSchema } from "@/modules/hr/schemas/onboarding";

const membershipId = "11111111-1111-4111-8111-111111111111";

function items(status: HrOnboardingItemStatus) {
  return hrOnboardingItemDefinitions.map((item) => ({ key: item.key, status }));
}

describe("HR onboarding workflow", () => {
  it("derives draft, ready, and completed states from the shared checklist", () => {
    expect(deriveOnboardingPlanStatus(items("pending"))).toBe("draft");

    const ready = items("complete").map((item) =>
      item.key === "first_day_meeting_scheduled" || item.key === "probation_review_scheduled"
        ? { ...item, status: "pending" as const }
        : item,
    );
    expect(deriveOnboardingPlanStatus(ready)).toBe("ready");
    expect(deriveOnboardingPlanStatus(items("complete"))).toBe("completed");
  });

  it("calculates bounded checklist progress", () => {
    expect(onboardingProgress([])).toEqual({ completed: 0, total: 0, percent: 0 });
    expect(
      onboardingProgress([
        { status: "complete" },
        { status: "not_applicable" },
        { status: "pending" },
      ]),
    ).toEqual({ completed: 2, total: 3, percent: 67 });
  });

  it("validates onboarding schedule boundaries", () => {
    expect(
      createHrOnboardingPlanSchema.parse({
        membershipId,
        targetStartDate: "2026-08-03",
        firstDayMeetingAt: "2026-08-03T09:30:00.000Z",
        firstDayMeetingDetails: "Main meeting room",
        probationReviewDate: "2026-11-03",
        notes: "Prepare laptop and account access.",
      }),
    ).toMatchObject({ membershipId, targetStartDate: "2026-08-03" });

    expect(
      createHrOnboardingPlanSchema.safeParse({
        membershipId,
        targetStartDate: "2026-08-03",
        firstDayMeetingAt: null,
        firstDayMeetingDetails: null,
        probationReviewDate: "2026-07-01",
        notes: null,
      }).success,
    ).toBe(false);
  });
});
