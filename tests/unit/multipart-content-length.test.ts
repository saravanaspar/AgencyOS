import { describe, expect, it } from "vitest";

import { validateMultipartContentLength } from "@/lib/server/multipart-content-length";

function requestWithLength(contentLength?: string) {
  return new Request("https://agency.example.test/upload", {
    method: "POST",
    headers: contentLength === undefined ? undefined : { "content-length": contentLength },
  });
}

describe("multipart Content-Length boundary", () => {
  it("accepts a positive safe length within the file and overhead allowance", () => {
    expect(validateMultipartContentLength(requestWithLength("1100"), 1000, 100)).toEqual({
      ok: true,
      contentLength: 1100,
    });
  });

  it("requires a canonical positive Content-Length", () => {
    for (const value of [undefined, "", "0", "-1", "1.5", "1e3", "not-a-number"]) {
      expect(validateMultipartContentLength(requestWithLength(value), 1000, 100)).toEqual({
        ok: false,
        status: 411,
      });
    }
  });

  it("rejects declared bodies above the complete multipart allowance", () => {
    expect(validateMultipartContentLength(requestWithLength("1101"), 1000, 100)).toEqual({
      ok: false,
      status: 413,
    });
  });
});
