import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (file: string) => readFileSync(join(root, file), "utf8");

describe("request performance contracts", () => {
  it("reuses one bounded database pool across development reloads", () => {
    const database = source("src/integrations/postgres/database.ts");
    const environment = source("src/lib/validation/env.ts");

    expect(database).toContain("globalThis.__agencyOsDatabaseClient");
    expect(database).toContain("max: environment.poolMax");
    expect(environment).toContain("DATABASE_POOL_MAX");
    expect(environment).toContain(".max(50).default(10)");
  });

  it("evaluates security in one database round trip and overlaps workspace counters", () => {
    const access = source("src/modules/identity/server/get-current-access-context.ts");
    const session = source("src/modules/security/server/session-security.ts");

    expect(access).toContain("const [security, counters] = await Promise.all");
    expect(session).toContain("private.evaluate_security_session");
    expect(session).not.toContain("database.begin");
  });

  it("fans out independent calendar, asset, and support reads concurrently", () => {
    const calendar = source("src/modules/calendar/server/calendar.ts");
    const assets = source("src/modules/assets/server/assets.ts");
    const support = source("src/modules/support/server/support.ts");

    expect(calendar).toContain("const derivedQueries");
    expect(calendar).toContain("Promise.all(derivedQueries)");
    expect(assets).toContain("[members, vendors, documents, requestRows, returnRequestRows]");
    expect(support).toContain("[companies, contacts, projects, documents] = await Promise.all");
  });

  it("fails over quickly and backs off when optional Redis is unavailable", () => {
    const redis = source("src/integrations/redis/client.ts");

    expect(redis).toContain("const RETRY_COOLDOWN_MS = 5 * 60_000");
    expect(redis).toContain("connectTimeout: 750");
    expect(redis).toContain("socketTimeout: 1_000");
  });
});
