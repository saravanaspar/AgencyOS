import { describe, expect, it } from "vitest";

import {
  databaseStatusIsCurrent,
  parseDatabaseStatusOutput,
} from "../../scripts/operations/verify-deployment.mjs";

describe("deployment verification tooling", () => {
  it("parses provider-neutral database migration status", () => {
    const parsed = parseDatabaseStatusOutput(`
      Target: postgresql://ag***@db.example.test/agencyos
      Applied: 61
      Local migrations: 61
      Pending: 0
      Checksum drift: 0
    `);
    expect(parsed).toEqual({ applied: 61, local: 61, pending: 0, drift: 0 });
    expect(databaseStatusIsCurrent(parsed)).toBe(true);
  });

  it("rejects pending or drifted migration status", () => {
    expect(databaseStatusIsCurrent({ applied: 60, local: 61, pending: 1, drift: 0 })).toBe(false);
    expect(databaseStatusIsCurrent({ applied: 61, local: 61, pending: 0, drift: 1 })).toBe(false);
  });
});
