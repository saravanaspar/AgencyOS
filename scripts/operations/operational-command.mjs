import { createHash } from "node:crypto";
import { accessSync, constants } from "node:fs";
import { chmod, writeFile } from "node:fs/promises";
import { delimiter, isAbsolute, relative, resolve } from "node:path";
import { spawn } from "node:child_process";

const MAX_DIAGNOSTIC_CHARS = 4_096;
const unsafeCommandPattern = /[\r\n\0;&|><`$]/;
const sensitiveArgumentPlaceholderPattern =
  /\$\{[^}]*?(password|secret|token|private[_-]?key|credential|connection[_-]?string|database[_-]?url)[^}]*\}/i;

export function stableJson(value) {
  if (Array.isArray(value)) return value.map((entry) => stableJson(entry));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableJson(entry)]),
  );
}

export function sha256Json(value) {
  return createHash("sha256")
    .update(JSON.stringify(stableJson(value)))
    .digest("hex");
}

export function assertSafeExecutable(command) {
  if (
    typeof command !== "string" ||
    command.length < 1 ||
    command.length > 500 ||
    unsafeCommandPattern.test(command) ||
    /\s/.test(command)
  ) {
    throw new Error("Commands must be a single executable without shell syntax.");
  }
  return command;
}

export function assertSafeArguments(args) {
  if (!Array.isArray(args) || args.length > 200) {
    throw new Error("Command arguments must be an array with at most 200 entries.");
  }
  return args.map((argument) => {
    const value = String(argument);
    if (value.length > 4_000 || /[\r\n\0]/.test(value)) {
      throw new Error("Command arguments must be single-line values of at most 4000 characters.");
    }
    if (sensitiveArgumentPlaceholderPattern.test(value)) {
      throw new Error(
        "Sensitive environment values must be inherited through the process environment, not command arguments.",
      );
    }
    return value;
  });
}

export function interpolateNonSensitiveArguments(args, environment = process.env) {
  return assertSafeArguments(args).map((argument) =>
    argument.replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (_match, name) => {
      const value = environment[name];
      if (value === undefined || value === "") {
        throw new Error(`Required environment value ${name} is missing.`);
      }
      return value;
    }),
  );
}

export function resolveInside(root, candidate = ".") {
  const rootPath = resolve(root);
  const candidatePath = resolve(rootPath, candidate);
  const pathFromRoot = relative(rootPath, candidatePath);
  if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    throw new Error(
      "Operational command working directories must stay inside the recovery workspace.",
    );
  }
  return candidatePath;
}

export function executableExists(command, environment = process.env) {
  assertSafeExecutable(command);
  const candidates = command.includes("/")
    ? [resolve(command)]
    : String(environment.PATH ?? "")
        .split(delimiter)
        .filter(Boolean)
        .map((entry) => resolve(entry, command));
  return candidates.some((candidate) => {
    try {
      accessSync(candidate, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

function appendDiagnostic(current, chunk) {
  const combined = `${current}${chunk}`;
  return combined.length <= MAX_DIAGNOSTIC_CHARS
    ? combined
    : combined.slice(combined.length - MAX_DIAGNOSTIC_CHARS);
}

export async function runOperationalCommand({
  command,
  args = [],
  cwd = process.cwd(),
  env = {},
  timeoutMs = 120_000,
}) {
  const executable = assertSafeExecutable(command);
  const safeArgs = assertSafeArguments(args);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 7_200_000) {
    throw new Error("Command timeout must be between 1 second and 2 hours.");
  }

  const startedAt = Date.now();
  const stdoutHash = createHash("sha256");
  const stderrHash = createHash("sha256");
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let stdoutDiagnostic = "";
  let stdoutText = "";
  let stderrDiagnostic = "";
  let timedOut = false;

  const child = spawn(executable, safeArgs, {
    cwd,
    env: { ...process.env, ...env },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    stdoutHash.update(chunk);
    stdoutBytes += chunk.length;
    const text = chunk.toString("utf8");
    stdoutDiagnostic = appendDiagnostic(stdoutDiagnostic, text);
    if (stdoutText.length < 1_000_000) stdoutText += text.slice(0, 1_000_000 - stdoutText.length);
  });
  child.stderr.on("data", (chunk) => {
    stderrHash.update(chunk);
    stderrBytes += chunk.length;
    stderrDiagnostic = appendDiagnostic(stderrDiagnostic, chunk.toString("utf8"));
  });

  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
  }, timeoutMs);
  timeout.unref();

  const { code, signal, spawnError } = await new Promise((resolveResult) => {
    let spawnError;
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", (code, signal) => resolveResult({ code, signal, spawnError }));
  });
  clearTimeout(timeout);

  return {
    status: !spawnError && !timedOut && code === 0 ? "passed" : "failed",
    exitCode: code,
    signal,
    timedOut,
    durationMs: Date.now() - startedAt,
    stdoutSha256: stdoutHash.digest("hex"),
    stderrSha256: stderrHash.digest("hex"),
    stdoutBytes,
    stderrBytes,
    diagnostic:
      spawnError instanceof Error
        ? spawnError.message
        : timedOut
          ? "Command timed out."
          : code === 0
            ? ""
            : (stderrDiagnostic || stdoutDiagnostic || `Command exited with code ${code}.`).trim(),
    stdoutDiagnostic,
    stdoutText,
  };
}

export async function writePrivateJson(path, value) {
  const target = resolve(path);
  await writeFile(target, `${JSON.stringify(stableJson(value), null, 2)}\n`, { mode: 0o600 });
  await chmod(target, 0o600);
  return target;
}
