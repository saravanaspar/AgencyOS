import { describe, expect, it } from "vitest";

import {
  buildAuditLogQuery,
  escapeCsvCell,
  humanizeAuditAction,
} from "@/modules/audit/audit-log-utils";
import { auditLogFiltersSchema, parseAuditLogFilters } from "@/modules/audit/schemas/audit-log";

describe("audit log filters", () => {
  it("normalizes supported filters and defaults to the first page", () => {
    expect(
      parseAuditLogFilters({
        q: "  spar@example.com  ",
        action: "membership.status_changed",
        from: "2026-07-01",
        to: "2026-07-13",
      }),
    ).toEqual({
      q: "spar@example.com",
      action: "membership.status_changed",
      from: "2026-07-01",
      to: "2026-07-13",
      page: 1,
    });
  });

  it("uses the first query-string value and parses positive page numbers", () => {
    expect(
      parseAuditLogFilters({
        q: ["membership", "ignored"],
        page: "3",
      }),
    ).toMatchObject({ q: "membership", page: 3 });
  });

  it("rejects invalid actions, dates, and reversed ranges", () => {
    expect(auditLogFiltersSchema.safeParse({ action: "status changed!" }).success).toBe(false);
    expect(auditLogFiltersSchema.safeParse({ from: "2026-02-31" }).success).toBe(false);
    expect(auditLogFiltersSchema.safeParse({ from: "2026-07-14", to: "2026-07-13" }).success).toBe(
      false,
    );
  });
});

describe("audit log presentation helpers", () => {
  const filters = parseAuditLogFilters({
    q: "spar@example.com",
    action: "membership.status_changed",
    from: "2026-07-01",
    to: "2026-07-13",
    page: "2",
  });

  it("humanizes stored action keys", () => {
    expect(humanizeAuditAction("membership.status_changed")).toBe("Membership Status Changed");
  });

  it("preserves active filters when changing pages", () => {
    expect(buildAuditLogQuery(filters, { page: 3 })).toBe(
      "?q=spar%40example.com&action=membership.status_changed&from=2026-07-01&to=2026-07-13&page=3",
    );
  });

  it("quotes CSV values and neutralizes spreadsheet formulas", () => {
    expect(escapeCsvCell('Agency "Owner"')).toBe('"Agency ""Owner"""');
    expect(escapeCsvCell('=HYPERLINK("https://example.com")')).toBe(
      '"\'=HYPERLINK(""https://example.com"")"',
    );
  });
});
