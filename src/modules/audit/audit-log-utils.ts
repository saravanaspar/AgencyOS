import type { AuditLogFilters } from "@/modules/audit/schemas/audit-log";

export function humanizeAuditAction(action: string): string {
  return action
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function buildAuditLogQuery(
  filters: AuditLogFilters,
  overrides: Partial<AuditLogFilters> = {},
) {
  const merged = { ...filters, ...overrides };
  const params = new URLSearchParams();

  if (merged.q) params.set("q", merged.q);
  if (merged.action) params.set("action", merged.action);
  if (merged.from) params.set("from", merged.from);
  if (merged.to) params.set("to", merged.to);
  if (merged.page > 1) params.set("page", String(merged.page));

  const query = params.toString();
  return query ? `?${query}` : "";
}

export function escapeCsvCell(value: unknown): string {
  let text = value == null ? "" : String(value);

  if (/^[=+\-@]/.test(text)) {
    text = `'${text}`;
  }

  return `"${text.replaceAll('"', '""')}"`;
}
