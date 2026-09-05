"use client";

import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  LockKeyhole,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";

import { SecurityActionMessage } from "@/components/security/security-action-message";
import { StatusBadge } from "@/components/ui/status-badge";
import { getDateTimeFormatter } from "@/lib/intl-formatters";
import {
  createSecurityIncidentAction,
  reauthenticateSecurityAction,
  recordRestoreDrillAction,
  resetMembershipMfaAction,
  revokeSecuritySessionAction,
  updateSecurityIncidentAction,
  updateSecurityPolicyAction,
} from "@/modules/security/actions/security";
import type { SecurityActionState } from "@/modules/security/schemas/security";
import type {
  SecurityIncidentItem,
  SecurityMemberItem,
  SecuritySessionItem,
  SecurityWorkspaceData,
} from "@/modules/security/security";

const initialState: SecurityActionState = { status: "idle" };
const dateTime = getDateTimeFormatter("en", { dateStyle: "medium", timeStyle: "short" });

function formatDate(value: string | null): string {
  return value ? dateTime.format(new Date(value)) : "—";
}

function ReauthenticateForm({ recent }: { recent: boolean }) {
  const [state, action, pending] = useActionState(reauthenticateSecurityAction, initialState);
  return (
    <form action={action} className="security-inline-form">
      <label className="field">
        <span>Current password</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={pending}
        />
      </label>
      <button className="button button--secondary button--md" type="submit" disabled={pending}>
        <KeyRound size={16} aria-hidden="true" /> {pending ? "Confirming" : "Confirm identity"}
      </button>
      <StatusBadge tone={recent ? "success" : "warning"}>
        {recent ? "Recently confirmed" : "Confirmation required"}
      </StatusBadge>
      <SecurityActionMessage state={state} />
    </form>
  );
}

function PolicyForm({ data }: { data: SecurityWorkspaceData }) {
  const [state, action, pending] = useActionState(updateSecurityPolicyAction, initialState);
  const policy = data.policy;
  return (
    <form action={action} className="security-policy-form">
      <label className="security-check">
        <input
          name="requirePrivilegedMfa"
          type="checkbox"
          defaultChecked={policy.requirePrivilegedMfa}
        />
        <span>
          <strong>Require MFA for privileged roles</strong>
          <small>Block privileged workspace access until AAL2 is established.</small>
        </span>
      </label>
      <label className="security-check">
        <input name="recommendMfa" type="checkbox" defaultChecked={policy.recommendMfa} />
        <span>
          <strong>Recommend MFA to all members</strong>
          <small>Expose enrollment guidance without blocking standard roles.</small>
        </span>
      </label>
      <div className="security-form-grid">
        {[
          ["absoluteSessionMinutes", "Absolute session", policy.absoluteSessionMinutes, 30, 10080],
          ["idleTimeoutMinutes", "Idle timeout", policy.idleTimeoutMinutes, 5, 480],
          [
            "reauthenticationMinutes",
            "Critical-action window",
            policy.reauthenticationMinutes,
            5,
            120,
          ],
          [
            "suspiciousFailureThreshold",
            "Suspicious failures",
            policy.suspiciousFailureThreshold,
            3,
            20,
          ],
          ["suspiciousWindowMinutes", "Failure window", policy.suspiciousWindowMinutes, 5, 120],
          ["loginLimitPerWindow", "Login attempts / 15 min", policy.loginLimitPerWindow, 3, 100],
          [
            "passwordResetLimitPerWindow",
            "Password resets / 15 min",
            policy.passwordResetLimitPerWindow,
            1,
            30,
          ],
          ["apiLimitPerMinute", "API requests / min", policy.apiLimitPerMinute, 10, 5000],
          ["aiLimitPerMinute", "AI chats / min", policy.aiLimitPerMinute, 1, 100],
          ["workerLimitPerMinute", "Worker requests / min", policy.workerLimitPerMinute, 5, 1000],
          ["exportLimitPerMinute", "Exports / min", policy.exportLimitPerMinute, 1, 100],
          ["mcpLimitPerMinute", "MCP requests / min", policy.mcpLimitPerMinute, 1, 500],
        ].map(([name, label, value, min, max]) => (
          <label className="field" key={String(name)}>
            <span>{String(label)}</span>
            <input
              name={String(name)}
              type="number"
              defaultValue={Number(value)}
              min={Number(min)}
              max={Number(max)}
              required
            />
          </label>
        ))}
      </div>
      <div className="security-form-actions">
        <button className="button button--primary button--md" type="submit" disabled={pending}>
          {pending ? "Saving policy" : "Save security policy"}
        </button>
        <SecurityActionMessage state={state} />
      </div>
    </form>
  );
}

function SessionRevokeForm({ session }: { session: SecuritySessionItem }) {
  const [state, action, pending] = useActionState(revokeSecuritySessionAction, initialState);
  if (session.status !== "active") return null;
  return (
    <form action={action} className="security-row-action">
      <input type="hidden" name="sessionId" value={session.id} />
      <input
        name="reason"
        aria-label="Revocation reason"
        placeholder="Reason"
        minLength={3}
        maxLength={240}
        required
      />
      <button className="button button--danger button--sm" type="submit" disabled={pending}>
        {session.current ? "End this session" : "Revoke"}
      </button>
      <SecurityActionMessage state={state} />
    </form>
  );
}

function MfaResetForm({ member }: { member: SecurityMemberItem }) {
  const [state, action, pending] = useActionState(resetMembershipMfaAction, initialState);
  return (
    <form action={action} className="security-row-action">
      <input type="hidden" name="membershipId" value={member.membershipId} />
      <button
        className="button button--secondary button--sm"
        type="submit"
        disabled={pending || member.verifiedMfaFactors === 0}
      >
        Reset MFA
      </button>
      <SecurityActionMessage state={state} />
    </form>
  );
}

function IncidentCreateForm({ data }: { data: SecurityWorkspaceData }) {
  const [state, action, pending] = useActionState(createSecurityIncidentAction, initialState);
  return (
    <form action={action} className="security-form-grid security-form-grid--incident">
      <label className="field">
        <span>Title</span>
        <input name="title" minLength={3} maxLength={160} required />
      </label>
      <label className="field">
        <span>Severity</span>
        <select name="severity" defaultValue="medium">
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
      </label>
      <label className="field">
        <span>Classification</span>
        <select name="classification" defaultValue="other">
          <option value="authentication">Authentication</option>
          <option value="authorization">Authorization</option>
          <option value="data_exposure">Data exposure</option>
          <option value="malware">Malware</option>
          <option value="availability">Availability</option>
          <option value="fraud">Fraud</option>
          <option value="third_party">Third party</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label className="field">
        <span>Owner</span>
        <select name="ownerMembershipId" defaultValue="">
          <option value="">Unassigned</option>
          {data.members.map((member) => (
            <option key={member.membershipId} value={member.membershipId}>
              {member.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field security-form-grid__wide">
        <span>Initial summary</span>
        <textarea name="summary" rows={3} minLength={10} maxLength={4000} required />
      </label>
      <div className="security-form-grid__wide security-form-actions">
        <button className="button button--primary button--md" type="submit" disabled={pending}>
          Record incident
        </button>
        <SecurityActionMessage state={state} />
      </div>
    </form>
  );
}

function IncidentUpdateForm({ incident }: { incident: SecurityIncidentItem }) {
  const [state, action, pending] = useActionState(updateSecurityIncidentAction, initialState);
  return (
    <form action={action} className="security-incident-update">
      <input type="hidden" name="incidentId" value={incident.id} />
      <select name="status" defaultValue={incident.status} aria-label="Incident status">
        <option value="open">Open</option>
        <option value="investigating">Investigating</option>
        <option value="contained">Contained</option>
        <option value="resolved">Resolved</option>
        <option value="closed">Closed</option>
      </select>
      <select
        name="communicationStatus"
        defaultValue={incident.communicationStatus}
        aria-label="Communication status"
      >
        <option value="not_required">No communication required</option>
        <option value="pending">Communication pending</option>
        <option value="internal_sent">Internal sent</option>
        <option value="external_sent">External sent</option>
        <option value="complete">Communication complete</option>
      </select>
      <textarea
        name="containmentSummary"
        defaultValue={incident.containmentSummary ?? ""}
        rows={2}
        maxLength={4000}
        placeholder="Containment and recovery summary"
        aria-label="Containment summary"
      />
      <button className="button button--secondary button--sm" type="submit" disabled={pending}>
        Update incident
      </button>
      <SecurityActionMessage state={state} />
    </form>
  );
}

function RestoreDrillForm() {
  const [state, action, pending] = useActionState(recordRestoreDrillAction, initialState);
  return (
    <form action={action} className="security-form-grid">
      <label className="field">
        <span>Drill type</span>
        <select name="drillType" defaultValue="database">
          <option value="database">Database</option>
          <option value="minio">MinIO</option>
          <option value="configuration">Configuration</option>
          <option value="redis">Redis</option>
          <option value="automation">Automation worker</option>
          <option value="full">Full recovery</option>
        </select>
      </label>
      <label className="field">
        <span>Result</span>
        <select name="status" defaultValue="passed">
          <option value="passed">Passed</option>
          <option value="partial">Partial</option>
          <option value="failed">Failed</option>
        </select>
      </label>
      <label className="field">
        <span>Runbook version</span>
        <input name="runbookVersion" defaultValue="v1" maxLength={80} required />
      </label>
      <label className="field">
        <span>Started at</span>
        <input name="startedAt" type="datetime-local" required />
      </label>
      <label className="field">
        <span>Completed at</span>
        <input name="completedAt" type="datetime-local" />
      </label>
      <label className="field">
        <span>Recovered point (minutes)</span>
        <input name="recoveryPointMinutes" type="number" min={0} max={10080} />
      </label>
      <label className="field">
        <span>Recovery time (minutes)</span>
        <input name="recoveryTimeMinutes" type="number" min={0} max={10080} />
      </label>
      <label className="field">
        <span>Evidence SHA-256</span>
        <input name="evidenceHash" pattern="[0-9a-f]{64}" maxLength={64} />
      </label>
      <label className="field security-form-grid__wide">
        <span>Evidence summary</span>
        <textarea name="evidenceSummary" rows={3} minLength={10} maxLength={4000} required />
      </label>
      <div className="security-form-grid__wide security-form-actions">
        <button className="button button--primary button--md" type="submit" disabled={pending}>
          Record restore drill
        </button>
        <SecurityActionMessage state={state} />
      </div>
    </form>
  );
}

export function SecurityWorkspace({ data }: { data: SecurityWorkspaceData }) {
  return (
    <div className="security-workspace">
      {data.policy.recommendMfa && data.current.verifiedMfaFactors === 0 ? (
        <section className="security-recommendation">
          <ShieldAlert size={20} aria-hidden="true" />
          <div>
            <strong>Add an authenticator</strong>
            <p>A second factor protects your account if your password is exposed.</p>
          </div>
          <Link className="button button--primary button--sm" href="/mfa?next=/settings/security">
            Set up MFA
          </Link>
        </section>
      ) : null}
      <section className="security-overview" aria-label="Current security posture">
        <div>
          <ShieldCheck size={20} aria-hidden="true" />
          <span>Assurance</span>
          <strong>{data.current.assuranceLevel.toUpperCase()}</strong>
        </div>
        <div>
          <KeyRound size={20} aria-hidden="true" />
          <span>Verified MFA factors</span>
          <strong>{data.current.verifiedMfaFactors}</strong>
        </div>
        <div>
          <LockKeyhole size={20} aria-hidden="true" />
          <span>Active sessions</span>
          <strong>{data.sessions.filter((session) => session.status === "active").length}</strong>
        </div>
        <div>
          <ShieldAlert size={20} aria-hidden="true" />
          <span>Open incidents</span>
          <strong>
            {
              data.incidents.filter((incident) => !["resolved", "closed"].includes(incident.status))
                .length
            }
          </strong>
        </div>
      </section>

      <section className="settings-panel security-section">
        <div className="settings-panel__heading">
          <div>
            <h2>Critical-action confirmation</h2>
            <p>
              Confirm your password before policy changes, organization-wide session revocation, MFA
              reset, or restore-drill evidence.
            </p>
          </div>
        </div>
        <ReauthenticateForm recent={data.current.recentReauthentication} />
      </section>

      {data.capabilities.managePolicy ? (
        <section className="settings-panel security-section">
          <div className="settings-panel__heading">
            <div>
              <h2>Authentication and rate-limit policy</h2>
              <p>
                Changes require a recent identity confirmation and are recorded in the audit log.
              </p>
            </div>
          </div>
          <PolicyForm data={data} />
        </section>
      ) : null}

      <section className="settings-panel security-section">
        <div className="settings-panel__heading">
          <div>
            <h2>Sessions</h2>
            <p>Review active and historical sessions visible within your permission scope.</p>
          </div>
        </div>
        <div className="security-table-wrap" tabIndex={0} aria-label="Organization sessions table">
          <table className="security-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Status</th>
                <th>Assurance</th>
                <th>Last seen</th>
                <th>Expires</th>
                <th>Network</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {data.sessions.map((session) => (
                <tr key={session.id}>
                  <td>
                    <strong>{session.memberName}</strong>
                    <small>{session.own ? "Your session" : session.memberEmail}</small>
                  </td>
                  <td>
                    <StatusBadge
                      tone={
                        session.status === "active"
                          ? "success"
                          : session.status === "revoked"
                            ? "error"
                            : "warning"
                      }
                    >
                      {session.status}
                    </StatusBadge>
                  </td>
                  <td>{session.assuranceLevel.toUpperCase()}</td>
                  <td>{formatDate(session.lastSeenAt)}</td>
                  <td>{formatDate(session.idleExpiresAt)}</td>
                  <td>
                    <small>{session.ipAddress ?? "Unknown"}</small>
                  </td>
                  <td>
                    {session.own || data.capabilities.revokeOrganizationSessions ? (
                      <SessionRevokeForm session={session} />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {data.capabilities.resetMfa ? (
        <section className="settings-panel security-section">
          <div className="settings-panel__heading">
            <div>
              <h2>Member MFA</h2>
              <p>
                Reset factors only after identity verification through an approved recovery channel.
              </p>
            </div>
          </div>
          <div className="security-table-wrap" tabIndex={0} aria-label="Member MFA table">
            <table className="security-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Role posture</th>
                  <th>Factors</th>
                  <th>Sessions</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {data.members.map((member) => (
                  <tr key={member.membershipId}>
                    <td>
                      <strong>{member.name}</strong>
                      <small>{member.email}</small>
                    </td>
                    <td>
                      <StatusBadge tone={member.privileged ? "warning" : "neutral"}>
                        {member.privileged ? "Privileged" : "Standard"}
                      </StatusBadge>
                    </td>
                    <td>{member.verifiedMfaFactors}</td>
                    <td>{member.activeSessions}</td>
                    <td>
                      {member.membershipId !== data.current.membershipId ? (
                        <MfaResetForm member={member} />
                      ) : (
                        <small>Use your authenticator settings</small>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {data.capabilities.recordOperations ? (
        <section className="settings-panel security-section">
          <div className="settings-panel__heading">
            <div>
              <h2>Incident operations</h2>
              <p>Capture classification, containment, communication, and resolution evidence.</p>
            </div>
          </div>
          <IncidentCreateForm data={data} />
          <div className="security-incident-list">
            {data.incidents.map((incident) => (
              <article className="security-incident" key={incident.id}>
                <header>
                  <div>
                    <strong>
                      {incident.incidentNumber} · {incident.title}
                    </strong>
                    <small>
                      {incident.classification} · detected {formatDate(incident.detectedAt)}
                    </small>
                  </div>
                  <StatusBadge
                    tone={
                      incident.severity === "critical" || incident.severity === "high"
                        ? "error"
                        : incident.severity === "medium"
                          ? "warning"
                          : "info"
                    }
                  >
                    {incident.severity}
                  </StatusBadge>
                </header>
                <p>{incident.summary}</p>
                <IncidentUpdateForm incident={incident} />
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {data.capabilities.recordOperations ? (
        <section className="settings-panel security-section">
          <div className="settings-panel__heading">
            <div>
              <h2>Restore drills</h2>
              <p>
                Record measured recovery points, recovery times, and immutable evidence summaries.
              </p>
            </div>
          </div>
          <RestoreDrillForm />
          <div className="security-drill-list">
            {data.restoreDrills.map((drill) => (
              <article key={drill.id}>
                <div>
                  <strong>
                    {drill.drillType} · {drill.runbookVersion}
                  </strong>
                  <small>
                    {formatDate(drill.startedAt)} · {drill.executedByName}
                  </small>
                </div>
                <StatusBadge
                  tone={
                    drill.status === "passed"
                      ? "success"
                      : drill.status === "failed"
                        ? "error"
                        : "warning"
                  }
                >
                  {drill.status}
                </StatusBadge>
                <p>{drill.evidenceSummary}</p>
                <small>
                  RPO {drill.recoveryPointMinutes ?? "—"} min · RTO{" "}
                  {drill.recoveryTimeMinutes ?? "—"} min
                </small>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="settings-panel security-section">
        <div className="settings-panel__heading">
          <div>
            <h2>Security events</h2>
            <p>Append-only authentication, session, policy, recovery, and alert evidence.</p>
          </div>
        </div>
        <div className="security-event-list">
          {data.events.map((event) => (
            <article key={event.id}>
              <span className={`security-event-icon security-event-icon--${event.severity}`}>
                {event.severity === "critical" ? (
                  <AlertTriangle size={16} />
                ) : (
                  <CheckCircle2 size={16} />
                )}
              </span>
              <div>
                <strong>{event.eventType.replaceAll("_", " ").replaceAll(".", " · ")}</strong>
                <small>
                  {event.memberName ?? "System"} · {formatDate(event.occurredAt)} ·{" "}
                  {event.ipAddress ?? "No IP"}
                </small>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
