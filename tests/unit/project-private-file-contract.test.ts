import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

describe("project attachment adoption of shared private files", () => {
  it("routes uploads through quarantine instead of directly releasing objects", () => {
    const route = source("src/app/api/projects/tasks/[taskId]/attachments/route.ts");
    expect(route).toContain("createQuarantinedPrivateFile");
    expect(route).toContain('status: "quarantined"');
    expect(route).not.toContain("getSupabaseAdminClient");
    expect(route).not.toContain("PROJECT_ATTACHMENT_BUCKET).upload");
  });

  it("permits downloads only after a clean scan and logs access", () => {
    const route = source("src/app/api/projects/attachments/[attachmentId]/route.ts");
    expect(route).toContain('file_status !== "available"');
    expect(route).toContain('eventType: "file.downloaded"');
    expect(route).toContain("readObject");
    expect(route).not.toContain(".storage.from(");
    expect(route).toContain('"content-security-policy": "sandbox; default-src \'none\'"');
    expect(route).toContain('"x-content-type-options": "nosniff"');
  });

  it("shows scan states and performs bounded visible-tab refreshes", () => {
    const pollingComponent = source("src/components/projects/projects-workspace.tsx");
    const attachmentComponent = source("src/components/projects/project-stage-two.tsx");

    expect(pollingComponent).toContain("hasPendingFileScan");
    expect(pollingComponent).toContain('document.visibilityState !== "visible"');
    expect(pollingComponent).toContain("scanRefreshCountRef.current >= 24");
    expect(attachmentComponent).toContain("attachment.statusLabel");
  });
});
