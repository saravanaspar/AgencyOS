import "server-only";

import { createHash } from "node:crypto";

import { normalizeCrmCompanyName, normalizeCrmEmail, normalizeCrmPhone } from "@/modules/crm/crm";
import type { CrmImportLeadRow } from "@/modules/crm/crm-imports";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function leadDuplicateFingerprint(row: CrmImportLeadRow): string | null {
  const parts = [
    normalizeCrmEmail(row.email),
    normalizeCrmPhone(row.phone),
    normalizeCrmCompanyName(row.companyName),
  ].filter(Boolean);
  if (!parts.length) return null;
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

export function stablePayloadHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}
