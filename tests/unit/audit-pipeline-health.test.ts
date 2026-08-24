import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  database: vi.fn(),
}));

vi.mock("@/integrations/postgres/database", () => ({
  getDatabaseClient: () => mocks.database,
}));

import { runAuditPipelineHealthWorker } from "@/modules/audit/server/audit-pipeline-health";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.database.mockResolvedValue([{ id: "42" }]);
});

describe("audit-pipeline health worker", () => {
  it("commits a platform-scoped system canary to the real append-only audit table", async () => {
    await expect(runAuditPipelineHealthWorker()).resolves.toEqual({ canariesWritten: 1 });

    expect(mocks.database).toHaveBeenCalledOnce();
    const [strings] = mocks.database.mock.calls[0] as unknown as [TemplateStringsArray];
    const statement = strings.join("?");
    expect(statement).toContain("insert into public.audit_events");
    expect(statement).toContain("organization_id");
    expect(statement).toContain("actor_user_id");
    expect(statement).toContain("null,\n      null,\n      'system'");
    expect(statement).toContain("'audit.pipeline.canary_written'");
    expect(statement).toContain("'audit_pipeline_health'");
    expect(statement).toContain("returning id::text");
  });

  it("fails unless PostgreSQL confirms exactly one inserted canary", async () => {
    mocks.database.mockResolvedValueOnce([]);
    await expect(runAuditPipelineHealthWorker()).rejects.toThrow(
      "audit_pipeline_canary_not_committed",
    );
  });

  it("keeps the canary and alert path independent from notification and email queues", () => {
    const healthWorker = source("src/modules/audit/server/audit-pipeline-health.ts");
    const alertSender = source("scripts/workers/audit-pipeline-alert.mjs");
    for (const implementation of [healthWorker, alertSender]) {
      expect(implementation).not.toContain("enqueueNotification");
      expect(implementation).not.toContain("notification_deliveries");
      expect(implementation).not.toContain("sendEmailWithResend");
      expect(implementation).not.toContain("pg_notify");
    }
  });
});
