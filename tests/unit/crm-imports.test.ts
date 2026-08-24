import { describe, expect, it } from "vitest";

import {
  mapTabularLeadRows,
  normalizeImportHeader,
  parseCsv,
  redactImportPayload,
  sanitizeCrmExtraFields,
} from "@/modules/crm/crm-imports";
import { leadDuplicateFingerprint, stablePayloadHash } from "@/modules/crm/server/import-hashing";

describe("CRM lead import normalization", () => {
  it("parses quoted CSV values, escaped quotes, and embedded newlines", () => {
    const rows = parseCsv(
      'Full Name,Email,Notes\r\n"Ada Lovelace",ada@example.test,"First line\nSecond ""quoted"" line"\r\n',
    );

    expect(rows).toEqual([
      ["Full Name", "Email", "Notes"],
      ["Ada Lovelace", "ada@example.test", 'First line\nSecond "quoted" line'],
    ]);
  });

  it("maps common spreadsheet headings into normalized lead rows", () => {
    const rows = mapTabularLeadRows([
      [
        "First name",
        "Last name",
        "E-mail Address",
        "Mobile",
        "Organisation",
        "Deal value",
        "Campaign code",
      ],
      [
        "  Ada ",
        "Lovelace",
        " ADA@Example.Test ",
        "+44 (20) 1234 5678",
        "Analytical Engines",
        "$12,500",
        "SUMMER-26",
      ],
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      rowNumber: 2,
      name: "Ada Lovelace",
      email: "ada@example.test",
      phone: "+442012345678",
      companyName: "Analytical Engines",
      estimatedValue: 12500,
      leadType: "person",
      extraFields: { "Campaign code": "SUMMER-26" },
    });
  });

  it("retains nested custom fields while removing credentials and bounding values", () => {
    expect(
      sanitizeCrmExtraFields({
        campaign_segment: "enterprise",
        qualification: { seats: 25, api_token: "must-not-be-stored" },
        accessToken: "must-not-be-stored",
        veryLong: "x".repeat(2_100),
      }),
    ).toEqual({
      campaign_segment: "enterprise",
      qualification: { seats: 25 },
      veryLong: "x".repeat(2_000),
      __agencyos_truncated: true,
    });
  });

  it("normalizes accented and punctuated headings", () => {
    expect(normalizeImportHeader("  Téléphone / Mobile  ")).toBe("telephonemobile");
  });

  it("redacts credentials and masks contact data in retained error payloads", () => {
    expect(
      redactImportPayload({
        accessToken: "secret-token",
        password: "secret-password",
        emailAddress: "person@example.test",
        phoneNumber: "+1 555 123 4567",
        note: "safe",
      }),
    ).toEqual({
      accessToken: "[REDACTED]",
      password: "[REDACTED]",
      emailAddress: "p***@example.test",
      phoneNumber: "***4567",
      note: "safe",
    });
  });

  it("produces stable payload hashes regardless of object-key order", () => {
    expect(stablePayloadHash({ b: 2, a: { d: 4, c: 3 } })).toBe(
      stablePayloadHash({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });

  it("uses normalized email, phone, and company values for duplicate fingerprints", () => {
    expect(
      leadDuplicateFingerprint({
        name: "One",
        email: " Person@Example.Test ",
        phone: "+1 (555) 123-4567",
        companyName: "  Example   Company ",
      }),
    ).toBe(
      leadDuplicateFingerprint({
        name: "Two",
        email: "person@example.test",
        phone: "+15551234567",
        companyName: "example company",
      }),
    );
    expect(leadDuplicateFingerprint({ name: "No identifiers" })).toBeNull();
  });
});
