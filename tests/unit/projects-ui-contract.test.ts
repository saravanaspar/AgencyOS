import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const workspaceSource = readFileSync(
  path.join(root, "src/components/projects/projects-workspace.tsx"),
  "utf8",
);
const actionSource = readFileSync(
  path.join(root, "src/modules/projects/actions/projects.ts"),
  "utf8",
);
const globalErrorSource = readFileSync(path.join(root, "src/app/global-error.tsx"), "utf8");

describe("project creation dialog and global error contracts", () => {
  it("uses an accessible modal with explicit and escape close paths", () => {
    expect(workspaceSource).toContain('<dialog\n        className="project-create-dialog"');
    expect(workspaceSource).toContain('aria-label="Close dialog"');
    expect(workspaceSource).toContain("onCancel={(event) => {");
    expect(workspaceSource).not.toContain("if (event.target === dialogRef.current) close();");
    expect(workspaceSource).toContain("nameInputRef.current?.focus()");
    expect(workspaceSource).toContain('type="button" variant="secondary" onClick={onCancel}');
    expect(workspaceSource).not.toContain('className="project-create-panel"');
  });

  it("closes and selects the new project only after a successful create action", () => {
    expect(workspaceSource).toContain(
      'if (state.status === "success" && state.projectId) onCreated(state.projectId);',
    );
    expect(workspaceSource).toContain("router.replace(buildProjectHref(data, projectId));");
    expect(actionSource).toContain(
      'return { ...successState("Project created."), projectId: created.id };',
    );
  });

  it("keeps the root error boundary generic and retryable", () => {
    expect(globalErrorSource).toContain("Something went wrong");
    expect(globalErrorSource).toContain("onClick={reset}");
    expect(globalErrorSource).not.toContain("error.message");
    expect(globalErrorSource).not.toContain("error.stack");
  });
});
