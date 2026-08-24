"use server";

import { revalidatePath } from "next/cache";

import { formText, stateError } from "@/modules/hr/actions/action-utils";
import { hrPermissionKeys } from "@/modules/hr/hr";
import {
  hrSupportingDocumentReviewSchema,
  hrSupportingDocumentVisibilitySchema,
} from "@/modules/hr/schemas/supporting-documents";
import type { HrActionState } from "@/modules/hr/schemas/hr";
import {
  HrSupportingDocumentTargetError,
  reviewHrSupportingDocument,
  setHrSupportingDocumentVisibility,
} from "@/modules/hr/server/supporting-documents";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";

export async function reviewHrSupportingDocumentAction(
  _previous: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const parsed = hrSupportingDocumentReviewSchema.safeParse({
    documentId: formText(formData, "documentId"),
    reviewStatus: formText(formData, "reviewStatus"),
  });
  if (!parsed.success) return stateError("Choose a valid review result.");
  const authorization = await authorizeCurrentUser([
    hrPermissionKeys.workspace,
    hrPermissionKeys.supportingDocumentManage,
  ]);
  if (!authorization.allowed) return stateError("You cannot review supporting documents.");
  try {
    await reviewHrSupportingDocument(authorization.context, parsed.data);
    revalidatePath("/hr");
    return { status: "success", message: "Supporting-document review updated." };
  } catch (error) {
    return stateError(
      error instanceof HrSupportingDocumentTargetError
        ? error.message
        : "Supporting document could not be reviewed.",
    );
  }
}

export async function setHrSupportingDocumentVisibilityAction(
  _previous: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const parsed = hrSupportingDocumentVisibilitySchema.safeParse({
    documentId: formText(formData, "documentId"),
    employeeVisible: formText(formData, "employeeVisible") === "true",
  });
  if (!parsed.success) return stateError("Choose a valid visibility setting.");
  const authorization = await authorizeCurrentUser([
    hrPermissionKeys.workspace,
    hrPermissionKeys.supportingDocumentManage,
  ]);
  if (!authorization.allowed) return stateError("You cannot change document visibility.");
  try {
    await setHrSupportingDocumentVisibility(authorization.context, parsed.data);
    revalidatePath("/hr");
    return { status: "success", message: "Employee visibility updated." };
  } catch (error) {
    return stateError(
      error instanceof HrSupportingDocumentTargetError
        ? error.message
        : "Document visibility could not be updated.",
    );
  }
}
