#!/usr/bin/env node
import { randomBytes, randomUUID } from "node:crypto";
import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import { fileURLToPath } from "node:url";

import { Client } from "minio";

import {
  assertRuntimeBackupIsolation,
  objectStorageConfiguration,
  resolveObjectStorageLocation,
} from "../../src/integrations/object-storage/config.mjs";

async function readObject(stream, maximum = 4096) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > maximum) throw new Error("Object-storage probe response exceeded its limit.");
    chunks.push(value);
  }
  return Buffer.concat(chunks, size);
}

async function withDeadline(operation, agent, timeoutMs = 15_000) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          agent.destroy();
          reject(new Error("Object-storage probe timed out."));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function checkObjectStorage({
  environment = process.env,
  destructiveProbe = true,
} = {}) {
  const configuration = objectStorageConfiguration(environment);
  if (environment.B2_ENDPOINT?.trim() && environment.B2_BUCKET?.trim()) {
    assertRuntimeBackupIsolation(configuration, environment);
  }
  const agent = configuration.useSSL
    ? new HttpsAgent({ keepAlive: false, timeout: 15_000 })
    : new HttpAgent({ keepAlive: false, timeout: 15_000 });
  const client = new Client({
    endPoint: configuration.hostname,
    port: configuration.port,
    useSSL: configuration.useSSL,
    accessKey: configuration.accessKey,
    secretKey: configuration.secretKey,
    region: configuration.region,
    transportAgent: agent,
    retryOptions: { disableRetry: true },
  });
  try {
    const checkedBuckets = new Set();
    for (const location of configuration.locations) {
      if (!checkedBuckets.has(location.bucket)) {
        if (!(await withDeadline(client.bucketExists(location.bucket), agent))) {
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
        await withDeadline(
          client.putObject(
            resolved.physicalBucket,
            resolved.physicalKey,
            expected,
            expected.length,
            { "Content-Type": "application/octet-stream" },
          ),
          agent,
        );
        created = true;
        const metadata = await withDeadline(
          client.statObject(resolved.physicalBucket, resolved.physicalKey),
          agent,
        );
        if (metadata.size !== expected.length)
          throw new Error("Object-storage probe size mismatch.");
        const stream = await withDeadline(
          client.getObject(resolved.physicalBucket, resolved.physicalKey),
          agent,
        );
        const actual = await withDeadline(readObject(stream), agent);
        if (!actual.equals(expected)) throw new Error("Object-storage probe readback mismatch.");
      } catch (error) {
        probeFailed = true;
        throw error;
      } finally {
        if (created) {
          try {
            await withDeadline(
              client.removeObject(resolved.physicalBucket, resolved.physicalKey),
              agent,
            );
          } catch (cleanupError) {
            if (!probeFailed) throw cleanupError;
          }
        }
      }
    }
  } finally {
    agent.destroy();
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
