-- Permission-gated report exports for role-aware management dashboards and
-- cross-module operational reporting. Reporting reads canonical module data;
-- no parallel summary tables or duplicated financial ledgers are introduced.

set lock_timeout = '10s';
set statement_timeout = '120s';

insert into public.permissions (module, resource, action, description, is_sensitive)
values (
  'reports',
  'export',
  'create',
  'Export permission-filtered operational reports with audit evidence.',
  true
)
on conflict (module, resource, action) do update
set description = excluded.description,
    is_sensitive = excluded.is_sensitive;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'organization'
from public.role_templates as role_template
join public.permissions as permission on permission.key = 'reports.export.create'
where role_template.key in (
  'owner',
  'operations_administrator',
  'finance_manager',
  'accountant',
  'hr_manager',
  'project_manager',
  'sales_manager',
  'support_manager',
  'legal_manager'
)
on conflict (role_template_key, permission_id) do update
set scope = excluded.scope;

-- Keep existing organization roles synchronized with the revised templates.
insert into public.role_permissions (role_id, permission_id, scope, conditions)
select role.id, template_permission.permission_id, template_permission.scope, '{}'::jsonb
from public.roles as role
join public.role_template_permissions as template_permission
  on template_permission.role_template_key = role.template_key
join public.permissions as permission on permission.id = template_permission.permission_id
where permission.key = 'reports.export.create'
on conflict (role_id, permission_id) do update
set scope = excluded.scope,
    conditions = excluded.conditions,
    updated_at = now();
