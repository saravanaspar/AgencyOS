#!/usr/bin/env node
import { fileURLToPath } from "node:url";

import { objectStorageConfiguration } from "../../src/integrations/object-storage/config.mjs";
import { createS3CompatibleClient } from "../../src/integrations/object-storage/s3-client.mjs";

export async function setupObjectStorage(environment = process.env) {
  const configuration = objectStorageConfiguration(environment);
  const client = createS3CompatibleClient(configuration);
  const buckets = [...new Set(configuration.locations.map(({ bucket }) => bucket))];
  for (const bucket of buckets) {
    if (!(await client.bucketExists(bucket))) {
      await client.makeBucket(bucket, configuration.region);
      console.log(`Created private object-storage bucket: ${bucket}`);
    } else {
      console.log(`Object-storage bucket exists: ${bucket}`);
    }
  }
  console.log(`Object storage is ready with ${configuration.locations.length} logical locations.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  setupObjectStorage().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
