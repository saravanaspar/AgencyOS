import { describe, expect, it } from "vitest";

import {
  initialNotificationDeliveryTime,
  isAllowedBrowserPushEndpoint,
  isWithinQuietHours,
  notificationRetryDelaySeconds,
  retryAfterSeconds,
} from "@/modules/notifications/notification-delivery";

describe("notification delivery scheduling", () => {
  it("uses bounded exponential retry delays", () => {
    expect(notificationRetryDelaySeconds(1)).toBe(30);
    expect(notificationRetryDelaySeconds(4)).toBe(240);
    expect(notificationRetryDelaySeconds(20)).toBe(21_600);
  });

  it("parses retry-after seconds and dates safely", () => {
    const now = new Date("2026-07-14T10:00:00Z");
    expect(retryAfterSeconds("120", now)).toBe(120);
    expect(retryAfterSeconds("Tue, 14 Jul 2026 10:02:00 GMT", now)).toBe(120);
    expect(retryAfterSeconds("invalid", now)).toBeNull();
  });

  it("handles quiet hours that cross midnight", () => {
    expect(isWithinQuietHours(new Date("2026-07-14T23:00:00Z"), "22:00", "07:00")).toBe(true);
    expect(isWithinQuietHours(new Date("2026-07-14T06:00:00Z"), "22:00", "07:00")).toBe(true);
    expect(isWithinQuietHours(new Date("2026-07-14T12:00:00Z"), "22:00", "07:00")).toBe(false);
  });

  it("schedules immediate and digest deliveries without entering quiet hours", () => {
    const now = new Date("2026-07-14T23:00:00Z");
    expect(
      initialNotificationDeliveryTime({
        now,
        channel: "email",
        digest: "none",
        quietHours: { enabled: true, start: "22:00", end: "07:00" },
      }).toISOString(),
    ).toBe("2026-07-15T07:00:00.000Z");
    expect(
      initialNotificationDeliveryTime({
        now: new Date("2026-07-14T09:00:00Z"),
        channel: "email",
        digest: "daily",
        quietHours: { enabled: false, start: "22:00", end: "07:00" },
      }).toISOString(),
    ).toBe("2026-07-15T08:00:00.000Z");
  });

  it("allows only known HTTPS browser push hosts", () => {
    expect(isAllowedBrowserPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(
      isAllowedBrowserPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc"),
    ).toBe(true);
    expect(isAllowedBrowserPushEndpoint("https://web.push.apple.com/QP/abc")).toBe(true);
    expect(isAllowedBrowserPushEndpoint("https://evil.example/push")).toBe(false);
    expect(isAllowedBrowserPushEndpoint("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
  });
});
