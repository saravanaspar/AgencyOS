import { createHash } from "node:crypto";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { runOperationalCommand } from "../operations/operational-command.mjs";

const SENSITIVE_PATTERN =
  /(password|secret|token|authorization|credential|application[_-]?key|access[_-]?key|database[_-]?url)/gi;

export function redactDiagnostic(value) {
  return String(value ?? "")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[redacted]@")
    .replace(/([?&](?:token|secret|key|password)=)[^&\s]+/gi, "$1[redacted]")
    .replace(
      /((?:password|secret|token|authorization|credential|application[_-]?key|access[_-]?key)\s*[:=]\s*)[^\s,;]+/gi,
      "$1[redacted]",
    )
    .replace(SENSITIVE_PATTERN, "[sensitive]")
    .slice(-2_048);
}

export async function atomicPrivateJson(path, value) {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, target);
  await chmod(target, 0o600);
}

export async function sha256File(path) {
  const { createReadStream } = await import("node:fs");
  const hash = createHash("sha256");
  await new Promise((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("end", resolvePromise);
    stream.once("error", reject);
  });
  return hash.digest("hex");
}

export async function checkedCommand(input) {
  const result = await runOperationalCommand(input);
  if (result.status !== "passed") {
    const error = new Error(
      `${input.command} failed: ${redactDiagnostic(result.diagnostic || "non-zero exit")}`,
    );
    error.result = result;
    throw error;
  }
  return result;
}

export async function withFlock({ lockPath, scriptPath, args = [], timeoutMs }) {
  await mkdir(dirname(resolve(lockPath)), { recursive: true, mode: 0o700 });
  const result = await runOperationalCommand({
    command: "flock",
    args: [
      "--wait",
      "300",
      "--conflict-exit-code",
      "75",
      lockPath,
      "node",
      scriptPath,
      "--lock-held",
      ...args,
    ],
    timeoutMs,
  });
  if (result.status !== "passed") {
    throw new Error(
      result.exitCode === 75
        ? "Another backup or repository-maintenance operation holds the exclusive lock."
        : `Locked operation failed: ${redactDiagnostic(result.diagnostic)}`,
    );
  }
  return result;
}

export async function removePrivateTree(path) {
  await rm(path, { recursive: true, force: true, maxRetries: 2 });
}
