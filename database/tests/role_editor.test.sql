begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(8);

select has_function('private', 'protect_role_integrity', array[]::text[], 'role integrity function exists');
select trigger_is('public', 'roles', 'roles_protect_integrity', 'private', 'protect_role_integrity', 'role integrity trigger exists');
select has_table('public', 'role_permissions', 'role permissions table exists');
select has_table('public', 'membership_permission_overrides', 'member overrides table exists');
select has_column('public', 'role_permissions', 'scope', 'role grants have scope');
select has_column('public', 'membership_permission_overrides', 'effect', 'member overrides have effect');
select has_column('public', 'membership_permission_overrides', 'reason', 'member overrides require a reason');
select has_column('public', 'membership_permission_overrides', 'expires_at', 'member overrides support expiry');

select * from finish();
rollback;
