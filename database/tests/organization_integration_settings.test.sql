begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(6);

select has_table(
  'public',
  'organization_integration_settings',
  'Organization integration settings are persisted'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.organization_integration_settings'::regclass),
  'Organization integration settings enforce RLS'
);

select ok(
  has_table_privilege('authenticated', 'public.organization_integration_settings', 'SELECT'),
  'Authenticated sessions may read authorized integration status'
);

select ok(
  not has_table_privilege('authenticated', 'public.organization_integration_settings', 'UPDATE'),
  'Authenticated sessions cannot directly update encrypted integration settings'
);

select ok(
  exists (
    select 1
    from public.role_template_permissions template_permission
    join public.permissions permission on permission.id = template_permission.permission_id
    where template_permission.role_template_key = 'owner'
      and permission.key = 'settings.integration.manage_settings'
  ),
  'Owners retain integration-management permission'
);

select ok(
  exists (
    select 1 from pg_trigger
    where tgname = 'organizations_create_integration_settings' and not tgisinternal
  ),
  'New organizations receive an integration-settings record'
);

select * from finish();
rollback;
