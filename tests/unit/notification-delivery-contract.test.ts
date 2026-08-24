import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

describe("external notification delivery contracts", () => {
  it("runs through the single worker endpoint with bounded lock-safe claims", () => {
    const route = source("src/app/api/internal/workers/run/route.ts");
    const registry = source("src/modules/workers/server/worker-registry.ts");
    const boundary = source("src/lib/server/internal-worker.ts");
    const worker = source("src/modules/notifications/server/delivery-worker.ts");
    expect(route).toContain("INTERNAL_WORKER_SECRET");
    expect(route).toContain("runInternalWorkerRequest");
    expect(registry).toContain('key === "notifications"');
    expect(registry).toContain("runNotificationDeliveryWorker");
    expect(boundary).toContain("hasValidBearerSecret");
    expect(worker).toContain("for update skip locked");
    expect(worker).toContain("MAX_DELIVERIES_PER_RUN = 40");
    expect(worker).toContain("MAX_ATTEMPTS = 6");
  });

  it("uses encrypted payloadless push subscriptions and recipient-only detail retrieval", () => {
    const queue = source("src/modules/notifications/server/delivery-queue.ts");
    const worker = source("src/modules/notifications/server/delivery-worker.ts");
    const serviceWorker = source("public/notification-sw.js");
    expect(queue).toContain("encryptSecretObjectWithEnvironmentKey");
    expect(worker).toContain('method: "POST"');
    expect(worker).not.toContain("JSON.stringify({ title:");
    expect(serviceWorker).toContain("/api/notifications/push/latest");
    expect(serviceWorker).toContain('credentials: "include"');
  });

  it("supports only the built-in email and browser-push delivery channels", () => {
    const worker = source("src/modules/notifications/server/delivery-worker.ts");
    const resend = source("src/integrations/email/resend.ts");
    const queue = source("src/modules/notifications/server/delivery-queue.ts");
    const center = source("src/components/notifications/notification-center.tsx");
    expect(worker).toContain('row.channel === "email"');
    expect(worker).toContain('row.channel === "browser_push"');
    expect(queue).toContain('channels.push("email")');
    expect(queue).toContain('channels.push("browser_push")');
    expect(worker).toContain("sendEmailWithResend");
    expect(resend).toContain("https://api.resend.com/emails");
    expect(resend).toContain('"idempotency-key"');
    expect(worker).not.toContain("NOTIFICATION_EMAIL_DELIVERY_URL");
    expect(worker).not.toContain("n8n");
    expect(center).not.toContain("N8N");
  });
});
