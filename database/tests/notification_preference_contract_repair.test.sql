begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(7);

select ok(
  exists (select 1 from public.permissions where key = 'notifications.preference.manage_settings'),
  'Notification preference management permission exists'
);

select is(
  (
    select count(*)::integer
    from public.role_template_permissions as template_permission
    join public.permissions as permission
      on permission.id = template_permission.permission_id
    where permission.key = 'notifications.preference.manage_settings'
      and template_permission.role_template_key in (
        'owner',
        'system_administrator',
        'operations_administrator',
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
  ),
  14,
  'Every default non-auditor role template can manage personal notification preferences'
);

select ok(
  not exists (
    select 1
    from public.roles as role
    join public.role_template_permissions as template_permission
      on template_permission.role_template_key = role.template_key
    join public.permissions as permission
      on permission.id = template_permission.permission_id
    left join public.role_permissions as role_permission
      on role_permission.role_id = role.id
     and role_permission.permission_id = permission.id
    where role.is_system
      and permission.key = 'notifications.preference.manage_settings'
      and role_permission.role_id is null
  ),
  'Existing migration-managed system roles receive the preference permission'
);

select ok(
  has_table_privilege('authenticated', 'public.user_preferences', 'SELECT'),
  'Authenticated sessions may read their RLS-scoped preferences'
);

select ok(
  has_table_privilege('authenticated', 'public.user_preferences', 'INSERT'),
  'Authenticated sessions may insert their RLS-scoped preferences'
);

select ok(
  has_table_privilege('authenticated', 'public.user_preferences', 'UPDATE'),
  'Authenticated sessions may update their RLS-scoped preferences'
);

select ok(
  exists (
    select 1
    from pg_trigger
    where tgname = 'user_preferences_set_updated_at'
      and not tgisinternal
  ),
  'Preference updates maintain updated_at'
);

select * from finish();
rollback;
