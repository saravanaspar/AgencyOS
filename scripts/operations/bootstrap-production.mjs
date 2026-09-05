#!/usr/bin/env node
import process from "node:process";

import postgres from "postgres";

import { infrastructureMode } from "../../src/integrations/object-storage/config.mjs";
import { checkedCommand, redactDiagnostic } from "../backup/process.mjs";

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;
const BUCKETS = [
  "private-file-quarantine",
  "private-files",
  "project-attachments",
  "document-templates",
];

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

function minioHost(user, password) {
  const endpoint = new URL(required("MINIO_ENDPOINT"));
  if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
    throw new Error("MINIO_ENDPOINT must be a credential-free HTTP or HTTPS URL.");
  }
  return `${endpoint.protocol}//${encodeURIComponent(user)}:${encodeURIComponent(password)}@${endpoint.host}`;
}

async function command(args, env) {
  return checkedCommand({ command: "mc", args, env, timeoutMs: 120_000 });
}

async function bootstrapMinio() {
  const rootUser = required("MINIO_ROOT_USER");
  const rootPassword = required("MINIO_ROOT_PASSWORD");
  const applicationUser = required("MINIO_ACCESS_KEY");
  const applicationPassword = required("MINIO_SECRET_KEY");
  if (applicationUser === rootUser || applicationPassword === rootPassword) {
    throw new Error("MinIO application credentials must be distinct from the root credentials.");
  }
  if (applicationPassword.length < 32)
    throw new Error("MINIO_SECRET_KEY must contain 32 characters.");
  const rootEnvironment = { MC_HOST_root: minioHost(rootUser, rootPassword) };
  await command(["ready", "root"], rootEnvironment);
  for (const bucket of BUCKETS) {
    await command(["mb", "--ignore-existing", `root/${bucket}`], rootEnvironment);
    await command(["version", "enable", `root/${bucket}`], rootEnvironment);
    const anonymous = await command(["anonymous", "get", `root/${bucket}`], rootEnvironment);
    if (!/private/i.test(anonymous.stdoutText)) {
      throw new Error(`MinIO bucket ${bucket} is not private.`);
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
  await command(
    [
      "admin",
      "policy",
      "create",
      "root",
      "agencyos-app",
      "/app/deploy/minio/agencyos-app-policy.json",
    ],
    rootEnvironment,
  );
  await command(
    ["admin", "policy", "attach", "root", "agencyos-app", "--user", applicationUser],
    rootEnvironment,
  );
  const applicationEnvironment = {
    MC_HOST_application: minioHost(applicationUser, applicationPassword),
  };
  for (const bucket of BUCKETS) {
    await command(["stat", `application/${bucket}`], applicationEnvironment);
  }
}

async function main() {
  if (infrastructureMode() !== "local") {
    throw new Error(
      "bootstrap-production is local-only; cloud resources must be provider-created.",
    );
  }
  await bootstrapVaultwardenDatabase();
  await bootstrapMinio();
  console.log(
    "Production bootstrap complete: Vaultwarden database and private MinIO access verified.",
  );
}

main().catch((error) => {
  console.error(
    `Production bootstrap failed: ${redactDiagnostic(error instanceof Error ? error.message : error)}`,
  );
  process.exitCode = 1;
});
