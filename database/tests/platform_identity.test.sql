begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(25);

select has_schema('private', 'private helper schema exists');
select has_table('public', 'organizations', 'organizations table exists');
select has_table('public', 'profiles', 'profiles table exists');
select has_table('public', 'memberships', 'memberships table exists');
select has_table('public', 'permissions', 'permissions table exists');
select has_table('public', 'roles', 'roles table exists');
select has_table('public', 'role_permissions', 'role_permissions table exists');
select has_table('public', 'membership_roles', 'membership_roles table exists');
select has_table('public', 'membership_permission_overrides', 'permission overrides table exists');
select has_table('public', 'organization_invitations', 'organization invitations table exists');
select has_table('public', 'audit_events', 'audit events table exists');

select has_function('private', 'has_permission', array['uuid', 'text'], 'has_permission helper exists');
select has_function('private', 'bootstrap_organization', array['uuid', 'text', 'text', 'text', 'text', 'text'], 'bootstrap helper exists');
select has_function('private', 'handle_new_user', array[]::text[], 'auth profile trigger helper exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.organizations'::regclass),
  'organizations has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'profiles has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.memberships'::regclass),
  'memberships has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.roles'::regclass),
  'roles has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.role_permissions'::regclass),
  'role_permissions has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.audit_events'::regclass),
  'audit_events has RLS enabled'
);

select ok(
  (select count(*) >= 40 from public.permissions),
  'foundation permission catalogue is installed'
);
select is(
  (select count(*)::integer from public.role_templates),
  15,
  'all default role templates are installed'
);
select ok(
  exists (
    select 1
    from public.role_template_permissions as role_permission
    join public.permissions as permission on permission.id = role_permission.permission_id
    where role_permission.role_template_key = 'owner'
      and permission.key = 'settings.permission.manage_access'
  ),
  'owner template includes permission administration'
);
select ok(
  not has_table_privilege('anon', 'public.organizations', 'SELECT'),
  'anonymous users cannot read organizations'
);
select ok(
  has_table_privilege('authenticated', 'public.organizations', 'SELECT'),
  'authenticated role has organization SELECT privilege subject to RLS'
);

select * from finish();
rollback;
