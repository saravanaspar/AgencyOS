#!/usr/bin/env node
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  assertRuntimeBackupIsolation,
  objectStorageConfiguration,
  resolveObjectStorageLocation,
} from "../../src/integrations/object-storage/config.mjs";
import { createS3CompatibleClient } from "../../src/integrations/object-storage/s3-client.mjs";

async function readObject(stream, maximum = 4096) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > maximum) {
      stream.destroy();
      throw new Error("Object-storage probe response exceeded its limit.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, size);
}

export async function checkObjectStorage({
  environment = process.env,
  destructiveProbe = true,
} = {}) {
  const configuration = objectStorageConfiguration(environment);
  if (environment.B2_ENDPOINT?.trim() && environment.B2_BUCKET?.trim()) {
    assertRuntimeBackupIsolation(configuration, environment);
  }
  const client = createS3CompatibleClient(configuration, { requestTimeoutMs: 15_000 });
  const checkedBuckets = new Set();
  for (const location of configuration.locations) {
    if (!checkedBuckets.has(location.bucket)) {
      if (!(await client.bucketExists(location.bucket))) {
        throw new Error(`Object-storage bucket for ${location.logicalBucket} is unavailable.`);
      }
      checkedBuckets.add(location.bucket);
    }
    if (!destructiveProbe) continue;
    const expected = randomBytes(32);
    const resolved = resolveObjectStorageLocation(
      configuration,
      location.logicalBucket,
      `.agencyos-preflight/${randomUUID()}`,
    );
    let created = false;
    let probeFailed = false;
    try {
      await client.putObject(
        resolved.physicalBucket,
        resolved.physicalKey,
        expected,
        expected.length,
        { "Content-Type": "application/octet-stream" },
      );
      created = true;
      const metadata = await client.statObject(resolved.physicalBucket, resolved.physicalKey);
      if (metadata.size !== expected.length) throw new Error("Object-storage probe size mismatch.");
      const stream = await client.getObject(resolved.physicalBucket, resolved.physicalKey);
      const actual = await readObject(stream);
      if (!actual.equals(expected)) throw new Error("Object-storage probe readback mismatch.");
    } catch (error) {
      probeFailed = true;
      throw error;
    } finally {
      if (created) {
        try {
          await client.removeObject(resolved.physicalBucket, resolved.physicalKey);
        } catch (cleanupError) {
          if (!probeFailed) throw cleanupError;
        }
      }
    }
  }
  return { locationsChecked: configuration.locations.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  checkObjectStorage()
    .then(({ locationsChecked }) =>
      console.log(`Object storage ready (${locationsChecked} logical locations).`),
    )
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
