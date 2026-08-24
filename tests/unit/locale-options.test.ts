import { afterEach, describe, expect, it, vi } from "vitest";

import {
  formatCountryLabel,
  formatCurrencyLabel,
  formatTimezoneLabel,
  formatUtcOffset,
  getCountryDefaults,
  getCurrencyOptions,
  getTimezoneOptions,
  isIsoCountryCode,
  normalizeTimezone,
} from "@/lib/locale-options";

describe("locale option labels", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a country code together with its country name", () => {
    expect(formatCountryLabel("IN")).toContain("IN");
    expect(formatCountryLabel("IN")).toContain("India");
  });

  it("recognizes real ISO country codes", () => {
    expect(isIsoCountryCode("US")).toBe(true);
    expect(isIsoCountryCode("ZZ")).toBe(false);
  });

  it("shows UTC shorthand before the IANA timezone", () => {
    const at = new Date("2026-01-15T12:00:00.000Z");
    expect(formatUtcOffset("Asia/Kolkata", at)).toBe("UTC+05:30");
    expect(formatTimezoneLabel("Asia/Kolkata", at)).toBe("UTC+05:30 — Asia/Kolkata");
    expect(formatTimezoneLabel("UTC", at)).toContain("UTC");
  });

  it("deduplicates timezone choices by current UTC offset", () => {
    const at = new Date("2026-01-15T12:00:00.000Z");
    const options = getTimezoneOptions(at);
    const offsets = options.map((option) => option.label.split(" — ")[0]);

    expect(new Set(offsets).size).toBe(offsets.length);
    expect(offsets.filter((offset) => offset === "UTC")).toHaveLength(1);
  });

  it("normalizes explicit zero-offset formatter output to UTC", () => {
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function DateTimeFormatMock() {
      return {
        formatToParts: () => [{ type: "timeZoneName", value: "GMT+00:00" }],
      } as Intl.DateTimeFormat;
    });

    expect(formatUtcOffset("UTC", new Date("2026-01-15T12:00:00.000Z"))).toBe("UTC");
  });

  it("normalizes legacy timezone aliases", () => {
    expect(normalizeTimezone("Asia/Calcutta")).toBe("Asia/Kolkata");
  });

  it("suggests Indian regional defaults and shows a currency symbol", () => {
    expect(getCountryDefaults("IN")).toEqual({ currency: "INR", timezone: "Asia/Kolkata" });
    expect(formatCurrencyLabel("INR")).toContain("INR");
    expect(formatCurrencyLabel("INR")).toContain("Indian Rupee");
  });

  it("prioritizes the recommended currency when one is provided", () => {
    const options = getCurrencyOptions("en", "INR");

    expect(options[0]?.value).toBe("INR");
  });
});
