export const CRM_SYNC_MAX_PAGES = 4;
export const CRM_SYNC_MAX_ROWS = 800;

export const crmSyncIntervalOptions = [
  { minutes: 15, label: "Every 15 minutes" },
  { minutes: 30, label: "Every 30 minutes" },
  { minutes: 60, label: "Every hour" },
  { minutes: 360, label: "Every 6 hours" },
  { minutes: 720, label: "Every 12 hours" },
  { minutes: 1_440, label: "Every day" },
] as const;

export const crmSyncIntervals = crmSyncIntervalOptions.map((option) => option.minutes);

export function isCrmSyncInterval(value: number): boolean {
  return crmSyncIntervals.includes(value as (typeof crmSyncIntervals)[number]);
}

export interface CrmSyncCheckpoint {
  modifiedAfter?: string;
}

export interface CrmSyncCursor {
  windowStartedAt?: string;
  page?: number;
  after?: string;
  nextPath?: string;
  nextStart?: number;
  pagesFetched?: number;
}

export function calculateCrmSyncBackoffSeconds(
  consecutiveFailures: number,
  retryAfterSeconds?: number | null,
): number {
  const failures = Math.max(1, Math.trunc(consecutiveFailures));
  const exponential = Math.min(24 * 60 * 60, 5 * 60 * 2 ** Math.min(9, failures - 1));
  const providerDelay = Math.max(0, Math.trunc(retryAfterSeconds ?? 0));
  return Math.max(exponential, providerDelay);
}

export function parseRetryAfterSeconds(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) return Math.ceil(numeric);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.ceil((date - now) / 1_000));
}

export function checkpointDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function hubSpotNextAfter(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const paging = "paging" in payload ? Reflect.get(payload, "paging") : null;
  if (!paging || typeof paging !== "object") return null;
  const next = "next" in paging ? Reflect.get(paging, "next") : null;
  if (!next || typeof next !== "object") return null;
  const after = "after" in next ? Reflect.get(next, "after") : null;
  return typeof after === "string" || typeof after === "number" ? String(after) : null;
}

export function salesforceNextPath(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const done = "done" in payload ? Reflect.get(payload, "done") : true;
  if (done === true) return null;
  const nextPath = "nextRecordsUrl" in payload ? Reflect.get(payload, "nextRecordsUrl") : null;
  return typeof nextPath === "string" && nextPath.startsWith("/") ? nextPath : null;
}

export function zohoHasMoreRecords(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const info = "info" in payload ? Reflect.get(payload, "info") : null;
  return Boolean(info && typeof info === "object" && Reflect.get(info, "more_records") === true);
}

export function pipedriveNextStart(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const additional = "additional_data" in payload ? Reflect.get(payload, "additional_data") : null;
  if (!additional || typeof additional !== "object") return null;
  const pagination = Reflect.get(additional, "pagination");
  if (!pagination || typeof pagination !== "object") return null;
  if (Reflect.get(pagination, "more_items_in_collection") !== true) return null;
  const nextStart = Reflect.get(pagination, "next_start");
  return typeof nextStart === "number" && Number.isFinite(nextStart) && nextStart >= 0
    ? Math.trunc(nextStart)
    : null;
}
