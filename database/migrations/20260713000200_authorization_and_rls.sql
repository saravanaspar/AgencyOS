-- AgencyOS permission catalogue, default role templates, authorization helpers,
-- tenant RLS policies, and service-only organization bootstrap.

set lock_timeout = '10s';
set statement_timeout = '120s';

insert into public.permissions (module, resource, action, description, is_sensitive)
values
  ('dashboard', 'workspace', 'view', 'View the role-aware AgencyOS workspace dashboard.', false),
  ('settings', 'organization', 'view', 'View organization profile and operational settings.', false),
  ('settings', 'organization', 'update', 'Update organization profile and operational settings.', true),
  ('settings', 'organization', 'manage_settings', 'Manage organization-wide feature and policy settings.', true),
  ('settings', 'organization', 'export', 'Export organization configuration and organization-owned data.', true),
  ('settings', 'user', 'view', 'View users and memberships in the organization.', false),
  ('settings', 'user', 'create', 'Invite or create an organization membership.', true),
  ('settings', 'user', 'update', 'Update organization membership attributes and status.', true),
  ('settings', 'user', 'delete', 'Deactivate or remove an organization membership where permitted.', true),
  ('settings', 'user', 'manage_access', 'Manage membership access, assignments, and security actions.', true),
  ('settings', 'role', 'view', 'View organization roles and their assignments.', false),
  ('settings', 'role', 'create', 'Create organization roles.', true),
  ('settings', 'role', 'update', 'Update organization roles.', true),
  ('settings', 'role', 'delete', 'Delete non-system organization roles.', true),
  ('settings', 'role', 'manage_access', 'Assign roles and manage role permissions.', true),
  ('settings', 'permission', 'view', 'View the permission catalogue and effective grants.', true),
  ('settings', 'permission', 'manage_access', 'Manage permission grants and explicit overrides.', true),
  ('settings', 'department', 'view', 'View organization departments.', false),
  ('settings', 'department', 'create', 'Create organization departments.', false),
  ('settings', 'department', 'update', 'Update organization departments.', false),
  ('settings', 'department', 'delete', 'Deactivate or delete organization departments.', true),
  ('settings', 'team', 'view', 'View organization teams.', false),
  ('settings', 'team', 'create', 'Create organization teams.', false),
  ('settings', 'team', 'update', 'Update organization teams.', false),
  ('settings', 'team', 'delete', 'Deactivate or delete organization teams.', true),
  ('settings', 'team', 'assign', 'Assign memberships to organization teams.', true),
  ('settings', 'audit', 'view', 'View organization audit events.', true),
  ('settings', 'audit', 'export', 'Export organization audit events.', true),
  ('settings', 'integration', 'view', 'View configured infrastructure integrations.', true),
  ('settings', 'integration', 'manage_settings', 'Manage infrastructure integration configuration.', true),
  ('settings', 'security', 'view', 'View organization security status and session metadata.', true),
  ('settings', 'security', 'manage_settings', 'Manage organization authentication and security policy.', true),
  ('settings', 'security', 'revoke', 'Revoke user sessions and emergency-lock accounts.', true),
  ('settings', 'security', 'reset_mfa', 'Reset MFA for an authorized membership.', true),
  ('notifications', 'notification', 'view', 'View notifications addressed to the current user.', false),
  ('notifications', 'notification', 'update', 'Mark notifications read or update delivery state.', false),
  ('notifications', 'preference', 'manage_settings', 'Manage personal notification preferences.', false),
  ('approvals', 'request', 'view', 'View approval requests within the granted scope.', true),
  ('approvals', 'request', 'create', 'Submit records for approval.', true),
  ('approvals', 'request', 'approve', 'Approve an assigned approval step.', true),
  ('approvals', 'request', 'reject', 'Reject or return an assigned approval step.', true)
on conflict (module, resource, action) do update
set
  description = excluded.description,
  is_sensitive = excluded.is_sensitive;

insert into public.role_templates (key, name, description, is_privileged, sort_order)
values
  ('owner', 'Owner', 'Full organization authority subject to separation-of-duty controls.', true, 10),
  ('system_administrator', 'System Administrator', 'Manages platform settings, users, roles, security, audit, and integrations without automatic finance or HR-sensitive access.', true, 20),
  ('operations_administrator', 'Operations Administrator', 'Manages agency operations, teams, users, and shared workflows.', true, 30),
  ('finance_manager', 'Finance Manager', 'Manages finance operations and approvals.', true, 40),
  ('accountant', 'Accountant', 'Processes scoped finance records and reports.', false, 50),
  ('hr_manager', 'HR Manager', 'Manages employees, HR records, and HR approvals.', true, 60),
  ('project_manager', 'Project Manager', 'Manages assigned projects, delivery teams, and project reporting.', false, 70),
  ('team_lead', 'Team Lead', 'Manages assigned team work and scoped employee visibility.', false, 80),
  ('sales_manager', 'Sales Manager', 'Manages CRM records, pipeline, and sales reporting.', false, 90),
  ('sales_executive', 'Sales Executive', 'Works with assigned leads, companies, contacts, and activities.', false, 100),
  ('support_manager', 'Support Manager', 'Manages support queues, agents, and service reporting.', false, 110),
  ('support_agent', 'Support Agent', 'Works assigned support tickets and customer replies.', false, 120),
  ('legal_manager', 'Legal Manager', 'Manages legal records, approvals, and restricted legal access.', true, 130),
  ('auditor', 'Auditor', 'Read-only access to explicitly granted records and audit evidence.', true, 140),
  ('employee', 'Employee', 'Standard employee self-service and assigned-work access.', false, 150)
on conflict (key) do update
set
  name = excluded.name,
  description = excluded.description,
  is_privileged = excluded.is_privileged,
  sort_order = excluded.sort_order;

-- Owner receives every registered permission. Future permission migrations should
-- also insert the owner mapping for newly added permissions.
insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'owner', id, 'organization'
from public.permissions
on conflict (role_template_key, permission_id) do update
set scope = excluded.scope;

-- System Administrator receives the platform administration catalogue only.
insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'system_administrator', id, 'organization'
from public.permissions
where module in ('dashboard', 'settings', 'notifications')
   or key = 'approvals.request.view'
on conflict (role_template_key, permission_id) do update
set scope = excluded.scope;

-- Operations Administrator can operate the foundation but cannot export audit
-- history or manage organization security policy by default.
insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'operations_administrator', id, 'organization'
from public.permissions
where key in (
  'dashboard.workspace.view',
  'settings.organization.view',
  'settings.organization.update',
  'settings.user.view',
  'settings.user.create',
  'settings.user.update',
  'settings.user.manage_access',
  'settings.role.view',
  'settings.department.view',
  'settings.department.create',
  'settings.department.update',
  'settings.team.view',
  'settings.team.create',
  'settings.team.update',
  'settings.team.assign',
  'settings.audit.view',
  'notifications.notification.view',
  'notifications.notification.update',
  'notifications.preference.manage_settings',
  'approvals.request.view',
  'approvals.request.create',
  'approvals.request.approve',
  'approvals.request.reject'
)
on conflict (role_template_key, permission_id) do update
set scope = excluded.scope;

-- Auditor receives read-only foundation and audit export grants.
insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'auditor', id, 'organization'
from public.permissions
where key in (
  'dashboard.workspace.view',
  'settings.organization.view',
  'settings.user.view',
  'settings.role.view',
  'settings.permission.view',
  'settings.department.view',
  'settings.team.view',
  'settings.audit.view',
  'settings.audit.export',
  'approvals.request.view'
)
on conflict (role_template_key, permission_id) do update
set scope = excluded.scope;

-- Every normal role starts with dashboard, organization-directory, and personal
-- notification access. Module migrations will add domain-specific permissions.
insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'organization'
from public.role_templates as role_template
cross join public.permissions as permission
where role_template.key in (
  'finance_manager',
  'accountant',
  'hr_manager',
  'project_manager',
  'team_lead',
  'sales_manager',
  'sales_executive',
  'support_manager',
  'support_agent',
  'legal_manager',
  'employee'
)
and permission.key in (
  'dashboard.workspace.view',
  'settings.organization.view',
  'settings.department.view',
  'settings.team.view',
  'notifications.notification.view',
  'notifications.notification.update',
  'notifications.preference.manage_settings'
)
on conflict (role_template_key, permission_id) do update
set scope = excluded.scope;

create or replace function private.current_membership_id(p_organization_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select membership.id
  from public.memberships as membership
  where membership.organization_id = p_organization_id
    and membership.user_id = (select auth.uid())
    and membership.status = 'active'
  limit 1
$$;

create or replace function private.is_active_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships as membership
    join public.organizations as organization
      on organization.id = membership.organization_id
    where membership.organization_id = p_organization_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and organization.status = 'active'
  )
$$;

create or replace function private.owns_membership(p_membership_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships as membership
    where membership.id = p_membership_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
  )
$$;

create or replace function private.shares_active_organization(p_other_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships as mine
    join public.memberships as theirs
      on theirs.organization_id = mine.organization_id
    join public.organizations as organization
      on organization.id = mine.organization_id
    where mine.user_id = (select auth.uid())
      and mine.status = 'active'
      and theirs.user_id = p_other_user_id
      and theirs.status = 'active'
      and organization.status = 'active'
  )
$$;

create or replace function private.is_role_assigned_to_current_user(p_role_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.membership_roles as assignment
    join public.memberships as membership
      on membership.id = assignment.membership_id
    where assignment.role_id = p_role_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
  )
$$;

create or replace function private.has_permission(
  p_organization_id uuid,
  p_permission_key text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_membership_id uuid;
begin
  select membership.id
  into v_membership_id
  from public.memberships as membership
  join public.organizations as organization
    on organization.id = membership.organization_id
  where membership.organization_id = p_organization_id
    and membership.user_id = (select auth.uid())
    and membership.status = 'active'
    and organization.status = 'active'
  limit 1;

  if v_membership_id is null then
    return false;
  end if;

  if exists (
    select 1
    from public.membership_permission_overrides as override_grant
    join public.permissions as permission
      on permission.id = override_grant.permission_id
    where override_grant.membership_id = v_membership_id
      and permission.key = p_permission_key
      and override_grant.effect = 'deny'
      and (override_grant.expires_at is null or override_grant.expires_at > now())
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.membership_permission_overrides as override_grant
    join public.permissions as permission
      on permission.id = override_grant.permission_id
    where override_grant.membership_id = v_membership_id
      and permission.key = p_permission_key
      and override_grant.effect = 'allow'
      and (override_grant.expires_at is null or override_grant.expires_at > now())
  ) then
    return true;
  end if;

  return exists (
    select 1
    from public.membership_roles as assignment
    join public.roles as role
      on role.id = assignment.role_id
     and role.organization_id = p_organization_id
     and role.status = 'active'
    join public.role_permissions as role_permission
      on role_permission.role_id = role.id
    join public.permissions as permission
      on permission.id = role_permission.permission_id
    where assignment.membership_id = v_membership_id
      and permission.key = p_permission_key
  );
end;
$$;

create or replace function private.bootstrap_organization(
  p_user_id uuid,
  p_legal_name text,
  p_slug text,
  p_country_code text default null,
  p_timezone text default 'UTC',
  p_default_currency text default 'USD'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_membership_id uuid;
  v_owner_role_id uuid;
begin
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'User does not exist';
  end if;

  insert into public.profiles (id)
  values (p_user_id)
  on conflict (id) do nothing;

  insert into public.organizations (
    slug,
    legal_name,
    country_code,
    timezone,
    default_currency,
    created_by
  )
  values (
    lower(btrim(p_slug)),
    btrim(p_legal_name),
    case when p_country_code is null then null else upper(btrim(p_country_code)) end,
    coalesce(nullif(btrim(p_timezone), ''), 'UTC'),
    upper(btrim(p_default_currency)),
    p_user_id
  )
  returning id into v_organization_id;

  insert into public.memberships (
    organization_id,
    user_id,
    status,
    invitation_accepted_at,
    activated_at,
    invited_by
  )
  values (
    v_organization_id,
    p_user_id,
    'active',
    now(),
    now(),
    p_user_id
  )
  returning id into v_membership_id;

  insert into public.user_preferences (membership_id)
  values (v_membership_id);

  insert into public.roles (
    organization_id,
    template_key,
    key,
    name,
    description,
    is_system,
    is_privileged,
    created_by
  )
  select
    v_organization_id,
    template.key,
    template.key,
    template.name,
    template.description,
    true,
    template.is_privileged,
    p_user_id
  from public.role_templates as template;

  insert into public.role_permissions (
    role_id,
    permission_id,
    scope,
    conditions,
    granted_by
  )
  select
    role.id,
    template_permission.permission_id,
    template_permission.scope,
    template_permission.conditions,
    p_user_id
  from public.roles as role
  join public.role_template_permissions as template_permission
    on template_permission.role_template_key = role.template_key
  where role.organization_id = v_organization_id;

  select role.id
  into v_owner_role_id
  from public.roles as role
  where role.organization_id = v_organization_id
    and role.key = 'owner';

  insert into public.membership_roles (membership_id, role_id, assigned_by)
  values (v_membership_id, v_owner_role_id, p_user_id);

  insert into public.audit_events (
    organization_id,
    actor_user_id,
    actor_type,
    action,
    entity_type,
    entity_id,
    source,
    after_state
  )
  values (
    v_organization_id,
    p_user_id,
    'user',
    'organization.created',
    'organization',
    v_organization_id::text,
    'system',
    jsonb_build_object(
      'id', v_organization_id,
      'slug', lower(btrim(p_slug)),
      'legal_name', btrim(p_legal_name)
    )
  );

  return v_organization_id;
end;
$$;

revoke all on function private.set_updated_at() from public, anon, authenticated;
revoke all on function private.prevent_audit_event_mutation() from public, anon, authenticated;
revoke all on function private.handle_new_user() from public, anon, authenticated;
revoke all on function private.bootstrap_organization(uuid, text, text, text, text, text) from public, anon, authenticated;

revoke all on function private.current_membership_id(uuid) from public, anon;
revoke all on function private.is_active_member(uuid) from public, anon;
revoke all on function private.owns_membership(uuid) from public, anon;
revoke all on function private.shares_active_organization(uuid) from public, anon;
revoke all on function private.is_role_assigned_to_current_user(uuid) from public, anon;
revoke all on function private.has_permission(uuid, text) from public, anon;

grant usage on schema private to authenticated, service_role;
grant execute on function private.current_membership_id(uuid) to authenticated, service_role;
grant execute on function private.is_active_member(uuid) to authenticated, service_role;
grant execute on function private.owns_membership(uuid) to authenticated, service_role;
grant execute on function private.shares_active_organization(uuid) to authenticated, service_role;
grant execute on function private.is_role_assigned_to_current_user(uuid) to authenticated, service_role;
grant execute on function private.has_permission(uuid, text) to authenticated, service_role;
grant execute on function private.bootstrap_organization(uuid, text, text, text, text, text) to service_role;

revoke all on public.organizations from anon;
revoke all on public.profiles from anon;
revoke all on public.departments from anon;
revoke all on public.memberships from anon;
revoke all on public.teams from anon;
revoke all on public.team_members from anon;
revoke all on public.permissions from anon;
revoke all on public.role_templates from anon;
revoke all on public.roles from anon;
revoke all on public.role_permissions from anon;
revoke all on public.role_template_permissions from anon;
revoke all on public.membership_roles from anon;
revoke all on public.membership_permission_overrides from anon;
revoke all on public.organization_invitations from anon;
revoke all on public.user_preferences from anon;
revoke all on public.audit_events from anon;

-- Explicit table grants match the new Supabase default where new tables are not
-- automatically exposed to Data API roles.
grant select, update on public.profiles to authenticated;
grant select, update on public.organizations to authenticated;
grant select, insert, update, delete on public.departments to authenticated;
grant select, insert, update, delete on public.memberships to authenticated;
grant select, insert, update, delete on public.teams to authenticated;
grant select, insert, update, delete on public.team_members to authenticated;
grant select on public.permissions to authenticated;
grant select on public.role_templates to authenticated;
grant select, insert, update, delete on public.roles to authenticated;
grant select, insert, update, delete on public.role_permissions to authenticated;
grant select on public.role_template_permissions to authenticated;
grant select, insert, delete on public.membership_roles to authenticated;
grant select, insert, update, delete on public.membership_permission_overrides to authenticated;
grant select, insert, update, delete on public.organization_invitations to authenticated;
grant select, insert, update on public.user_preferences to authenticated;
grant select on public.audit_events to authenticated;

grant all on public.organizations to service_role;
grant all on public.profiles to service_role;
grant all on public.departments to service_role;
grant all on public.memberships to service_role;
grant all on public.teams to service_role;
grant all on public.team_members to service_role;
grant all on public.permissions to service_role;
grant all on public.role_templates to service_role;
grant all on public.roles to service_role;
grant all on public.role_permissions to service_role;
grant all on public.role_template_permissions to service_role;
grant all on public.membership_roles to service_role;
grant all on public.membership_permission_overrides to service_role;
grant all on public.organization_invitations to service_role;
grant all on public.user_preferences to service_role;
grant all on public.audit_events to service_role;
grant usage, select on sequence public.audit_events_id_seq to service_role;

create policy organizations_select_member
on public.organizations
for select
to authenticated
using ((select private.is_active_member(id)));

create policy organizations_update_authorized
on public.organizations
for update
to authenticated
using ((select private.has_permission(id, 'settings.organization.update')))
with check ((select private.has_permission(id, 'settings.organization.update')));

create policy profiles_select_organization_directory
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or (select private.shares_active_organization(id))
);

create policy profiles_update_self
on public.profiles
for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy departments_select_member
on public.departments
for select
to authenticated
using ((select private.is_active_member(organization_id)));

create policy departments_insert_authorized
on public.departments
for insert
to authenticated
with check ((select private.has_permission(organization_id, 'settings.department.create')));

create policy departments_update_authorized
on public.departments
for update
to authenticated
using ((select private.has_permission(organization_id, 'settings.department.update')))
with check ((select private.has_permission(organization_id, 'settings.department.update')));

create policy departments_delete_authorized
on public.departments
for delete
to authenticated
using ((select private.has_permission(organization_id, 'settings.department.delete')));

create policy memberships_select_self_or_authorized
on public.memberships
for select
to authenticated
using (
  user_id = (select auth.uid())
  or (select private.has_permission(organization_id, 'settings.user.view'))
);

create policy memberships_insert_authorized
on public.memberships
for insert
to authenticated
with check ((select private.has_permission(organization_id, 'settings.user.create')));

create policy memberships_update_authorized
on public.memberships
for update
to authenticated
using ((select private.has_permission(organization_id, 'settings.user.update')))
with check ((select private.has_permission(organization_id, 'settings.user.update')));

create policy memberships_delete_authorized
on public.memberships
for delete
to authenticated
using ((select private.has_permission(organization_id, 'settings.user.delete')));

create policy teams_select_member
on public.teams
for select
to authenticated
using ((select private.is_active_member(organization_id)));

create policy teams_insert_authorized
on public.teams
for insert
to authenticated
with check ((select private.has_permission(organization_id, 'settings.team.create')));

create policy teams_update_authorized
on public.teams
for update
to authenticated
using ((select private.has_permission(organization_id, 'settings.team.update')))
with check ((select private.has_permission(organization_id, 'settings.team.update')));

create policy teams_delete_authorized
on public.teams
for delete
to authenticated
using ((select private.has_permission(organization_id, 'settings.team.delete')));

create policy team_members_select_member
on public.team_members
for select
to authenticated
using (
  exists (
    select 1
    from public.teams as team
    where team.id = team_id
      and (select private.is_active_member(team.organization_id))
  )
);

create policy team_members_insert_authorized
on public.team_members
for insert
to authenticated
with check (
  exists (
    select 1
    from public.teams as team
    where team.id = team_id
      and (select private.has_permission(team.organization_id, 'settings.team.assign'))
  )
);

create policy team_members_update_authorized
on public.team_members
for update
to authenticated
using (
  exists (
    select 1
    from public.teams as team
    where team.id = team_id
      and (select private.has_permission(team.organization_id, 'settings.team.assign'))
  )
)
with check (
  exists (
    select 1
    from public.teams as team
    where team.id = team_id
      and (select private.has_permission(team.organization_id, 'settings.team.assign'))
  )
);

create policy team_members_delete_authorized
on public.team_members
for delete
to authenticated
using (
  exists (
    select 1
    from public.teams as team
    where team.id = team_id
      and (select private.has_permission(team.organization_id, 'settings.team.assign'))
  )
);

create policy permissions_select_authenticated
on public.permissions
for select
to authenticated
using (true);

create policy role_templates_select_authenticated
on public.role_templates
for select
to authenticated
using (true);

create policy role_template_permissions_select_authenticated
on public.role_template_permissions
for select
to authenticated
using (true);

create policy roles_select_member
on public.roles
for select
to authenticated
using ((select private.is_active_member(organization_id)));

create policy roles_insert_authorized
on public.roles
for insert
to authenticated
with check ((select private.has_permission(organization_id, 'settings.role.create')));

create policy roles_update_authorized
on public.roles
for update
to authenticated
using ((select private.has_permission(organization_id, 'settings.role.update')))
with check ((select private.has_permission(organization_id, 'settings.role.update')));

create policy roles_delete_authorized
on public.roles
for delete
to authenticated
using (
  not is_system
  and (select private.has_permission(organization_id, 'settings.role.delete'))
);

create policy role_permissions_select_assigned_or_authorized
on public.role_permissions
for select
to authenticated
using (
  (select private.is_role_assigned_to_current_user(role_id))
  or exists (
    select 1
    from public.roles as role
    where role.id = role_id
      and (select private.has_permission(role.organization_id, 'settings.permission.view'))
  )
);

create policy role_permissions_insert_authorized
on public.role_permissions
for insert
to authenticated
with check (
  exists (
    select 1
    from public.roles as role
    where role.id = role_id
      and (select private.has_permission(role.organization_id, 'settings.role.manage_access'))
  )
);

create policy role_permissions_update_authorized
on public.role_permissions
for update
to authenticated
using (
  exists (
    select 1
    from public.roles as role
    where role.id = role_id
      and (select private.has_permission(role.organization_id, 'settings.role.manage_access'))
  )
)
with check (
  exists (
    select 1
    from public.roles as role
    where role.id = role_id
      and (select private.has_permission(role.organization_id, 'settings.role.manage_access'))
  )
);

create policy role_permissions_delete_authorized
on public.role_permissions
for delete
to authenticated
using (
  exists (
    select 1
    from public.roles as role
    where role.id = role_id
      and (select private.has_permission(role.organization_id, 'settings.role.manage_access'))
  )
);

create policy membership_roles_select_self_or_authorized
on public.membership_roles
for select
to authenticated
using (
  (select private.owns_membership(membership_id))
  or exists (
    select 1
    from public.memberships as membership
    where membership.id = membership_id
      and (
        (select private.has_permission(membership.organization_id, 'settings.user.view'))
        or (select private.has_permission(membership.organization_id, 'settings.role.view'))
      )
  )
);

create policy membership_roles_insert_authorized
on public.membership_roles
for insert
to authenticated
with check (
  exists (
    select 1
    from public.memberships as membership
    join public.roles as role
      on role.id = role_id
     and role.organization_id = membership.organization_id
    where membership.id = membership_id
      and (select private.has_permission(membership.organization_id, 'settings.role.manage_access'))
  )
);

create policy membership_roles_delete_authorized
on public.membership_roles
for delete
to authenticated
using (
  exists (
    select 1
    from public.memberships as membership
    where membership.id = membership_id
      and (select private.has_permission(membership.organization_id, 'settings.role.manage_access'))
  )
);

create policy permission_overrides_select_self_or_authorized
on public.membership_permission_overrides
for select
to authenticated
using (
  (select private.owns_membership(membership_id))
  or exists (
    select 1
    from public.memberships as membership
    where membership.id = membership_id
      and (select private.has_permission(membership.organization_id, 'settings.permission.view'))
  )
);

create policy permission_overrides_insert_authorized
on public.membership_permission_overrides
for insert
to authenticated
with check (
  exists (
    select 1
    from public.memberships as membership
    where membership.id = membership_id
      and (select private.has_permission(membership.organization_id, 'settings.permission.manage_access'))
  )
);

create policy permission_overrides_update_authorized
on public.membership_permission_overrides
for update
to authenticated
using (
  exists (
    select 1
    from public.memberships as membership
    where membership.id = membership_id
      and (select private.has_permission(membership.organization_id, 'settings.permission.manage_access'))
  )
)
with check (
  exists (
    select 1
    from public.memberships as membership
    where membership.id = membership_id
      and (select private.has_permission(membership.organization_id, 'settings.permission.manage_access'))
  )
);

create policy permission_overrides_delete_authorized
on public.membership_permission_overrides
for delete
to authenticated
using (
  exists (
    select 1
    from public.memberships as membership
    where membership.id = membership_id
      and (select private.has_permission(membership.organization_id, 'settings.permission.manage_access'))
  )
);

create policy invitations_select_authorized
on public.organization_invitations
for select
to authenticated
using ((select private.has_permission(organization_id, 'settings.user.view')));

create policy invitations_insert_authorized
on public.organization_invitations
for insert
to authenticated
with check ((select private.has_permission(organization_id, 'settings.user.create')));

create policy invitations_update_authorized
on public.organization_invitations
for update
to authenticated
using ((select private.has_permission(organization_id, 'settings.user.update')))
with check ((select private.has_permission(organization_id, 'settings.user.update')));

create policy invitations_delete_authorized
on public.organization_invitations
for delete
to authenticated
using ((select private.has_permission(organization_id, 'settings.user.delete')));

create policy user_preferences_select_self
on public.user_preferences
for select
to authenticated
using ((select private.owns_membership(membership_id)));

create policy user_preferences_insert_self
on public.user_preferences
for insert
to authenticated
with check ((select private.owns_membership(membership_id)));

create policy user_preferences_update_self
on public.user_preferences
for update
to authenticated
using ((select private.owns_membership(membership_id)))
with check ((select private.owns_membership(membership_id)));

create policy audit_events_select_authorized
on public.audit_events
for select
to authenticated
using (
  organization_id is not null
  and (select private.has_permission(organization_id, 'settings.audit.view'))
);
