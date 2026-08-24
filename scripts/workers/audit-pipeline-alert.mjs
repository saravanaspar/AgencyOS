import { Buffer } from "node:buffer";
import process from "node:process";

export const AUDIT_PIPELINE_ALERT_MAX_PAYLOAD_BYTES = 1_024;
export const AUDIT_PIPELINE_ALERT_REPEAT_INTERVAL_MS = 30 * 60_000;
export const AUDIT_PIPELINE_ALERT_TIMEOUT_MS = 5_000;

const MAX_WEBHOOK_URL_LENGTH = 2_048;
const MAX_WEBHOOK_SECRET_LENGTH = 512;

export function readAuditPipelineAlertConfiguration(environment = process.env, options = {}) {
  const webhookUrl = environment.AUDIT_PIPELINE_ALERT_WEBHOOK_URL?.trim() ?? "";
  const webhookSecret = environment.AUDIT_PIPELINE_ALERT_WEBHOOK_SECRET?.trim() ?? "";
  const required = options.required ?? environment.NODE_ENV === "production";

  if (!webhookUrl && !webhookSecret) {
    if (required) {
      throw new Error(
        "AUDIT_PIPELINE_ALERT_WEBHOOK_URL and AUDIT_PIPELINE_ALERT_WEBHOOK_SECRET are required in production.",
      );
    }
    return null;
  }
  if (!webhookUrl || !webhookSecret) {
    throw new Error(
      "AUDIT_PIPELINE_ALERT_WEBHOOK_URL and AUDIT_PIPELINE_ALERT_WEBHOOK_SECRET must be configured together.",
    );
  }
  if (
    webhookSecret.length < 32 ||
    webhookSecret.length > MAX_WEBHOOK_SECRET_LENGTH ||
    !/^[\x21-\x7e]+$/.test(webhookSecret)
  ) {
    throw new Error(
      "AUDIT_PIPELINE_ALERT_WEBHOOK_SECRET must contain 32 to 512 printable ASCII characters without spaces.",
    );
  }
  if (webhookUrl.length > MAX_WEBHOOK_URL_LENGTH) {
    throw new Error("AUDIT_PIPELINE_ALERT_WEBHOOK_URL is too long.");
  }

  let parsed;
  try {
    parsed = new URL(webhookUrl);
  } catch {
    throw new Error("AUDIT_PIPELINE_ALERT_WEBHOOK_URL must be a valid HTTPS URL.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
    throw new Error(
      "AUDIT_PIPELINE_ALERT_WEBHOOK_URL must use HTTPS without credentials or a fragment.",
    );
  }

  return Object.freeze({ webhookUrl: parsed.href, webhookSecret });
}

function alertPayload(kind, occurredAt) {
  const failure = kind === "failure";
  return {
    version: 1,
    event: failure ? "audit_pipeline.failure" : "audit_pipeline.recovered",
    severity: failure ? "critical" : "info",
    service: "agencyos",
    component: "audit_pipeline",
    status: failure ? "failed" : "recovered",
    occurredAt: new Date(occurredAt).toISOString(),
  };
}

async function deliverAlert(configuration, kind, occurredAt, fetchImpl) {
  const body = JSON.stringify(alertPayload(kind, occurredAt));
  const contentLength = Buffer.byteLength(body, "utf8");
  if (contentLength > AUDIT_PIPELINE_ALERT_MAX_PAYLOAD_BYTES) return false;

  try {
    const response = await fetchImpl(configuration.webhookUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${configuration.webhookSecret}`,
        "content-type": "application/json",
        "content-length": String(contentLength),
      },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(AUDIT_PIPELINE_ALERT_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function createAuditPipelineAlertController(configuration, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const repeatIntervalMs = options.repeatIntervalMs ?? AUDIT_PIPELINE_ALERT_REPEAT_INTERVAL_MS;
  let incidentActive = false;
  let lastFailureAlertAt = null;

  return Object.freeze({
    async recordFailure() {
      incidentActive = true;
      if (!configuration) return "not_configured";

      const occurredAt = now();
      if (lastFailureAlertAt !== null && occurredAt - lastFailureAlertAt < repeatIntervalMs) {
        return "throttled";
      }

      const delivered = await deliverAlert(configuration, "failure", occurredAt, fetchImpl);
      if (!delivered) return "delivery_failed";
      lastFailureAlertAt = occurredAt;
      return "sent";
    },

    async recordSuccess() {
      if (!incidentActive) return "idle";
      if (!configuration) {
        incidentActive = false;
        lastFailureAlertAt = null;
        return "not_configured";
      }

      const delivered = await deliverAlert(configuration, "recovery", now(), fetchImpl);
      if (!delivered) return "delivery_failed";
      incidentActive = false;
      lastFailureAlertAt = null;
      return "sent";
    },
  });
}
