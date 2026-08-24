import { describe, expect, it } from "vitest";

import {
  purchaseOrderStatuses,
  purchaseRequestStatuses,
  requestEstimatedTotalMinor,
  vendorBillStatuses,
  vendorKey,
  vendorRiskClassifications,
  vendorStatuses,
  billMatchStatus,
} from "@/modules/vendors/vendors";
import {
  goodsReceiptSchema,
  purchaseOrderSchema,
  purchaseRequestSchema,
  quotationSchema,
  vendorBillSchema,
  vendorSchema,
} from "@/modules/vendors/schemas/vendors";

const id = "11111111-1111-4111-8111-111111111111";
const vendor = {
  vendorId: null,
  legalName: "Framework Computer Inc.",
  displayName: "Framework",
  primaryCategoryId: id,
  categoryIds: [id],
  status: "active",
  riskClassification: "low",
  ownerMembershipId: id,
  website: "https://frame.work",
  email: "procurement@example.com",
  phone: "+1 555 0100",
  address: "123 Supplier Street",
  countryCode: "US",
  defaultCurrency: "USD",
  paymentTermsDays: 30,
  onboardingDate: "2026-07-18",
  nextReviewDate: "2027-07-18",
  taxCountryCode: "US",
  taxIdentifier: "TIN-1234",
  taxRegistrationName: "Framework Computer Inc.",
  bankName: "Example Bank",
  bankAccountName: "Framework Computer Inc.",
  bankAccountLastFour: "1234",
  bankRoutingReference: "ROUTE-1",
  paymentInstructions: "Pay against an approved matched bill.",
} as const;

describe("vendor and procurement foundation", () => {
  it("defines governed supplier and order-to-pay lifecycles", () => {
    expect(vendorStatuses).toEqual(["prospect", "active", "on_hold", "inactive", "blocked"]);
    expect(vendorRiskClassifications).toEqual(["low", "medium", "high", "critical"]);
    expect(purchaseRequestStatuses).toContain("pending_approval");
    expect(purchaseRequestStatuses).toContain("partially_received");
    expect(purchaseOrderStatuses).toEqual([
      "issued",
      "acknowledged",
      "partially_received",
      "received",
      "cancelled",
      "closed",
    ]);
    expect(vendorBillStatuses).toContain("partially_paid");
  });

  it("validates vendor, request, quotation, PO, receipt, and bill inputs", () => {
    expect(vendorSchema.safeParse(vendor).success).toBe(true);
    expect(
      purchaseRequestSchema.safeParse({
        title: "Engineering laptops",
        businessJustification: "Replace end-of-life developer workstations.",
        departmentId: id,
        projectId: id,
        budgetMinor: 300000,
        currency: "USD",
        requiredByDate: "2026-08-30",
        items: [
          {
            description: "Developer laptop",
            specifications: "32GB RAM",
            quantity: 2,
            unit: "each",
            estimatedUnitPriceMinor: 150000,
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      quotationSchema.safeParse({
        purchaseRequestId: id,
        vendorId: id,
        quotationReference: "Q-100",
        quotedOn: "2026-07-18",
        validUntil: "2026-08-18",
        subtotalMinor: 280000,
        taxMinor: 28000,
        shippingMinor: 0,
        currency: "USD",
        leadTimeDays: 14,
        paymentTerms: "Net 30",
        notes: null,
        sourceDocumentId: id,
      }).success,
    ).toBe(true);
    expect(
      purchaseOrderSchema.safeParse({
        purchaseRequestId: id,
        issueDate: "2026-07-18",
        expectedDeliveryDate: "2026-08-01",
        contractId: id,
        paymentTerms: "Net 30",
        deliveryAddress: "Head office",
      }).success,
    ).toBe(true);
    expect(
      goodsReceiptSchema.safeParse({
        purchaseOrderId: id,
        receivedAt: "2026-08-01T10:30:00.000Z",
        deliveryReference: "DEL-100",
        status: "complete",
        notes: null,
        items: [
          { purchaseOrderItemId: id, quantityReceived: 2, condition: "accepted", notes: null },
        ],
      }).success,
    ).toBe(true);
    expect(
      vendorBillSchema.safeParse({
        purchaseOrderId: id,
        billReference: "INV-100",
        invoiceDate: "2026-08-01",
        dueDate: "2026-08-31",
        subtotalMinor: 280000,
        taxMinor: 28000,
        currency: "USD",
        sourceDocumentId: id,
      }).success,
    ).toBe(true);
  });

  it("derives stable keys, request totals, and exact PO-to-bill matching", () => {
    expect(vendorKey(42)).toBe("VEN-000042");
    expect(
      requestEstimatedTotalMinor([
        { quantity: 2, estimatedUnitPriceMinor: 125000 },
        { quantity: 3, estimatedUnitPriceMinor: 5000 },
      ]),
    ).toBe(265000);
    expect(billMatchStatus({ purchaseOrderTotalMinor: 308000, billTotalMinor: 308000 })).toBe(
      "matched",
    );
    expect(billMatchStatus({ purchaseOrderTotalMinor: 308000, billTotalMinor: 308001 })).toBe(
      "exception",
    );
  });
});
