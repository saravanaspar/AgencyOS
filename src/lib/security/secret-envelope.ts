import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function encryptionKey(environmentVariable: string, purpose: string): Buffer {
  const value = process.env[environmentVariable]?.trim();
  if (!value) {
    throw new Error(`${environmentVariable} is required before saving ${purpose}.`);
  }

  const key = /^[a-f0-9]{64}$/i.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
  if (key.length !== 32) {
    throw new Error(`${environmentVariable} must decode to exactly 32 bytes.`);
  }
  return key;
}

export function encryptSecretObjectWithEnvironmentKey(
  value: Record<string, string>,
  environmentVariable: string,
  purpose: string,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(environmentVariable, purpose), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptSecretObjectWithEnvironmentKey(
  envelope: string,
  environmentVariable: string,
  purpose: string,
): Record<string, string> {
  const [version, encodedIv, encodedTag, encodedCiphertext] = envelope.split(".");
  if (version !== "v1" || !encodedIv || !encodedTag || !encodedCiphertext) {
    throw new Error(`Unsupported ${purpose} envelope.`);
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(environmentVariable, purpose),
    Buffer.from(encodedIv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  const parsed: unknown = JSON.parse(plaintext);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${purpose} envelope contains invalid data.`);
  }
  return Object.fromEntries(
    Object.entries(parsed).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

export function encryptSecretObject(value: Record<string, string>): string {
  return encryptSecretObjectWithEnvironmentKey(
    value,
    "CRM_CONNECTOR_ENCRYPTION_KEY",
    "connector credentials",
  );
}

export function decryptSecretObject(envelope: string): Record<string, string> {
  return decryptSecretObjectWithEnvironmentKey(
    envelope,
    "CRM_CONNECTOR_ENCRYPTION_KEY",
    "connector credential",
  );
}
