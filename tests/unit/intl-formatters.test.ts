import { describe, expect, it } from "vitest";

import { getDateTimeFormatter, getDisplayNames, getNumberFormatter } from "@/lib/intl-formatters";

describe("cached Intl formatters", () => {
  it("reuses date-time formatters with deterministic defaults", () => {
    const first = getDateTimeFormatter("en", { dateStyle: "medium", timeZone: "UTC" });
    const second = getDateTimeFormatter("en", { dateStyle: "medium", timeZone: "UTC" });

    expect(second).toBe(first);
    expect(first.resolvedOptions().timeZone).toBe("UTC");
    expect(first.format(new Date("2026-07-17T12:00:00.000Z"))).toBeTruthy();

    expect(
      getDateTimeFormatter(undefined, { dateStyle: "medium" }).resolvedOptions(),
    ).toMatchObject({
      locale: expect.stringMatching(/^en/),
      timeZone: "UTC",
    });
  });

  it("reuses number formatters without mixing currencies", () => {
    const rupees = getNumberFormatter("en-IN", { style: "currency", currency: "INR" });
    const repeatedRupees = getNumberFormatter("en-IN", {
      style: "currency",
      currency: "INR",
    });
    const dollars = getNumberFormatter("en-IN", { style: "currency", currency: "USD" });

    expect(repeatedRupees).toBe(rupees);
    expect(dollars).not.toBe(rupees);
  });

  it("reuses display-name formatters by locale and type", () => {
    const regions = getDisplayNames(["en"], { type: "region" });
    const repeatedRegions = getDisplayNames(["en"], { type: "region" });
    const currencies = getDisplayNames(["en"], { type: "currency" });

    expect(repeatedRegions).toBe(regions);
    expect(currencies).not.toBe(regions);
    expect(regions.of("IN")).toBe("India");
  });
});
