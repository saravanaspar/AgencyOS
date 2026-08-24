import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

describe("live notification refresh contracts", () => {
  it("refreshes lightweight workspace counters without reloading the current page", () => {
    const realtime = source("src/components/notifications/notification-realtime-refresh.tsx");
    const route = source("src/app/api/workspace/counters/route.ts");

    expect(realtime).toContain("foregroundResyncIntervalMs");
    expect(realtime).toContain("5 * 60_000");
    expect(realtime).toContain("window.setInterval");
    expect(realtime).toContain("visibilitychange");
    expect(realtime).toContain('fetch("/api/workspace/counters"');
    expect(realtime).not.toContain("router.refresh()");
    expect(realtime).not.toContain("createClient");
    expect(realtime).not.toContain("postgres_changes");
    expect(route).toContain("getCurrentPermissionContext");
    expect(route).toContain('"cache-control": "private, no-store"');
  });

  it("mounts one shared subscription for permitted workspace users", () => {
    const layout = source("src/app/(workspace)/layout.tsx");
    const shell = source("src/components/shell/workspace-shell.tsx");

    expect(layout).toContain("membershipId={access.context.membership.id}");
    expect(shell).toContain("NotificationRealtimeRefresh");
    expect(shell).toContain('permissions.includes("notifications.notification.view")');
  });
});
