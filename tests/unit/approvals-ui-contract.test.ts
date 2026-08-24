import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ApprovalDialogShell } from "@/components/approvals/approval-dialog-shell";
import {
  eligibleApprovalMembers,
  isUnhandledApprovalSuccess,
} from "@/components/approvals/approval-ui-state";

describe("shared approval UI behavior", () => {
  it("renders one labelled native dialog around the supplied form", () => {
    const markup = renderToStaticMarkup(
      createElement(
        ApprovalDialogShell,
        {
          dialogRef: createRef<HTMLDialogElement>(),
          title: "Create approval policy",
          description: "Define the approval route.",
        },
        createElement("form", { action: "/approvals" }, createElement("button", null, "Save")),
      ),
    );

    expect(markup).toContain('<dialog class="approval-dialog"');
    expect(markup).toContain('aria-labelledby="approval-create-approval-policy-title"');
    expect(markup.match(/<form\b/g)).toHaveLength(1);
    expect(markup).toContain('aria-label="Close Create approval policy"');
  });

  it("filters named approvers and reassignment targets by current eligibility", () => {
    const members = [
      { id: "eligible", canApprove: true },
      { id: "excluded", canApprove: true },
      { id: "ineligible", canApprove: false },
    ];

    expect(eligibleApprovalMembers(members).map((member) => member.id)).toEqual([
      "eligible",
      "excluded",
    ]);
    expect(eligibleApprovalMembers(members, "excluded").map((member) => member.id)).toEqual([
      "eligible",
    ]);
  });

  it("handles every distinct successful submission exactly once", () => {
    const first = { status: "success", completionId: "first", message: "Created." } as const;
    const second = { status: "success", completionId: "second", message: "Created." } as const;

    expect(isUnhandledApprovalSuccess(first, null)).toBe(true);
    expect(isUnhandledApprovalSuccess(first, "first")).toBe(false);
    expect(isUnhandledApprovalSuccess(second, "first")).toBe(true);
    expect(isUnhandledApprovalSuccess({ status: "error", message: "No." }, "first")).toBe(false);
  });
});
