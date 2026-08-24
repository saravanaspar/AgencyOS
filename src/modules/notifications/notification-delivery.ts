import type { NotificationDigestPreference } from "@/modules/notifications/notifications";

export const externalNotificationChannels = ["email", "browser_push"] as const;
export type ExternalNotificationChannel = (typeof externalNotificationChannels)[number];

const MAX_RETRY_DELAY_SECONDS = 6 * 60 * 60;

export function notificationRetryDelaySeconds(attemptCount: number): number {
  const normalizedAttempt = Math.max(1, Math.min(12, Math.trunc(attemptCount)));
  return Math.min(MAX_RETRY_DELAY_SECONDS, 30 * 2 ** (normalizedAttempt - 1));
}

export function retryAfterSeconds(value: string | null, now = new Date()): number | null {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return Math.min(MAX_RETRY_DELAY_SECONDS, Math.ceil(numeric));
  }
  const retryAt = new Date(value);
  if (Number.isNaN(retryAt.getTime())) return null;
  return Math.min(
    MAX_RETRY_DELAY_SECONDS,
    Math.max(0, Math.ceil((retryAt.getTime() - now.getTime()) / 1000)),
  );
}

function parseClock(value: string): { hours: number; minutes: number } {
  const [hours = "0", minutes = "0"] = value.split(":");
  return { hours: Number(hours), minutes: Number(minutes) };
}

export function isWithinQuietHours(now: Date, start: string, end: string): boolean {
  const startClock = parseClock(start);
  const endClock = parseClock(end);
  const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
  const startMinute = startClock.hours * 60 + startClock.minutes;
  const endMinute = endClock.hours * 60 + endClock.minutes;
  if (startMinute === endMinute) return true;
  return startMinute < endMinute
    ? minute >= startMinute && minute < endMinute
    : minute >= startMinute || minute < endMinute;
}

export function nextQuietHoursEnd(now: Date, end: string): Date {
  const clock = parseClock(end);
  const next = new Date(now);
  next.setUTCSeconds(0, 0);
  next.setUTCHours(clock.hours, clock.minutes, 0, 0);
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function nextDigestTime(now: Date, digest: NotificationDigestPreference): Date {
  const next = new Date(now);
  next.setUTCSeconds(0, 0);
  next.setUTCHours(8, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  if (digest === "weekly") {
    const daysUntilMonday = (8 - next.getUTCDay()) % 7;
    next.setUTCDate(next.getUTCDate() + daysUntilMonday);
  }
  return next;
}

export function initialNotificationDeliveryTime(input: {
  now?: Date;
  channel: ExternalNotificationChannel;
  digest: NotificationDigestPreference;
  quietHours: { enabled: boolean; start: string; end: string };
}): Date {
  const now = input.now ? new Date(input.now) : new Date();
  let scheduled = new Date(now);
  if (input.channel === "email" && input.digest !== "none") {
    scheduled = nextDigestTime(now, input.digest);
  }
  if (
    input.quietHours.enabled &&
    isWithinQuietHours(scheduled, input.quietHours.start, input.quietHours.end)
  ) {
    scheduled = nextQuietHoursEnd(scheduled, input.quietHours.end);
  }
  return scheduled;
}

const allowedPushHosts = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com",
];

export function isAllowedBrowserPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return (
      allowedPushHosts.includes(host) ||
      host.endsWith(".push.services.mozilla.com") ||
      host.endsWith(".notify.windows.com")
    );
  } catch {
    return false;
  }
}
