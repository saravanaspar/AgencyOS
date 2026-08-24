"use client";

import { useActionState, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  KeyRound,
  LockKeyhole,
  Plus,
  Save,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserRoundCog,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  changeRoleStatusAction,
  createRoleAction,
  deleteMemberOverrideAction,
  deleteRoleAction,
  saveMemberOverrideAction,
  saveRolePermissionsAction,
  updateRoleAction,
} from "@/modules/permissions/actions/role-editor";
import {
  humanizeModuleName,
  humanizePermissionKey,
  summarizePermissionKey,
} from "@/modules/permissions/permission-display";
import {
  permissionScopeDescriptions,
  permissionScopeLabels,
  permissionScopes,
  type PermissionScope,
} from "@/modules/permissions/permission-scopes";
import type { RoleEditorActionState } from "@/modules/permissions/schemas/role-editor";
import type {
  EditableRole,
  MemberPermissionOverride,
  RoleEditorData,
  RoleEditorPermission,
} from "@/modules/permissions/server/role-editor";
import { getDateTimeFormatter } from "@/lib/intl-formatters";

const initialState: RoleEditorActionState = { status: "idle" };

function ActionMessage({ state }: { state: RoleEditorActionState }) {
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

function groupPermissions(permissions: RoleEditorPermission[]) {
  const groups = new Map<string, RoleEditorPermission[]>();

  for (const permission of permissions) {
    const current = groups.get(permission.module) ?? [];
    current.push(permission);
    groups.set(permission.module, current);
  }

  return [...groups.entries()]
    .sort((left, right) => humanizeModuleName(left[0]).localeCompare(humanizeModuleName(right[0])))
    .map(
      ([moduleName, entries]) =>
        [
          moduleName,
          [...entries].sort((left, right) =>
            humanizePermissionKey(left.key).localeCompare(humanizePermissionKey(right.key)),
          ),
        ] as const,
    );
}

function matchesPermissionSearch(permission: RoleEditorPermission, searchTerm: string) {
  if (!searchTerm) return true;
  const haystack = [
    permission.key,
    permission.description,
    humanizePermissionKey(permission.key),
    summarizePermissionKey(permission.key),
    humanizeModuleName(permission.module),
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(searchTerm);
}

function createExpandedGroupState(
  permissions: RoleEditorPermission[],
  activeGrants: Record<string, PermissionScope>,
) {
  const grouped = groupPermissions(permissions);

  return Object.fromEntries(
    grouped.map(([moduleName, modulePermissions], index) => [
      moduleName,
      index === 0 || modulePermissions.some((permission) => Boolean(activeGrants[permission.id])),
    ]),
  );
}

function RoleCard({
  role,
  selected,
  onSelect,
}: {
  role: EditableRole;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`role-editor-role-card${selected ? " is-selected" : ""}`}
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${selected ? "Selected role" : "Select role"}: ${role.name}`}
    >
      <span className="role-editor-role-card__icon" aria-hidden="true">
        {role.isSystem ? <LockKeyhole size={17} /> : <KeyRound size={17} />}
      </span>
      <span className="role-editor-role-card__copy">
        <strong>{role.name}</strong>
        <small>
          {role.assignmentCount} member{role.assignmentCount === 1 ? "" : "s"} ·{" "}
          {role.permissionCount} permission{role.permissionCount === 1 ? "" : "s"}
        </small>
      </span>
      <span className="role-editor-role-card__badges">
        {role.isSystem ? <StatusBadge tone="neutral">System</StatusBadge> : null}
        {role.isPrivileged ? <StatusBadge tone="warning">Privileged</StatusBadge> : null}
        <StatusBadge tone={role.status === "active" ? "success" : "neutral"}>
          {role.status}
        </StatusBadge>
      </span>
    </button>
  );
}

function ScopeHint({ scope }: { scope: PermissionScope }) {
  return <small className="role-scope-hint">{permissionScopeDescriptions[scope]}</small>;
}

function OverrideRow({
  override,
  canManage,
}: {
  override: MemberPermissionOverride;
  canManage: boolean;
}) {
  const [state, action, pending] = useActionState(deleteMemberOverrideAction, initialState);
  return (
    <article className="permission-override-row">
      <div>
        <strong>{override.memberName}</strong>
        <small>{override.memberEmail}</small>
      </div>
      <div className="permission-override-row__permission">
        <strong>{humanizePermissionKey(override.permissionKey)}</strong>
        <code>{override.permissionKey}</code>
      </div>
      <StatusBadge tone={override.effect === "allow" ? "success" : "warning"}>
        {override.effect}
      </StatusBadge>
      <span>{override.scope ? permissionScopeLabels[override.scope] : "Inherited scope"}</span>
      <span>{override.reason}</span>
      <span>
        {override.expiresAt
          ? `Expires ${getDateTimeFormatter("en", { dateStyle: "medium" }).format(new Date(override.expiresAt))}`
          : "No expiry"}
      </span>
      {canManage ? (
        <form action={action}>
          <input type="hidden" name="membershipId" value={override.membershipId} />
          <input type="hidden" name="permissionId" value={override.permissionId} />
          <Button variant="ghost" size="sm" type="submit" disabled={pending}>
            <Trash2 size={14} aria-hidden="true" />
            {pending ? "Removing" : "Remove"}
          </Button>
        </form>
      ) : null}
      <ActionMessage state={state} />
    </article>
  );
}

export function RoleEditorPanel({ data }: { data: RoleEditorData }) {
  const initialRoleId = data.roles.find((role) => !role.isSystem)?.id ?? data.roles[0]?.id ?? "";
  const initialRole = data.roles.find((role) => role.id === initialRoleId) ?? data.roles[0];
  const [selectedRoleId, setSelectedRoleId] = useState(initialRoleId);
  const selectedRole = data.roles.find((role) => role.id === selectedRoleId) ?? data.roles[0];
  const [grants, setGrants] = useState<Record<string, PermissionScope>>(() =>
    Object.fromEntries(
      (initialRole?.grants ?? []).map((grant) => [grant.permissionId, grant.scope]),
    ),
  );
  const [permissionSearch, setPermissionSearch] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() =>
    createExpandedGroupState(
      data.permissions,
      Object.fromEntries(
        (initialRole?.grants ?? []).map((grant) => [grant.permissionId, grant.scope]),
      ),
    ),
  );
  const [overridePermissionId, setOverridePermissionId] = useState(data.permissions[0]?.id ?? "");
  const [overrideScope, setOverrideScope] = useState<PermissionScope | "">("");
  const [createState, createAction, createPending] = useActionState(createRoleAction, initialState);
  const [updateState, updateAction, updatePending] = useActionState(updateRoleAction, initialState);
  const [statusState, statusAction, statusPending] = useActionState(
    changeRoleStatusAction,
    initialState,
  );
  const [deleteState, deleteAction, deletePending] = useActionState(deleteRoleAction, initialState);
  const [permissionState, permissionAction, permissionPending] = useActionState(
    saveRolePermissionsAction,
    initialState,
  );
  const [overrideState, overrideAction, overridePending] = useActionState(
    saveMemberOverrideAction,
    initialState,
  );

  const permissionGroups = useMemo(() => groupPermissions(data.permissions), [data.permissions]);
  const selectedPermissionIds = Object.keys(grants);
  const selectedPermissions = data.permissions.filter((permission) => grants[permission.id]);
  const sensitiveCount = selectedPermissions.filter((permission) => permission.isSensitive).length;
  const grantPayload = JSON.stringify(
    selectedPermissionIds.map((permissionId) => ({ permissionId, scope: grants[permissionId] })),
  );
  const normalizedSearch = permissionSearch.trim().toLowerCase();
  const filteredPermissionGroups = useMemo(
    () =>
      permissionGroups
        .map(
          ([moduleName, permissions]) =>
            [
              moduleName,
              permissions.filter((permission) =>
                matchesPermissionSearch(permission, normalizedSearch),
              ),
            ] as const,
        )
        .filter(([, permissions]) => permissions.length > 0),
    [normalizedSearch, permissionGroups],
  );
  const overridePermission =
    data.permissions.find((permission) => permission.id === overridePermissionId) ??
    data.permissions[0];

  function togglePermission(permissionId: string, checked: boolean) {
    setGrants((current) => {
      if (!checked) {
        const next = { ...current };
        delete next[permissionId];
        return next;
      }
      return { ...current, [permissionId]: current[permissionId] ?? "organization" };
    });
  }

  return (
    <div className="role-editor">
      <section className="role-editor-summary" aria-label="Role editor summary">
        <div>
          <KeyRound size={19} aria-hidden="true" />
          <span>Organization roles</span>
          <strong>{data.roles.length}</strong>
        </div>
        <div>
          <ShieldCheck size={19} aria-hidden="true" />
          <span>Custom roles</span>
          <strong>{data.roles.filter((role) => !role.isSystem).length}</strong>
        </div>
        <div>
          <UserRoundCog size={19} aria-hidden="true" />
          <span>Active overrides</span>
          <strong>{data.overrides.length}</strong>
        </div>
      </section>

      {data.capabilities.canCreate ? (
        <section className="settings-panel role-create-panel">
          <header className="settings-panel__heading">
            <span className="settings-panel__icon">
              <Plus size={20} aria-hidden="true" />
            </span>
            <div>
              <h2>Create custom role</h2>
              <p>Custom roles start with no permissions and are never automatically privileged.</p>
            </div>
          </header>
          <form className="role-create-form" action={createAction}>
            <label className="field">
              <span>Role name</span>
              <input
                name="name"
                placeholder="Delivery coordinator"
                disabled={createPending}
                required
              />
            </label>
            <label className="field">
              <span>Description</span>
              <input
                name="description"
                placeholder="Optional purpose and boundaries"
                disabled={createPending}
              />
            </label>
            <Button type="submit" disabled={createPending}>
              <Plus size={15} aria-hidden="true" />
              {createPending ? "Creating" : "Create role"}
            </Button>
            <ActionMessage state={createState} />
          </form>
        </section>
      ) : null}

      <div className="role-editor-layout">
        <aside className="settings-panel role-editor-sidebar">
          <header>
            <h2>Roles</h2>
            <p>Select a role to inspect or edit.</p>
          </header>
          <div className="role-editor-role-list">
            {data.roles.map((role) => (
              <RoleCard
                role={role}
                selected={role.id === selectedRole?.id}
                onSelect={() => {
                  const nextGrants = Object.fromEntries(
                    role.grants.map((grant) => [grant.permissionId, grant.scope]),
                  );
                  setSelectedRoleId(role.id);
                  setGrants(nextGrants);
                  setExpandedGroups(createExpandedGroupState(data.permissions, nextGrants));
                }}
                key={role.id}
              />
            ))}
          </div>
        </aside>

        {selectedRole ? (
          <section className="settings-panel role-editor-main">
            <header className="role-editor-main__header">
              <div>
                <div className="role-editor-main__title">
                  <h2>{selectedRole.name}</h2>
                  {selectedRole.isSystem ? (
                    <StatusBadge tone="neutral">Protected system role</StatusBadge>
                  ) : null}
                </div>
                <p>{selectedRole.description || "No role description."}</p>
                <code>{selectedRole.key}</code>
              </div>
              <StatusBadge tone={selectedRole.status === "active" ? "success" : "neutral"}>
                {selectedRole.status}
              </StatusBadge>
            </header>

            {selectedRole.isSystem ? (
              <div className="role-protected-note">
                <LockKeyhole size={18} aria-hidden="true" />
                <div>
                  <strong>System role protection</strong>
                  <p>
                    System role identity and grants are migration-managed and cannot be changed
                    here.
                  </p>
                </div>
              </div>
            ) : (
              <>
                {data.capabilities.canUpdate ? (
                  <form className="role-details-form" action={updateAction} key={selectedRole.id}>
                    <input type="hidden" name="roleId" value={selectedRole.id} />
                    <label className="field">
                      <span>Role name</span>
                      <input
                        name="name"
                        defaultValue={selectedRole.name}
                        disabled={updatePending}
                        required
                      />
                    </label>
                    <label className="field">
                      <span>Description</span>
                      <input
                        name="description"
                        defaultValue={selectedRole.description ?? ""}
                        disabled={updatePending}
                      />
                    </label>
                    <Button type="submit" variant="secondary" disabled={updatePending}>
                      <Save size={15} aria-hidden="true" />
                      {updatePending ? "Saving" : "Save details"}
                    </Button>
                    <ActionMessage state={updateState} />
                  </form>
                ) : null}

                <div className="role-lifecycle-actions">
                  {data.capabilities.canUpdate ? (
                    <form action={statusAction}>
                      <input type="hidden" name="roleId" value={selectedRole.id} />
                      <input
                        type="hidden"
                        name="status"
                        value={selectedRole.status === "active" ? "inactive" : "active"}
                      />
                      <Button type="submit" variant="ghost" disabled={statusPending}>
                        {statusPending
                          ? "Updating"
                          : selectedRole.status === "active"
                            ? "Deactivate role"
                            : "Activate role"}
                      </Button>
                    </form>
                  ) : null}
                  {data.capabilities.canDelete && selectedRole.status === "inactive" ? (
                    <form
                      action={deleteAction}
                      onSubmit={(event) => {
                        if (!window.confirm(`Permanently delete ${selectedRole.name}?`)) {
                          event.preventDefault();
                        }
                      }}
                    >
                      <input type="hidden" name="roleId" value={selectedRole.id} />
                      <Button type="submit" variant="danger" disabled={deletePending}>
                        <Trash2 size={15} aria-hidden="true" />
                        {deletePending ? "Deleting" : "Delete role"}
                      </Button>
                    </form>
                  ) : null}
                  <ActionMessage state={statusState} />
                  <ActionMessage state={deleteState} />
                </div>
              </>
            )}

            {data.permissions.length > 0 ? (
              <form className="role-permission-editor" action={permissionAction}>
                <input type="hidden" name="roleId" value={selectedRole.id} />
                <input type="hidden" name="grants" value={grantPayload} />
                <div className="role-permission-preview">
                  <div>
                    <ShieldCheck size={18} aria-hidden="true" />
                    <span>Selected permissions</span>
                    <strong>{selectedPermissionIds.length}</strong>
                  </div>
                  <div>
                    <ShieldAlert size={18} aria-hidden="true" />
                    <span>Sensitive permissions</span>
                    <strong>{sensitiveCount}</strong>
                  </div>
                  <div>
                    <UserRoundCog size={18} aria-hidden="true" />
                    <span>Assigned members</span>
                    <strong>{selectedRole.assignmentCount}</strong>
                  </div>
                </div>

                <div className="role-permission-toolbar">
                  <label className="role-search-field">
                    <Search size={16} aria-hidden="true" />
                    <input
                      value={permissionSearch}
                      onChange={(event) => setPermissionSearch(event.target.value)}
                      placeholder="Search permissions, modules, or actions"
                      aria-label="Search permissions"
                    />
                  </label>
                  <p>
                    Permissions are grouped by module and shown with readable labels. Select a scope
                    for each enabled permission.
                  </p>
                </div>

                <div className="role-permission-groups role-permission-groups--improved">
                  {filteredPermissionGroups.length > 0 ? (
                    filteredPermissionGroups.map(([moduleName, permissions]) => {
                      const totalSelected = permissions.filter(
                        (permission) => grants[permission.id],
                      ).length;
                      const overallCount =
                        permissionGroups.find(([name]) => name === moduleName)?.[1].length ??
                        permissions.length;
                      const progress =
                        overallCount > 0 ? Math.round((totalSelected / overallCount) * 100) : 0;
                      const expanded = expandedGroups[moduleName] ?? false;

                      return (
                        <article className="role-permission-group" key={moduleName}>
                          <button
                            className="role-permission-group__toggle"
                            type="button"
                            onClick={() =>
                              setExpandedGroups((current) => ({
                                ...current,
                                [moduleName]: !expanded,
                              }))
                            }
                            aria-expanded={expanded}
                          >
                            <div className="role-permission-group__heading">
                              <div>
                                <h3>{humanizeModuleName(moduleName)}</h3>
                                <p>
                                  {permissions.length === overallCount
                                    ? "Showing all permissions"
                                    : `Showing ${permissions.length} filtered permissions`}
                                </p>
                              </div>
                              <div className="role-permission-group__stats">
                                <span>
                                  {totalSelected} of {overallCount} selected
                                </span>
                                {expanded ? (
                                  <ChevronUp size={16} aria-hidden="true" />
                                ) : (
                                  <ChevronDown size={16} aria-hidden="true" />
                                )}
                              </div>
                            </div>
                            <ProgressBar
                              value={progress}
                              label={`${humanizeModuleName(moduleName)} grants`}
                            />
                          </button>

                          {expanded ? (
                            <div>
                              {permissions.map((permission) => {
                                const checked = Boolean(grants[permission.id]);
                                const activeScope = grants[permission.id] ?? "organization";
                                return (
                                  <div
                                    className="role-permission-row role-permission-row--improved"
                                    key={permission.id}
                                  >
                                    <label className="role-permission-row__label">
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        disabled={
                                          selectedRole.isSystem ||
                                          !data.capabilities.canManageRoleAccess
                                        }
                                        onChange={(event) =>
                                          togglePermission(permission.id, event.target.checked)
                                        }
                                      />
                                      <span className="role-permission-row__copy">
                                        <strong>{humanizePermissionKey(permission.key)}</strong>
                                        <code>{permission.key}</code>
                                        <small>
                                          {permission.description ||
                                            summarizePermissionKey(permission.key)}
                                        </small>
                                      </span>
                                    </label>

                                    <div className="role-permission-row__meta">
                                      {permission.isSensitive ? (
                                        <StatusBadge tone="warning">Sensitive</StatusBadge>
                                      ) : (
                                        <StatusBadge tone={checked ? "success" : "neutral"}>
                                          {checked ? "Selected" : "Not selected"}
                                        </StatusBadge>
                                      )}
                                      <label className="field role-permission-row__scope">
                                        <span>Scope</span>
                                        <select
                                          aria-label={`Scope for ${permission.key}`}
                                          value={activeScope}
                                          disabled={
                                            !checked ||
                                            selectedRole.isSystem ||
                                            !data.capabilities.canManageRoleAccess
                                          }
                                          onChange={(event) =>
                                            setGrants((current) => ({
                                              ...current,
                                              [permission.id]: event.target
                                                .value as PermissionScope,
                                            }))
                                          }
                                        >
                                          {permissionScopes.map((scope) => (
                                            <option value={scope} key={scope}>
                                              {permissionScopeLabels[scope]}
                                            </option>
                                          ))}
                                        </select>
                                        {checked ? <ScopeHint scope={activeScope} /> : null}
                                      </label>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}
                        </article>
                      );
                    })
                  ) : (
                    <p className="empty-state-copy">No permissions match this search.</p>
                  )}
                </div>

                {!selectedRole.isSystem && data.capabilities.canManageRoleAccess ? (
                  <div className="role-permission-actions">
                    <p>
                      Saving replaces this custom role’s permission set. The last access
                      administrator is protected.
                    </p>
                    <Button type="submit" disabled={permissionPending}>
                      <Save size={15} aria-hidden="true" />
                      {permissionPending ? "Saving" : "Save permissions"}
                    </Button>
                  </div>
                ) : null}
                <ActionMessage state={permissionState} />
              </form>
            ) : null}
          </section>
        ) : null}
      </div>

      {data.capabilities.canManageOverrides ? (
        <section className="settings-panel permission-override-panel">
          <header className="settings-panel__heading">
            <span className="settings-panel__icon">
              <UserRoundCog size={20} aria-hidden="true" />
            </span>
            <div>
              <h2>Member permission overrides</h2>
              <p>Explicit allow or deny rules take precedence over role grants.</p>
            </div>
          </header>
          <form className="permission-override-form" action={overrideAction}>
            <label className="field permission-override-form__member">
              <span>Member</span>
              <select name="membershipId" disabled={overridePending} required>
                {data.members.map((member) => (
                  <option value={member.membershipId} key={member.membershipId}>
                    {member.displayName} — {member.email}
                  </option>
                ))}
              </select>
            </label>
            <label className="field permission-override-form__permission-field">
              <span>Permission</span>
              <select
                name="permissionId"
                value={overridePermissionId}
                disabled={overridePending}
                required
                onChange={(event) => setOverridePermissionId(event.target.value)}
              >
                {permissionGroups.map(([moduleName, permissions]) => (
                  <optgroup label={humanizeModuleName(moduleName)} key={moduleName}>
                    {permissions.map((permission) => (
                      <option value={permission.id} key={permission.id}>
                        {humanizePermissionKey(permission.key)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {overridePermission ? (
                <small className="field-hint">
                  {overridePermission.key} — {summarizePermissionKey(overridePermission.key)}
                </small>
              ) : null}
            </label>
            <label className="field permission-override-form__effect">
              <span>Effect</span>
              <select name="effect" defaultValue="deny" disabled={overridePending}>
                <option value="allow">Allow</option>
                <option value="deny">Deny</option>
              </select>
            </label>
            <label className="field permission-override-form__scope">
              <span>Scope</span>
              <select
                name="scope"
                value={overrideScope}
                disabled={overridePending}
                onChange={(event) => setOverrideScope(event.target.value as PermissionScope | "")}
              >
                <option value="">Inherited / not applicable</option>
                {permissionScopes.map((scope) => (
                  <option value={scope} key={scope}>
                    {permissionScopeLabels[scope]}
                  </option>
                ))}
              </select>
              <small className="field-hint">
                {overrideScope
                  ? permissionScopeDescriptions[overrideScope]
                  : "Leave this empty to inherit the role’s scope for the same permission."}
              </small>
            </label>
            <label className="field permission-override-form__reason">
              <span>Reason</span>
              <input
                name="reason"
                placeholder="Required business or security reason"
                disabled={overridePending}
                required
              />
            </label>
            <label className="field permission-override-form__expires">
              <span>Expires at</span>
              <input type="datetime-local" name="expiresAt" disabled={overridePending} />
            </label>
            <Button
              className="permission-override-form__submit"
              type="submit"
              disabled={overridePending}
            >
              <Save size={15} aria-hidden="true" />
              {overridePending ? "Saving" : "Save override"}
            </Button>
            <ActionMessage state={overrideState} />
          </form>

          <div className="permission-override-list">
            {data.overrides.length > 0 ? (
              data.overrides.map((override) => (
                <OverrideRow
                  override={override}
                  canManage={data.capabilities.canManageOverrides}
                  key={`${override.membershipId}:${override.permissionId}`}
                />
              ))
            ) : (
              <p className="empty-state-copy">No active member overrides.</p>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
