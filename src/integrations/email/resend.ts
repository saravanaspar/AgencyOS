import "server-only";

import { z } from "zod";

import { readBoundedResponseText } from "@/lib/server/bounded-response";

const RESEND_EMAIL_URL = "https://api.resend.com/emails";
const RESPONSE_LIMIT_BYTES = 32 * 1024;
const DELIVERY_TIMEOUT_MS = 15_000;

const successSchema = z.object({
  id: z.string().trim().min(1).max(200),
});

const errorSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  message: z.string().trim().min(1).max(500).optional(),
});

export interface ResendEmailAttachment {
  fileName: string;
  content: Buffer;
}

export interface ResendEmailInput {
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
  attachments?: readonly ResendEmailAttachment[];
}

export type ResendEmailResult =
  | { delivered: true; providerReference: string }
  | {
      delivered: false;
      retryable: boolean;
      errorCode: string;
      retryAfterSeconds?: number;
    };

function retryAfterSeconds(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.ceil(seconds), 6 * 60 * 60);
  }
  const date = Date.parse(header);
  if (!Number.isFinite(date)) return undefined;
  return Math.min(Math.max(0, Math.ceil((date - Date.now()) / 1000)), 6 * 60 * 60);
}

function safeProviderCode(value: string | undefined, status: number): string {
  if (!value) return `resend_http_${status}`;
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .slice(0, 80);
  return normalized ? `resend_${normalized}` : `resend_http_${status}`;
}

export async function sendEmailWithResend(
  configuration: { apiKey: string; from: string },
  input: ResendEmailInput,
): Promise<ResendEmailResult> {
  try {
    const response = await fetch(RESEND_EMAIL_URL, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      headers: {
        authorization: `Bearer ${configuration.apiKey}`,
        "content-type": "application/json",
        "idempotency-key": input.idempotencyKey.slice(0, 256),
      },
      body: JSON.stringify({
        from: configuration.from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        html: input.html,
        attachments: input.attachments?.map((attachment) => ({
          filename: attachment.fileName,
          content: attachment.content.toString("base64"),
        })),
      }),
    });

    const responseText = await readBoundedResponseText(
      response,
      RESPONSE_LIMIT_BYTES,
      "Resend response exceeded the safe limit.",
    );
    let parsedJson: unknown = {};
    if (responseText) {
      try {
        parsedJson = JSON.parse(responseText);
      } catch {
        if (response.ok) {
          return {
            delivered: false,
            retryable: true,
            errorCode: "resend_invalid_response",
          };
        }
      }
    }

    if (response.ok) {
      const success = successSchema.safeParse(parsedJson);
      if (!success.success) {
        return {
          delivered: false,
          retryable: true,
          errorCode: "resend_invalid_response",
        };
      }
      return { delivered: true, providerReference: success.data.id };
    }

    const providerError = errorSchema.safeParse(parsedJson);
    const providerName = providerError.success ? providerError.data.name : undefined;
    const retryable =
      response.status === 408 ||
      response.status === 429 ||
      response.status >= 500 ||
      (response.status === 409 && providerName === "concurrent_idempotent_requests");

    return {
      delivered: false,
      retryable,
      errorCode: safeProviderCode(providerName, response.status),
      retryAfterSeconds: retryAfterSeconds(response.headers.get("retry-after")),
    };
  } catch {
    return {
      delivered: false,
      retryable: true,
      errorCode: "resend_network_error",
    };
  }
}
