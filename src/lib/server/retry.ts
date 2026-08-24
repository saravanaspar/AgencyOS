import "server-only";

const retryableCodes = new Set([
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "08P01",
  "53300",
  "53400",
  "55000",
  "55006",
  "55P03",
  "57014",
  "57P01",
  "57P02",
  "57P03",
  "EAI_AGAIN",
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETUNREACH",
  "ETIMEDOUT",
]);

function getErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function safeErrorSummary(error: unknown): { code: string | null; message: string } {
  const message = getErrorMessage(error)
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[database-url-redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);

  return {
    code: getErrorCode(error),
    message: message || "Unknown infrastructure error",
  };
}

export function isRetryableInfrastructureError(error: unknown): boolean {
  const code = getErrorCode(error);
  if (code && retryableCodes.has(code)) return true;

  const message = getErrorMessage(error).toLowerCase();
  return [
    "connection terminated",
    "connection closed",
    "connection timeout",
    "fetch failed",
    "network error",
    "socket hang up",
    "temporary failure",
    "timed out",
  ].some((fragment) => message.includes(fragment));
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  operationName?: string;
  shouldRetry?: (error: unknown) => boolean;
}

export async function withInfrastructureRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 2);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 100);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 1_000);
  const shouldRetry = options.shouldRetry ?? isRetryableInfrastructureError;

  let lastError: unknown;
  let completedAttempts = 0;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    completedAttempts = attempt;

    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const retry = attempt < attempts && shouldRetry(error);

      if (!retry) break;

      const exponentialDelay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const jitter = exponentialDelay > 0 ? Math.floor(Math.random() * exponentialDelay * 0.2) : 0;
      await sleep(exponentialDelay + jitter);
    }
  }

  if (options.operationName) {
    console.warn(`[AgencyOS] ${options.operationName} unavailable.`, {
      attempts: completedAttempts,
      ...safeErrorSummary(lastError),
    });
  }

  throw lastError;
}
