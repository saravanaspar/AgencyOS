#!/usr/bin/env node
import { chmod, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DIGEST_PATTERN = /^[a-z0-9._/-]+@sha256:[a-f0-9]{64}$/;
const SUCCESS_STATES = new Set(["finished", "success", "succeeded", "completed"]);
const FAILURE_STATES = new Set(["failed", "error", "cancelled", "canceled"]);

export function assertImmutableImage(value, label) {
  if (!DIGEST_PATTERN.test(value)) throw new Error(`${label} must be a name@sha256 digest.`);
  return value;
}

export function deploymentUuid(payload) {
  const value =
    payload?.deployment_uuid ??
    payload?.deploymentUuid ??
    payload?.deployments?.[0]?.deployment_uuid ??
    payload?.deployments?.[0]?.uuid;
  if (!value || !/^[a-zA-Z0-9_-]{8,128}$/.test(String(value))) {
    throw new Error("Coolify deploy response did not contain a valid deployment UUID.");
  }
  return String(value);
}

export function deploymentState(payload) {
  const state = String(payload?.status ?? payload?.deployment?.status ?? "").toLowerCase();
  if (SUCCESS_STATES.has(state)) return "succeeded";
  if (FAILURE_STATES.has(state)) return "failed";
  return "pending";
}

function required(name, environment = process.env) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function responseJson(response) {
  const length = Number(response.headers.get("content-length") || 0);
  if (length > 1_000_000) throw new Error("Coolify API response exceeded the safe size limit.");
  const value = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Coolify API returned HTTP ${response.status}.`);
  return value;
}

function environmentValue(payload, key) {
  const entries = Array.isArray(payload)
    ? payload
    : (payload?.data ?? payload?.environment_variables ?? payload?.envs ?? []);
  const entry = entries.find(
    (candidate) => candidate?.key === key && candidate?.is_preview !== true,
  );
  return entry?.value ?? null;
}

export async function deployCoolify({ environment = process.env, fetchImpl = fetch } = {}) {
  const baseUrl = new URL(required("COOLIFY_BASE_URL", environment));
  if (baseUrl.protocol !== "https:" || baseUrl.username || baseUrl.password || baseUrl.hash) {
    throw new Error("COOLIFY_BASE_URL must be credential-free HTTPS.");
  }
  const token = required("COOLIFY_API_TOKEN", environment);
  const applicationUuid = required("COOLIFY_APPLICATION_UUID", environment);
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(applicationUuid)) {
    throw new Error("COOLIFY_APPLICATION_UUID is invalid.");
  }
  const appImage = assertImmutableImage(required("AGENCYOS_IMAGE", environment), "AGENCYOS_IMAGE");
  const operationsImage = assertImmutableImage(
    required("AGENCYOS_OPERATIONS_IMAGE", environment),
    "AGENCYOS_OPERATIONS_IMAGE",
  );
  const releaseId = required("AGENCYOS_RELEASE_ID", environment);
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const api = (path) =>
    new URL(path.replace(/^\//, ""), `${baseUrl.href.replace(/\/$/, "")}/api/v1/`);
  const request = async (path, init = {}) =>
    responseJson(
      await fetchImpl(api(path), {
        ...init,
        redirect: "error",
        headers: { ...headers, ...init.headers },
        signal: AbortSignal.timeout(30_000),
      }),
    );

  for (const [key, value] of [
    ["AGENCYOS_IMAGE", appImage],
    ["AGENCYOS_OPERATIONS_IMAGE", operationsImage],
    ["AGENCYOS_RELEASE_ID", releaseId],
  ]) {
    await request(`applications/${applicationUuid}/envs`, {
      method: "PATCH",
      body: JSON.stringify({ key, value, is_preview: false, is_literal: true }),
    });
  }
  const configured = await request(`applications/${applicationUuid}/envs`);
  for (const [key, expected] of [
    ["AGENCYOS_IMAGE", appImage],
    ["AGENCYOS_OPERATIONS_IMAGE", operationsImage],
  ]) {
    if (environmentValue(configured, key) !== expected) {
      throw new Error(
        `Coolify did not persist the exact ${key} digest; deployment was not started.`,
      );
    }
  }

  if (!/^[a-f0-9]{40}$/.test(releaseId))
    throw new Error("AGENCYOS_RELEASE_ID must be the full source commit SHA.");
  await request(`applications/${applicationUuid}`, {
    method: "PATCH",
    body: JSON.stringify({ git_commit_sha: releaseId }),
  });
  const deployment = await request("deploy", {
    method: "POST",
    body: JSON.stringify({ uuid: applicationUuid, force: false }),
  });
  const id = deploymentUuid(deployment);
  const pollIntervalMs = Number(environment.COOLIFY_POLL_INTERVAL_MS || 10_000);
  const deadline = Date.now() + Number(environment.COOLIFY_DEPLOY_TIMEOUT_MS || 1_200_000);
  let lastStatus = null;
  while (Date.now() < deadline) {
    lastStatus = await request(`deployments/${id}`);
    const state = deploymentState(lastStatus);
    if (state === "failed") throw new Error(`Coolify deployment ${id} failed.`);
    if (state === "succeeded") break;
    await delay(pollIntervalMs);
  }
  if (deploymentState(lastStatus) !== "succeeded")
    throw new Error(`Coolify deployment ${id} timed out.`);

  const publicUrl = new URL(required("PRODUCTION_APP_URL", environment));
  if (publicUrl.protocol !== "https:" || publicUrl.username || publicUrl.password) {
    throw new Error("PRODUCTION_APP_URL must use credential-free HTTPS.");
  }
  let healthy = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const [live, ready] = await Promise.all([
        fetchImpl(new URL("/api/health/live", publicUrl), {
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        }),
        fetchImpl(new URL("/api/health/ready", publicUrl), {
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        }),
      ]);
      healthy =
        live.ok &&
        ready.ok &&
        live.headers.get("x-content-type-options") === "nosniff" &&
        Boolean(live.headers.get("referrer-policy"));
      if (healthy) healthy = (await live.json()).revision === releaseId;
      if (healthy) break;
    } catch {
      // A container/proxy transition is expected while Coolify finishes routing the release.
    }
    await delay(5_000);
  }
  if (!healthy)
    throw new Error("Public live/ready or gateway security-header verification failed.");

  const afterDeploy = await request(`applications/${applicationUuid}/envs`);
  if (
    environmentValue(afterDeploy, "AGENCYOS_IMAGE") !== appImage ||
    environmentValue(afterDeploy, "AGENCYOS_OPERATIONS_IMAGE") !== operationsImage
  ) {
    throw new Error("Coolify image digests changed during deployment verification.");
  }
  const evidence = {
    schemaVersion: 1,
    applicationUuid,
    deploymentUuid: id,
    releaseId,
    appImage,
    operationsImage,
    status: "succeeded",
    verifiedAt: new Date().toISOString(),
    publicUrl: publicUrl.origin,
  };
  const evidencePath = resolve(
    environment.COOLIFY_EVIDENCE_PATH || "coolify-deployment-evidence.json",
  );
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  await chmod(evidencePath, 0o600);
  console.log(`Coolify deployment ${id} passed public health verification.`);
  return evidence;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  deployCoolify().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
