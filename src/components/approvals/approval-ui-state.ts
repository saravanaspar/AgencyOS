import type { ApprovalActionState } from "@/modules/approvals/schemas/approvals";

export function eligibleApprovalMembers<T extends { id: string; canApprove: boolean }>(
  members: readonly T[],
  excludedMembershipId?: string,
): T[] {
  return members.filter((member) => member.canApprove && member.id !== excludedMembershipId);
}

export function isUnhandledApprovalSuccess(
  state: ApprovalActionState,
  handledCompletionId: string | null,
): state is ApprovalActionState & { status: "success"; completionId: string } {
  return (
    state.status === "success" &&
    typeof state.completionId === "string" &&
    state.completionId.length > 0 &&
    state.completionId !== handledCompletionId
  );
}
