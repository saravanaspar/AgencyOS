import { describe, expect, it } from "vitest";

import {
  calculateProjectProgress,
  normalizeProjectCode,
  projectHealth,
} from "@/modules/projects/projects";
import {
  projectCreateSchema,
  projectDependencySchema,
  projectFiltersSchema,
  projectLabelCreateSchema,
  projectMilestoneStatusSchema,
  projectPhaseStatusSchema,
  projectRecurrenceSchema,
  projectTaskCreateSchema,
} from "@/modules/projects/schemas/projects";

const companyId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const statusId = "33333333-3333-4333-8333-333333333333";
const taskId = "44444444-4444-4444-8444-444444444444";
const relatedTaskId = "55555555-5555-4555-8555-555555555555";

describe("project helpers and validation", () => {
  it("normalizes readable project codes", () => {
    expect(normalizeProjectCode("  client launch / phase 1  ")).toBe("CLIENT-LAUNCH-PHASE-1");
  });

  it("calculates bounded completion progress", () => {
    expect(calculateProjectProgress(8, 3)).toBe(38);
    expect(calculateProjectProgress(0, 0)).toBe(0);
    expect(calculateProjectProgress(3, 10)).toBe(100);
  });

  it("marks blocked and overdue projects as at risk", () => {
    expect(
      projectHealth({
        status: "active",
        dueDate: "2026-07-20",
        progress: 90,
        blockedTasks: 1,
        now: new Date("2026-07-13T00:00:00Z"),
      }),
    ).toBe("at_risk");
    expect(
      projectHealth({
        status: "active",
        dueDate: "2026-07-01",
        progress: 75,
        blockedTasks: 0,
        now: new Date("2026-07-13T00:00:00Z"),
      }),
    ).toBe("at_risk");
  });

  it("requires a CRM company for client projects", () => {
    const result = projectCreateSchema.safeParse({
      name: "Client launch",
      projectType: "client",
      status: "planned",
      priority: "normal",
      visibility: "members",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors.companyId).toBeDefined();

    expect(
      projectCreateSchema.safeParse({
        name: "Client launch",
        projectType: "client",
        companyId,
        status: "planned",
        priority: "normal",
        visibility: "members",
      }).success,
    ).toBe(true);
  });

  it("requires closure instead of direct completed status", () => {
    const result = projectCreateSchema.safeParse({
      name: "Closed directly",
      projectType: "internal",
      status: "completed",
      priority: "normal",
      visibility: "members",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors.status).toBeDefined();
  });

  it("rejects project and task date ranges that run backwards", () => {
    expect(
      projectCreateSchema.safeParse({
        name: "Internal work",
        projectType: "internal",
        status: "planned",
        priority: "normal",
        visibility: "members",
        startDate: "2026-07-20",
        dueDate: "2026-07-19",
      }).success,
    ).toBe(false);

    expect(
      projectTaskCreateSchema.safeParse({
        projectId,
        statusId,
        title: "Prepare launch",
        priority: "normal",
        startDate: "2026-07-20",
        dueDate: "2026-07-19",
      }).success,
    ).toBe(false);
  });

  it("defaults archive filtering to active projects and accepts explicit archive views", () => {
    expect(projectFiltersSchema.parse({}).archive).toBe("active");
    expect(projectFiltersSchema.parse({ archive: "archived" }).archive).toBe("archived");
    expect(projectFiltersSchema.parse({ archive: "all" }).archive).toBe("all");
  });

  it("rejects self-dependencies and accepts valid same-project dependency input", () => {
    expect(
      projectDependencySchema.safeParse({
        taskId,
        relatedTaskId: taskId,
        relationship: "blocks",
        operation: "add",
      }).success,
    ).toBe(false);

    expect(
      projectDependencySchema.safeParse({
        taskId,
        relatedTaskId,
        relationship: "related_to",
        operation: "add",
      }).success,
    ).toBe(true);
  });

  it("requires recurrence end dates to be on or after the next run", () => {
    expect(
      projectRecurrenceSchema.safeParse({
        taskId,
        intervalUnit: "week",
        intervalCount: 2,
        nextRunOn: "2026-08-10",
        endOn: "2026-08-09",
        active: true,
      }).success,
    ).toBe(false);

    expect(
      projectRecurrenceSchema.safeParse({
        taskId,
        intervalUnit: "month",
        intervalCount: 1,
        nextRunOn: "2026-08-10",
        endOn: "2026-12-10",
        active: true,
      }).success,
    ).toBe(true);
  });

  it("accepts only canonical six-digit label colors", () => {
    expect(
      projectLabelCreateSchema.safeParse({ projectId, name: "Blocked", color: "#AABBCC" }).success,
    ).toBe(true);
    expect(
      projectLabelCreateSchema.safeParse({ projectId, name: "Blocked", color: "red" }).success,
    ).toBe(false);
  });

  it("accepts only supported phase and milestone lifecycle statuses", () => {
    expect(projectPhaseStatusSchema.safeParse({ phaseId: taskId, status: "active" }).success).toBe(
      true,
    );
    expect(
      projectPhaseStatusSchema.safeParse({ phaseId: taskId, status: "finished" }).success,
    ).toBe(false);
    expect(
      projectMilestoneStatusSchema.safeParse({ milestoneId: taskId, status: "completed" }).success,
    ).toBe(true);
    expect(
      projectMilestoneStatusSchema.safeParse({ milestoneId: taskId, status: "planned" }).success,
    ).toBe(false);
  });
});
