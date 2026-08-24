import { Buffer } from "node:buffer";

import { afterEach, describe, expect, it, vi } from "vitest";

interface AlertConfiguration {
  webhookUrl: string;
  webhookSecret: string;
}

interface AlertController {
  recordFailure(): Promise<string>;
  recordSuccess(): Promise<string>;
}

interface AlertModule {
  AUDIT_PIPELINE_ALERT_MAX_PAYLOAD_BYTES: number;
  AUDIT_PIPELINE_ALERT_REPEAT_INTERVAL_MS: number;
  AUDIT_PIPELINE_ALERT_TIMEOUT_MS: number;
  readAuditPipelineAlertConfiguration(
    environment?: Record<string, string | undefined>,
    options?: { required?: boolean },
  ): AlertConfiguration | null;
  createAuditPipelineAlertController(
    configuration: AlertConfiguration | null,
    options?: {
      fetchImpl?: typeof fetch;
      now?: () => number;
      repeatIntervalMs?: number;
    },
  ): AlertController;
}

const moduleUrl = new URL("../../scripts/workers/audit-pipeline-alert.mjs", import.meta.url).href;
const alerts = (await import(moduleUrl)) as AlertModule;
const secret = "alert-secret-abcdefghijklmnopqrstuvwxyz";
const configuration = {
  webhookUrl: "https://alerts.example.test/audit-pipeline",
  webhookSecret: secret,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("audit-pipeline out-of-band alerts", () => {
  it("fails closed for unsafe or incomplete production configuration", () => {
    expect(alerts.readAuditPipelineAlertConfiguration({ NODE_ENV: "development" })).toBeNull();
    expect(() => alerts.readAuditPipelineAlertConfiguration({ NODE_ENV: "production" })).toThrow(
      "are required in production",
    );
    expect(() =>
      alerts.readAuditPipelineAlertConfiguration({
        NODE_ENV: "development",
        AUDIT_PIPELINE_ALERT_WEBHOOK_URL: configuration.webhookUrl,
      }),
    ).toThrow("must be configured together");
    expect(() =>
      alerts.readAuditPipelineAlertConfiguration({
        NODE_ENV: "development",
        AUDIT_PIPELINE_ALERT_WEBHOOK_URL: "http://alerts.example.test/audit-pipeline",
        AUDIT_PIPELINE_ALERT_WEBHOOK_SECRET: secret,
      }),
    ).toThrow("must use HTTPS");
    expect(() =>
      alerts.readAuditPipelineAlertConfiguration({
        NODE_ENV: "development",
        AUDIT_PIPELINE_ALERT_WEBHOOK_URL: configuration.webhookUrl,
        AUDIT_PIPELINE_ALERT_WEBHOOK_SECRET: "too-short",
      }),
    ).toThrow("32 to 512 printable ASCII");
  });

  it("posts only a bounded generic critical payload with hardened fetch options", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const occurredAt = Date.parse("2026-08-24T10:00:00.000Z");
    const controller = alerts.createAuditPipelineAlertController(configuration, {
      fetchImpl: fetchMock as unknown as typeof fetch,
      now: () => occurredAt,
    });

    await expect(controller.recordFailure()).resolves.toBe("sent");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(configuration.webhookUrl);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${secret}`);
    expect(headers.get("content-type")).toBe("application/json");

    const bodyText = String(init.body);
    const body = JSON.parse(bodyText) as Record<string, unknown>;
    expect(body).toEqual({
      version: 1,
      event: "audit_pipeline.failure",
      severity: "critical",
      service: "agencyos",
      component: "audit_pipeline",
      status: "failed",
      occurredAt: "2026-08-24T10:00:00.000Z",
    });
    expect(headers.get("content-length")).toBe(String(Buffer.byteLength(bodyText, "utf8")));
    expect(Buffer.byteLength(bodyText, "utf8")).toBeLessThanOrEqual(
      alerts.AUDIT_PIPELINE_ALERT_MAX_PAYLOAD_BYTES,
    );
    expect(bodyText).not.toContain(secret);
    expect(bodyText).not.toContain(configuration.webhookUrl);
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it("throttles repeat failures and emits exactly one recovery after success", async () => {
    let currentTime = Date.parse("2026-08-24T10:00:00.000Z");
    const fetchMock = vi.fn(async () => ({ ok: true }));
    const controller = alerts.createAuditPipelineAlertController(configuration, {
      fetchImpl: fetchMock as unknown as typeof fetch,
      now: () => currentTime,
    });

    await expect(controller.recordFailure()).resolves.toBe("sent");
    currentTime += 5 * 60_000;
    await expect(controller.recordFailure()).resolves.toBe("throttled");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    currentTime += alerts.AUDIT_PIPELINE_ALERT_REPEAT_INTERVAL_MS - 5 * 60_000;
    await expect(controller.recordFailure()).resolves.toBe("sent");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    currentTime += 60_000;
    await expect(controller.recordSuccess()).resolves.toBe("sent");
    await expect(controller.recordSuccess()).resolves.toBe("idle");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const recoveryBody = JSON.parse(
      String((fetchMock.mock.calls[2] as unknown as [string, RequestInit])[1].body),
    ) as Record<string, unknown>;
    expect(recoveryBody).toMatchObject({
      event: "audit_pipeline.recovered",
      severity: "info",
      status: "recovered",
    });
  });

  it("retries an undelivered alert without reading or logging the provider response", async () => {
    const responseText = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, text: responseText })
      .mockResolvedValueOnce({ ok: true, text: responseText });
    const controller = alerts.createAuditPipelineAlertController(configuration, {
      fetchImpl: fetchMock as unknown as typeof fetch,
      now: () => Date.parse("2026-08-24T10:00:00.000Z"),
    });

    await expect(controller.recordFailure()).resolves.toBe("delivery_failed");
    await expect(controller.recordFailure()).resolves.toBe("sent");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(responseText).not.toHaveBeenCalled();
    expect(alerts.AUDIT_PIPELINE_ALERT_TIMEOUT_MS).toBe(5_000);
  });
});
