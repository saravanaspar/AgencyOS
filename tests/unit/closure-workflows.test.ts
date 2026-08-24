import { describe, expect, it } from "vitest";

import { assetRequestKey } from "@/modules/assets/assets";
import {
  assetRequestCreateSchema,
  assetRequestFulfillSchema,
  assetReturnRequestUpdateSchema,
} from "@/modules/assets/schemas/assets";
import { supportRoutingRuleMatches } from "@/modules/support/support";
import { vendorBillApprovalSchema } from "@/modules/vendors/schemas/vendors";

const uuid = "11111111-1111-4111-8111-111111111111";

describe("closure workflow boundaries", () => {
  it("formats organization-scoped Asset request numbers", () => {
    expect(assetRequestKey(1)).toBe("AR-000001");
    expect(assetRequestKey(987654)).toBe("AR-987654");
  });

  it("requires a meaningful Asset request justification", () => {
    expect(
      assetRequestCreateSchema.safeParse({
        categoryId: uuid,
        requestType: "replacement",
        title: "Replacement laptop",
        justification: "too short",
        neededByDate: "",
        expectedReturnAt: "",
      }).success,
    ).toBe(false);
    expect(
      assetRequestCreateSchema.safeParse({
        categoryId: uuid,
        requestType: "replacement",
        title: "Replacement laptop",
        justification: "The current laptop can no longer run the approved development toolchain.",
        neededByDate: "2026-08-01",
        expectedReturnAt: "",
      }).success,
    ).toBe(true);
  });

  it("binds fulfillment to a request, Asset, checkout time, and condition", () => {
    const result = assetRequestFulfillSchema.parse({
      requestId: uuid,
      assetId: "22222222-2222-4222-8222-222222222222",
      checkoutAt: "2026-07-18T10:00",
      expectedReturnAt: "",
      condition: "good",
      notes: "Issued after shared approval.",
    });
    expect(result.condition).toBe("good");
    expect(result.expectedReturnAt).toBeNull();
  });

  it("allows employees to acknowledge but not invent return actions", () => {
    expect(
      assetReturnRequestUpdateSchema.safeParse({
        returnRequestId: uuid,
        action: "acknowledge",
        notes: "Return date confirmed.",
      }).success,
    ).toBe(true);
    expect(
      assetReturnRequestUpdateSchema.safeParse({
        returnRequestId: uuid,
        action: "complete",
        notes: "Attempted direct completion.",
      }).success,
    ).toBe(false);
  });

  it("matches deterministic Support rules case-insensitively", () => {
    expect(
      supportRoutingRuleMatches("Production OUTAGE", "The client cannot access the workspace.", [
        "invoice",
        "outage",
      ]),
    ).toBe(true);
    expect(supportRoutingRuleMatches("Question", "How do I change my profile?", ["billing"])).toBe(
      false,
    );
  });

  it("accepts only a valid Vendor bill identifier for approval submission", () => {
    expect(vendorBillApprovalSchema.parse({ billId: uuid }).billId).toBe(uuid);
    expect(vendorBillApprovalSchema.safeParse({ billId: "bill-1" }).success).toBe(false);
  });
});
