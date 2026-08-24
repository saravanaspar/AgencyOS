import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const retiredValidationModules = [
  "src/modules/organizations/schemas/organization.ts",
  "src/modules/identity/schemas/membership.ts",
  "src/modules/permissions/schemas/permission.ts",
] as const;

describe("retired validation modules", () => {
  it("keeps superseded parallel validation modules removed", () => {
    for (const relativePath of retiredValidationModules) {
      expect(existsSync(path.join(process.cwd(), relativePath)), relativePath).toBe(false);
    }
  });
});
