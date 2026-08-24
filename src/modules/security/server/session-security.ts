import "server-only";

import { getDatabaseClient } from "@/integrations/postgres/database";
import type { RequestSecurityContext } from "@/lib/server/request-context";

export type SessionSecurityDenialReason = "mfa-required" | "session-expired" | "session-revoked";

interface SecurityEvaluationRow {
  decision: "active" | SessionSecurityDenialReason;
  effective_assurance_level: "aal1" | "aal2";
  effective_reauthenticated_at: Date | null;
  reauthentication_minutes: number;
}

export interface SessionSecurityInput {
  organizationId: string;
  membershipId: string;
  userId: string;
  sessionId: string | null;
  assuranceLevel: "aal1" | "aal2";
  issuedAt: Date;
  privileged: boolean;
  request: RequestSecurityContext;
}

export interface SessionSecurityState {
  sessionId: string | null;
  assuranceLevel: "aal1" | "aal2";
  privileged: boolean;
  recentReauthentication: boolean;
}

export type SessionSecurityResult =
  | { allowed: true; state: SessionSecurityState }
  | { allowed: false; reason: SessionSecurityDenialReason };

const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecent(value: Date | null, minutes: number): boolean {
  return Boolean(value && value.getTime() >= Date.now() - minutes * 60_000);
}

export async function evaluateCurrentSecuritySession(
  input: SessionSecurityInput,
): Promise<SessionSecurityResult> {
  const database = getDatabaseClient();
  const sessionId =
    input.sessionId && SESSION_ID_PATTERN.test(input.sessionId) ? input.sessionId : null;
  const [evaluation] = await database<SecurityEvaluationRow[]>`
    select decision, effective_assurance_level, effective_reauthenticated_at,
      reauthentication_minutes
    from private.evaluate_security_session(
      ${input.organizationId}::uuid,
      ${input.membershipId}::uuid,
      ${input.userId}::uuid,
      ${sessionId}::uuid,
      ${input.assuranceLevel},
      ${input.issuedAt},
      ${input.privileged},
      ${input.request.ipAddress}::inet,
      ${input.request.userAgent},
      ${input.request.requestId}
    )
  `;

  if (!evaluation) throw new Error("Security session evaluation returned no result.");
  if (evaluation.decision !== "active") {
    return { allowed: false, reason: evaluation.decision };
  }

  return {
    allowed: true,
    state: {
      sessionId,
      assuranceLevel: evaluation.effective_assurance_level,
      privileged: input.privileged,
      recentReauthentication: isRecent(
        evaluation.effective_reauthenticated_at,
        evaluation.reauthentication_minutes,
      ),
    },
  };
}
