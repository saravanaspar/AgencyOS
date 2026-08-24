"use client";

import { useEffect } from "react";

const foregroundResyncIntervalMs = 5 * 60_000;
const foregroundResyncMinimumAgeMs = 60_000;

interface NotificationRealtimeRefreshProps {
  membershipId: string;
  onCountersChange: (counters: {
    unreadNotificationCount: number;
    pendingApprovalCount: number;
  }) => void;
}

export function NotificationRealtimeRefresh({
  membershipId,
  onCountersChange,
}: NotificationRealtimeRefreshProps) {
  useEffect(() => {
    const controller = new AbortController();
    let lastRefreshAt = Date.now();
    let requestInFlight = false;

    async function refreshWhenForegrounded() {
      if (document.visibilityState !== "visible") return;
      if (requestInFlight || Date.now() - lastRefreshAt < foregroundResyncMinimumAgeMs) return;

      lastRefreshAt = Date.now();
      requestInFlight = true;
      try {
        const response = await fetch("/api/workspace/counters", {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const payload: unknown = await response.json();
        if (!payload || typeof payload !== "object") return;
        const unreadNotificationCount = Reflect.get(payload, "unreadNotificationCount");
        const pendingApprovalCount = Reflect.get(payload, "pendingApprovalCount");
        if (
          typeof unreadNotificationCount !== "number" ||
          !Number.isSafeInteger(unreadNotificationCount) ||
          unreadNotificationCount < 0 ||
          typeof pendingApprovalCount !== "number" ||
          !Number.isSafeInteger(pendingApprovalCount) ||
          pendingApprovalCount < 0
        ) {
          return;
        }
        onCountersChange({ unreadNotificationCount, pendingApprovalCount });
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          // The shell keeps its last known counters when a background resync fails.
        }
      } finally {
        requestInFlight = false;
      }
    }

    const requestRefresh = () => void refreshWhenForegrounded();
    const timer = window.setInterval(requestRefresh, foregroundResyncIntervalMs);
    window.addEventListener("focus", requestRefresh);
    window.addEventListener("online", requestRefresh);
    document.addEventListener("visibilitychange", requestRefresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", requestRefresh);
      window.removeEventListener("online", requestRefresh);
      document.removeEventListener("visibilitychange", requestRefresh);
    };
  }, [membershipId, onCountersChange]);

  return null;
}
