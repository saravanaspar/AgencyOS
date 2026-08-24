import { getDateTimeFormatter, getDisplayNames, getNumberFormatter } from "@/lib/intl-formatters";
export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

export interface CountryDefaults {
  currency: string;
  timezone: string;
}

export const isoCountryCodes = [
  "AD",
  "AE",
  "AF",
  "AG",
  "AI",
  "AL",
  "AM",
  "AO",
  "AQ",
  "AR",
  "AS",
  "AT",
  "AU",
  "AW",
  "AX",
  "AZ",
  "BA",
  "BB",
  "BD",
  "BE",
  "BF",
  "BG",
  "BH",
  "BI",
  "BJ",
  "BL",
  "BM",
  "BN",
  "BO",
  "BQ",
  "BR",
  "BS",
  "BT",
  "BV",
  "BW",
  "BY",
  "BZ",
  "CA",
  "CC",
  "CD",
  "CF",
  "CG",
  "CH",
  "CI",
  "CK",
  "CL",
  "CM",
  "CN",
  "CO",
  "CR",
  "CU",
  "CV",
  "CW",
  "CX",
  "CY",
  "CZ",
  "DE",
  "DJ",
  "DK",
  "DM",
  "DO",
  "DZ",
  "EC",
  "EE",
  "EG",
  "EH",
  "ER",
  "ES",
  "ET",
  "FI",
  "FJ",
  "FK",
  "FM",
  "FO",
  "FR",
  "GA",
  "GB",
  "GD",
  "GE",
  "GF",
  "GG",
  "GH",
  "GI",
  "GL",
  "GM",
  "GN",
  "GP",
  "GQ",
  "GR",
  "GS",
  "GT",
  "GU",
  "GW",
  "GY",
  "HK",
  "HM",
  "HN",
  "HR",
  "HT",
  "HU",
  "ID",
  "IE",
  "IL",
  "IM",
  "IN",
  "IO",
  "IQ",
  "IR",
  "IS",
  "IT",
  "JE",
  "JM",
  "JO",
  "JP",
  "KE",
  "KG",
  "KH",
  "KI",
  "KM",
  "KN",
  "KP",
  "KR",
  "KW",
  "KY",
  "KZ",
  "LA",
  "LB",
  "LC",
  "LI",
  "LK",
  "LR",
  "LS",
  "LT",
  "LU",
  "LV",
  "LY",
  "MA",
  "MC",
  "MD",
  "ME",
  "MF",
  "MG",
  "MH",
  "MK",
  "ML",
  "MM",
  "MN",
  "MO",
  "MP",
  "MQ",
  "MR",
  "MS",
  "MT",
  "MU",
  "MV",
  "MW",
  "MX",
  "MY",
  "MZ",
  "NA",
  "NC",
  "NE",
  "NF",
  "NG",
  "NI",
  "NL",
  "NO",
  "NP",
  "NR",
  "NU",
  "NZ",
  "OM",
  "PA",
  "PE",
  "PF",
  "PG",
  "PH",
  "PK",
  "PL",
  "PM",
  "PN",
  "PR",
  "PS",
  "PT",
  "PW",
  "PY",
  "QA",
  "RE",
  "RO",
  "RS",
  "RU",
  "RW",
  "SA",
  "SB",
  "SC",
  "SD",
  "SE",
  "SG",
  "SH",
  "SI",
  "SJ",
  "SK",
  "SL",
  "SM",
  "SN",
  "SO",
  "SR",
  "SS",
  "ST",
  "SV",
  "SX",
  "SY",
  "SZ",
  "TC",
  "TD",
  "TF",
  "TG",
  "TH",
  "TJ",
  "TK",
  "TL",
  "TM",
  "TN",
  "TO",
  "TR",
  "TT",
  "TV",
  "TW",
  "TZ",
  "UA",
  "UG",
  "UM",
  "US",
  "UY",
  "UZ",
  "VA",
  "VC",
  "VE",
  "VG",
  "VI",
  "VN",
  "VU",
  "WF",
  "WS",
  "YE",
  "YT",
  "ZA",
  "ZM",
  "ZW",
] as const;

const countryCodeSet = new Set<string>(isoCountryCodes);

const countryDefaults: Record<string, CountryDefaults> = {
  AE: { currency: "AED", timezone: "Asia/Dubai" },
  AR: { currency: "ARS", timezone: "America/Argentina/Buenos_Aires" },
  AT: { currency: "EUR", timezone: "Europe/Vienna" },
  AU: { currency: "AUD", timezone: "Australia/Sydney" },
  BD: { currency: "BDT", timezone: "Asia/Dhaka" },
  BE: { currency: "EUR", timezone: "Europe/Brussels" },
  BR: { currency: "BRL", timezone: "America/Sao_Paulo" },
  CA: { currency: "CAD", timezone: "America/Toronto" },
  CH: { currency: "CHF", timezone: "Europe/Zurich" },
  CL: { currency: "CLP", timezone: "America/Santiago" },
  CN: { currency: "CNY", timezone: "Asia/Shanghai" },
  CZ: { currency: "CZK", timezone: "Europe/Prague" },
  DE: { currency: "EUR", timezone: "Europe/Berlin" },
  DK: { currency: "DKK", timezone: "Europe/Copenhagen" },
  EG: { currency: "EGP", timezone: "Africa/Cairo" },
  ES: { currency: "EUR", timezone: "Europe/Madrid" },
  FI: { currency: "EUR", timezone: "Europe/Helsinki" },
  FR: { currency: "EUR", timezone: "Europe/Paris" },
  GB: { currency: "GBP", timezone: "Europe/London" },
  GR: { currency: "EUR", timezone: "Europe/Athens" },
  HK: { currency: "HKD", timezone: "Asia/Hong_Kong" },
  HU: { currency: "HUF", timezone: "Europe/Budapest" },
  ID: { currency: "IDR", timezone: "Asia/Jakarta" },
  IE: { currency: "EUR", timezone: "Europe/Dublin" },
  IL: { currency: "ILS", timezone: "Asia/Jerusalem" },
  IN: { currency: "INR", timezone: "Asia/Kolkata" },
  IT: { currency: "EUR", timezone: "Europe/Rome" },
  JP: { currency: "JPY", timezone: "Asia/Tokyo" },
  KE: { currency: "KES", timezone: "Africa/Nairobi" },
  KR: { currency: "KRW", timezone: "Asia/Seoul" },
  LK: { currency: "LKR", timezone: "Asia/Colombo" },
  MX: { currency: "MXN", timezone: "America/Mexico_City" },
  MY: { currency: "MYR", timezone: "Asia/Kuala_Lumpur" },
  NG: { currency: "NGN", timezone: "Africa/Lagos" },
  NL: { currency: "EUR", timezone: "Europe/Amsterdam" },
  NO: { currency: "NOK", timezone: "Europe/Oslo" },
  NP: { currency: "NPR", timezone: "Asia/Kathmandu" },
  NZ: { currency: "NZD", timezone: "Pacific/Auckland" },
  PH: { currency: "PHP", timezone: "Asia/Manila" },
  PK: { currency: "PKR", timezone: "Asia/Karachi" },
  PL: { currency: "PLN", timezone: "Europe/Warsaw" },
  PT: { currency: "EUR", timezone: "Europe/Lisbon" },
  QA: { currency: "QAR", timezone: "Asia/Qatar" },
  RO: { currency: "RON", timezone: "Europe/Bucharest" },
  RU: { currency: "RUB", timezone: "Europe/Moscow" },
  SA: { currency: "SAR", timezone: "Asia/Riyadh" },
  SE: { currency: "SEK", timezone: "Europe/Stockholm" },
  SG: { currency: "SGD", timezone: "Asia/Singapore" },
  TH: { currency: "THB", timezone: "Asia/Bangkok" },
  TR: { currency: "TRY", timezone: "Europe/Istanbul" },
  TW: { currency: "TWD", timezone: "Asia/Taipei" },
  UA: { currency: "UAH", timezone: "Europe/Kyiv" },
  US: { currency: "USD", timezone: "America/New_York" },
  VN: { currency: "VND", timezone: "Asia/Ho_Chi_Minh" },
  ZA: { currency: "ZAR", timezone: "Africa/Johannesburg" },
};

const timezoneAliases: Record<string, string> = {
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Europe/Kiev": "Europe/Kyiv",
  "US/Central": "America/Chicago",
  "US/Eastern": "America/New_York",
  "US/Mountain": "America/Denver",
  "US/Pacific": "America/Los_Angeles",
};

const preferredTimezones = [
  "UTC",
  "Pacific/Pago_Pago",
  "Pacific/Honolulu",
  "America/Anchorage",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Halifax",
  "America/St_Johns",
  "America/Sao_Paulo",
  "Atlantic/South_Georgia",
  "Atlantic/Azores",
  "Europe/London",
  "Europe/Paris",
  "Europe/Helsinki",
  "Europe/Moscow",
  "Asia/Tehran",
  "Asia/Dubai",
  "Asia/Kabul",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Kathmandu",
  "Asia/Dhaka",
  "Asia/Yangon",
  "Asia/Bangkok",
  "Asia/Shanghai",
  "Australia/Eucla",
  "Asia/Tokyo",
  "Australia/Adelaide",
  "Australia/Sydney",
  "Australia/Lord_Howe",
  "Pacific/Noumea",
  "Pacific/Norfolk",
  "Pacific/Auckland",
  "Pacific/Chatham",
  "Pacific/Tongatapu",
  "Pacific/Kiritimati",
] as const;

const preferredTimezoneRank = new Map<string, number>(
  preferredTimezones.map((timezone, index) => [timezone, index]),
);

export function isIsoCountryCode(value: string): boolean {
  return countryCodeSet.has(value.toUpperCase());
}

export function getCountryName(code: string, locale = "en"): string {
  const normalized = code.toUpperCase();

  try {
    return getDisplayNames([locale], { type: "region" }).of(normalized) ?? normalized;
  } catch {
    return normalized;
  }
}

export function formatCountryLabel(code: string, locale = "en"): string {
  const normalized = code.toUpperCase();
  return `${normalized} — ${getCountryName(normalized, locale)}`;
}

export function getCountryOptions(locale = "en"): SelectOption[] {
  return isoCountryCodes
    .map((code) => ({ value: code, label: formatCountryLabel(code, locale) }))
    .sort((left, right) => left.label.localeCompare(right.label, locale));
}

export function getCountryDefaults(code: string | null | undefined): CountryDefaults | null {
  if (!code) return null;
  return countryDefaults[code.toUpperCase()] ?? null;
}

export function normalizeTimezone(timezone: string): string {
  return timezoneAliases[timezone] ?? timezone;
}

function getSupportedTimezones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [...preferredTimezones].filter((timezone) => timezone !== "UTC");
  }
}

export function formatUtcOffset(timezone: string, at = new Date()): string {
  const normalized = normalizeTimezone(timezone);

  try {
    const offset = getDateTimeFormatter("en-US", {
      timeZone: normalized,
      timeZoneName: "longOffset",
      hour: "2-digit",
    })
      .formatToParts(at)
      .find((part) => part.type === "timeZoneName")?.value;

    if (!offset) return "UTC";

    const asciiOffset = offset.replace("−", "-");
    if (/^(?:GMT|UTC)(?:[+-]0{1,2}(?::?0{2})?)?$/.test(asciiOffset)) return "UTC";

    return asciiOffset.replace(/^GMT/, "UTC");
  } catch {
    return "UTC";
  }
}

function offsetMinutes(offset: string): number {
  if (offset === "UTC") return 0;
  const match = /^UTC([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "-" ? -minutes : minutes;
}

export function formatTimezoneLabel(timezone: string, at = new Date()): string {
  const normalized = normalizeTimezone(timezone);
  const offset = formatUtcOffset(normalized, at);
  const readableZone =
    normalized === "UTC" ? "Coordinated Universal Time" : normalized.replaceAll("_", " ");
  return `${offset} — ${readableZone}`;
}

export function getTimezoneOptions(at = new Date(), currentTimezone?: string): SelectOption[] {
  const normalizedCurrent = currentTimezone ? normalizeTimezone(currentTimezone) : undefined;
  const zones = Array.from(
    new Set(["UTC", ...getSupportedTimezones().map((timezone) => normalizeTimezone(timezone))]),
  );
  const buckets = new Map<string, string[]>();

  for (const timezone of zones) {
    const offset = formatUtcOffset(timezone, at);
    const current = buckets.get(offset) ?? [];
    current.push(timezone);
    buckets.set(offset, current);
  }

  return [...buckets.entries()]
    .map(([offset, candidates]) => {
      const selected =
        normalizedCurrent && candidates.includes(normalizedCurrent)
          ? normalizedCurrent
          : [...candidates].sort((left, right) => {
              const leftRank = preferredTimezoneRank.get(left) ?? Number.MAX_SAFE_INTEGER;
              const rightRank = preferredTimezoneRank.get(right) ?? Number.MAX_SAFE_INTEGER;
              return leftRank - rightRank || left.localeCompare(right);
            })[0];

      return {
        value: selected,
        label: formatTimezoneLabel(selected, at),
        offset: offsetMinutes(offset),
      };
    })
    .sort((left, right) => left.offset - right.offset || left.label.localeCompare(right.label))
    .map(({ value, label }) => ({ value, label }));
}

function getSupportedCurrencies(): string[] {
  try {
    return Intl.supportedValuesOf("currency");
  } catch {
    return ["AED", "AUD", "CAD", "CHF", "CNY", "EUR", "GBP", "INR", "JPY", "SGD", "USD", "ZAR"];
  }
}

export function getCurrencySymbol(currency: string, locale = "en"): string {
  const normalized = currency.toUpperCase();

  try {
    return (
      getNumberFormatter(locale, {
        style: "currency",
        currency: normalized,
        currencyDisplay: "narrowSymbol",
      })
        .formatToParts(0)
        .find((part) => part.type === "currency")?.value ?? normalized
    );
  } catch {
    return normalized;
  }
}

export function getCurrencyName(currency: string, locale = "en"): string {
  const normalized = currency.toUpperCase();

  try {
    return getDisplayNames([locale], { type: "currency" }).of(normalized) ?? normalized;
  } catch {
    return normalized;
  }
}

export function formatCurrencyLabel(currency: string, locale = "en"): string {
  const normalized = currency.toUpperCase();
  return `${getCurrencySymbol(normalized, locale)} ${normalized} — ${getCurrencyName(normalized, locale)}`;
}

export function getCurrencyOptions(locale = "en", preferredCurrency?: string): SelectOption[] {
  const preferred = preferredCurrency?.toUpperCase();

  return getSupportedCurrencies()
    .map((currency) => ({ value: currency, label: formatCurrencyLabel(currency, locale) }))
    .sort((left, right) => {
      const leftPreferred = left.value === preferred ? 0 : 1;
      const rightPreferred = right.value === preferred ? 0 : 1;

      return (
        leftPreferred - rightPreferred ||
        left.label.localeCompare(right.label, locale) ||
        left.value.localeCompare(right.value)
      );
    });
}
