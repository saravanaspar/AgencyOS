import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function source(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

describe("notification and CRM UI contracts", () => {
  it("links the shell bell to the real notification center without a fake unread count", () => {
    const shell = source("src/components/shell/workspace-shell.tsx");
    expect(shell).toContain('href="/notifications"');
    expect(shell).toContain("unreadNotificationCount");
    expect(shell).not.toContain("3 unread notifications");
  });

  it("uses the aligned connection-form layout for provider-specific fields", () => {
    const center = source("src/components/crm/crm-import-center.tsx");
    const css = source("src/app/globals.css");
    expect(center).toContain("crm-import-form--connection");
    expect(css).toContain(".crm-import-form--connection > .field");
    expect(css).toContain("grid-template-rows: minmax(32px, auto) 42px minmax(30px, auto)");
  });

  it("keeps notification links internal and exposes recipient-only actions", () => {
    const notificationSource = source("src/modules/notifications/notifications.ts");
    const actions = source("src/modules/notifications/actions/notifications.ts");
    expect(notificationSource).toContain('normalized.startsWith("//")');
    expect(actions).toContain("notificationPermissionKeys.update");
    expect(actions).toContain("notificationPermissionKeys.managePreferences");
  });

  it("exposes aligned external delivery controls without client-side secrets", () => {
    const center = source("src/components/notifications/notification-center.tsx");
    const css = source("src/app/globals.css");
    expect(center).toContain("notification-channel-grid");
    expect(center).toContain("BrowserPushControl");
    expect(center).toContain("deliveryConfiguration");
    expect(css).toContain(".notification-channel-card");
    expect(css).toContain(".notification-delivery-chip");
    expect(center).not.toContain("NOTIFICATION_N8N_SIGNING_SECRET");
  });

  it("reuses the shared notification service for CRM operator failures", () => {
    const crmImports = source("src/modules/crm/server/imports.ts");
    expect(crmImports).toContain("enqueueNotification");
    expect(crmImports).toContain('category: "integration_failure"');
    expect(crmImports).toContain("crm-connection:${connection.id}:${code}");
  });
});
