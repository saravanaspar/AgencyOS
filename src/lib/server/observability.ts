import "server-only";

const SENSITIVE_FIELD =
  /(?:authorization|cookie|password|secret|token|credential|api[_-]?key|private[_-]?key)/i;
const MAX_STRING = 1_000;
const MAX_ARRAY = 20;
const MAX_OBJECT_KEYS = 40;

export type LogLevel = "debug" | "info" | "warn" | "error";
export type ObservabilityFields = Record<string, unknown>;

function safeValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth-limited]";
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, MAX_STRING);
  if (value instanceof Error) {
    return { name: value.name.slice(0, 120) };
  }
  if (Array.isArray(value))
    return value.slice(0, MAX_ARRAY).map((entry) => safeValue(entry, depth + 1));
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .slice(0, MAX_OBJECT_KEYS)
      .map(([key, entry]) => [
        key,
        SENSITIVE_FIELD.test(key) ? "[redacted]" : safeValue(entry, depth + 1),
      ]);
    return Object.fromEntries(entries);
  }
  return String(value).slice(0, MAX_STRING);
}

export function structuredLog(
  level: LogLevel,
  event: string,
  fields: ObservabilityFields = {},
): void {
  const sanitized = safeValue(fields);
  const safeFields =
    sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
      ? (sanitized as Record<string, unknown>)
      : {};
  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: "agencyos",
    event: event.slice(0, 160),
    ...safeFields,
  });
  if (level === "error") console.error(payload);
  else if (level === "warn") console.warn(payload);
  else if (level === "debug") console.debug(payload);
  else console.info(payload);
}

export async function observeOperation<T>(
  event: string,
  fields: ObservabilityFields,
  operation: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  structuredLog("info", `${event}.started`, fields);
  try {
    const result = await operation();
    structuredLog("info", `${event}.succeeded`, { ...fields, durationMs: Date.now() - startedAt });
    return result;
  } catch (error) {
    structuredLog("error", `${event}.failed`, {
      ...fields,
      durationMs: Date.now() - startedAt,
      error,
    });
    throw error;
  }
}
