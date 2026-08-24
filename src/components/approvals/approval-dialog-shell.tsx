"use client";

import type { ReactNode, RefObject } from "react";

interface ApprovalDialogShellProps {
  dialogRef: RefObject<HTMLDialogElement | null>;
  title: string;
  description: string;
  children?: ReactNode;
}

export function ApprovalDialogShell({
  dialogRef,
  title,
  description,
  children,
}: ApprovalDialogShellProps) {
  const titleId = `approval-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-title`;

  return (
    <dialog className="approval-dialog" ref={dialogRef} aria-labelledby={titleId}>
      <div className="approval-dialog__header">
        <div>
          <h2 id={titleId}>{title}</h2>
          <p>{description}</p>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label={`Close ${title}`}
          onClick={() => dialogRef.current?.close()}
        >
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
