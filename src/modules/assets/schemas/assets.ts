import { z } from "zod";

import {
  assetCategoryKinds,
  assetConditions,
  assetDepreciationMethods,
  assetMaintenanceTypes,
  assetOwnershipTypes,
  assetStatuses,
  assetRequestTypes,
} from "@/modules/assets/assets";

const blankToNull = (value: unknown) => (value === "" || value === undefined ? null : value);
const optionalUuid = z.preprocess(blankToNull, z.uuid().nullable());
const optionalText = (max: number, min = 1) =>
  z.preprocess(blankToNull, z.string().trim().min(min).max(max).nullable());
const optionalDate = z.preprocess(blankToNull, z.iso.date().nullable());
const optionalDateTime = z.preprocess(blankToNull, z.iso.datetime({ local: true }).nullable());
const optionalInteger = (maximum = Number.MAX_SAFE_INTEGER) =>
  z.preprocess(blankToNull, z.coerce.number().int().min(0).max(maximum).nullable());

export const assetCategorySchema = z.object({
  name: z.string().trim().min(2).max(80),
  kind: z.enum(assetCategoryKinds),
  description: optionalText(500, 2),
});

const assetMetadataShape = {
  assetTag: z.string().trim().min(2).max(80),
  serialNumber: optionalText(160),
  categoryId: z.uuid(),
  name: z.string().trim().min(2).max(180),
  manufacturer: optionalText(120),
  model: optionalText(120),
  ownershipType: z.enum(assetOwnershipTypes),
  ownerMembershipId: optionalUuid,
  vendorId: optionalUuid,
  purchaseDate: optionalDate,
  purchasePriceMinor: optionalInteger(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/),
  warrantyProvider: optionalText(160),
  warrantyStartDate: optionalDate,
  warrantyEndDate: optionalDate,
  warrantyReference: optionalText(160),
  location: optionalText(180),
  condition: z.enum(assetConditions),
  depreciationMethod: z.enum(assetDepreciationMethods),
  depreciationStartDate: optionalDate,
  usefulLifeMonths: optionalInteger(1200),
  salvageValueMinor: optionalInteger(),
  notes: optionalText(4000, 2),
};

export const assetCreateSchema = z.object({
  ...assetMetadataShape,
  status: z.enum(assetStatuses).refine((status) => !["assigned", "disposed"].includes(status), {
    message: "Assigned and disposed states require lifecycle actions.",
  }),
});

export const assetUpdateSchema = z.object({
  assetId: z.uuid(),
  ...assetMetadataShape,
  status: z.enum(assetStatuses),
});

export const assetAssignmentSchema = z.object({
  assetId: z.uuid(),
  membershipId: z.uuid(),
  checkoutAt: z.iso.datetime({ local: true }),
  expectedReturnAt: optionalDateTime,
  condition: z.enum(assetConditions),
  notes: optionalText(2000, 2),
});

export const assetAcknowledgeSchema = z.object({ assetId: z.uuid() });

export const assetReturnSchema = z.object({
  assetId: z.uuid(),
  returnedAt: z.iso.datetime({ local: true }),
  condition: z.enum(assetConditions),
  nextStatus: z.enum(["available", "under_repair", "lost", "stolen", "retired"]),
  notes: optionalText(2000, 2),
});

export const assetConditionSchema = z.object({
  assetId: z.uuid(),
  condition: z.enum(assetConditions),
  eventType: z.enum(["inspection", "incident"]),
  notes: optionalText(2000, 2),
});

export const assetMaintenanceCreateSchema = z.object({
  assetId: z.uuid(),
  maintenanceType: z.enum(assetMaintenanceTypes),
  provider: optionalText(180),
  scheduledAt: optionalDateTime,
  details: z.string().trim().min(2).max(4000),
  costMinor: optionalInteger(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/),
  startNow: z.preprocess((value) => value === "on" || value === "true", z.boolean()),
});

export const assetMaintenanceCompleteSchema = z.object({
  maintenanceId: z.uuid(),
  assetId: z.uuid(),
  completedAt: z.iso.datetime({ local: true }),
  conditionAfter: z.enum(assetConditions),
  outcome: z.string().trim().min(2).max(4000),
});

export const assetDisposalSchema = z.object({
  assetId: z.uuid(),
  disposalDate: z.iso.date(),
  method: z.enum(["recycled", "sold", "donated", "destroyed", "returned_to_vendor", "other"]),
  reason: z.string().trim().min(2).max(2000),
  valueMinor: optionalInteger(),
});

export const assetDocumentSchema = z.object({
  assetId: z.uuid(),
  documentId: z.uuid(),
});

export const assetRequestCreateSchema = z.object({
  categoryId: z.uuid(),
  requestType: z.enum(assetRequestTypes),
  title: z.string().trim().min(2).max(180),
  justification: z.string().trim().min(10).max(4000),
  neededByDate: optionalDate,
  expectedReturnAt: optionalDateTime,
});

export const assetRequestIdSchema = z.object({ requestId: z.uuid() });

export const assetRequestFulfillSchema = z.object({
  requestId: z.uuid(),
  assetId: z.uuid(),
  checkoutAt: z.iso.datetime({ local: true }),
  expectedReturnAt: optionalDateTime,
  condition: z.enum(assetConditions),
  notes: optionalText(2000, 2),
});

export const assetReturnRequestCreateSchema = z.object({
  assetId: z.uuid(),
  dueAt: z.iso.datetime({ local: true }),
  notes: optionalText(2000, 2),
});

export const assetReturnRequestUpdateSchema = z.object({
  returnRequestId: z.uuid(),
  action: z.enum(["acknowledge", "cancel"]),
  notes: optionalText(2000, 2),
});

export type AssetActionState = {
  status: "idle" | "success" | "error";
  message: string;
  fieldErrors?: Record<string, string[]>;
};
