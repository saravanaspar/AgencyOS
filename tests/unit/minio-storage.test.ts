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
import {
  assertObjectStorageIsolation,
  assertRuntimeBackupIsolation,
  objectStorageConfiguration,
  resolveObjectStorageLocation,
} from "@/integrations/object-storage/config.mjs";

function cloudEnvironment() {
  return {
    AGENCYOS_INFRA_MODE: "cloud",
    OBJECT_STORAGE_PROVIDER: "b2",
    OBJECT_STORAGE_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
    OBJECT_STORAGE_REGION: "us-west-004",
    OBJECT_STORAGE_ACCESS_KEY_ID: "runtime-key",
    OBJECT_STORAGE_SECRET_ACCESS_KEY: "runtime-secret",
    OBJECT_STORAGE_BACKUP_ACCESS_KEY_ID: "source-key",
    OBJECT_STORAGE_BACKUP_SECRET_ACCESS_KEY: "source-secret",
    OBJECT_STORAGE_QUARANTINE_BUCKET: "agencyos-runtime",
    OBJECT_STORAGE_QUARANTINE_PREFIX: "private-file-quarantine",
    OBJECT_STORAGE_PRIVATE_FILES_BUCKET: "agencyos-runtime",
    OBJECT_STORAGE_PRIVATE_FILES_PREFIX: "private-files",
    OBJECT_STORAGE_PROJECT_ATTACHMENTS_BUCKET: "agencyos-runtime",
    OBJECT_STORAGE_PROJECT_ATTACHMENTS_PREFIX: "project-attachments",
    OBJECT_STORAGE_DOCUMENT_TEMPLATES_BUCKET: "agencyos-runtime",
    OBJECT_STORAGE_DOCUMENT_TEMPLATES_PREFIX: "document-templates",
    B2_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
    B2_BUCKET: "agencyos-backup",
    B2_WRITER_KEY_ID: "writer-key",
  };
}

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

  it("maps stable logical buckets to cloud physical prefixes", () => {
    const environment = cloudEnvironment();
    const configuration = objectStorageConfiguration(environment);
    for (const [logicalBucket, prefix] of [
      [MINIO_QUARANTINE_BUCKET, "private-file-quarantine"],
      [MINIO_PRIVATE_BUCKET, "private-files"],
      [MINIO_LEGACY_PROJECT_BUCKET, "project-attachments"],
      [MINIO_DOCUMENT_TEMPLATE_BUCKET, "document-templates"],
    ]) {
      expect(
        resolveObjectStorageLocation(configuration, logicalBucket, "tenant/file.pdf"),
      ).toMatchObject({
        logicalBucket,
        physicalBucket: "agencyos-runtime",
        physicalKey: `${prefix}/tenant/file.pdf`,
      });
    }
  });

  it("preserves canonical local MinIO locations and accepts four cloud buckets", () => {
    const local = objectStorageConfiguration({
      AGENCYOS_INFRA_MODE: "local",
      OBJECT_STORAGE_PROVIDER: "minio",
      MINIO_ENDPOINT: "http://minio:9000",
      MINIO_ACCESS_KEY: "agencyos-app",
      MINIO_SECRET_KEY: "local-secret",
    });
    expect(resolveObjectStorageLocation(local, MINIO_PRIVATE_BUCKET, "tenant/file.pdf")).toEqual({
      logicalBucket: MINIO_PRIVATE_BUCKET,
      physicalBucket: MINIO_PRIVATE_BUCKET,
      physicalKey: "tenant/file.pdf",
      prefix: "",
    });

    const separated = cloudEnvironment();
    for (const [suffix, bucket] of [
      ["QUARANTINE", "runtime-quarantine"],
      ["PRIVATE_FILES", "runtime-private"],
      ["PROJECT_ATTACHMENTS", "runtime-projects"],
      ["DOCUMENT_TEMPLATES", "runtime-templates"],
    ]) {
      separated[`OBJECT_STORAGE_${suffix}_BUCKET` as keyof typeof separated] = bucket;
      separated[`OBJECT_STORAGE_${suffix}_PREFIX` as keyof typeof separated] = "";
    }
    const configuration = objectStorageConfiguration(separated);
    expect(configuration.locations.map(({ bucket, prefix }) => ({ bucket, prefix }))).toEqual([
      { bucket: "runtime-quarantine", prefix: "" },
      { bucket: "runtime-private", prefix: "" },
      { bucket: "runtime-projects", prefix: "" },
      { bucket: "runtime-templates", prefix: "" },
    ]);
  });

  it("rejects overlapping cloud prefixes", () => {
    expect(() =>
      objectStorageConfiguration({
        AGENCYOS_INFRA_MODE: "cloud",
        OBJECT_STORAGE_PROVIDER: "b2",
        OBJECT_STORAGE_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
        OBJECT_STORAGE_REGION: "us-west-004",
        OBJECT_STORAGE_ACCESS_KEY_ID: "runtime-key",
        OBJECT_STORAGE_SECRET_ACCESS_KEY: "runtime-secret",
        OBJECT_STORAGE_QUARANTINE_BUCKET: "agencyos-runtime",
        OBJECT_STORAGE_QUARANTINE_PREFIX: "private",
        OBJECT_STORAGE_PRIVATE_FILES_BUCKET: "agencyos-runtime",
        OBJECT_STORAGE_PRIVATE_FILES_PREFIX: "private/files",
        OBJECT_STORAGE_PROJECT_ATTACHMENTS_BUCKET: "agencyos-runtime",
        OBJECT_STORAGE_PROJECT_ATTACHMENTS_PREFIX: "projects",
        OBJECT_STORAGE_DOCUMENT_TEMPLATES_BUCKET: "agencyos-runtime",
        OBJECT_STORAGE_DOCUMENT_TEMPLATES_PREFIX: "templates",
      }),
    ).toThrow("must not overlap");
  });

  it("fails closed for unsafe cloud endpoints, mappings, and mode conflicts", () => {
    for (const endpoint of [
      "http://s3.us-west-004.backblazeb2.com",
      "https://user:secret@s3.us-west-004.backblazeb2.com",
      "https://s3.us-west-004.backblazeb2.com/path",
      "https://s3.us-west-004.backblazeb2.com?bucket=runtime",
      "https://s3.us-west-004.backblazeb2.com#runtime",
    ]) {
      expect(() =>
        objectStorageConfiguration({ ...cloudEnvironment(), OBJECT_STORAGE_ENDPOINT: endpoint }),
      ).toThrow();
    }
    expect(() =>
      objectStorageConfiguration({
        ...cloudEnvironment(),
        OBJECT_STORAGE_PRIVATE_FILES_PREFIX: "../private-files",
      }),
    ).toThrow("unsafe or ambiguous prefix");
    expect(() =>
      objectStorageConfiguration({
        ...cloudEnvironment(),
        AGENCYOS_INFRA_MODE: "local",
      }),
    ).toThrow("must agree");
    expect(() =>
      objectStorageConfiguration({
        AGENCYOS_INFRA_MODE: "cloud",
        OBJECT_STORAGE_PROVIDER: "b2",
        MINIO_ENDPOINT: "http://minio:9000",
      }),
    ).toThrow("not allowed in cloud mode");
  });

  it("enforces source, recovery, and immutable-destination separation", () => {
    const runtime = objectStorageConfiguration(cloudEnvironment());
    expect(() => assertRuntimeBackupIsolation(runtime, cloudEnvironment())).not.toThrow();
    expect(() =>
      assertRuntimeBackupIsolation(runtime, {
        ...cloudEnvironment(),
        B2_BUCKET: "agencyos-runtime",
      }),
    ).toThrow("different buckets");
    expect(() =>
      assertRuntimeBackupIsolation(runtime, {
        ...cloudEnvironment(),
        B2_WRITER_KEY_ID: "source-key",
      }),
    ).toThrow("different key IDs");

    const recoveryEnvironment = {
      ...cloudEnvironment(),
      RECOVERY_OBJECT_STORAGE_PROVIDER: "b2",
      RECOVERY_OBJECT_STORAGE_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
      RECOVERY_OBJECT_STORAGE_REGION: "us-west-004",
      RECOVERY_OBJECT_STORAGE_ACCESS_KEY_ID: "recovery-key",
      RECOVERY_OBJECT_STORAGE_SECRET_ACCESS_KEY: "recovery-secret",
      RECOVERY_OBJECT_STORAGE_QUARANTINE_BUCKET: "agencyos-recovery",
      RECOVERY_OBJECT_STORAGE_PRIVATE_FILES_BUCKET: "agencyos-recovery",
      RECOVERY_OBJECT_STORAGE_PROJECT_ATTACHMENTS_BUCKET: "agencyos-recovery",
      RECOVERY_OBJECT_STORAGE_DOCUMENT_TEMPLATES_BUCKET: "agencyos-recovery",
      RECOVERY_OBJECT_STORAGE_QUARANTINE_PREFIX: "private-file-quarantine",
      RECOVERY_OBJECT_STORAGE_PRIVATE_FILES_PREFIX: "private-files",
      RECOVERY_OBJECT_STORAGE_PROJECT_ATTACHMENTS_PREFIX: "project-attachments",
      RECOVERY_OBJECT_STORAGE_DOCUMENT_TEMPLATES_PREFIX: "document-templates",
    };
    const recovery = objectStorageConfiguration(recoveryEnvironment, "recovery");
    expect(() => assertObjectStorageIsolation(runtime, recovery)).not.toThrow();
    const overlapping = objectStorageConfiguration(
      {
        ...recoveryEnvironment,
        RECOVERY_OBJECT_STORAGE_QUARANTINE_BUCKET: "agencyos-runtime",
      },
      "recovery",
    );
    expect(() => assertObjectStorageIsolation(runtime, overlapping)).toThrow("must not overlap");
  });
});
