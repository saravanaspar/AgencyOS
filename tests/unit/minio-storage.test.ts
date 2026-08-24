import { describe, expect, it } from "vitest";

import {
  assertMinioObjectLocation,
  isMinioNotFoundError,
  MINIO_DOCUMENT_TEMPLATE_BUCKET,
  MINIO_LEGACY_PROJECT_BUCKET,
  MINIO_PRIVATE_BUCKET,
  MINIO_QUARANTINE_BUCKET,
  parseMinioEndpoint,
} from "@/integrations/minio/object-storage";

describe("MinIO object-storage boundary", () => {
  it("parses local HTTP and production HTTPS endpoints without paths", () => {
    expect(parseMinioEndpoint("http://127.0.0.1:9000")).toEqual({
      endPoint: "127.0.0.1",
      port: 9000,
      useSSL: false,
    });
    expect(parseMinioEndpoint("https://objects.example.com")).toEqual({
      endPoint: "objects.example.com",
      port: 443,
      useSSL: true,
    });
    expect(() => parseMinioEndpoint("ftp://objects.example.com")).toThrow("http:// or https://");
    expect(() => parseMinioEndpoint("https://objects.example.com/agencyos")).toThrow(
      "must not contain a path",
    );
    expect(() => parseMinioEndpoint("https://user:secret@objects.example.com")).toThrow(
      "must not contain credentials",
    );
  });

  it("allows only AgencyOS private buckets and traversal-safe keys", () => {
    for (const bucket of [
      MINIO_QUARANTINE_BUCKET,
      MINIO_PRIVATE_BUCKET,
      MINIO_DOCUMENT_TEMPLATE_BUCKET,
      MINIO_LEGACY_PROJECT_BUCKET,
    ]) {
      expect(() =>
        assertMinioObjectLocation(
          bucket,
          "11111111-1111-4111-8111-111111111111/files/22222222-2222-4222-8222-222222222222.pdf",
        ),
      ).not.toThrow();
    }

    expect(() => assertMinioObjectLocation("public", "safe.pdf")).toThrow(
      "minio-bucket-not-allowed",
    );
    expect(() => assertMinioObjectLocation(MINIO_PRIVATE_BUCKET, "../secret.pdf")).toThrow(
      "minio-object-key-invalid",
    );
    expect(() => assertMinioObjectLocation(MINIO_PRIVATE_BUCKET, "/absolute.pdf")).toThrow(
      "minio-object-key-invalid",
    );
    expect(() => assertMinioObjectLocation(MINIO_PRIVATE_BUCKET, "folder\\file.pdf")).toThrow(
      "minio-object-key-invalid",
    );
  });

  it("recognizes MinIO not-found responses without swallowing other failures", () => {
    expect(isMinioNotFoundError({ code: "NoSuchKey" })).toBe(true);
    expect(isMinioNotFoundError({ code: "NoSuchBucket" })).toBe(true);
    expect(isMinioNotFoundError({ code: "AccessDenied" })).toBe(false);
    expect(isMinioNotFoundError(new Error("network failure"))).toBe(false);
  });
});
