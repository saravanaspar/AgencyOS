import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");
const runtimeFiles = [
  "src/modules/private-files/server/private-files.ts",
  "src/modules/private-files/server/scan-worker.ts",
  "src/modules/finance/server/document-snapshots.ts",
  "src/app/api/projects/attachments/[attachmentId]/route.ts",
];

describe("object-storage runtime contract", () => {
  it("uses the provider-neutral storage boundary in every runtime file", () => {
    for (const file of runtimeFiles) {
      const contents = source(file);
      expect(contents, file).not.toContain("getSupabaseAdminClient");
      expect(contents, file).not.toContain(".storage.from(");
      expect(contents, file).toContain("object-storage/client");
      expect(contents, file).not.toContain("integrations/minio");
    }
  });

  it("has no hosted-storage migration dependency at runtime", () => {
    const packageJson = JSON.parse(source("package.json")) as { scripts: Record<string, string> };
    const scripts = Object.entries(packageJson.scripts);
    expect(scripts.some(([name, command]) => /supabase/i.test(`${name} ${command}`))).toBe(false);
  });

  it("ships an idempotent local bootstrap using the common storage contract", () => {
    const setup = source("scripts/storage/setup-object-storage.mjs");
    const compose = source("compose.object-storage.yaml");
    const guide = source("docs/OPERATIONS.md");
    expect(setup).toContain("bucketExists");
    expect(setup).toContain("objectStorageConfiguration");
    expect(compose).toContain("127.0.0.1:9000:9000");
    expect(compose).toContain("OBJECT_STORAGE_ACCESS_KEY_ID");
    expect(guide).toContain("## S3-compatible object storage");
    expect(guide).toContain("document-templates");
  });
});
