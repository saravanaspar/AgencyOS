import { describe, expect, it } from "vitest";

import { readBoundedResponseText } from "@/lib/server/bounded-response";

describe("bounded response reader", () => {
  it("returns a response body within the configured byte limit", async () => {
    const response = new Response("connector-ok");
    await expect(readBoundedResponseText(response, 64, "too large")).resolves.toBe("connector-ok");
  });

  it("rejects declared and streamed responses above the limit", async () => {
    const declared = new Response("small", { headers: { "content-length": "100" } });
    await expect(readBoundedResponseText(declared, 10, "too large")).rejects.toThrow("too large");

    const streamed = new Response("12345678901");
    await expect(readBoundedResponseText(streamed, 10, "too large")).rejects.toThrow("too large");
  });
});
