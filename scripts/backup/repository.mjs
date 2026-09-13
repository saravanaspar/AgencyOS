import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { checkedCommand } from "./process.mjs";
import { createS3CompatibleClient } from "../../src/integrations/object-storage/s3-client.mjs";

export function localRepository(environment = process.env) {
  return environment.AGENCYOS_RESTIC_LOCAL_DIR || "/repository";
}

export function b2MirrorEnvironment(environment = process.env, kind = "WRITER") {
  const endpoint = new URL(environment.B2_ENDPOINT);
  endpoint.username = environment[`B2_${kind}_KEY_ID`];
  endpoint.password = environment[`B2_${kind}_APPLICATION_KEY`];
  return { MC_HOST_b2: endpoint.href };
}

export function remoteRepository(environment = process.env) {
  return `b2/${environment.B2_BUCKET}/${environment.B2_PREFIX || "agencyos/restic"}`;
}

export async function prepareLocalRepository(configuration, environment) {
  const endpoint = new URL(environment.B2_ENDPOINT);
  const client = createS3CompatibleClient({
    endpoint: `${endpoint.protocol}//${endpoint.host}`,
    accessKey: environment.B2_WRITER_KEY_ID,
    secretKey: environment.B2_WRITER_APPLICATION_KEY,
    region: environment.B2_REGION || "us-west-004",
  });
  const lock = await client.getObjectLockConfig(environment.B2_BUCKET);
  if (
    lock.objectLockEnabled !== "Enabled" ||
    lock.mode !== "COMPLIANCE" ||
    !(lock.unit === "Days" ? lock.validity >= 30 : lock.unit === "Years" && lock.validity >= 1)
  ) {
    throw new Error("B2 must have default Compliance retention of at least 30 days before backup.");
  }
  const path = localRepository(environment);
  await mkdir(path, { recursive: true, mode: 0o700 });
  const local = { ...configuration.restic, RESTIC_REPOSITORY: path };
  if ((await readdir(path)).length === 0) {
    // A missing local volume must not initialize a second incompatible remote repository.
    // List the bucket first: authentication/network failures must never mean "empty".
    const probe = await checkedCommand({
      command: "mc",
      args: ["ls", "--json", remoteRepository(environment)],
      env: b2MirrorEnvironment(environment),
      timeoutMs: configuration.commandTimeoutMs,
    });
    if (probe.stdoutText.trim()) {
      await checkedCommand({
        command: "mc",
        args: ["mirror", "--exclude", "locks/*", remoteRepository(environment), path],
        env: b2MirrorEnvironment(environment),
        timeoutMs: configuration.commandTimeoutMs,
      });
    } else {
      await checkedCommand({
        command: "restic",
        args: ["init"],
        env: local,
        timeoutMs: configuration.commandTimeoutMs,
      });
    }
  }
  await checkedCommand({
    command: "restic",
    args: ["cat", "config"],
    env: local,
    timeoutMs: configuration.commandTimeoutMs,
  });
  return local;
}

export async function publishRepository(configuration, environment, snapshotId) {
  const source = localRepository(environment);
  const target = remoteRepository(environment);
  const options = {
    env: b2MirrorEnvironment(environment),
    timeoutMs: configuration.commandTimeoutMs,
  };
  // Publish referenced objects before publishing snapshot pointers. Never overwrite/delete B2.
  for (const name of ["config", "keys", "data", "index"]) {
    await checkedCommand({
      command: "mc",
      args:
        name === "config"
          ? [
              "mirror",
              "--exclude",
              "keys/*",
              "--exclude",
              "data/*",
              "--exclude",
              "index/*",
              "--exclude",
              "snapshots/*",
              "--exclude",
              "locks/*",
              source,
              target,
            ]
          : ["mirror", join(source, name), `${target}/${name}`],
      ...options,
    });
  }
  await checkedCommand({
    command: "mc",
    args: ["mirror", join(source, "snapshots"), `${target}/snapshots`],
    ...options,
  });
  await checkedCommand({
    command: "restic",
    args: ["cat", "snapshot", snapshotId, "--no-lock"],
    env: configuration.restic,
    timeoutMs: configuration.commandTimeoutMs,
  });
}
