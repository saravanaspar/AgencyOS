"use client";

import { useActionState, useMemo, useState } from "react";
import {
  Building2,
  CheckCircle2,
  Edit3,
  Network,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  UserRoundCheck,
  UsersRound,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  assignTeamMemberAction,
  changeDepartmentStatusAction,
  changeTeamStatusAction,
  createDepartmentAction,
  createTeamAction,
  deleteDepartmentAction,
  deleteTeamAction,
  removeTeamMemberAction,
  updateDepartmentAction,
  updateMemberStructureAction,
  updateTeamAction,
} from "@/modules/organization-structure/actions/organization-structure";
import type { OrganizationStructureActionState } from "@/modules/organization-structure/schemas/organization-structure";
import type {
  OrganizationStructureData,
  StructureDepartment,
  StructureMember,
  StructureTeam,
} from "@/modules/organization-structure/server/organization-structure";

const initialState: OrganizationStructureActionState = { status: "idle" };

function ActionMessage({ state }: { state: OrganizationStructureActionState }) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <p
      className={`inline-action-message${state.status === "success" ? " is-success" : ""}`}
      role={state.status === "error" ? "alert" : "status"}
    >
      {state.status === "success" ? <CheckCircle2 size={14} aria-hidden="true" /> : null}
      {state.message}
    </p>
  );
}

function DepartmentCard({
  department,
  canUpdate,
  canDeactivate,
}: {
  department: StructureDepartment;
  canUpdate: boolean;
  canDeactivate: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [updateState, updateAction, updatePending] = useActionState(
    updateDepartmentAction,
    initialState,
  );
  const [statusState, statusAction, statusPending] = useActionState(
    changeDepartmentStatusAction,
    initialState,
  );
  const [deleteState, deleteAction, deletePending] = useActionState(
    deleteDepartmentAction,
    initialState,
  );

  return (
    <article className="structure-entity-card">
      <header className="structure-entity-card__header">
        <div>
          <div className="structure-entity-card__title">
            <strong>{department.name}</strong>
            {department.code ? <code>{department.code}</code> : null}
          </div>
          <span>{department.activeMemberCount} active members</span>
        </div>
        <StatusBadge tone={department.status === "active" ? "success" : "neutral"}>
          {department.status}
        </StatusBadge>
      </header>

      {editing ? (
        <form className="structure-inline-form" action={updateAction}>
          <input type="hidden" name="departmentId" value={department.id} />
          <label className="field">
            <span>Name</span>
            <input name="name" defaultValue={department.name} disabled={updatePending} required />
          </label>
          <label className="field">
            <span>Code</span>
            <input name="code" defaultValue={department.code ?? ""} disabled={updatePending} />
          </label>
          <div className="structure-inline-form__actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditing(false)}
              disabled={updatePending}
            >
              <X size={14} aria-hidden="true" /> Cancel
            </Button>
            <Button type="submit" size="sm" disabled={updatePending}>
              <Save size={14} aria-hidden="true" /> {updatePending ? "Saving" : "Save"}
            </Button>
          </div>
          <ActionMessage state={updateState} />
        </form>
      ) : (
        <div className="structure-entity-card__actions">
          {canUpdate ? (
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <Edit3 size={14} aria-hidden="true" /> Edit
            </Button>
          ) : null}
          {(department.status === "active" ? canDeactivate : canUpdate) ? (
            <form action={statusAction}>
              <input type="hidden" name="departmentId" value={department.id} />
              <input
                type="hidden"
                name="status"
                value={department.status === "active" ? "inactive" : "active"}
              />
              <Button
                variant={department.status === "active" ? "ghost" : "secondary"}
                size="sm"
                type="submit"
                disabled={statusPending}
              >
                {statusPending
                  ? "Updating"
                  : department.status === "active"
                    ? "Deactivate"
                    : "Activate"}
              </Button>
            </form>
          ) : null}
          {department.status === "inactive" && canDeactivate ? (
            <form
              action={deleteAction}
              onSubmit={(event) => {
                if (!window.confirm(`Permanently delete ${department.name}?`)) {
                  event.preventDefault();
                }
              }}
            >
              <input type="hidden" name="departmentId" value={department.id} />
              <Button variant="danger" size="sm" type="submit" disabled={deletePending}>
                <Trash2 size={14} aria-hidden="true" />
                {deletePending ? "Deleting" : "Delete"}
              </Button>
            </form>
          ) : null}
        </div>
      )}
      <ActionMessage state={statusState} />
      <ActionMessage state={deleteState} />
    </article>
  );
}

function TeamCard({
  team,
  canUpdate,
  canDeactivate,
  canAssign,
}: {
  team: StructureTeam;
  canUpdate: boolean;
  canDeactivate: boolean;
  canAssign: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [updateState, updateAction, updatePending] = useActionState(updateTeamAction, initialState);
  const [statusState, statusAction, statusPending] = useActionState(
    changeTeamStatusAction,
    initialState,
  );
  const [deleteState, deleteAction, deletePending] = useActionState(deleteTeamAction, initialState);

  return (
    <article className="structure-entity-card">
      <header className="structure-entity-card__header">
        <div>
          <div className="structure-entity-card__title">
            <strong>{team.name}</strong>
          </div>
          <span>{team.activeMemberCount} active members</span>
        </div>
        <StatusBadge tone={team.status === "active" ? "success" : "neutral"}>
          {team.status}
        </StatusBadge>
      </header>

      {team.description ? (
        <p className="structure-entity-card__description">{team.description}</p>
      ) : null}

      {editing ? (
        <form className="structure-inline-form" action={updateAction}>
          <input type="hidden" name="teamId" value={team.id} />
          <label className="field">
            <span>Name</span>
            <input name="name" defaultValue={team.name} disabled={updatePending} required />
          </label>
          <label className="field">
            <span>Description</span>
            <textarea
              name="description"
              defaultValue={team.description ?? ""}
              disabled={updatePending}
            />
          </label>
          <div className="structure-inline-form__actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditing(false)}
              disabled={updatePending}
            >
              <X size={14} aria-hidden="true" /> Cancel
            </Button>
            <Button type="submit" size="sm" disabled={updatePending}>
              <Save size={14} aria-hidden="true" /> {updatePending ? "Saving" : "Save"}
            </Button>
          </div>
          <ActionMessage state={updateState} />
        </form>
      ) : (
        <div className="structure-entity-card__actions">
          {canUpdate ? (
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <Edit3 size={14} aria-hidden="true" /> Edit
            </Button>
          ) : null}
          {(team.status === "active" ? canDeactivate : canUpdate) ? (
            <form action={statusAction}>
              <input type="hidden" name="teamId" value={team.id} />
              <input
                type="hidden"
                name="status"
                value={team.status === "active" ? "inactive" : "active"}
              />
              <Button
                variant={team.status === "active" ? "ghost" : "secondary"}
                size="sm"
                type="submit"
                disabled={statusPending}
              >
                {statusPending ? "Updating" : team.status === "active" ? "Deactivate" : "Activate"}
              </Button>
            </form>
          ) : null}
          {team.status === "inactive" && canDeactivate ? (
            <form
              action={deleteAction}
              onSubmit={(event) => {
                if (!window.confirm(`Permanently delete ${team.name}?`)) {
                  event.preventDefault();
                }
              }}
            >
              <input type="hidden" name="teamId" value={team.id} />
              <Button variant="danger" size="sm" type="submit" disabled={deletePending}>
                <Trash2 size={14} aria-hidden="true" />
                {deletePending ? "Deleting" : "Delete"}
              </Button>
            </form>
          ) : null}
        </div>
      )}
      <ActionMessage state={statusState} />
      <ActionMessage state={deleteState} />

      {team.members.length > 0 ? (
        <div className="team-member-list">
          {team.members.map((member) => (
            <TeamMemberRow
              key={member.membershipId}
              teamId={team.id}
              member={member}
              canRemove={canAssign}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function TeamMemberRow({
  teamId,
  member,
  canRemove,
}: {
  teamId: string;
  member: StructureTeam["members"][number];
  canRemove: boolean;
}) {
  const [state, action, pending] = useActionState(removeTeamMemberAction, initialState);
  return (
    <div className="team-member-row">
      <span className="avatar" aria-hidden="true">
        {member.displayName.slice(0, 2).toUpperCase()}
      </span>
      <div>
        <strong>{member.displayName}</strong>
        <small>{member.email}</small>
      </div>
      {member.isLead ? <StatusBadge tone="info">Lead</StatusBadge> : null}
      {canRemove ? (
        <form action={action}>
          <input type="hidden" name="teamId" value={teamId} />
          <input type="hidden" name="membershipId" value={member.membershipId} />
          <Button variant="ghost" size="sm" type="submit" disabled={pending}>
            Remove
          </Button>
        </form>
      ) : null}
      <ActionMessage state={state} />
    </div>
  );
}

function MemberStructureRow({
  member,
  members,
  departments,
}: {
  member: StructureMember;
  members: StructureMember[];
  departments: StructureDepartment[];
}) {
  const [state, action, pending] = useActionState(updateMemberStructureAction, initialState);
  const managers = members.filter(
    (candidate) => candidate.status === "active" && candidate.membershipId !== member.membershipId,
  );

  return (
    <article className="member-structure-row">
      <div className="member-structure-row__identity">
        <span className="avatar" aria-hidden="true">
          {member.displayName.slice(0, 2).toUpperCase()}
        </span>
        <div>
          <strong>{member.displayName}</strong>
          <small>{member.email}</small>
        </div>
      </div>
      <form action={action} className="member-structure-row__form">
        <input type="hidden" name="membershipId" value={member.membershipId} />
        <label className="field">
          <span>Department</span>
          <select name="departmentId" defaultValue={member.departmentId ?? ""} disabled={pending}>
            <option value="">Unassigned</option>
            {departments
              .filter((department) => department.status === "active")
              .map((department) => (
                <option value={department.id} key={department.id}>
                  {department.name}
                  {department.code ? ` (${department.code})` : ""}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          <span>Reports to</span>
          <select
            name="managerMembershipId"
            defaultValue={member.managerMembershipId ?? ""}
            disabled={pending}
          >
            <option value="">No manager</option>
            {managers.map((manager) => (
              <option value={manager.membershipId} key={manager.membershipId}>
                {manager.displayName}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving" : "Save"}
        </Button>
      </form>
      <ActionMessage state={state} />
    </article>
  );
}

export function OrganizationStructurePanel({ data }: { data: OrganizationStructureData }) {
  const [departmentState, departmentAction, departmentPending] = useActionState(
    createDepartmentAction,
    initialState,
  );
  const [teamState, teamAction, teamPending] = useActionState(createTeamAction, initialState);
  const [assignmentState, assignmentAction, assignmentPending] = useActionState(
    assignTeamMemberAction,
    initialState,
  );
  const activeMembers = useMemo(
    () => data.members.filter((member) => member.status === "active"),
    [data.members],
  );
  const activeTeams = data.teams.filter((team) => team.status === "active");

  return (
    <div className="organization-structure">
      <section className="structure-summary" aria-label="Organization structure summary">
        <div>
          <Building2 size={18} aria-hidden="true" />
          <span>Active departments</span>
          <strong>{data.departments.filter((item) => item.status === "active").length}</strong>
        </div>
        <div>
          <UsersRound size={18} aria-hidden="true" />
          <span>Active teams</span>
          <strong>{activeTeams.length}</strong>
        </div>
        <div>
          <UserRoundCheck size={18} aria-hidden="true" />
          <span>Active members</span>
          <strong>{activeMembers.length}</strong>
        </div>
      </section>

      <div className="structure-directory-grid">
        {data.capabilities.canViewDepartments ? (
          <section className="settings-panel structure-directory">
            <header className="structure-directory__header">
              <span className="settings-panel__icon">
                <Building2 size={20} aria-hidden="true" />
              </span>
              <div>
                <h2>Departments</h2>
                <p>Stable reporting units used across people and operations.</p>
              </div>
            </header>
            {data.capabilities.canCreateDepartments ? (
              <form className="structure-create-form" action={departmentAction}>
                <label className="field">
                  <span>Department name</span>
                  <input
                    name="name"
                    placeholder="Client Delivery"
                    disabled={departmentPending}
                    required
                  />
                </label>
                <label className="field">
                  <span>Code</span>
                  <input name="code" placeholder="DELIVERY" disabled={departmentPending} />
                </label>
                <Button type="submit" disabled={departmentPending}>
                  <Plus size={15} aria-hidden="true" />
                  {departmentPending ? "Creating" : "Create"}
                </Button>
                <ActionMessage state={departmentState} />
              </form>
            ) : null}
            <div className="structure-entity-list">
              {data.departments.length ? (
                data.departments.map((department) => (
                  <DepartmentCard
                    key={department.id}
                    department={department}
                    canUpdate={data.capabilities.canUpdateDepartments}
                    canDeactivate={data.capabilities.canDeactivateDepartments}
                  />
                ))
              ) : (
                <p className="empty-state-copy">No departments have been created.</p>
              )}
            </div>
          </section>
        ) : null}

        {data.capabilities.canViewTeams ? (
          <section className="settings-panel structure-directory">
            <header className="structure-directory__header">
              <span className="settings-panel__icon">
                <Network size={20} aria-hidden="true" />
              </span>
              <div>
                <h2>Teams</h2>
                <p>Cross-functional groups with explicit members and leads.</p>
              </div>
            </header>
            {data.capabilities.canCreateTeams ? (
              <form className="structure-create-form" action={teamAction}>
                <label className="field">
                  <span>Team name</span>
                  <input name="name" placeholder="Website Launch" disabled={teamPending} required />
                </label>
                <label className="field">
                  <span>Description</span>
                  <input name="description" placeholder="Optional purpose" disabled={teamPending} />
                </label>
                <Button type="submit" disabled={teamPending}>
                  <Plus size={15} aria-hidden="true" />
                  {teamPending ? "Creating" : "Create"}
                </Button>
                <ActionMessage state={teamState} />
              </form>
            ) : null}
            <div className="structure-entity-list">
              {data.teams.length ? (
                data.teams.map((team) => (
                  <TeamCard
                    key={team.id}
                    team={team}
                    canUpdate={data.capabilities.canUpdateTeams}
                    canDeactivate={data.capabilities.canDeactivateTeams}
                    canAssign={data.capabilities.canAssignTeams}
                  />
                ))
              ) : (
                <p className="empty-state-copy">No teams have been created.</p>
              )}
            </div>
          </section>
        ) : null}
      </div>

      {data.capabilities.canAssignTeams && activeTeams.length > 0 && activeMembers.length > 0 ? (
        <section className="settings-panel structure-assignment-panel">
          <header className="structure-directory__header">
            <span className="settings-panel__icon">
              <ShieldCheck size={20} aria-hidden="true" />
            </span>
            <div>
              <h2>Team assignment</h2>
              <p>Add an active member to an active team and optionally designate them as a lead.</p>
            </div>
          </header>
          <form className="team-assignment-form" action={assignmentAction}>
            <label className="field">
              <span>Team</span>
              <select name="teamId" disabled={assignmentPending}>
                {activeTeams.map((team) => (
                  <option value={team.id} key={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Member</span>
              <select name="membershipId" disabled={assignmentPending}>
                {activeMembers.map((member) => (
                  <option value={member.membershipId} key={member.membershipId}>
                    {member.displayName} — {member.email}
                  </option>
                ))}
              </select>
            </label>
            <label className="field team-lead-field">
              <span>Assignment type</span>
              <span className="checkbox-field">
                <input type="checkbox" name="isLead" disabled={assignmentPending} />
                <span>Team lead</span>
              </span>
            </label>
            <Button type="submit" disabled={assignmentPending}>
              {assignmentPending ? "Saving" : "Save assignment"}
            </Button>
            <ActionMessage state={assignmentState} />
          </form>
        </section>
      ) : null}

      {data.capabilities.canManageMemberStructure ? (
        <section className="settings-panel member-structure-panel">
          <header className="structure-directory__header">
            <span className="settings-panel__icon">
              <UsersRound size={20} aria-hidden="true" />
            </span>
            <div>
              <h2>Reporting structure</h2>
              <p>Assign active members to departments and define a valid manager relationship.</p>
            </div>
          </header>
          <div className="member-structure-list">
            {activeMembers.map((member) => (
              <MemberStructureRow
                key={member.membershipId}
                member={member}
                members={activeMembers}
                departments={data.departments}
              />
            ))}
          </div>
        </section>
      ) : data.capabilities.canViewDepartments || data.capabilities.canViewTeams ? (
        <p className="structure-read-only-note">
          You can view organization structure. Member identities and assignments require
          user-directory permission.
        </p>
      ) : null}
    </div>
  );
}
