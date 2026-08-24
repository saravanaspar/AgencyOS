"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef, type RefObject } from "react";

import { isUnhandledApprovalSuccess } from "@/components/approvals/approval-ui-state";
import type { ApprovalActionState } from "@/modules/approvals/schemas/approvals";

interface CloseApprovalDialogOptions {
  state: ApprovalActionState;
  dialogRef: RefObject<HTMLDialogElement | null>;
  afterSuccess?: () => void;
}

export function useCloseApprovalDialogOnSuccess({
  state,
  dialogRef,
  afterSuccess,
}: CloseApprovalDialogOptions) {
  const router = useRouter();
  const handledCompletionId = useRef<string | null>(null);
  const runAfterSuccess = useEffectEvent(() => afterSuccess?.());

  useEffect(() => {
    if (!isUnhandledApprovalSuccess(state, handledCompletionId.current)) return;
    handledCompletionId.current = state.completionId;
    dialogRef.current?.close();
    runAfterSuccess();
    router.refresh();
  }, [dialogRef, router, state]);
}
