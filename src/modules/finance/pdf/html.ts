export function escapeHtml(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function safeFileStem(value: unknown): string {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim();
  return normalized.replace(/[^\p{Letter}\p{Number}._-]+/gu, "-").replace(/^-+|-+$/g, "");
}

export function safeCssColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const color = value.trim();
  return /^(?:#[0-9a-f]{3,8}|rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)|rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*(?:0|1|0?\.\d+)\s*\))$/i.test(
    color,
  )
    ? color
    : fallback;
}

export function safeCssLength(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const length = value.trim();
  return /^\d+(?:\.\d+)?(?:px|pt|rem|em|mm|cm|in|%)$/i.test(length) ? length : fallback;
}

export function safeFontFamily(value: unknown): string {
  if (typeof value !== "string") return "Roboto";
  const font = value.trim();
  return /^[\p{Letter}\p{Number} _-]{1,80}$/u.test(font) ? font : "Roboto";
}

export function paragraphs(value: string | null | undefined): string {
  if (!value?.trim()) return "";
  return value
    .split(/\r?\n|,\s+(?=[\p{Letter}\p{Number}])/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");
}
