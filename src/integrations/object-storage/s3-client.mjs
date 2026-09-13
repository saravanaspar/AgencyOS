import { createHash, createHmac } from "node:crypto";
import { Readable } from "node:stream";

const EMPTY_SHA256 = createHash("sha256").update("").digest("hex");
const MAX_ERROR_BODY_BYTES = 64 * 1024;

function hmac(key, value, encoding) {
  return createHmac("sha256", key).update(value, "utf8").digest(encoding);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function awsEncode(value) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalPath(bucket, key = "") {
  const encodedBucket = awsEncode(bucket);
  if (!key) return `/${encodedBucket}`;
  return `/${encodedBucket}/${key.split("/").map(awsEncode).join("/")}`;
}

function canonicalQuery(parameters = {}) {
  return Object.entries(parameters)
    .filter(([, value]) => value !== undefined && value !== null)
    .flatMap(([name, raw]) => {
      const values = Array.isArray(raw) ? raw : [raw];
      return values.map((value) => [awsEncode(name), awsEncode(String(value))]);
    })
    .sort(([leftName, leftValue], [rightName, rightValue]) =>
      leftName === rightName
        ? leftValue < rightValue
          ? -1
          : leftValue > rightValue
            ? 1
            : 0
        : leftName < rightName
          ? -1
          : leftName > rightName
            ? 1
            : 0,
    )
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
}

function canonicalHeaderValue(value) {
  return value.trim().replace(/\s+/g, " ");
}

function signedHeaderBlock(url, headers) {
  const entries = [["host", url.host]];
  for (const [name, value] of headers) {
    const normalizedName = name.toLowerCase();
    if (
      normalizedName === "authorization" ||
      normalizedName === "content-length" ||
      normalizedName === "host"
    ) {
      continue;
    }
    entries.push([normalizedName, canonicalHeaderValue(value)]);
  }
  entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return {
    canonicalHeaders: `${entries.map(([name, value]) => `${name}:${value}`).join("\n")}\n`,
    signedHeaders: entries.map(([name]) => name).join(";"),
  };
}

function escapeXml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function amzDate(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function signingKey(secretKey, dateStamp, region) {
  const dateKey = hmac(`AWS4${secretKey}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
}

function normalizeEndpoint(value) {
  const endpoint = new URL(value);
  if (!["http:", "https:"].includes(endpoint.protocol)) {
    throw new Error("S3 endpoint must use HTTP or HTTPS.");
  }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error("S3 endpoint must not contain credentials, a query, or a fragment.");
  }
  if (endpoint.pathname && endpoint.pathname !== "/") {
    throw new Error("S3 endpoint must not contain a path.");
  }
  endpoint.pathname = "/";
  return endpoint;
}

function xmlText(xml, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return match?.[1]?.trim() ?? null;
}

function decodeXml(value) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

async function readBoundedText(response, maximumBytes = MAX_ERROR_BODY_BYTES) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        return text;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

export class S3CompatibleError extends Error {
  constructor(message, { code = "S3Error", statusCode = 0 } = {}) {
    super(message);
    this.name = "S3CompatibleError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class S3CompatibleClient {
  constructor(configuration, options = {}) {
    if (!configuration?.endpoint) throw new Error("S3 endpoint is required.");
    if (!configuration?.region) throw new Error("S3 region is required.");
    if (!configuration?.accessKey) throw new Error("S3 access key is required.");
    if (!configuration?.secretKey) throw new Error("S3 secret key is required.");
    this.endpoint = normalizeEndpoint(configuration.endpoint);
    this.region = configuration.region;
    this.accessKey = configuration.accessKey;
    this.secretKey = configuration.secretKey;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.clock = options.clock ?? (() => new Date());
  }

  async request({ method, bucket, key = "", query = {}, headers = {}, body = null }) {
    const date = this.clock();
    const timestamp = amzDate(date);
    const dateStamp = timestamp.slice(0, 8);
    const path = canonicalPath(bucket, key);
    const queryString = canonicalQuery(query);
    const url = new URL(this.endpoint);
    url.pathname = path;
    url.search = queryString;

    const payloadHash = body === null ? EMPTY_SHA256 : sha256(body);
    const requestHeaders = new Headers(headers);
    requestHeaders.set("x-amz-content-sha256", payloadHash);
    requestHeaders.set("x-amz-date", timestamp);
    if (body !== null && !requestHeaders.has("content-length")) {
      requestHeaders.set("content-length", String(body.byteLength));
    }
    const { canonicalHeaders, signedHeaders } = signedHeaderBlock(url, requestHeaders);
    const canonicalRequest = [
      method,
      path,
      queryString,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");
    const scope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", timestamp, scope, sha256(canonicalRequest)].join(
      "\n",
    );
    const signature = hmac(signingKey(this.secretKey, dateStamp, this.region), stringToSign, "hex");
    const authorization = `AWS4-HMAC-SHA256 Credential=${this.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    requestHeaders.set("authorization", authorization);

    let response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: requestHeaders,
        body: body === null ? undefined : body,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (error) {
      throw new S3CompatibleError("Object-storage request failed.", {
        code:
          error instanceof Error && error.name === "TimeoutError"
            ? "RequestTimeout"
            : "NetworkError",
      });
    }

    if (response.ok) return response;

    const responseBody = method === "HEAD" ? "" : await readBoundedText(response);
    const responseCode = responseBody ? xmlText(responseBody, "Code") : null;
    const code = responseCode
      ? decodeXml(responseCode)
      : response.status === 404
        ? "NotFound"
        : `HTTP${response.status}`;
    throw new S3CompatibleError(`Object-storage request failed with status ${response.status}.`, {
      code,
      statusCode: response.status,
    });
  }

  async bucketExists(bucket) {
    try {
      await this.request({ method: "HEAD", bucket });
      return true;
    } catch (error) {
      if (error instanceof S3CompatibleError && error.statusCode === 404) return false;
      throw error;
    }
  }

  async makeBucket(bucket, region = this.region) {
    const useLocationConstraint = region !== "us-east-1" && region !== "auto";
    const body = useLocationConstraint
      ? Buffer.from(
          `<?xml version="1.0" encoding="UTF-8"?><CreateBucketConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><LocationConstraint>${escapeXml(region)}</LocationConstraint></CreateBucketConfiguration>`,
        )
      : Buffer.alloc(0);
    await this.request({
      method: "PUT",
      bucket,
      body,
      headers: useLocationConstraint ? { "content-type": "application/xml" } : {},
    });
  }

  async putObject(bucket, key, body, size, metadata = {}) {
    const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
    if (size !== undefined && size !== buffer.length) {
      throw new Error("Object-storage upload size does not match the supplied body.");
    }
    await this.request({ method: "PUT", bucket, key, body: buffer, headers: metadata });
  }

  async getObject(bucket, key) {
    const response = await this.request({ method: "GET", bucket, key });
    if (!response.body) throw new S3CompatibleError("Object-storage response had no body.");
    return Readable.fromWeb(response.body);
  }

  async statObject(bucket, key) {
    const response = await this.request({ method: "HEAD", bucket, key });
    const size = Number(response.headers.get("content-length") ?? 0);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new S3CompatibleError("Object-storage response contained an invalid size.");
    }
    const metadata = {};
    for (const [name, value] of response.headers) {
      if (name.startsWith("x-amz-meta-")) metadata[name.slice("x-amz-meta-".length)] = value;
    }
    return {
      size,
      etag: response.headers.get("etag")?.replace(/^"|"$/g, "") ?? undefined,
      lastModified: response.headers.get("last-modified")
        ? new Date(response.headers.get("last-modified"))
        : undefined,
      metaData: metadata,
    };
  }

  async removeObject(bucket, key) {
    await this.request({ method: "DELETE", bucket, key });
  }

  async getObjectLockConfig(bucket) {
    const response = await this.request({ method: "GET", bucket, query: { "object-lock": "" } });
    const xml = await readBoundedText(response);
    const objectLockEnabled = xmlText(xml, "ObjectLockEnabled") ?? undefined;
    const mode = xmlText(xml, "Mode") ?? undefined;
    const days = xmlText(xml, "Days");
    const years = xmlText(xml, "Years");
    return {
      objectLockEnabled,
      mode,
      unit: days ? "Days" : years ? "Years" : undefined,
      validity: Number(days ?? years ?? 0),
    };
  }
}

export function createS3CompatibleClient(configuration, options) {
  return new S3CompatibleClient(configuration, options);
}
