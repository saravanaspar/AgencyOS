import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

interface BoundaryResult {
  id: string;
  status: "validated" | "no-untrusted-input" | "allowlisted" | "uncovered";
  uncoveredSources: string[];
}

interface AuditResult {
  ok: boolean;
  summary: {
    total: number;
    actions: number;
    routes: number;
    allowlisted: number;
    uncovered: number;
  };
  boundaries: BoundaryResult[];
  staleAllowlist: string[];
}

const root = process.cwd();
const script = join(root, "scripts/security/check-mutation-boundaries.mjs");
const temporaryRoots: string[] = [];

function writeFixture(files: Record<string, string>, allowlist: unknown[] = []): string {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "agencyos-mutation-boundaries-"));
  temporaryRoots.push(fixtureRoot);
  for (const [path, contents] of Object.entries(files)) {
    const absolutePath = join(fixtureRoot, path);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, contents);
  }
  const policyPath = join(fixtureRoot, "security/mutation-boundaries.json");
  mkdirSync(dirname(policyPath), { recursive: true });
  writeFileSync(policyPath, `${JSON.stringify({ version: 1, allowlist }, null, 2)}\n`);
  return fixtureRoot;
}

function runAudit(auditRoot: string): {
  status: number | null;
  result: AuditResult;
  stderr: string;
} {
  const execution = spawnSync(process.execPath, [script, "--root", auditRoot, "--json"], {
    cwd: root,
    encoding: "utf8",
  });
  return {
    status: execution.status,
    result: JSON.parse(execution.stdout) as AuditResult,
    stderr: execution.stderr,
  };
}

afterEach(() => {
  for (const path of temporaryRoots.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("mutation-boundary AST inventory", () => {
  it("inventories function and variable server actions plus mutation route handlers", () => {
    const fixtureRoot = writeFixture({
      "src/modules/example/actions.ts": `
        "use server";
        export async function createThingAction(_previous: unknown, formData: FormData) {
          const parsed = createSchema.safeParse({ name: formData.get("name") });
          if (!parsed.success) return;
          await createThing(parsed.data);
        }
        export const updateThingAction = async (formData: FormData) => {
          const parsed = updateSchema.parse(Object.fromEntries(formData.entries()));
          await updateThing(parsed);
        };
      `,
      "src/app/api/example/route.ts": `
        export async function PATCH(request: Request) {
          const body = await request.json();
          const parsed = patchSchema.safeParse(body);
          if (!parsed.success) return;
          await updateThing(parsed.data);
        }
      `,
    });

    const audit = runAudit(fixtureRoot);
    expect(audit.status, audit.stderr).toBe(0);
    expect(audit.result.summary).toMatchObject({
      total: 3,
      actions: 2,
      routes: 1,
      uncovered: 0,
    });
    expect(audit.result.boundaries.every((boundary) => boundary.status === "validated")).toBe(true);
  });

  it("fails new boundaries when parsing is unrelated to input or happens after mutation", () => {
    const fixtureRoot = writeFixture({
      "src/modules/example/actions.ts": `
        "use server";
        export async function saveUnsafeAction(_previous: unknown, formData: FormData) {
          staticSchema.safeParse({ fixed: true });
          await saveThing(formData.get("name"));
        }
        export async function updateTooLateAction(_previous: unknown, formData: FormData) {
          await updateThing(formData.get("name"));
          updateSchema.safeParse({ name: formData.get("name") });
        }
      `,
    });

    const audit = runAudit(fixtureRoot);
    expect(audit.status).toBe(1);
    expect(audit.result.ok).toBe(false);
    expect(audit.result.summary.uncovered).toBe(2);
    expect(
      audit.result.boundaries.every((boundary) =>
        boundary.uncoveredSources.includes("form-data:formData"),
      ),
    ).toBe(true);
  });

  it("treats typed and object server-action parameters as caller-controlled input", () => {
    const fixtureRoot = writeFixture({
      "src/modules/example/actions.ts": `
        "use server";
        export async function saveTypedAction(input: string) {
          await saveThing(input);
        }
        export async function saveObjectAction(input: { name: string }) {
          unrelatedSchema.safeParse({ fixed: true });
          await saveThing(input.name);
        }
      `,
    });

    const audit = runAudit(fixtureRoot);
    expect(audit.status).toBe(1);
    expect(audit.result.summary.uncovered).toBe(2);
    expect(
      audit.result.boundaries.every((boundary) =>
        boundary.uncoveredSources.includes("action-input:input"),
      ),
    ).toBe(true);
  });

  it("requires exact, documented exceptions and rejects stale entries", () => {
    const reason =
      "The framework supplies FormData, but this action explicitly ignores it and scopes the mutation to the authenticated membership.";
    const fixtureRoot = writeFixture(
      {
        "src/modules/example/actions.ts": `
          "use server";
          export async function markAllAction(formData: FormData) {
            void formData;
            await markAllForCurrentMembership();
          }
        `,
      },
      [
        {
          boundary: "action:src/modules/example/actions.ts#markAllAction",
          reason,
        },
      ],
    );
    const accepted = runAudit(fixtureRoot);
    expect(accepted.status, accepted.stderr).toBe(0);
    expect(accepted.result.boundaries[0]?.status).toBe("allowlisted");

    const staleRoot = writeFixture({ "src/modules/example/read.ts": "export const value = 1;" }, [
      { boundary: "action:src/modules/example/actions.ts#missingAction", reason },
    ]);
    const stale = runAudit(staleRoot);
    expect(stale.status).toBe(1);
    expect(stale.result.staleAllowlist).toEqual([
      "action:src/modules/example/actions.ts#missingAction",
    ]);
  });

  it("keeps the repository inventory green with only the three reviewed exceptions", () => {
    const audit = runAudit(root);
    expect(audit.status, audit.stderr).toBe(0);
    expect(audit.result.ok).toBe(true);
    expect(audit.result.summary.total).toBeGreaterThan(250);
    expect(audit.result.summary.uncovered).toBe(0);
    expect(audit.result.summary.allowlisted).toBe(3);

    const policy = JSON.parse(
      readFileSync(join(root, "security/mutation-boundaries.json"), "utf8"),
    ) as { allowlist: Array<{ boundary: string }> };
    expect(policy.allowlist.map((entry) => entry.boundary).sort()).toEqual(
      [
        "action:src/modules/notifications/actions/notifications.ts#markAllNotificationsReadAction",
        "route:src/app/api/mcp/route.ts#DELETE",
        "route:src/app/api/mcp/route.ts#POST",
      ].sort(),
    );

    const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts["security:mutation-boundaries"]).toContain(
      "check-mutation-boundaries.mjs",
    );
    expect(packageJson.scripts.check).toContain("security:mutation-boundaries");
  });
});
