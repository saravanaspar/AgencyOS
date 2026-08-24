"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import {
  approvalDecisionSchema,
  cancelApprovalRequestSchema,
  createApprovalDefinitionSchema,
  createApprovalDelegationSchema,
  createApprovalRequestSchema,
  reassignApprovalStepSchema,
  retireApprovalDefinitionSchema,
  revokeApprovalDelegationSchema,
  type ApprovalActionState,
} from "@/modules/approvals/schemas/approvals";
import {
  approvalPermissionKeys,
  cancelApprovalRequest,
  createApprovalDefinition,
  createApprovalDelegation,
  createApprovalRequest,
  decideApprovalStep,
  reassignApprovalStep,
  retireApprovalDefinition,
  revokeApprovalDelegation,
} from "@/modules/approvals/server/approvals";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";

const RULE_MESSAGES = [
  /active approval policy/i,
  /approval policy has no steps/i,
  /no approval policy step applies/i,
  /no eligible approver/i,
  /delegates back to the requester/i,
  /already has a pending approval/i,
  /pending approval step was not found/i,
  /assigned to another member/i,
  /comment is required/i,
  /does not allow reassignment/i,
  /only the current approver/i,
  /does not allow self-approval/i,
  /new approver is not an active/i,
  /pending request was not found/i,
  /cannot delegate approvals to yourself/i,
  /delegate is not an active/i,
  /overlapping active delegation/i,
  /active delegation was not found/i,
  /snapshot exceeds/i,
  /resolves to too many members/i,
  /already uses this key/i,
] as const;

function booleanFormValue(value: FormDataEntryValue | null): boolean {
  return value === "on" || value === "true" || value === "1";
}

function nullableString(value: FormDataEntryValue | null): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized ? normalized : null;
}

function nullableNumber(value: FormDataEntryValue | null): number | null {
  const normalized = nullableString(value);
  if (normalized === null) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function dateTimeValue(value: FormDataEntryValue | null): string | null {
  const normalized = nullableString(value);
  if (!normalized) return null;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? normalized : date.toISOString();
}

function fieldErrors(error: { flatten: () => { fieldErrors: Record<string, string[]> } }) {
  return error.flatten().fieldErrors;
}

function safeFailure(error: unknown, fallback: string): ApprovalActionState {
  const message = error instanceof Error ? error.message : "";
  return {
    status: "error",
    message: RULE_MESSAGES.some((pattern) => pattern.test(message)) ? message : fallback,
  };
}

function revalidateApprovalSurfaces() {
  revalidatePath("/approvals");
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
}

export async function createApprovalDefinitionAction(
  _previous: ApprovalActionState,
  formData: FormData,
): Promise<ApprovalActionState> {
  let steps: unknown = null;
  try {
    steps = JSON.parse(String(formData.get("steps") ?? "[]"));
  } catch {
    return { status: "error", message: "Review the approval policy steps." };
  }
  const parsed = createApprovalDefinitionSchema.safeParse({
    key: formData.get("key"),
    name: formData.get("name"),
    description: nullableString(formData.get("description")),
    sourceModule: formData.get("sourceModule"),
    entityType: formData.get("entityType"),
    allowSelfApproval: booleanFormValue(formData.get("allowSelfApproval")),
    allowReassignment: booleanFormValue(formData.get("allowReassignment")),
    steps,
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Review the approval policy values.",
      fieldErrors: fieldErrors(parsed.error),
    };
  }
  const authorization = await authorizeCurrentUser([approvalPermissionKeys.manageDefinitions]);
  if (!authorization.allowed) return { status: "error", message: "Approval policy access denied." };
  try {
    await createApprovalDefinition(authorization.context, parsed.data);
    revalidateApprovalSurfaces();
    return { status: "success", message: "Approval policy created.", completionId: randomUUID() };
  } catch (error) {
    return safeFailure(error, "The approval policy could not be created.");
  }
}

export async function retireApprovalDefinitionAction(
  _previous: ApprovalActionState,
  formData: FormData,
): Promise<ApprovalActionState> {
  const parsed = retireApprovalDefinitionSchema.safeParse({
    definitionId: formData.get("definitionId"),
  });
  if (!parsed.success) return { status: "error", message: "Approval policy is invalid." };
  const authorization = await authorizeCurrentUser([approvalPermissionKeys.manageDefinitions]);
  if (!authorization.allowed) return { status: "error", message: "Approval policy access denied." };
  try {
    await retireApprovalDefinition(authorization.context, parsed.data.definitionId);
    revalidateApprovalSurfaces();
    return { status: "success", message: "Approval policy retired." };
  } catch (error) {
    return safeFailure(error, "The approval policy could not be retired.");
  }
}

export async function createApprovalRequestAction(
  _previous: ApprovalActionState,
  formData: FormData,
): Promise<ApprovalActionState> {
  let snapshot: unknown = null;
  try {
    snapshot = JSON.parse(String(formData.get("snapshot") ?? "{}"));
  } catch {
    return { status: "error", message: "Snapshot must be a valid JSON object." };
  }
  const parsed = createApprovalRequestSchema.safeParse({
    definitionId: formData.get("definitionId"),
    title: formData.get("title"),
    entityId: nullableString(formData.get("entityId")),
    deepLink: String(formData.get("deepLink") ?? ""),
    departmentId: nullableString(formData.get("departmentId")),
    amount: nullableNumber(formData.get("amount")),
    currency: nullableString(formData.get("currency")),
    snapshot,
    dueAt: dateTimeValue(formData.get("dueAt")),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Review the approval request values.",
      fieldErrors: fieldErrors(parsed.error),
    };
  }
  const authorization = await authorizeCurrentUser([approvalPermissionKeys.createRequest]);
  if (!authorization.allowed)
    return { status: "error", message: "Approval request access denied." };
  try {
    const requestId = await createApprovalRequest(authorization.context, parsed.data);
    revalidateApprovalSurfaces();
    return {
      status: "success",
      message: "Approval request submitted.",
      requestId,
      completionId: randomUUID(),
    };
  } catch (error) {
    return safeFailure(error, "The approval request could not be submitted.");
  }
}

export async function decideApprovalStepAction(
  _previous: ApprovalActionState,
  formData: FormData,
): Promise<ApprovalActionState> {
  const parsed = approvalDecisionSchema.safeParse({
    requestStepId: formData.get("requestStepId"),
    decision: formData.get("decision"),
    comment: nullableString(formData.get("comment")),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Review the approval decision.",
      fieldErrors: fieldErrors(parsed.error),
    };
  }
  const permission =
    parsed.data.decision === "approved"
      ? approvalPermissionKeys.approveRequest
      : approvalPermissionKeys.rejectRequest;
  const authorization = await authorizeCurrentUser([permission]);
  if (!authorization.allowed)
    return { status: "error", message: "Approval decision access denied." };
  try {
    const result = await decideApprovalStep(authorization.context, parsed.data);
    revalidateApprovalSurfaces();
    return {
      status: "success",
      message:
        result.status === "pending"
          ? "Decision recorded. The request moved to its next approval step."
          : `Decision recorded. Request is now ${result.status.replaceAll("_", " ")}.`,
      requestId: result.requestId,
    };
  } catch (error) {
    return safeFailure(error, "The approval decision could not be recorded.");
  }
}

export async function reassignApprovalStepAction(
  _previous: ApprovalActionState,
  formData: FormData,
): Promise<ApprovalActionState> {
  const parsed = reassignApprovalStepSchema.safeParse({
    requestStepId: formData.get("requestStepId"),
    approverMembershipId: formData.get("approverMembershipId"),
    comment: formData.get("comment"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Review the reassignment values.",
      fieldErrors: fieldErrors(parsed.error),
    };
  }
  const authorization = await authorizeCurrentUser([approvalPermissionKeys.reassignRequest]);
  if (!authorization.allowed) return { status: "error", message: "Approval reassignment denied." };
  try {
    const requestId = await reassignApprovalStep(authorization.context, parsed.data);
    revalidateApprovalSurfaces();
    return { status: "success", message: "Approval step reassigned.", requestId };
  } catch (error) {
    return safeFailure(error, "The approval step could not be reassigned.");
  }
}

export async function cancelApprovalRequestAction(
  _previous: ApprovalActionState,
  formData: FormData,
): Promise<ApprovalActionState> {
  const parsed = cancelApprovalRequestSchema.safeParse({
    requestId: formData.get("requestId"),
    comment: formData.get("comment"),
  });
  if (!parsed.success) {
    return { status: "error", message: "A cancellation reason is required." };
  }
  const authorization = await authorizeCurrentUser([approvalPermissionKeys.createRequest]);
  if (!authorization.allowed)
    return { status: "error", message: "Approval request access denied." };
  try {
    await cancelApprovalRequest(authorization.context, parsed.data.requestId, parsed.data.comment);
    revalidateApprovalSurfaces();
    return { status: "success", message: "Approval request cancelled." };
  } catch (error) {
    return safeFailure(error, "The approval request could not be cancelled.");
  }
}

export async function createApprovalDelegationAction(
  _previous: ApprovalActionState,
  formData: FormData,
): Promise<ApprovalActionState> {
  const parsed = createApprovalDelegationSchema.safeParse({
    toMembershipId: formData.get("toMembershipId"),
    sourceModule: nullableString(formData.get("sourceModule")),
    startsAt: dateTimeValue(formData.get("startsAt")),
    endsAt: dateTimeValue(formData.get("endsAt")),
    reason: nullableString(formData.get("reason")),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Review the delegation values.",
      fieldErrors: fieldErrors(parsed.error),
    };
  }
  const authorization = await authorizeCurrentUser([approvalPermissionKeys.manageDelegations]);
  if (!authorization.allowed) return { status: "error", message: "Approval delegation denied." };
  try {
    await createApprovalDelegation(authorization.context, parsed.data);
    revalidateApprovalSurfaces();
    return {
      status: "success",
      message: "Approval delegation created.",
      completionId: randomUUID(),
    };
  } catch (error) {
    return safeFailure(error, "The approval delegation could not be created.");
  }
}

export async function revokeApprovalDelegationAction(
  _previous: ApprovalActionState,
  formData: FormData,
): Promise<ApprovalActionState> {
  const parsed = revokeApprovalDelegationSchema.safeParse({
    delegationId: formData.get("delegationId"),
  });
  if (!parsed.success) return { status: "error", message: "Approval delegation is invalid." };
  const authorization = await authorizeCurrentUser([approvalPermissionKeys.manageDelegations]);
  if (!authorization.allowed) return { status: "error", message: "Approval delegation denied." };
  try {
    await revokeApprovalDelegation(authorization.context, parsed.data.delegationId);
    revalidateApprovalSurfaces();
    return { status: "success", message: "Approval delegation revoked." };
  } catch (error) {
    return safeFailure(error, "The approval delegation could not be revoked.");
  }
}
