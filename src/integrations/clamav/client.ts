import "server-only";

import { once } from "node:events";
import { Socket } from "node:net";

const CLAMAV_CHUNK_BYTES = 64 * 1024;
const DEFAULT_CLAMAV_PORT = 3310;

export interface ClamavScanResult {
  verdict: "clean" | "infected";
  engine: "clamav";
  signature?: string;
}

function scannerError(code: string): Error {
  return new Error(code);
}

export function parseClamavResponse(value: string): ClamavScanResult {
  const response = value.replaceAll("\0", "").trim();
  if (/^(?:stream|[^:]+): OK$/i.test(response)) {
    return { verdict: "clean", engine: "clamav" };
  }

  const infected = response.match(/^(?:stream|[^:]+):\s+(.+)\s+FOUND$/i);
  if (infected?.[1]) {
    return {
      verdict: "infected",
      engine: "clamav",
      signature: infected[1].trim().slice(0, 200),
    };
  }

  if (/ERROR$/i.test(response)) {
    throw scannerError("scanner_clamav_error");
  }
  throw scannerError("scanner_invalid_response");
}

async function writeSocket(socket: Socket, data: Uint8Array): Promise<void> {
  if (socket.write(data)) return;
  await once(socket, "drain");
}

async function sendInstream(socket: Socket, buffer: Buffer): Promise<void> {
  await writeSocket(socket, Buffer.from("zINSTREAM\0", "ascii"));
  for (let offset = 0; offset < buffer.length; offset += CLAMAV_CHUNK_BYTES) {
    const chunk = buffer.subarray(offset, Math.min(buffer.length, offset + CLAMAV_CHUNK_BYTES));
    const size = Buffer.allocUnsafe(4);
    size.writeUInt32BE(chunk.length, 0);
    await writeSocket(socket, size);
    await writeSocket(socket, chunk);
  }
  await writeSocket(socket, Buffer.alloc(4));
  socket.end();
}

export async function scanBufferWithClamav(input: {
  host: string;
  port?: number;
  buffer: Buffer;
  timeoutMs: number;
  maxResponseBytes: number;
}): Promise<ClamavScanResult> {
  const socket = new Socket();
  const responseChunks: Buffer[] = [];
  let responseBytes = 0;
  let settled = false;

  const response = await new Promise<string>((resolve, reject) => {
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error instanceof Error ? error : scannerError("scanner_network_error"));
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(Buffer.concat(responseChunks).toString("utf8"));
    };

    socket.setTimeout(input.timeoutMs);
    socket.once("timeout", () => fail(scannerError("scanner_timeout")));
    socket.once("error", () => fail(scannerError("scanner_network_error")));
    socket.on("data", (chunk: Buffer) => {
      responseBytes += chunk.length;
      if (responseBytes > input.maxResponseBytes) {
        fail(scannerError("scanner_response_too_large"));
        return;
      }
      responseChunks.push(chunk);
      if (chunk.includes(0)) succeed();
    });
    socket.once("close", () => {
      if (!settled && responseBytes > 0) succeed();
      else if (!settled) fail(scannerError("scanner_empty_response"));
    });

    socket.connect(input.port ?? DEFAULT_CLAMAV_PORT, input.host, () => {
      void sendInstream(socket, input.buffer).catch(fail);
    });
  });

  return parseClamavResponse(response);
}
