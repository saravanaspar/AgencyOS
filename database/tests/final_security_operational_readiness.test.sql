begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(22);

select has_table('public', 'organization_security_policies', 'Organization security policy exists');
select has_table('public', 'security_sessions', 'Security sessions exist');
select has_table('public', 'security_events', 'Security events exist');
select has_table('public', 'security_incidents', 'Security incidents exist');
select has_table('public', 'security_incident_events', 'Incident timeline exists');
select has_table('public', 'security_restore_drills', 'Restore drill evidence exists');

select ok(exists(select 1 from public.permissions where key = 'settings.security.view'), 'Security view permission exists');
select ok(exists(select 1 from public.permissions where key = 'settings.security.manage_settings' and is_sensitive), 'Security policy management is sensitive');
select ok(exists(select 1 from public.permissions where key = 'settings.security.revoke' and is_sensitive), 'Session revocation is sensitive');
select ok(exists(select 1 from public.permissions where key = 'settings.security.reset_mfa' and is_sensitive), 'MFA reset is sensitive');

select ok((select relrowsecurity from pg_class where oid = 'public.security_sessions'::regclass), 'Security sessions use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.security_events'::regclass), 'Security events use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.security_incidents'::regclass), 'Security incidents use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.security_restore_drills'::regclass), 'Restore drills use RLS');

select ok(exists(select 1 from pg_trigger where tgrelid = 'public.security_events'::regclass and tgname = 'security_events_prevent_update' and not tgisinternal), 'Security events are update protected');
select ok(exists(select 1 from pg_trigger where tgrelid = 'public.security_events'::regclass and tgname = 'security_events_prevent_delete' and not tgisinternal), 'Security events are delete protected');
select ok(exists(select 1 from pg_trigger where tgrelid = 'public.security_incident_events'::regclass and tgname = 'security_incident_events_prevent_update' and not tgisinternal), 'Incident history is append-only');
select ok(exists(select 1 from pg_trigger where tgrelid = 'public.security_restore_drills'::regclass and tgname = 'security_restore_drills_prevent_update' and not tgisinternal), 'Restore evidence is append-only');
select ok(exists(select 1 from pg_trigger where tgrelid = 'public.memberships'::regclass and tgname = 'memberships_revoke_security_sessions' and not tgisinternal), 'Membership deactivation revokes sessions');

select ok(not has_table_privilege('authenticated', 'public.security_sessions', 'UPDATE'), 'Authenticated clients cannot rewrite session state');
select ok(not has_table_privilege('authenticated', 'public.security_events', 'INSERT'), 'Authenticated clients cannot forge security events');
select ok(has_table_privilege('authenticated', 'public.security_sessions', 'SELECT'), 'Authorized clients may read scoped session metadata through RLS');

select * from finish();
rollback;
