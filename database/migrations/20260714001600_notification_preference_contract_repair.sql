-- Repair notification preference permissions for migration-managed system roles.
-- This forward migration is intentionally idempotent because already-applied
-- foundational migrations are not replayed on linked databases.

set lock_timeout = '10s';
set statement_timeout = '120s';

insert into public.permissions (module, resource, action, description, is_sensitive)
values
  ('notifications', 'notification', 'view', 'View notifications addressed to the current user.', false),
  ('notifications', 'notification', 'update', 'Mark notifications read or update delivery state.', false),
  ('notifications', 'preference', 'manage_settings', 'Manage personal notification preferences.', false)
on conflict (module, resource, action) do update
set
  description = excluded.description,
  is_sensitive = excluded.is_sensitive;

with default_notification_templates(template_key) as (
  values
    ('owner'),
    ('system_administrator'),
    ('operations_administrator'),
    ('finance_manager'),
    ('accountant'),
    ('hr_manager'),
    ('project_manager'),
    ('team_lead'),
    ('sales_manager'),
    ('sales_executive'),
    ('support_manager'),
    ('support_agent'),
    ('legal_manager'),
    ('employee')
), notification_permissions as (
  select id
  from public.permissions
  where key in (
    'notifications.notification.view',
    'notifications.notification.update',
    'notifications.preference.manage_settings'
  )
)
insert into public.role_template_permissions (role_template_key, permission_id, scope)
select template.template_key, permission.id, 'organization'
from default_notification_templates as template
cross join notification_permissions as permission
on conflict (role_template_key, permission_id) do update
set scope = excluded.scope;

-- System roles are migration-managed and read-only in the application, so their
-- grants must match the repaired templates. Custom roles remain untouched.
insert into public.role_permissions (
  role_id,
  permission_id,
  scope,
  conditions
)
select
  role.id,
  template_permission.permission_id,
  template_permission.scope,
  template_permission.conditions
from public.roles as role
join public.role_template_permissions as template_permission
  on template_permission.role_template_key = role.template_key
join public.permissions as permission
  on permission.id = template_permission.permission_id
where role.is_system
  and permission.key in (
    'notifications.notification.view',
    'notifications.notification.update',
    'notifications.preference.manage_settings'
  )
on conflict (role_id, permission_id) do update
set
  scope = excluded.scope,
  conditions = excluded.conditions,
  updated_at = now();

grant select, insert, update on public.user_preferences to authenticated;
grant all on public.user_preferences to service_role;
