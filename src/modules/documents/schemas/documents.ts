import { z } from "zod";

import {
  documentAccessLevels,
  documentClassifications,
  documentEntityTypes,
  documentPublicationAudienceTypes,
} from "@/modules/documents/documents";

const optionalUuid = z.preprocess((value) => (value === "" ? null : value), z.uuid().nullable());
const optionalDate = z.preprocess(
  (value) => (value === "" ? null : value),
  z.iso.date().nullable(),
);
const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().max(max).nullable(),
  );
const optionalDateTime = z.preprocess(
  (value) => {
    if (value === "" || value == null) return null;
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
      return `${value}:00Z`;
    }
    return value;
  },
  z.iso.datetime({ offset: true }).nullable(),
);

export const documentFolderSchema = z.object({
  folderId: optionalUuid,
  parentFolderId: optionalUuid,
  name: z.string().trim().min(1).max(120),
  description: optionalText(500),
  classification: z.enum(documentClassifications),
});

export const documentCategorySchema = z.object({
  categoryId: optionalUuid,
  name: z.string().trim().min(1).max(80),
  description: optionalText(300),
  status: z.enum(["active", "inactive"]),
});

export const documentTagSchema = z.object({
  name: z.string().trim().min(1).max(50),
});

const documentMetadataShape = {
  title: z.string().trim().min(1).max(180),
  description: optionalText(2000),
  folderId: optionalUuid,
  categoryId: optionalUuid,
  classification: z.enum(documentClassifications),
  ownerMembershipId: z.uuid(),
  expiryDate: optionalDate,
  reviewDate: optionalDate,
  retentionUntil: optionalDate,
  tagIds: z.array(z.uuid()).max(20).default([]),
  entityType: z.enum(documentEntityTypes).nullable(),
  entityId: optionalUuid,
};

type DocumentMetadataInput = z.infer<z.ZodObject<typeof documentMetadataShape>>;

function validateDocumentMetadata(value: DocumentMetadataInput, context: z.RefinementCtx): void {
  if (Boolean(value.entityType) !== Boolean(value.entityId)) {
    context.addIssue({
      code: "custom",
      path: ["entityId"],
      message: "Choose both an entity type and a related record.",
    });
  }
  if (value.retentionUntil && value.expiryDate && value.retentionUntil < value.expiryDate) {
    context.addIssue({
      code: "custom",
      path: ["retentionUntil"],
      message: "Retention cannot end before the document expiry date.",
    });
  }
}

export const documentUploadMetadataSchema = z
  .object({
    documentId: optionalUuid,
    ...documentMetadataShape,
    versionNote: optionalText(500),
  })
  .superRefine(validateDocumentMetadata);

export const documentMetadataSchema = z
  .object(documentMetadataShape)
  .superRefine(validateDocumentMetadata);

export const documentCommentSchema = z.object({
  documentId: z.uuid(),
  body: z.string().trim().min(1).max(2000),
});

export const documentAccessGrantSchema = z.object({
  documentId: z.uuid(),
  membershipId: z.uuid(),
  accessLevel: z.enum(documentAccessLevels),
  expiresAt: z.preprocess(
    (value) => {
      if (value === "" || value == null) return null;
      if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
        return `${value}:00Z`;
      }
      return value;
    },
    z.iso.datetime({ offset: true }).nullable(),
  ),
});

export const documentAccessRevokeSchema = z.object({
  documentId: z.uuid(),
  membershipId: z.uuid(),
});

export const documentLegalHoldSchema = z
  .object({
    documentId: z.uuid(),
    legalHold: z.enum(["true", "false"]).transform((value) => value === "true"),
    reason: optionalText(1000),
  })
  .superRefine((value, context) => {
    if (value.legalHold && (!value.reason || value.reason.length < 3)) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "Add a legal-hold reason.",
      });
    }
  });

export const documentArchiveSchema = z.object({
  documentId: z.uuid(),
  archive: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export const documentEntityLinkSchema = z.object({
  documentId: z.uuid(),
  entityType: z.enum(documentEntityTypes),
  entityId: z.uuid(),
});

export const documentEntityUnlinkSchema = z.object({
  linkId: z.uuid(),
  documentId: z.uuid(),
});

export const documentReviewSubmitSchema = z.object({
  documentId: z.uuid(),
});

export const documentPublicationSchema = z
  .object({
    documentId: z.uuid(),
    effectiveAt: z.preprocess(
      (value) => {
        if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
          return `${value}:00Z`;
        }
        return value;
      },
      z.iso.datetime({ offset: true }),
    ),
    expiresAt: optionalDateTime,
    releaseNote: optionalText(1000),
    organizationWide: z
      .preprocess((value) => value === "true" || value === "on", z.boolean())
      .default(false),
    departmentIds: z.array(z.uuid()).max(100).default([]),
    teamIds: z.array(z.uuid()).max(100).default([]),
    membershipIds: z.array(z.uuid()).max(200).default([]),
  })
  .superRefine((value, context) => {
    if (
      !value.organizationWide &&
      value.departmentIds.length === 0 &&
      value.teamIds.length === 0 &&
      value.membershipIds.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["organizationWide"],
        message: "Choose at least one publication audience.",
      });
    }
    if (value.expiresAt && value.expiresAt <= value.effectiveAt) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Publication expiry must be after its effective time.",
      });
    }
  });

export const documentPublicationWithdrawSchema = z.object({
  documentId: z.uuid(),
  publicationId: z.uuid(),
  reason: z.string().trim().min(3).max(1000),
});

export const documentPublicationAudienceSchema = z.object({
  audienceType: z.enum(documentPublicationAudienceTypes),
  audienceId: optionalUuid,
});

export const documentIdSchema = z.uuid();
export const documentVersionIdSchema = z.uuid();

export type DocumentActionState = {
  status: "idle" | "success" | "error";
  message: string;
  fieldErrors?: Record<string, string[]>;
};
