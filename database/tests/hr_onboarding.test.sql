begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(25);

select has_table('public', 'hr_onboarding_plans', 'onboarding plans table exists');
select has_table('public', 'hr_onboarding_items', 'onboarding checklist table exists');
select has_column('public', 'hr_onboarding_plans', 'cycle_number', 'plans preserve rehire onboarding cycles');
select has_column('public', 'hr_onboarding_plans', 'target_start_date', 'plans track target start date');
select has_column('public', 'hr_onboarding_plans', 'first_day_meeting_at', 'plans track first-day meeting');
select has_column('public', 'hr_onboarding_plans', 'probation_review_date', 'plans track probation review');
select has_column('public', 'hr_onboarding_items', 'completion_source', 'items record completion source');
select has_column('public', 'hr_onboarding_items', 'assigned_membership_id', 'items support assignment');
select has_index('public', 'hr_onboarding_plans', 'hr_onboarding_plans_status_idx', 'plan status is indexed');
select has_index('public', 'hr_onboarding_plans', 'hr_onboarding_plans_active_unique', 'only one active plan per employee is enforced');
select has_index('public', 'hr_onboarding_items', 'hr_onboarding_items_assignee_idx', 'open assignments are indexed');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.hr_onboarding_plans'::regclass),
  'onboarding plans have RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.hr_onboarding_items'::regclass),
  'onboarding items have RLS enabled'
);
select ok(
  exists(select 1 from public.permissions where key = 'hr.onboarding.view' and is_sensitive),
  'sensitive onboarding view permission exists'
);
select ok(
  exists(select 1 from public.permissions where key = 'hr.onboarding.manage' and is_sensitive),
  'sensitive onboarding manage permission exists'
);
select ok(
  exists(select 1 from public.permissions where key = 'hr.onboarding.update_own' and is_sensitive),
  'sensitive own acknowledgement permission exists'
);
select ok(
  exists(
    select 1 from public.role_template_permissions rtp
    join public.permissions p on p.id = rtp.permission_id
    where rtp.role_template_key = 'employee' and p.key = 'hr.onboarding.view' and rtp.scope = 'own'
  ),
  'employees receive own-scope onboarding visibility'
);
select ok(
  exists(
    select 1 from public.role_template_permissions rtp
    join public.permissions p on p.id = rtp.permission_id
    where rtp.role_template_key = 'team_lead' and p.key = 'hr.onboarding.view'
      and rtp.scope = 'managed_employees'
  ),
  'team leads receive managed-employee onboarding visibility'
);
select ok(
  exists(select 1 from pg_trigger where tgname = 'hr_onboarding_plans_seed_items' and not tgisinternal),
  'new plans seed the standard checklist'
);
select ok(
  exists(select 1 from pg_trigger where tgname = 'hr_onboarding_items_refresh_plan' and not tgisinternal),
  'checklist updates refresh plan status'
);
select ok(
  exists(select 1 from pg_trigger where tgname = 'hr_onboarding_items_enforce_employee_update' and not tgisinternal),
  'employee checklist writes are constrained by a trigger'
);
select ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'seed_hr_onboarding_items' and p.prosecdef
  ),
  'checklist seeding function is security definer'
);
select ok(
  exists(
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'hr_onboarding_plans'
      and policyname = 'hr_onboarding_plans_select_authorized'
  ),
  'scoped plan select policy exists'
);
select ok(
  exists(
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'hr_onboarding_items'
      and policyname = 'hr_onboarding_items_update_authorized'
  ),
  'scoped checklist update policy exists'
);
select ok(
  has_table_privilege('authenticated', 'public.hr_onboarding_plans', 'SELECT')
  and not has_table_privilege('authenticated', 'public.hr_onboarding_plans', 'INSERT')
  and not has_table_privilege('authenticated', 'public.hr_onboarding_plans', 'UPDATE')
  and has_table_privilege('authenticated', 'public.hr_onboarding_items', 'SELECT')
  and not has_table_privilege('authenticated', 'public.hr_onboarding_items', 'UPDATE'),
  'authenticated clients receive read-only onboarding table privileges'
);

select * from finish();
rollback;
