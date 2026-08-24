import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { decryptSecretObject, encryptSecretObject } from "@/lib/security/secret-envelope";

const originalKey = process.env.CRM_CONNECTOR_ENCRYPTION_KEY;

describe("CRM connector secret envelope", () => {
  beforeEach(() => {
    process.env.CRM_CONNECTOR_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.CRM_CONNECTOR_ENCRYPTION_KEY;
    else process.env.CRM_CONNECTOR_ENCRYPTION_KEY = originalKey;
  });

  it("round-trips connector credentials without returning plaintext", () => {
    const credentials = { accessToken: "token-value", appSecret: "secret-value" };
    const envelope = encryptSecretObject(credentials);

    expect(envelope).toMatch(/^v1\./);
    expect(envelope).not.toContain("token-value");
    expect(decryptSecretObject(envelope)).toEqual(credentials);
  });

  it("rejects a tampered authenticated-encryption envelope", () => {
    const envelope = encryptSecretObject({ accessToken: "token-value" });
    const parts = envelope.split(".");
    const ciphertext = Buffer.from(parts[3] ?? "", "base64url");
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 1;
    parts[3] = ciphertext.toString("base64url");

    expect(() => decryptSecretObject(parts.join("."))).toThrow();
  });

  it("requires a valid 32-byte key", () => {
    process.env.CRM_CONNECTOR_ENCRYPTION_KEY = "too-short";
    expect(() => encryptSecretObject({ accessToken: "token" })).toThrow(
      "must decode to exactly 32 bytes",
    );
  });
});
