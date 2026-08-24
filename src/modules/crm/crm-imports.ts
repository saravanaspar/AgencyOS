import { normalizeCrmEmail, normalizeCrmPhone } from "@/modules/crm/crm";

export {
  crmImportProviderLabels,
  crmImportProviderModes,
  crmImportProviders,
} from "@/modules/crm/crm-import-providers";
export type {
  CrmDuplicatePolicy,
  CrmImportProvider,
  CrmImportSourceType,
} from "@/modules/crm/crm-import-providers";

import {
  crmImportProviderLabels,
  type CrmImportProvider,
} from "@/modules/crm/crm-import-providers";

export interface CrmImportLeadRow {
  rowNumber?: number;
  externalId?: string | null;
  name: string;
  leadType?: "person" | "company";
  source?: string | null;
  email?: string | null;
  phone?: string | null;
  companyName?: string | null;
  estimatedValue?: number | null;
  currency?: string | null;
  expectedCloseDate?: string | null;
  notes?: string | null;
  extraFields?: Record<string, unknown>;
  raw?: Record<string, unknown>;
}

const CRM_EXTRA_FIELDS_MAX_BYTES = 64 * 1024;
const CRM_EXTRA_FIELDS_MAX_DEPTH = 5;
const CRM_EXTRA_FIELDS_MAX_KEYS = 200;
const CRM_EXTRA_FIELDS_MAX_ARRAY_ITEMS = 50;
const CRM_EXTRA_FIELDS_MAX_STRING_LENGTH = 2_000;

const sensitiveExtraFieldFragments = [
  "password",
  "passcode",
  "secret",
  "token",
  "authorization",
  "cookie",
  "privatekey",
  "apikey",
  "credential",
];

const headerAliases: Record<string, string> = {
  name: "name",
  fullname: "name",
  leadname: "name",
  contactname: "name",
  firstname: "firstName",
  lastname: "lastName",
  email: "email",
  emailaddress: "email",
  phone: "phone",
  phonenumber: "phone",
  mobile: "phone",
  company: "companyName",
  companyname: "companyName",
  organization: "companyName",
  organisation: "companyName",
  source: "source",
  leadsource: "source",
  value: "estimatedValue",
  estimatedvalue: "estimatedValue",
  dealvalue: "estimatedValue",
  currency: "currency",
  expectedclosedate: "expectedCloseDate",
  closedate: "expectedCloseDate",
  notes: "notes",
  note: "notes",
  description: "notes",
  externalid: "externalId",
  id: "externalId",
};

export function normalizeImportHeader(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isSensitiveExtraField(key: string): boolean {
  const normalized = normalizeImportHeader(key);
  return sensitiveExtraFieldFragments.some((fragment) => normalized.includes(fragment));
}

interface ExtraFieldSanitizerState {
  remainingKeys: number;
  truncated: boolean;
}

function sanitizeExtraFieldValue(
  value: unknown,
  depth: number,
  state: ExtraFieldSanitizerState,
): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length > CRM_EXTRA_FIELDS_MAX_STRING_LENGTH) state.truncated = true;
    return value.replace(/\u0000/g, "").slice(0, CRM_EXTRA_FIELDS_MAX_STRING_LENGTH);
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (depth >= CRM_EXTRA_FIELDS_MAX_DEPTH) {
    state.truncated = true;
    return "[depth limited]";
  }
  if (Array.isArray(value)) {
    if (value.length > CRM_EXTRA_FIELDS_MAX_ARRAY_ITEMS) state.truncated = true;
    return value
      .slice(0, CRM_EXTRA_FIELDS_MAX_ARRAY_ITEMS)
      .map((item) => sanitizeExtraFieldValue(item, depth + 1, state));
  }
  if (!value || typeof value !== "object") return String(value ?? "");

  const result: Record<string, unknown> = {};
  for (const [rawKey, item] of Object.entries(value)) {
    if (state.remainingKeys <= 0) {
      state.truncated = true;
      break;
    }
    const key = rawKey
      .trim()
      .replace(/\u0000/g, "")
      .slice(0, 120);
    if (!key || isSensitiveExtraField(key)) continue;
    state.remainingKeys -= 1;
    result[key] = sanitizeExtraFieldValue(item, depth + 1, state);
  }
  return result;
}

function limitExtraFieldBytes(fields: Record<string, unknown>): Record<string, unknown> {
  const limited: Record<string, unknown> = {};
  let truncated = fields.__agencyos_truncated === true;
  for (const [key, value] of Object.entries(fields)) {
    if (key === "__agencyos_truncated") continue;
    const candidate = { ...limited, [key]: value, __agencyos_truncated: true };
    if (new TextEncoder().encode(JSON.stringify(candidate)).length > CRM_EXTRA_FIELDS_MAX_BYTES) {
      truncated = true;
      break;
    }
    limited[key] = value;
  }
  if (truncated) limited.__agencyos_truncated = true;
  return limited;
}

export function sanitizeCrmExtraFields(
  payload: Record<string, unknown>,
  excludedKeys: readonly string[] = [],
): Record<string, unknown> {
  const excluded = new Set(excludedKeys.map(normalizeImportHeader));
  const filtered = Object.fromEntries(
    Object.entries(payload).filter(
      ([key]) => !excluded.has(normalizeImportHeader(key)) && !isSensitiveExtraField(key),
    ),
  );
  const state: ExtraFieldSanitizerState = {
    remainingKeys: CRM_EXTRA_FIELDS_MAX_KEYS,
    truncated: false,
  };
  const sanitized = sanitizeExtraFieldValue(filtered, 0, state) as Record<string, unknown>;
  if (state.truncated) sanitized.__agencyos_truncated = true;
  return limitExtraFieldBytes(sanitized);
}

function safeText(value: unknown, maxLength: number): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value)
    .trim()
    .replace(/\u0000/g, "");
  return text ? text.slice(0, maxLength) : null;
}

function parseMoney(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const normalized = String(value).replace(/[^0-9.-]/g, "");
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0 && number <= 1_000_000_000 ? number : null;
}

function parseDate(value: unknown): string | null {
  const text = safeText(value, 40);
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export function mapTabularLeadRows(rows: unknown[][]): CrmImportLeadRow[] {
  if (rows.length < 2) return [];
  const headers = rows[0].map((header, index) => ({
    label: safeText(header, 120) ?? `Column ${index + 1}`,
    mapped: headerAliases[normalizeImportHeader(header)] ?? null,
  }));

  return rows.slice(1).flatMap((row, index) => {
    const mapped: Record<string, unknown> = {};
    const extra: Record<string, unknown> = {};
    headers.forEach((header, column) => {
      if (header.mapped) mapped[header.mapped] = row[column];
      else if (row[column] !== undefined && row[column] !== null && row[column] !== "") {
        extra[header.label] = row[column];
      }
    });

    const firstName = safeText(mapped.firstName, 100);
    const lastName = safeText(mapped.lastName, 100);
    const explicitName = safeText(mapped.name, 180);
    const companyName = safeText(mapped.companyName, 180);
    const name = explicitName ?? [firstName, lastName].filter(Boolean).join(" ") ?? companyName;
    const resolvedName = name || companyName;
    if (!resolvedName) return [];

    return [
      {
        rowNumber: index + 2,
        externalId: safeText(mapped.externalId, 200),
        name: resolvedName.slice(0, 180),
        leadType: companyName && !firstName && !lastName ? "company" : "person",
        source: safeText(mapped.source, 100),
        email: normalizeCrmEmail(safeText(mapped.email, 254)),
        phone: normalizeCrmPhone(safeText(mapped.phone, 40)),
        companyName,
        estimatedValue: parseMoney(mapped.estimatedValue),
        currency: safeText(mapped.currency, 3)?.toUpperCase() ?? null,
        expectedCloseDate: parseDate(mapped.expectedCloseDate),
        notes: safeText(mapped.notes, 4_000),
        extraFields: sanitizeCrmExtraFields(extra),
        raw: redactImportPayload({ ...mapped, ...extra }),
      },
    ];
  });
}

export function parseCsv(text: string, maxRows = 5_001): unknown[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      if (rows.length > maxRows)
        throw new Error(`Import files are limited to ${maxRows - 1} data rows.`);
      row = [];
      cell = "";
    } else cell += character;
  }

  if (quoted) throw new Error("CSV contains an unterminated quoted value.");
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((values) => values.some((value) => value.trim() !== ""));
}

export function redactImportPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    const normalized = key.toLowerCase();
    if (
      normalized.includes("token") ||
      normalized.includes("secret") ||
      normalized.includes("password") ||
      normalized.includes("authorization")
    ) {
      redacted[key] = "[REDACTED]";
    } else if (normalized.includes("email")) {
      const email = safeText(value, 254);
      redacted[key] = email ? email.replace(/^(.).+(@.+)$/, "$1***$2") : null;
    } else if (normalized.includes("phone") || normalized.includes("mobile")) {
      const phone = safeText(value, 40);
      redacted[key] = phone ? `***${phone.slice(-4)}` : null;
    } else {
      redacted[key] = typeof value === "string" ? value.slice(0, 300) : value;
    }
  }
  return redacted;
}

export function providerSourceLabel(provider: CrmImportProvider): string {
  return crmImportProviderLabels[provider];
}
