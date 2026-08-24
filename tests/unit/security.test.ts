import { describe, expect, it } from "vitest";

import {
  reauthenticateSchema,
  restoreDrillSchema,
  revokeSessionSchema,
  securityIncidentCreateSchema,
  securityPolicySchema,
} from "@/modules/security/schemas/security";

describe("security input boundaries", () => {
  it("accepts a bounded organization policy", () => {
    const policy = securityPolicySchema.parse({
      requirePrivilegedMfa: "on",
      recommendMfa: "on",
      absoluteSessionMinutes: "720",
      idleTimeoutMinutes: "30",
      reauthenticationMinutes: "15",
      suspiciousFailureThreshold: "5",
      suspiciousWindowMinutes: "15",
      loginLimitPerWindow: "10",
      passwordResetLimitPerWindow: "5",
      apiLimitPerMinute: "120",
      aiLimitPerMinute: "10",
      workerLimitPerMinute: "60",
      exportLimitPerMinute: "10",
      mcpLimitPerMinute: "30",
    });
    expect(policy.absoluteSessionMinutes).toBe(720);
    expect(policy.requirePrivilegedMfa).toBe("on");
  });

  it("rejects idle sessions longer than the absolute lifetime", () => {
    expect(() =>
      securityPolicySchema.parse({
        absoluteSessionMinutes: "30",
        idleTimeoutMinutes: "60",
        reauthenticationMinutes: "15",
        suspiciousFailureThreshold: "5",
        suspiciousWindowMinutes: "15",
        loginLimitPerWindow: "10",
        passwordResetLimitPerWindow: "5",
        apiLimitPerMinute: "120",
        aiLimitPerMinute: "10",
        workerLimitPerMinute: "60",
        exportLimitPerMinute: "10",
        mcpLimitPerMinute: "30",
      }),
    ).toThrow(/Idle timeout/);
  });

  it("requires a reason for session revocation and a current password for reauthentication", () => {
    expect(() =>
      revokeSessionSchema.parse({
        sessionId: "11111111-1111-4111-8111-111111111111",
        reason: "x",
      }),
    ).toThrow();
    expect(reauthenticateSchema.safeParse({ password: "" }).success).toBe(false);
  });

  it("bounds incident narrative and validates classification", () => {
    const incident = securityIncidentCreateSchema.parse({
      title: "Suspicious privileged sign-in",
      severity: "high",
      classification: "authentication",
      summary: "Multiple sign-in attempts were confirmed from an unexpected network.",
      ownerMembershipId: "",
    });
    expect(incident.ownerMembershipId).toBeNull();
    expect(() =>
      securityIncidentCreateSchema.parse({
        ...incident,
        classification: "unbounded",
      }),
    ).toThrow();
  });

  it("normalizes UTC restore-drill timestamps and optional metrics", () => {
    const drill = restoreDrillSchema.parse({
      drillType: "full",
      status: "passed",
      runbookVersion: "v1",
      startedAt: "2026-07-18T10:30",
      completedAt: "2026-07-18T11:45",
      recoveryPointMinutes: "12",
      recoveryTimeMinutes: "75",
      evidenceSummary: "Database, objects, authorization, and workers passed the isolated drill.",
      evidenceHash: "a".repeat(64),
    });
    expect(drill.startedAt).toBe("2026-07-18T10:30:00.000Z");
    expect(drill.recoveryTimeMinutes).toBe(75);
  });
});
