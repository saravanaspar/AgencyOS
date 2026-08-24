export function normalizeRoleName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeRoleKey(value: string): string {
  const normalized = normalizeRoleName(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60)
    .replace(/_+$/g, "");

  return normalized || "custom_role";
}
