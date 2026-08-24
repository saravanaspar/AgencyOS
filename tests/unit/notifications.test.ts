import { describe, expect, it } from "vitest";

import {
  defaultNotificationPreferences,
  normalizeNotificationPreferences,
  safeNotificationDeepLink,
} from "@/modules/notifications/notifications";

describe("notification preferences", () => {
  it("normalizes partial and invalid preference payloads", () => {
    const preferences = normalizeNotificationPreferences({
      categories: { assignment: false, integration_failure: true, unknown: false },
      emailEnabled: true,
      browserPushEnabled: true,
      digest: "daily",
      quietHours: { enabled: true, start: "23:30", end: "06:15" },
    });

    expect(preferences.categories.assignment).toBe(false);
    expect(preferences.categories.integration_failure).toBe(true);
    expect(preferences.categories.security_alert).toBe(true);
    expect(preferences.categories.automation).toBe(true);
    expect(preferences.emailEnabled).toBe(true);
    expect(preferences.browserPushEnabled).toBe(true);
    expect(preferences.digest).toBe("daily");
    expect(preferences.quietHours).toEqual({ enabled: true, start: "23:30", end: "06:15" });
  });

  it("falls back safely when stored JSON is malformed", () => {
    expect(normalizeNotificationPreferences({ digest: "hourly" })).toEqual(
      defaultNotificationPreferences,
    );
  });
});

describe("notification deep links", () => {
  it("accepts only internal root-relative links", () => {
    expect(safeNotificationDeepLink("/crm?tab=imports")).toBe("/crm?tab=imports");
    expect(safeNotificationDeepLink("https://example.com")).toBeNull();
    expect(safeNotificationDeepLink("//example.com/path")).toBeNull();
    expect(safeNotificationDeepLink("javascript:alert(1)")).toBeNull();
  });
});
