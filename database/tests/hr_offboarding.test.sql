begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(27);

select has_table('public', 'hr_offboarding_plans', 'offboarding plans table exists');
select has_table('public', 'hr_offboarding_items', 'offboarding checklist table exists');
select has_column('public', 'hr_offboarding_plans', 'cycle_number', 'plans preserve rehire cycles');
select has_column('public', 'hr_offboarding_plans', 'prior_lifecycle_status', 'plans preserve lifecycle rollback state');
select has_column('public', 'hr_offboarding_plans', 'last_working_date', 'plans track last working date');
select has_column('public', 'hr_offboarding_plans', 'replacement_membership_id', 'plans track a replacement employee');
select has_column('public', 'hr_offboarding_items', 'completion_source', 'items record completion source');
select has_column('public', 'hr_offboarding_items', 'assigned_membership_id', 'items support assignment');
select has_index('public', 'hr_offboarding_plans', 'hr_offboarding_plans_status_idx', 'plan status is indexed');
select has_index('public', 'hr_offboarding_plans', 'hr_offboarding_plans_active_unique', 'only one active plan per employee is enforced');
select has_index('public', 'hr_offboarding_items', 'hr_offboarding_items_assignee_idx', 'open assignments are indexed');

select ok((select relrowsecurity from pg_class where oid = 'public.hr_offboarding_plans'::regclass), 'offboarding plans have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.hr_offboarding_items'::regclass), 'offboarding items have RLS');
select ok(exists(select 1 from public.permissions where key = 'hr.offboarding.view' and is_sensitive), 'sensitive view permission exists');
select ok(exists(select 1 from public.permissions where key = 'hr.offboarding.manage' and is_sensitive), 'sensitive manage permission exists');
select ok(exists(select 1 from public.permissions where key = 'hr.offboarding.create_own' and is_sensitive), 'own resignation permission exists');
select ok(exists(
  select 1 from public.role_template_permissions rtp join public.permissions p on p.id = rtp.permission_id
  where rtp.role_template_key = 'employee' and p.key = 'hr.offboarding.view' and rtp.scope = 'own'
), 'employees receive own-scope offboarding visibility');
select ok(exists(
  select 1 from public.role_template_permissions rtp join public.permissions p on p.id = rtp.permission_id
  where rtp.role_template_key = 'team_lead' and p.key = 'hr.offboarding.view' and rtp.scope = 'managed_employees'
), 'team leads receive managed-employee visibility');
select ok(exists(select 1 from pg_trigger where tgname = 'hr_offboarding_plans_seed_items' and not tgisinternal), 'plans seed the standard checklist');
select ok(exists(select 1 from pg_trigger where tgname = 'hr_offboarding_items_refresh_plan' and not tgisinternal), 'checklist updates refresh plan status');
select ok(exists(select 1 from pg_trigger where tgname = 'hr_offboarding_items_enforce_client_update' and not tgisinternal), 'derived item writes are constrained');
select ok(exists(
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'seed_hr_offboarding_items' and p.prosecdef
), 'checklist seeding is security definer');
select ok(exists(
  select 1 from pg_policies where schemaname = 'public' and tablename = 'hr_offboarding_plans'
    and policyname = 'hr_offboarding_plans_select_authorized'
), 'scoped plan select policy exists');
select ok(exists(
  select 1 from pg_policies where schemaname = 'public' and tablename = 'hr_offboarding_items'
    and policyname = 'hr_offboarding_items_update_authorized'
), 'scoped checklist update policy exists');
select ok(
  has_table_privilege('authenticated', 'public.hr_offboarding_plans', 'SELECT')
  and not has_table_privilege('authenticated', 'public.hr_offboarding_plans', 'INSERT')
  and not has_table_privilege('authenticated', 'public.hr_offboarding_plans', 'UPDATE')
  and has_table_privilege('authenticated', 'public.hr_offboarding_items', 'SELECT')
  and not has_table_privilege('authenticated', 'public.hr_offboarding_items', 'UPDATE'),
  'authenticated clients receive read-only offboarding privileges'
);
select ok(exists(
  select 1 from pg_constraint where conname = 'hr_offboarding_plans_dates_valid'
), 'notice and last-working-date ordering is constrained');
select ok(exists(
  select 1 from pg_constraint where conname = 'hr_offboarding_plans_status_timestamps_valid'
), 'terminal plan timestamps are constrained');

select * from finish();
rollback;
