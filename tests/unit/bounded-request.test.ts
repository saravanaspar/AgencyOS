import { describe, expect, it } from "vitest";

import { readBoundedRequestJson, readBoundedRequestText } from "@/lib/server/bounded-request";

describe("bounded request readers", () => {
  it("accepts a body without Content-Length while enforcing the streamed byte limit", async () => {
    const request = new Request("https://agency.example.test/webhook", {
      method: "POST",
      body: "connector-ok",
    });

    await expect(readBoundedRequestText(request, 64)).resolves.toEqual({
      ok: true,
      text: "connector-ok",
    });
  });

  it("rejects declared, understated, and multibyte bodies above the limit", async () => {
    const declared = new Request("https://agency.example.test/webhook", {
      method: "POST",
      headers: { "content-length": "100" },
      body: "small",
    });
    await expect(readBoundedRequestText(declared, 10)).resolves.toEqual({
      ok: false,
      status: 413,
    });

    const understated = new Request("https://agency.example.test/webhook", {
      method: "POST",
      headers: { "content-length": "1" },
      body: "12345678901",
    });
    await expect(readBoundedRequestText(understated, 10)).resolves.toEqual({
      ok: false,
      status: 413,
    });

    const multibyte = new Request("https://agency.example.test/webhook", {
      method: "POST",
      body: "€€",
    });
    await expect(readBoundedRequestText(multibyte, 5)).resolves.toEqual({
      ok: false,
      status: 413,
    });
  });

  it("can require a valid Content-Length for signed callback protocols", async () => {
    const missing = new Request("https://agency.example.test/callback", {
      method: "POST",
      body: "{}",
    });
    await expect(
      readBoundedRequestText(missing, 64, { requireContentLength: true }),
    ).resolves.toEqual({ ok: false, status: 411 });

    const invalid = new Request("https://agency.example.test/callback", {
      method: "POST",
      headers: { "content-length": "not-a-number" },
      body: "{}",
    });
    await expect(readBoundedRequestText(invalid, 64)).resolves.toEqual({
      ok: false,
      status: 411,
    });
  });

  it("parses bounded JSON and reports malformed JSON without buffering again", async () => {
    const valid = new Request("https://agency.example.test/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", method: "ping" }),
    });
    const parsed = await readBoundedRequestJson(valid, 256);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toEqual({ jsonrpc: "2.0", method: "ping" });

    const invalid = new Request("https://agency.example.test/mcp", {
      method: "POST",
      body: "{",
    });
    await expect(readBoundedRequestJson(invalid, 256)).resolves.toEqual({
      ok: false,
      status: 400,
    });
  });
});
