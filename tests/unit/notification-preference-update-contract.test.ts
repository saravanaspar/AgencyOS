import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const actionSource = readFileSync("src/modules/notifications/actions/notifications.ts", "utf8");
const serverSource = readFileSync("src/modules/notifications/server/notifications.ts", "utf8");
const deliveryQueueSource = readFileSync(
  "src/modules/notifications/server/delivery-queue.ts",
  "utf8",
);
const jsonValueSource = readFileSync("src/lib/server/json-value.ts", "utf8");
const auditWriterSource = readFileSync("src/modules/audit/server/write-audit-event.ts", "utf8");
const migrationSource = readFileSync(
  "database/migrations/20260714001600_notification_preference_contract_repair.sql",
  "utf8",
);

describe("notification preference persistence contract", () => {
  it("replaces the complete normalized preference document with bounded retry", () => {
    expect(serverSource).toContain("notification_preferences = excluded.notification_preferences");
    expect(serverSource).toContain('operationName: "Notification preference update"');
    expect(serverSource).toContain("returning stored_preference.membership_id");
    expect(serverSource).toContain("database.json(toJsonValue(normalized))");
    expect(serverSource).not.toContain("JSON.stringify(normalized)");
  });

  it("does not hide authorization and database-contract failures", () => {
    expect(actionSource).toContain("Your role does not allow notification preference changes.");
    expect(actionSource).toContain("Notification preference update failed.");
    expect(actionSource).toContain("The notification database contract is out of date.");
    expect(actionSource).toContain("The notification preference payload was rejected.");
  });

  it("uses the shared postgres JSON serializer for every notification JSON write", () => {
    expect(serverSource).toContain("database.json(toJsonValue(input.metadata ?? {}))");
    expect(deliveryQueueSource).toContain(
      "transaction.json(toJsonValue({ browserPushEnabled: true }))",
    );
    expect(deliveryQueueSource).toContain(
      "toJsonValue({ browserPushEnabled: remaining[0]?.exists ?? false })",
    );
    expect(serverSource).not.toContain("JSON.stringify(input.metadata ?? {})");
    expect(deliveryQueueSource).not.toContain("JSON.stringify({ browserPushEnabled:");
    expect(jsonValueSource).toContain("export function toJsonValue");
    expect(auditWriterSource).toContain('from "@/lib/server/json-value"');
    expect(auditWriterSource).not.toContain("function toJsonValue");
  });

  it("repairs only migration-managed system roles", () => {
    expect(migrationSource).toContain("where role.is_system");
    expect(migrationSource).toContain("Custom roles remain untouched");
    expect(migrationSource).toContain("notifications.preference.manage_settings");
  });
});
