import { z } from "zod";

const optionalInteger = (minimum: number, maximum: number) =>
  z.coerce.number().int().min(minimum).max(maximum);

export const securityPolicySchema = z
  .object({
    requirePrivilegedMfa: z.string().optional(),
    recommendMfa: z.string().optional(),
    absoluteSessionMinutes: optionalInteger(30, 10080),
    idleTimeoutMinutes: optionalInteger(5, 480),
    reauthenticationMinutes: optionalInteger(5, 120),
    suspiciousFailureThreshold: optionalInteger(3, 20),
    suspiciousWindowMinutes: optionalInteger(5, 120),
    loginLimitPerWindow: optionalInteger(3, 100),
    passwordResetLimitPerWindow: optionalInteger(1, 30),
    apiLimitPerMinute: optionalInteger(10, 5000),
    aiLimitPerMinute: optionalInteger(1, 100),
    workerLimitPerMinute: optionalInteger(5, 1000),
    exportLimitPerMinute: optionalInteger(1, 100),
    mcpLimitPerMinute: optionalInteger(1, 500),
  })
  .refine((value) => value.idleTimeoutMinutes <= value.absoluteSessionMinutes, {
    message: "Idle timeout cannot exceed the absolute session lifetime.",
    path: ["idleTimeoutMinutes"],
  });

export const revokeSessionSchema = z.object({
  sessionId: z.uuid(),
  reason: z.string().trim().min(3).max(240),
});

export const resetMfaSchema = z.object({ membershipId: z.uuid() });

export const reauthenticateSchema = z.object({
  password: z.string().min(1).max(1024),
});

export const securityIncidentCreateSchema = z.object({
  title: z.string().trim().min(3).max(160),
  severity: z.enum(["low", "medium", "high", "critical"]),
  classification: z.enum([
    "authentication",
    "authorization",
    "data_exposure",
    "malware",
    "availability",
    "fraud",
    "third_party",
    "other",
  ]),
  summary: z.string().trim().min(10).max(4000),
  ownerMembershipId: z.union([z.uuid(), z.literal("")]).transform((value) => value || null),
});

export const securityIncidentUpdateSchema = z.object({
  incidentId: z.uuid(),
  status: z.enum(["open", "investigating", "contained", "resolved", "closed"]),
  containmentSummary: z.string().trim().max(4000).optional().default(""),
  communicationStatus: z.enum([
    "not_required",
    "pending",
    "internal_sent",
    "external_sent",
    "complete",
  ]),
});

const utcDateTimeLocal = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Enter a valid UTC date and time.")
  .transform((value) => `${value}:00.000Z`);

export const restoreDrillSchema = z.object({
  drillType: z.enum(["database", "object_storage", "configuration", "redis", "automation", "full"]),
  status: z.enum(["passed", "failed", "partial"]),
  runbookVersion: z.string().trim().min(1).max(80),
  startedAt: utcDateTimeLocal,
  completedAt: z.union([utcDateTimeLocal, z.literal("")]).transform((value) => value || null),
  recoveryPointMinutes: z
    .union([optionalInteger(0, 10080), z.literal("")])
    .transform((value) => (value === "" ? null : value)),
  recoveryTimeMinutes: z
    .union([optionalInteger(0, 10080), z.literal("")])
    .transform((value) => (value === "" ? null : value)),
  evidenceSummary: z.string().trim().min(10).max(4000),
  evidenceHash: z
    .union([z.string().regex(/^[0-9a-f]{64}$/), z.literal("")])
    .transform((value) => value || null),
});

export interface SecurityActionState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string[]>;
}
