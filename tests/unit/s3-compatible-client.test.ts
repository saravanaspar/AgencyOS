import { describe, expect, it } from "vitest";

import {
  createS3CompatibleClient,
  S3CompatibleError,
} from "@/integrations/object-storage/s3-client.mjs";

const configuration = {
  endpoint: "https://objects.example.com",
  region: "us-east-1",
  accessKey: "runtime-access-key",
  secretKey: "runtime-secret-key",
};
const fixedClock = () => new Date("2026-09-13T08:00:00.000Z");

describe("S3-compatible client", () => {
  it("signs path-style requests without putting credentials in the URL", async () => {
    const calls: Array<{ url: URL; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: new URL(String(input)), init: init ?? {} });
      return new Response(null, { status: 200, headers: { "content-length": "0" } });
    };
    const client = createS3CompatibleClient(configuration, { fetchImpl, clock: fixedClock });

    await client.putObject(
      "agencyos-runtime",
      "private-files/folder/space file.txt",
      Buffer.from("hello"),
      5,
      { "content-type": "text/plain" },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].url.href).toBe(
      "https://objects.example.com/agencyos-runtime/private-files/folder/space%20file.txt",
    );
    expect(calls[0].url.href).not.toContain(configuration.accessKey);
    expect(calls[0].url.href).not.toContain(configuration.secretKey);
    const headers = new Headers(calls[0].init.headers);
    expect(headers.get("authorization")).toBe(
      "AWS4-HMAC-SHA256 Credential=runtime-access-key/20260913/us-east-1/s3/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=330cf6e6edc6cea1eceb9eefc0433bef556cd085a50556619090dd65d5eebf3e",
    );
    expect(headers.get("x-amz-content-sha256")).toMatch(/^[a-f0-9]{64}$/);
    expect(headers.get("x-amz-date")).toBe("20260913T080000Z");
  });

  it("maps a 404 HEAD response to an unavailable bucket", async () => {
    const client = createS3CompatibleClient(configuration, {
      clock: fixedClock,
      fetchImpl: async () => new Response(null, { status: 404 }),
    });
    await expect(client.bucketExists("agencyos-runtime")).resolves.toBe(false);
  });

  it("keeps provider error bodies out of thrown public messages", async () => {
    const client = createS3CompatibleClient(configuration, {
      clock: fixedClock,
      fetchImpl: async () =>
        new Response(
          "<Error><Code>AccessDenied</Code><Message>secret provider detail</Message></Error>",
          { status: 403 },
        ),
    });
    await expect(
      client.getObject("agencyos-runtime", "private-files/file.txt"),
    ).rejects.toMatchObject({
      name: "S3CompatibleError",
      code: "AccessDenied",
      statusCode: 403,
      message: "Object-storage request failed with status 403.",
    } satisfies Partial<S3CompatibleError>);
  });

  it("parses S3 Object Lock default retention for backup preflight", async () => {
    const client = createS3CompatibleClient(configuration, {
      clock: fixedClock,
      fetchImpl: async () =>
        new Response(
          "<ObjectLockConfiguration><ObjectLockEnabled>Enabled</ObjectLockEnabled><Rule><DefaultRetention><Mode>COMPLIANCE</Mode><Days>30</Days></DefaultRetention></Rule></ObjectLockConfiguration>",
          { status: 200 },
        ),
    });
    await expect(client.getObjectLockConfig("agencyos-backup")).resolves.toEqual({
      objectLockEnabled: "Enabled",
      mode: "COMPLIANCE",
      unit: "Days",
      validity: 30,
    });
  });
});
