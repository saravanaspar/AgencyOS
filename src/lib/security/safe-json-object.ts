import { createHash } from "node:crypto";

const SENSITIVE_KEY_PATTERN =
  /(?:password|passwd|secret|access.?token|refresh.?token|api.?key|private.?key|authorization|cookie|session.?token|totp|recovery.?code|card.?number)/i;

export interface SafeJsonObjectOptions {
  label: string;
  maximumBytes: number;
  maximumDepth?: number;
  maximumNodes?: number;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

export function validateSafeJsonObject(
  value: Record<string, unknown>,
  options: SafeJsonObjectOptions,
): string {
  const maximumDepth = options.maximumDepth ?? 20;
  const maximumNodes = options.maximumNodes ?? 5_000;
  const stack: Array<{ value: unknown; depth: number; path: string }> = [
    { value, depth: 0, path: "$" },
  ];
  const seen = new WeakSet<object>();
  let nodes = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    nodes += 1;
    if (nodes > maximumNodes) throw new Error(`${options.label} contains too many values.`);
    if (current.depth > maximumDepth) throw new Error(`${options.label} nesting is too deep.`);

    const entry = current.value;
    if (entry === null || typeof entry === "string" || typeof entry === "boolean") continue;
    if (typeof entry === "number") {
      if (!Number.isFinite(entry)) {
        throw new Error(`${options.label} contains an invalid number at ${current.path}.`);
      }
      continue;
    }
    if (typeof entry !== "object") {
      throw new Error(`${options.label} contains an unsupported value at ${current.path}.`);
    }
    if (seen.has(entry)) throw new Error(`${options.label} must not contain circular references.`);
    seen.add(entry);

    if (Array.isArray(entry)) {
      for (let index = entry.length - 1; index >= 0; index -= 1) {
        stack.push({
          value: entry[index],
          depth: current.depth + 1,
          path: `${current.path}[${index}]`,
        });
      }
      continue;
    }

    const prototype = Object.getPrototypeOf(entry);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${options.label} contains a non-JSON object at ${current.path}.`);
    }
    for (const [key, nested] of Object.entries(entry as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key.replace(/[-\s]/g, "_"))) {
        throw new Error(`${options.label} must not include sensitive field “${key}”.`);
      }
      stack.push({ value: nested, depth: current.depth + 1, path: `${current.path}.${key}` });
    }
  }

  const serialized = JSON.stringify(stableValue(value));
  if (Buffer.byteLength(serialized, "utf8") > options.maximumBytes) {
    throw new Error(
      `${options.label} exceeds the ${Math.ceil(options.maximumBytes / 1024)} KB limit.`,
    );
  }
  return serialized;
}

export function safeJsonObjectHash(
  value: Record<string, unknown>,
  options: SafeJsonObjectOptions,
): string {
  return createHash("sha256").update(validateSafeJsonObject(value, options)).digest("hex");
}
