import { describe, expect, it } from "vitest";

import {
  assertObjectStorageLocation,
  isObjectStorageNotFoundError,
  OBJECT_STORAGE_DOCUMENT_TEMPLATE_BUCKET,
  OBJECT_STORAGE_PRIVATE_BUCKET,
  OBJECT_STORAGE_PROJECT_ATTACHMENTS_BUCKET,
  OBJECT_STORAGE_QUARANTINE_BUCKET,
  parseObjectStorageEndpoint,
} from "@/integrations/object-storage/client";
import {
  assertObjectStorageIsolation,
  assertRuntimeBackupIsolation,
  objectStorageConfiguration,
  resolveObjectStorageLocation,
} from "@/integrations/object-storage/config.mjs";

function storageEnvironment(endpoint = "https://s3.us-west-004.backblazeb2.com") {
  return {
    OBJECT_STORAGE_ENDPOINT: endpoint,
    OBJECT_STORAGE_REGION: "us-west-004",
    OBJECT_STORAGE_ACCESS_KEY_ID: "runtime-key",
    OBJECT_STORAGE_SECRET_ACCESS_KEY: "runtime-secret",
    OBJECT_STORAGE_BACKUP_ACCESS_KEY_ID: "source-key",
    OBJECT_STORAGE_BACKUP_SECRET_ACCESS_KEY: "source-secret",
    OBJECT_STORAGE_BUCKET: "agencyos-runtime",
    B2_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
    B2_BUCKET: "agencyos-backup",
    B2_WRITER_KEY_ID: "writer-key",
  };
}

describe("object-storage boundary", () => {
  it("parses local HTTP and hosted HTTPS endpoints without provider-specific settings", () => {
    expect(parseObjectStorageEndpoint("http://127.0.0.1:9000")).toEqual({
      value: "http://127.0.0.1:9000",
      hostname: "127.0.0.1",
      port: 9000,
      useSSL: false,
    });
    expect(parseObjectStorageEndpoint("https://objects.example.com")).toEqual({
      value: "https://objects.example.com",
      hostname: "objects.example.com",
      port: 443,
      useSSL: true,
    });
    expect(() => parseObjectStorageEndpoint("ftp://objects.example.com")).toThrow(
      "http:// or https://",
    );
    expect(() => parseObjectStorageEndpoint("https://objects.example.com/agencyos")).toThrow(
      "must not contain a path",
    );
    expect(() => parseObjectStorageEndpoint("https://user:secret@objects.example.com")).toThrow(
      "must not contain credentials",
    );
  });

  it("allows only AgencyOS private logical buckets and traversal-safe keys", () => {
    for (const bucket of [
      OBJECT_STORAGE_QUARANTINE_BUCKET,
      OBJECT_STORAGE_PRIVATE_BUCKET,
      OBJECT_STORAGE_DOCUMENT_TEMPLATE_BUCKET,
      OBJECT_STORAGE_PROJECT_ATTACHMENTS_BUCKET,
    ]) {
      expect(() =>
        assertObjectStorageLocation(
          bucket,
          "11111111-1111-4111-8111-111111111111/files/22222222-2222-4222-8222-222222222222.pdf",
        ),
      ).not.toThrow();
    }

    expect(() => assertObjectStorageLocation("public", "safe.pdf")).toThrow(
      "object-storage-bucket-not-allowed",
    );
    expect(() =>
      assertObjectStorageLocation(OBJECT_STORAGE_PRIVATE_BUCKET, "../secret.pdf"),
    ).toThrow("object-storage-key-invalid");
    expect(() =>
      assertObjectStorageLocation(OBJECT_STORAGE_PRIVATE_BUCKET, "/absolute.pdf"),
    ).toThrow("object-storage-key-invalid");
    expect(() =>
      assertObjectStorageLocation(OBJECT_STORAGE_PRIVATE_BUCKET, "folder\\file.pdf"),
    ).toThrow("object-storage-key-invalid");
  });

  it("recognizes S3-compatible not-found responses without swallowing other failures", () => {
    expect(isObjectStorageNotFoundError({ code: "NoSuchKey" })).toBe(true);
    expect(isObjectStorageNotFoundError({ code: "NoSuchBucket" })).toBe(true);
    expect(isObjectStorageNotFoundError({ code: "AccessDenied" })).toBe(false);
    expect(isObjectStorageNotFoundError(new Error("network failure"))).toBe(false);
  });

  it("maps identical local and hosted contracts to stable physical prefixes", () => {
    for (const endpoint of ["http://127.0.0.1:9000", "https://s3.us-west-004.backblazeb2.com"]) {
      const configuration = objectStorageConfiguration(storageEnvironment(endpoint));
      for (const [logicalBucket, prefix] of [
        [OBJECT_STORAGE_QUARANTINE_BUCKET, "private-file-quarantine"],
        [OBJECT_STORAGE_PRIVATE_BUCKET, "private-files"],
        [OBJECT_STORAGE_PROJECT_ATTACHMENTS_BUCKET, "project-attachments"],
        [OBJECT_STORAGE_DOCUMENT_TEMPLATE_BUCKET, "document-templates"],
      ]) {
        expect(
          resolveObjectStorageLocation(configuration, logicalBucket, "tenant/file.pdf"),
        ).toMatchObject({
          logicalBucket,
          physicalBucket: "agencyos-runtime",
          physicalKey: `${prefix}/tenant/file.pdf`,
        });
      }
    }
  });

  it("rejects unsafe endpoints, buckets, and missing common settings", () => {
    for (const endpoint of [
      "https://user:secret@s3.us-west-004.backblazeb2.com",
      "https://s3.us-west-004.backblazeb2.com/path",
      "https://s3.us-west-004.backblazeb2.com?bucket=runtime",
      "https://s3.us-west-004.backblazeb2.com#runtime",
    ]) {
      expect(() => objectStorageConfiguration(storageEnvironment(endpoint))).toThrow();
    }
    for (const bucket of ["Uppercase", "192.0.2.1", "bad..bucket"]) {
      expect(() =>
        objectStorageConfiguration({ ...storageEnvironment(), OBJECT_STORAGE_BUCKET: bucket }),
      ).toThrow("unsupported characters");
    }
    expect(() =>
      objectStorageConfiguration({
        OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:9000",
        OBJECT_STORAGE_REGION: "us-east-1",
        OBJECT_STORAGE_ACCESS_KEY_ID: "runtime-key",
        OBJECT_STORAGE_SECRET_ACCESS_KEY: "runtime-secret",
      }),
    ).toThrow("OBJECT_STORAGE_BUCKET");
  });

  it("enforces source, recovery, and immutable-destination separation", () => {
    const runtime = objectStorageConfiguration(storageEnvironment());
    expect(() => assertRuntimeBackupIsolation(runtime, storageEnvironment())).not.toThrow();
    expect(() =>
      assertRuntimeBackupIsolation(runtime, {
        ...storageEnvironment(),
        B2_BUCKET: "agencyos-runtime",
      }),
    ).toThrow("different buckets");
    expect(() =>
      assertRuntimeBackupIsolation(runtime, {
        ...storageEnvironment(),
        B2_WRITER_KEY_ID: "source-key",
      }),
    ).toThrow("different key IDs");

    const recoveryEnvironment = {
      ...storageEnvironment(),
      RECOVERY_OBJECT_STORAGE_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
      RECOVERY_OBJECT_STORAGE_REGION: "us-west-004",
      RECOVERY_OBJECT_STORAGE_ACCESS_KEY_ID: "recovery-key",
      RECOVERY_OBJECT_STORAGE_SECRET_ACCESS_KEY: "recovery-secret",
      RECOVERY_OBJECT_STORAGE_BUCKET: "agencyos-recovery",
    };
    const recovery = objectStorageConfiguration(recoveryEnvironment, "recovery");
    expect(() => assertObjectStorageIsolation(runtime, recovery)).not.toThrow();
    const overlapping = objectStorageConfiguration(
      { ...recoveryEnvironment, RECOVERY_OBJECT_STORAGE_BUCKET: "agencyos-runtime" },
      "recovery",
    );
    expect(() => assertObjectStorageIsolation(runtime, overlapping)).toThrow("must not overlap");
  });
});
