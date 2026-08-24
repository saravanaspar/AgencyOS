export const securityPermissionKeys = {
  view: "settings.security.view",
  manage: "settings.security.manage_settings",
  revoke: "settings.security.revoke",
  resetMfa: "settings.security.reset_mfa",
} as const;

export interface SecurityPolicy {
  requirePrivilegedMfa: boolean;
  recommendMfa: boolean;
  absoluteSessionMinutes: number;
  idleTimeoutMinutes: number;
  reauthenticationMinutes: number;
  suspiciousFailureThreshold: number;
  suspiciousWindowMinutes: number;
  loginLimitPerWindow: number;
  passwordResetLimitPerWindow: number;
  apiLimitPerMinute: number;
  aiLimitPerMinute: number;
  workerLimitPerMinute: number;
  exportLimitPerMinute: number;
  mcpLimitPerMinute: number;
}

export interface SecuritySessionItem {
  id: string;
  membershipId: string;
  memberName: string;
  memberEmail: string;
  status: "active" | "revoked" | "expired";
  assuranceLevel: "aal1" | "aal2";
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  absoluteExpiresAt: string;
  idleExpiresAt: string;
  reauthenticatedAt: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  current: boolean;
  own: boolean;
}

export interface SecurityMemberItem {
  membershipId: string;
  name: string;
  email: string;
  status: string;
  privileged: boolean;
  verifiedMfaFactors: number;
  activeSessions: number;
}

export interface SecurityEventItem {
  id: string;
  membershipId: string | null;
  memberName: string | null;
  eventType: string;
  severity: "info" | "warning" | "critical";
  ipAddress: string | null;
  occurredAt: string;
  metadata: Record<string, unknown>;
}

export interface SecurityIncidentItem {
  id: string;
  incidentNumber: string;
  title: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "open" | "investigating" | "contained" | "resolved" | "closed";
  classification: string;
  summary: string;
  containmentSummary: string | null;
  communicationStatus: string;
  detectedAt: string;
  resolvedAt: string | null;
  ownerName: string | null;
}

export interface SecurityRestoreDrillItem {
  id: string;
  drillType: string;
  status: "passed" | "failed" | "partial";
  runbookVersion: string;
  startedAt: string;
  completedAt: string | null;
  recoveryPointMinutes: number | null;
  recoveryTimeMinutes: number | null;
  evidenceSummary: string;
  executedByName: string;
}

export interface SecurityWorkspaceData {
  policy: SecurityPolicy;
  sessions: SecuritySessionItem[];
  members: SecurityMemberItem[];
  events: SecurityEventItem[];
  incidents: SecurityIncidentItem[];
  restoreDrills: SecurityRestoreDrillItem[];
  capabilities: {
    organizationScope: boolean;
    managePolicy: boolean;
    revokeOrganizationSessions: boolean;
    resetMfa: boolean;
    recordOperations: boolean;
  };
  current: {
    sessionId: string | null;
    membershipId: string;
    privileged: boolean;
    assuranceLevel: "aal1" | "aal2";
    verifiedMfaFactors: number;
    recentReauthentication: boolean;
  };
}
