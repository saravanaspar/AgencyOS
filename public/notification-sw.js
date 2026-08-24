/* global self, clients */
/* AgencyOS payloadless notification worker. Notification details are fetched
   with the current browser session so private content is never sent through
   third-party push infrastructure. */
self.addEventListener("push", (event) => {
  event.waitUntil(
    fetch("/api/notifications/push/latest", {
      credentials: "include",
      cache: "no-store",
      headers: { accept: "application/json" },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        const title = payload?.notification?.title || "AgencyOS notification";
        const options = {
          body: payload?.notification?.message || "Open AgencyOS to review a new notification.",
          data: { url: payload?.notification?.deepLink || "/notifications" },
          icon: "/AgencyOS.png",
          badge: "/favicon.ico",
          tag: payload?.notification?.id || "agencyos-notification",
          renotify: false,
        };
        return self.registration.showNotification(title, options);
      })
      .catch(() =>
        self.registration.showNotification("AgencyOS notification", {
          body: "Open AgencyOS to review a new notification.",
          data: { url: "/notifications" },
          icon: "/AgencyOS.png",
          badge: "/favicon.ico",
          tag: "agencyos-notification",
        }),
      ),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const rawTarget = event.notification?.data?.url;
  const target =
    typeof rawTarget === "string" && rawTarget.startsWith("/") && !rawTarget.startsWith("//")
      ? rawTarget
      : "/notifications";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const windowClient of windows) {
        if ("focus" in windowClient) {
          windowClient.navigate(target);
          return windowClient.focus();
        }
      }
      return clients.openWindow ? clients.openWindow(target) : undefined;
    }),
  );
});
