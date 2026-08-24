export interface BoundedRequestOptions {
  requireContentLength?: boolean;
}

export type BoundedRequestFailure = { ok: false; status: 400 | 411 | 413 };

function parseDeclaredLength(
  request: Request,
  maximumBytes: number,
  options: BoundedRequestOptions,
): number | BoundedRequestFailure | null {
  const rawLength = request.headers.get("content-length");
  if (rawLength === null) {
    return options.requireContentLength ? { ok: false, status: 411 } : null;
  }

  const declaredLength = Number(rawLength);
  if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
    return { ok: false, status: 411 };
  }
  if (declaredLength > maximumBytes) return { ok: false, status: 413 };
  return declaredLength;
}

export async function readBoundedRequestText(
  request: Request,
  maximumBytes: number,
  options: BoundedRequestOptions = {},
): Promise<{ ok: true; text: string } | BoundedRequestFailure> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error("A positive request-size limit is required.");
  }

  const declaredLength = parseDeclaredLength(request, maximumBytes, options);
  if (typeof declaredLength === "object" && declaredLength !== null) return declaredLength;
  if (!request.body) return { ok: true, text: "" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        return { ok: false, status: 413 };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(combined) };
}

export async function readBoundedRequestJson(
  request: Request,
  maximumBytes: number,
  options: BoundedRequestOptions = {},
): Promise<{ ok: true; value: unknown; text: string } | BoundedRequestFailure> {
  const bounded = await readBoundedRequestText(request, maximumBytes, options);
  if (!bounded.ok) return bounded;

  try {
    return { ok: true, value: JSON.parse(bounded.text) as unknown, text: bounded.text };
  } catch {
    return { ok: false, status: 400 };
  }
}
