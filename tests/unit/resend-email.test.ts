import { afterEach, describe, expect, it, vi } from "vitest";

import { sendEmailWithResend } from "@/integrations/email/resend";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Resend email delivery", () => {
  it("sends a bounded idempotent request with attachments", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "email_123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendEmailWithResend(
        { apiKey: "re_abcdefghijklmnopqrstuvwxyz", from: "AgencyOS <mail@example.com>" },
        {
          to: "client@example.com",
          subject: "Invoice",
          text: "Attached",
          html: "<p>Attached</p>",
          idempotencyKey: "finance-email/123",
          attachments: [{ fileName: "invoice.pdf", content: Buffer.from("pdf") }],
        },
      ),
    ).resolves.toEqual({ delivered: true, providerReference: "email_123" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer re_abcdefghijklmnopqrstuvwxyz");
    expect(headers.get("idempotency-key")).toBe("finance-email/123");
    const body = JSON.parse(String(init.body));
    expect(body.to).toEqual(["client@example.com"]);
    expect(body.attachments).toEqual([{ filename: "invoice.pdf", content: "cGRm" }]);
  });

  it("retries rate limits and provider outages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ name: "rate_limit_exceeded" }), {
          status: 429,
          headers: { "retry-after": "45" },
        }),
      ),
    );

    await expect(
      sendEmailWithResend(
        { apiKey: "re_abcdefghijklmnopqrstuvwxyz", from: "mail@example.com" },
        {
          to: "client@example.com",
          subject: "Test",
          text: "Test",
          html: "<p>Test</p>",
          idempotencyKey: "test/123",
        },
      ),
    ).resolves.toEqual({
      delivered: false,
      retryable: true,
      errorCode: "resend_rate_limit_exceeded",
      retryAfterSeconds: 45,
    });
  });

  it("suppresses permanent provider rejections", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ name: "validation_error" }), { status: 403 }),
        ),
    );

    await expect(
      sendEmailWithResend(
        { apiKey: "re_abcdefghijklmnopqrstuvwxyz", from: "mail@example.com" },
        {
          to: "client@example.com",
          subject: "Test",
          text: "Test",
          html: "<p>Test</p>",
          idempotencyKey: "test/456",
        },
      ),
    ).resolves.toEqual({
      delivered: false,
      retryable: false,
      errorCode: "resend_validation_error",
      retryAfterSeconds: undefined,
    });
  });
});
