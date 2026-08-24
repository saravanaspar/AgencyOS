export type MultipartContentLengthResult =
  { ok: true; contentLength: number } | { ok: false; status: 411 | 413 };

export function validateMultipartContentLength(
  request: Request,
  maximumFileBytes: number,
  maximumOverheadBytes: number,
): MultipartContentLengthResult {
  if (
    !Number.isSafeInteger(maximumFileBytes) ||
    maximumFileBytes < 1 ||
    !Number.isSafeInteger(maximumOverheadBytes) ||
    maximumOverheadBytes < 0
  ) {
    throw new Error("Valid multipart size limits are required.");
  }

  const rawContentLength = request.headers.get("content-length");
  if (!rawContentLength || !/^[1-9]\d*$/.test(rawContentLength)) {
    return { ok: false, status: 411 };
  }

  const contentLength = Number(rawContentLength);
  if (!Number.isSafeInteger(contentLength)) return { ok: false, status: 411 };
  if (contentLength > maximumFileBytes + maximumOverheadBytes) {
    return { ok: false, status: 413 };
  }
  return { ok: true, contentLength };
}
