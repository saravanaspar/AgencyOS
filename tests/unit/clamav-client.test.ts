import { createServer } from "node:net";

import { describe, expect, it } from "vitest";

import { parseClamavResponse, scanBufferWithClamav } from "@/integrations/clamav/client";

describe("ClamAV response parsing", () => {
  it("accepts a clean streamed file", () => {
    expect(parseClamavResponse("stream: OK\0")).toEqual({
      verdict: "clean",
      engine: "clamav",
    });
  });

  it("extracts and bounds an infected signature", () => {
    expect(parseClamavResponse("stream: Eicar-Signature FOUND\0")).toEqual({
      verdict: "infected",
      engine: "clamav",
      signature: "Eicar-Signature",
    });
  });

  it("streams length-prefixed bytes to clamd", async () => {
    const payload = Buffer.from("hello");
    const expectedBytes = Buffer.concat([
      Buffer.from("zINSTREAM\0", "ascii"),
      Buffer.from([0, 0, 0, payload.length]),
      payload,
      Buffer.alloc(4),
    ]);

    const server = createServer({ allowHalfOpen: true });
    const received: Buffer[] = [];
    server.on("connection", (socket) => {
      socket.on("data", (chunk) => {
        received.push(chunk);
        if (Buffer.concat(received).length >= expectedBytes.length) {
          socket.end(Buffer.from("stream: OK\0", "ascii"));
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test_server_address_missing");

    try {
      await expect(
        scanBufferWithClamav({
          host: "127.0.0.1",
          port: address.port,
          buffer: payload,
          timeoutMs: 2_000,
          maxResponseBytes: 1_024,
        }),
      ).resolves.toEqual({ verdict: "clean", engine: "clamav" });
      expect(Buffer.concat(received)).toEqual(expectedBytes);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("rejects daemon errors and unknown responses", () => {
    expect(() => parseClamavResponse("INSTREAM size limit exceeded. ERROR\0")).toThrow(
      "scanner_clamav_error",
    );
    expect(() => parseClamavResponse("unexpected\0")).toThrow("scanner_invalid_response");
  });
});
