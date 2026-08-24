"use client";

import { useActionState } from "react";
import { CheckCircle2, ShieldCheck, UserCheck, UserMinus, UserRoundCog } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  changeMemberRoleAction,
  changeMemberStatusAction,
  grantUserAccessAction,
} from "@/modules/identity/actions/access-management";
import type { AccessManagementActionState } from "@/modules/identity/schemas/access-management";
import type {
  AccessManagementData,
  AccessManagementMember,
  AccessManagementRole,
} from "@/modules/identity/server/access-management";

const initialActionState: AccessManagementActionState = { status: "idle" };

function ActionMessage({ state }: { state: AccessManagementActionState }) {
  if (state.status === "idle" || !state.message) {
    return null;
  }

  return (
    <p
      className={
        state.status === "success" ? "inline-action-message is-success" : "inline-action-message"
      }
      role={state.status === "error" ? "alert" : "status"}
    >
      {state.status === "success" ? <CheckCircle2 size={14} aria-hidden="true" /> : null}
      {state.message}
    </p>
  );
}

function statusTone(status: AccessManagementMember["status"]) {
  switch (status) {
    case "active":
      return "success" as const;
    case "invited":
      return "info" as const;
    case "suspended":
      return "warning" as const;
    case "deactivated":
      return "error" as const;
  }
}

function MemberAccessRow({
  actorUserId,
  canManageRoles,
  canManageStatus,
  member,
  roles,
}: {
  actorUserId: string;
  canManageRoles: boolean;
  canManageStatus: boolean;
  member: AccessManagementMember;
  roles: AccessManagementRole[];
}) {
  const [roleState, roleAction, rolePending] = useActionState(
    changeMemberRoleAction,
    initialActionState,
  );
  const [statusState, statusAction, statusPending] = useActionState(
    changeMemberStatusAction,
    initialActionState,
  );
  const selectedRoleId = member.roleIds[0] ?? "";
  const isCurrentUser = member.userId === actorUserId;

  return (
    <article className="member-access-card">
      <div className="member-access-card__identity">
        <span className="avatar" aria-hidden="true">
          {member.displayName
            .split(/\s+/)
            .slice(0, 2)
            .map((part) => part.charAt(0).toUpperCase())
            .join("") || "AU"}
        </span>
        <div>
          <strong>{member.displayName}</strong>
          <small>{member.email}</small>
        </div>
        {isCurrentUser ? <span className="member-access-card__you">You</span> : null}
      </div>

      <div className="member-access-card__status">
        <StatusBadge tone={statusTone(member.status)}>{member.status}</StatusBadge>
        <small>
          {member.roleNames.length > 0 ? member.roleNames.join(", ") : "No role assigned"}
        </small>
      </div>

      <div className="member-access-card__controls">
        <form className="inline-control-form" action={roleAction}>
          <input type="hidden" name="membershipId" value={member.membershipId} />
          <label>
            <span>Role</span>
            <select
              name="roleId"
              defaultValue={selectedRoleId}
              disabled={!canManageRoles || rolePending}
              aria-label={`Role for ${member.email}`}
              required
            >
              <option value="" disabled>
                Choose role
              </option>
              {roles.map((role) => (
                <option value={role.id} key={role.id}>
                  {role.name}
                  {role.isPrivileged ? " — privileged" : ""}
                </option>
              ))}
            </select>
          </label>
          <Button
            size="sm"
            variant="secondary"
            type="submit"
            disabled={!canManageRoles || rolePending}
          >
            {rolePending ? "Saving" : "Save role"}
          </Button>
        </form>

        <form className="inline-control-form" action={statusAction}>
          <input type="hidden" name="membershipId" value={member.membershipId} />
          <label>
            <span>Access</span>
            <select
              name="status"
              defaultValue={member.status === "invited" ? "active" : member.status}
              disabled={!canManageStatus || statusPending || isCurrentUser}
              aria-label={`Access status for ${member.email}`}
            >
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="deactivated">Deactivated</option>
            </select>
          </label>
          <Button
            size="sm"
            variant={member.status === "active" ? "danger" : "secondary"}
            type="submit"
            disabled={!canManageStatus || statusPending || isCurrentUser}
          >
            {statusPending ? "Saving" : "Update access"}
          </Button>
        </form>
      </div>

      <div className="member-access-card__messages">
        <ActionMessage state={roleState} />
        <ActionMessage state={statusState} />
      </div>
    </article>
  );
}

export function AccessManagementPanel({ data }: { data: AccessManagementData }) {
  const [grantState, grantAction, grantPending] = useActionState(
    grantUserAccessAction,
    initialActionState,
  );
  const emailError = grantState.fieldErrors?.email?.[0];
  const roleError = grantState.fieldErrors?.roleId?.[0];
  const activeMembers = data.members.filter((member) => member.status === "active").length;
  const restrictedMembers = data.members.length - activeMembers;

  return (
    <div className="access-management-page">
      <section className="access-summary" aria-label="Access summary">
        <div>
          <UserCheck size={20} aria-hidden="true" />
          <span>Active members</span>
          <strong>{activeMembers}</strong>
        </div>
        <div>
          <UserMinus size={20} aria-hidden="true" />
          <span>Restricted members</span>
          <strong>{restrictedMembers}</strong>
        </div>
        <div>
          <ShieldCheck size={20} aria-hidden="true" />
          <span>Available roles</span>
          <strong>{data.roles.length}</strong>
        </div>
      </section>

      <section className="settings-panel settings-panel--grant">
        <div className="settings-panel__heading">
          <span className="settings-panel__icon">
            <UserRoundCog size={21} aria-hidden="true" />
          </span>
          <div>
            <h2>Grant organization access</h2>
            <p>
              Enter the exact email used for a confirmed AgencyOS signup, then assign the user’s
              initial role in {data.organization.legalName}.
            </p>
          </div>
        </div>

        <form className="grant-access-form" action={grantAction} noValidate>
          <label className="field">
            <span>Confirmed account email</span>
            <input
              type="email"
              name="email"
              inputMode="email"
              autoComplete="off"
              placeholder="name@agency.com"
              aria-invalid={Boolean(emailError)}
              aria-describedby={emailError ? "grant-email-error" : "grant-email-help"}
              disabled={!data.capabilities.canGrantAccess || grantPending}
              required
            />
            {emailError ? (
              <small className="field-error" id="grant-email-error">
                {emailError}
              </small>
            ) : (
              <small id="grant-email-help">
                The user must sign up and confirm their email first.
              </small>
            )}
          </label>

          <label className="field">
            <span>Initial role</span>
            <select
              name="roleId"
              defaultValue=""
              aria-invalid={Boolean(roleError)}
              aria-describedby={roleError ? "grant-role-error" : undefined}
              disabled={!data.capabilities.canGrantAccess || grantPending}
              required
            >
              <option value="" disabled>
                Choose a role
              </option>
              {data.roles.map((role) => (
                <option value={role.id} key={role.id}>
                  {role.name}
                  {role.isPrivileged ? " — privileged" : ""}
                </option>
              ))}
            </select>
            {roleError ? (
              <small className="field-error" id="grant-role-error">
                {roleError}
              </small>
            ) : null}
          </label>

          <Button type="submit" disabled={!data.capabilities.canGrantAccess || grantPending}>
            {grantPending ? "Granting access" : "Grant access"}
          </Button>
        </form>

        {!data.capabilities.canGrantAccess ? (
          <p className="settings-panel__permission-note">
            Your current role can view users but cannot grant organization access.
          </p>
        ) : null}
        <ActionMessage state={grantState} />
      </section>

      <section className="settings-panel">
        <div className="settings-panel__heading settings-panel__heading--spread">
          <div>
            <h2>Organization members</h2>
            <p>Role and access changes take effect on the next protected request.</p>
          </div>
          <StatusBadge tone="neutral">{data.members.length} total</StatusBadge>
        </div>

        <div className="member-access-list">
          {data.members.map((member) => (
            <MemberAccessRow
              actorUserId={data.actorUserId}
              canManageRoles={data.capabilities.canManageRoles}
              canManageStatus={data.capabilities.canManageStatus}
              member={member}
              roles={data.roles}
              key={`${member.membershipId}:${member.status}:${member.roleIds.join(",")}`}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
