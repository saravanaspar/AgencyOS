-- Permission gates for every workspace module and default role grants.

set lock_timeout = '10s';
set statement_timeout = '120s';

insert into public.permissions (module, resource, action, description, is_sensitive)
values
  ('crm', 'workspace', 'view', 'Open the CRM workspace and view permitted relationship records.', false),
  ('projects', 'workspace', 'view', 'Open the Projects workspace and view permitted delivery records.', false),
  ('calendar', 'workspace', 'view', 'Open the shared calendar workspace.', false),
  ('finance', 'workspace', 'view', 'Open the Finance workspace and view permitted financial records.', true),
  ('hr', 'workspace', 'view', 'Open the People workspace and view permitted employee records.', true),
  ('support', 'workspace', 'view', 'Open the Support workspace and view permitted tickets.', false),
  ('documents', 'workspace', 'view', 'Open the Documents workspace and view permitted files.', true),
  ('legal', 'workspace', 'view', 'Open the Legal workspace and view permitted legal records.', true),
  ('assets', 'workspace', 'view', 'Open the Assets workspace and view permitted inventory records.', false),
  ('vendors', 'workspace', 'view', 'Open the Vendors workspace and view permitted procurement records.', false),
  ('reports', 'workspace', 'view', 'Open the Reports workspace and run permitted reports.', true),
  ('automation', 'workspace', 'view', 'Open the Automation workspace and view permitted executions.', true),
  ('ai', 'workspace', 'view', 'Open permission-aware AI tools.', true)
on conflict (module, resource, action) do update
set
  description = excluded.description,
  is_sensitive = excluded.is_sensitive;

-- Owner always receives every registered permission.
insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'owner', permission.id, 'organization'
from public.permissions as permission
on conflict (role_template_key, permission_id) do update
set scope = excluded.scope;

-- Platform administrators receive broad operational module access but do not
-- automatically receive finance, HR, or legal workspaces.
insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'system_administrator', permission.id, 'organization'
from public.permissions as permission
where permission.key in (
  'crm.workspace.view',
  'projects.workspace.view',
  'calendar.workspace.view',
  'support.workspace.view',
  'documents.workspace.view',
  'assets.workspace.view',
  'vendors.workspace.view',
  'reports.workspace.view',
  'automation.workspace.view',
  'ai.workspace.view'
)
on conflict (role_template_key, permission_id) do update
set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select 'operations_administrator', permission.id, 'organization'
from public.permissions as permission
where permission.key in (
  'crm.workspace.view',
  'projects.workspace.view',
  'calendar.workspace.view',
  'support.workspace.view',
  'documents.workspace.view',
  'assets.workspace.view',
  'vendors.workspace.view',
  'reports.workspace.view',
  'automation.workspace.view'
)
on conflict (role_template_key, permission_id) do update
set scope = excluded.scope;

insert into public.role_template_permissions (role_template_key, permission_id, scope)
select role_template.key, permission.id, 'organization'
from public.role_templates as role_template
cross join public.permissions as permission
where
  (role_template.key in ('finance_manager', 'accountant') and permission.key in (
    'finance.workspace.view', 'calendar.workspace.view', 'documents.workspace.view', 'reports.workspace.view'
  ))
  or (role_template.key = 'hr_manager' and permission.key in (
    'hr.workspace.view', 'calendar.workspace.view', 'documents.workspace.view', 'reports.workspace.view'
  ))
  or (role_template.key = 'project_manager' and permission.key in (
    'projects.workspace.view', 'calendar.workspace.view', 'documents.workspace.view', 'reports.workspace.view'
  ))
  or (role_template.key = 'team_lead' and permission.key in (
    'projects.workspace.view', 'calendar.workspace.view', 'documents.workspace.view'
  ))
  or (role_template.key in ('sales_manager', 'sales_executive') and permission.key in (
    'crm.workspace.view', 'calendar.workspace.view', 'documents.workspace.view'
  ))
  or (role_template.key = 'sales_manager' and permission.key = 'reports.workspace.view')
  or (role_template.key in ('support_manager', 'support_agent') and permission.key in (
    'support.workspace.view', 'calendar.workspace.view', 'documents.workspace.view'
  ))
  or (role_template.key = 'support_manager' and permission.key = 'reports.workspace.view')
  or (role_template.key = 'legal_manager' and permission.key in (
    'legal.workspace.view', 'calendar.workspace.view', 'documents.workspace.view', 'reports.workspace.view'
  ))
  or (role_template.key = 'auditor' and permission.key = 'reports.workspace.view')
  or (role_template.key = 'employee' and permission.key in (
    'calendar.workspace.view', 'documents.workspace.view'
  ))
on conflict (role_template_key, permission_id) do update
set scope = excluded.scope;

-- Synchronize the new template grants to roles in organizations that already
-- existed before this migration was applied.
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
where permission.module in (
  'crm',
  'projects',
  'calendar',
  'finance',
  'hr',
  'support',
  'documents',
  'legal',
  'assets',
  'vendors',
  'reports',
  'automation',
  'ai'
)
on conflict (role_id, permission_id) do update
set
  scope = excluded.scope,
  conditions = excluded.conditions,
  updated_at = now();
