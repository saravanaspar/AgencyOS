import { describe, expect, it } from "vitest";

import {
  assetConditions,
  assetStatuses,
  assetWarrantyState,
  straightLineBookValueMinor,
} from "@/modules/assets/assets";
import {
  assetAssignmentSchema,
  assetCreateSchema,
  assetDisposalSchema,
  assetMaintenanceCreateSchema,
  assetReturnSchema,
} from "@/modules/assets/schemas/assets";

const id = "11111111-1111-4111-8111-111111111111";
const asset = {
  assetTag: "LAP-0001",
  serialNumber: "SERIAL-1",
  categoryId: id,
  name: "Engineering laptop",
  manufacturer: "Framework",
  model: "Laptop 16",
  ownershipType: "owned",
  ownerMembershipId: null,
  purchaseDate: "2026-01-05",
  purchasePriceMinor: 240000,
  currency: "USD",
  warrantyProvider: "Framework",
  warrantyStartDate: "2026-01-05",
  warrantyEndDate: "2029-01-05",
  warrantyReference: "W-123",
  location: "Bengaluru",
  status: "available",
  condition: "new",
  depreciationMethod: "straight_line",
  depreciationStartDate: "2026-01-05",
  usefulLifeMonths: 36,
  salvageValueMinor: 24000,
  notes: "Primary engineering workstation.",
} as const;

describe("asset management foundation", () => {
  it("defines the complete register lifecycle and condition vocabulary", () => {
    expect(assetStatuses).toEqual([
      "ordered",
      "received",
      "available",
      "assigned",
      "under_repair",
      "lost",
      "stolen",
      "retired",
      "disposed",
    ]);
    expect(assetConditions).toEqual(["new", "good", "fair", "poor", "damaged", "missing"]);
  });

  it("validates registration, assignment, return, maintenance, and disposal actions", () => {
    expect(assetCreateSchema.safeParse(asset).success).toBe(true);
    expect(assetCreateSchema.safeParse({ ...asset, status: "assigned" }).success).toBe(false);
    expect(
      assetAssignmentSchema.safeParse({
        assetId: id,
        membershipId: id,
        checkoutAt: "2026-07-18T10:30",
        expectedReturnAt: "2026-08-18T10:30",
        condition: "new",
        notes: "Issued with charger.",
      }).success,
    ).toBe(true);
    expect(
      assetReturnSchema.safeParse({
        assetId: id,
        returnedAt: "2026-08-18T10:30",
        condition: "good",
        nextStatus: "available",
        notes: "Returned with charger.",
      }).success,
    ).toBe(true);
    expect(
      assetMaintenanceCreateSchema.safeParse({
        assetId: id,
        maintenanceType: "repair",
        provider: "Authorized repair centre",
        scheduledAt: "2026-07-20T09:00",
        details: "Replace damaged display assembly.",
        costMinor: 35000,
        currency: "USD",
        startNow: "false",
      }).success,
    ).toBe(true);
    expect(
      assetDisposalSchema.safeParse({
        assetId: id,
        disposalDate: "2029-08-18",
        method: "recycled",
        reason: "End of useful life and certified data destruction.",
        valueMinor: 0,
      }).success,
    ).toBe(true);
  });

  it("derives warranty attention and straight-line book value deterministically", () => {
    expect(assetWarrantyState({ warrantyEndDate: null, today: "2026-07-18" })).toBe("none");
    expect(assetWarrantyState({ warrantyEndDate: "2026-07-17", today: "2026-07-18" })).toBe(
      "expired",
    );
    expect(assetWarrantyState({ warrantyEndDate: "2026-08-01", today: "2026-07-18" })).toBe(
      "expiring",
    );
    expect(assetWarrantyState({ warrantyEndDate: "2027-08-01", today: "2026-07-18" })).toBe(
      "active",
    );
    expect(
      straightLineBookValueMinor({
        purchasePriceMinor: 120000,
        salvageValueMinor: 12000,
        usefulLifeMonths: 36,
        depreciationStartDate: "2026-01-01",
        asOf: "2027-01-01",
      }),
    ).toBe(84000);
  });
});
