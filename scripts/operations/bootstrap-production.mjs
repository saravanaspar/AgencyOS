#!/usr/bin/env node
import process from "node:process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import postgres from "postgres";

import {
  objectStorageConfiguration,
  parseObjectStorageEndpoint,
} from "../../src/integrations/object-storage/config.mjs";
import { checkedCommand, redactDiagnostic } from "../backup/process.mjs";

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;
function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function identifier(name) {
  const value = required(name);
  if (!IDENTIFIER_PATTERN.test(value))
    throw new Error(`${name} must be a safe PostgreSQL identifier.`);
  return value;
}

function connectionFor(adminUrl, user, password, database) {
  const url = new URL(adminUrl);
  url.username = user;
  url.password = password;
  url.pathname = `/${database}`;
  return url.href;
}

async function verifyExistingVaultwardenLogin(adminUrl, role, password) {
  const probe = postgres(connectionFor(adminUrl, role, password, "postgres"), {
    max: 1,
    idle_timeout: 2,
    connect_timeout: 5,
  });
  try {
    await probe`SELECT 1`;
  } catch {
    throw new Error(
      "Vaultwarden database role exists but the configured password cannot authenticate; refusing silent rotation.",
    );
  } finally {
    await probe.end({ timeout: 2 });
  }
}

async function bootstrapVaultwardenDatabase() {
  const adminUrl = required("DATABASE_CONTROL_URL");
  const role = identifier("VAULTWARDEN_DATABASE_USER");
  const database = identifier("VAULTWARDEN_DATABASE_NAME");
  const password = required("VAULTWARDEN_DATABASE_PASSWORD");
  if (password.length < 32)
    throw new Error("VAULTWARDEN_DATABASE_PASSWORD must contain 32 characters.");
  const admin = postgres(adminUrl, { max: 1, idle_timeout: 2, connect_timeout: 10 });
  try {
    const roles = await admin`SELECT rolname FROM pg_roles WHERE rolname = ${role}`;
    if (roles.length === 0) {
      const [{ literal }] = await admin`SELECT quote_literal(${password}) AS literal`;
      // PostgreSQL utility statements do not accept bind parameters for PASSWORD.
      await admin.unsafe(`CREATE ROLE "${role}" LOGIN PASSWORD ${literal}`);
    } else {
      await verifyExistingVaultwardenLogin(adminUrl, role, password);
    }
    const databases = await admin`
      SELECT d.datname, r.rolname AS owner
      FROM pg_database d
      JOIN pg_roles r ON r.oid = d.datdba
      WHERE d.datname = ${database}
    `;
    if (databases.length === 0) {
      await admin`CREATE DATABASE ${admin(database)} OWNER ${admin(role)}`;
    } else if (databases[0].owner !== role) {
      throw new Error("Existing Vaultwarden database is not owned by the configured role.");
    }
  } finally {
    await admin.end({ timeout: 5 });
  }
}

function objectStorageHost(user, password) {
  const endpoint = new URL(parseObjectStorageEndpoint(required("OBJECT_STORAGE_ENDPOINT")).value);
  return `${endpoint.protocol}//${encodeURIComponent(user)}:${encodeURIComponent(password)}@${endpoint.host}`;
}

async function command(args, env) {
  return checkedCommand({ command: "mc", args, env, timeoutMs: 120_000 });
}

function applicationPolicy(configuration) {
  const bucket = configuration.locations[0].bucket;
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: ["s3:GetBucketLocation", "s3:ListBucket", "s3:ListBucketVersions"],
        Resource: [`arn:aws:s3:::${bucket}`],
      },
      {
        Effect: "Allow",
        Action: [
          "s3:AbortMultipartUpload",
          "s3:DeleteObject",
          "s3:GetObject",
          "s3:GetObjectVersion",
          "s3:ListMultipartUploadParts",
          "s3:PutObject",
        ],
        Resource: configuration.locations.map(
          ({ bucket: locationBucket, prefix }) => `arn:aws:s3:::${locationBucket}/${prefix}/*`,
        ),
      },
    ],
  };
}

async function bootstrapObjectStorage() {
  const rootUser = required("OBJECT_STORAGE_ADMIN_ACCESS_KEY_ID");
  const rootPassword = required("OBJECT_STORAGE_ADMIN_SECRET_ACCESS_KEY");
  const applicationUser = required("OBJECT_STORAGE_ACCESS_KEY_ID");
  const applicationPassword = required("OBJECT_STORAGE_SECRET_ACCESS_KEY");
  if (applicationUser === rootUser || applicationPassword === rootPassword) {
    throw new Error(
      "Object-storage application credentials must be distinct from administrator credentials.",
    );
  }
  if (applicationPassword.length < 32)
    throw new Error("OBJECT_STORAGE_SECRET_ACCESS_KEY must contain 32 characters.");
  const configuration = objectStorageConfiguration();
  const rootEnvironment = { MC_HOST_root: objectStorageHost(rootUser, rootPassword) };
  await command(["ready", "root"], rootEnvironment);
  for (const bucket of new Set(configuration.locations.map(({ bucket }) => bucket))) {
    await command(["mb", "--ignore-existing", `root/${bucket}`], rootEnvironment);
    await command(["version", "enable", `root/${bucket}`], rootEnvironment);
    const anonymous = await command(["anonymous", "get", `root/${bucket}`], rootEnvironment);
    if (!/private/i.test(anonymous.stdoutText)) {
      throw new Error(`Object-storage bucket ${bucket} is not private.`);
    }
  }
  const userProbe = await command(
    ["admin", "user", "info", "root", applicationUser],
    rootEnvironment,
  ).catch(() => null);
  if (!userProbe) {
    // mc currently requires the initial secret as an argument. This one-shot process is isolated
    // to the private network; the secret is never logged and host root already controls its env.
    await command(
      ["admin", "user", "add", "root", applicationUser, applicationPassword],
      rootEnvironment,
    );
  }
  const policyPath = join(tmpdir(), "agencyos-object-storage-policy.json");
  await writeFile(policyPath, JSON.stringify(applicationPolicy(configuration)), { mode: 0o600 });
  await command(["admin", "policy", "create", "root", "agencyos-app", policyPath], rootEnvironment);
  await command(
    ["admin", "policy", "attach", "root", "agencyos-app", "--user", applicationUser],
    rootEnvironment,
  );
  const applicationEnvironment = {
    MC_HOST_application: objectStorageHost(applicationUser, applicationPassword),
  };
  for (const bucket of new Set(configuration.locations.map(({ bucket }) => bucket))) {
    await command(["stat", `application/${bucket}`], applicationEnvironment);
  }
}

async function main() {
  await bootstrapVaultwardenDatabase();
  await bootstrapObjectStorage();
  console.log(
    "Production bootstrap complete: Vaultwarden database and private object storage verified.",
  );
}

main().catch((error) => {
  console.error(
    `Production bootstrap failed: ${redactDiagnostic(error instanceof Error ? error.message : error)}`,
  );
  process.exitCode = 1;
});
