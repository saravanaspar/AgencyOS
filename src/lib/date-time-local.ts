function partValue(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value ?? "";
}

/**
 * Formats an instant for a datetime-local input without losing the intended wall-clock timezone.
 *
 * Pass the organization's IANA timezone when it is known. In Node, the current TZ environment
 * value is used as a deterministic fallback. Browsers fall back to the user's resolved timezone.
 */
export function toDateTimeLocalValue(
  value: string | Date | null | undefined = new Date(),
  timeZone?: string,
): string {
  if (value === null || value === undefined || value === "") return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const resolvedTimeZone = timeZone?.trim() || process.env.TZ?.trim() || undefined;

  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: resolvedTimeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);

    const year = partValue(parts, "year");
    const month = partValue(parts, "month");
    const day = partValue(parts, "day");
    const hour = partValue(parts, "hour");
    const minute = partValue(parts, "minute");
    if (!year || !month || !day || !hour || !minute) return "";

    return `${year}-${month}-${day}T${hour}:${minute}`;
  } catch {
    return "";
  }
}
