begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(29);

select has_table('public', 'projects', 'Projects table exists');
select hasnt_table('public', 'user_profiles', 'Projects use the canonical public.profiles identity table');
select has_table('public', 'project_members', 'Project members table exists');
select has_table('public', 'project_task_statuses', 'Project task workflow table exists');
select has_table('public', 'project_tasks', 'Project tasks table exists');
select has_table('public', 'project_task_assignees', 'Task assignees table exists');
select has_table('public', 'project_task_comments', 'Task comments table exists');
select has_table('public', 'project_task_dependencies', 'Task dependency table exists');
select has_table('public', 'project_time_entries', 'Project time entries table exists');
select has_table('public', 'project_number_sequences', 'Project number sequence table exists');

select has_column('public', 'projects', 'company_id', 'Projects can link to CRM companies');
select has_column('public', 'projects', 'visibility', 'Projects have explicit visibility');
select has_column('public', 'projects', 'next_task_number', 'Projects allocate stable task numbers');
select has_column('public', 'project_tasks', 'parent_task_id', 'Tasks support future subtask hierarchy');
select has_column('public', 'project_tasks', 'estimated_minutes', 'Tasks store effort estimates');

select has_function(
  'private',
  'next_project_code',
  array['uuid'],
  'Project codes are allocated by a database function'
);
select has_function(
  'private',
  'project_is_visible',
  array['uuid', 'uuid', 'text'],
  'Project visibility is resolved in the database'
);
select has_function(
  'private',
  'validate_project_task_transition',
  array[]::text[],
  'Task completion and parent cycles are guarded by a trigger function'
);

select is(
  (select relrowsecurity from pg_class where oid = 'public.projects'::regclass),
  true,
  'Projects have RLS enabled'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.project_tasks'::regclass),
  true,
  'Project tasks have RLS enabled'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.project_time_entries'::regclass),
  true,
  'Project time entries have RLS enabled'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'projects'
      and policyname = 'projects_select_scoped'
  ),
  'Project reads require scoped project permissions'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'project_task_dependencies_not_self'
  ),
  'Task dependencies cannot point to the same task'
);


select is(
  (
    select count(*)::integer
    from public.role_template_permissions as template_permission
    join public.permissions as permission on permission.id = template_permission.permission_id
    where template_permission.role_template_key = 'owner'
      and permission.module = 'projects'
  ),
  (select count(*)::integer from public.permissions where module = 'projects'),
  'Owner template receives every registered project permission'
);


select ok(
  position('new.' in lower(pg_get_functiondef('private.validate_project_child_tenant()'::regprocedure))) = 0,
  'Shared project-child validation does not resolve table-specific NEW fields'
);

insert into public.identity_accounts (
  id, auth_provider, provider_subject, email, email_confirmed_at, raw_user_meta_data
)
values
  ('99999999-9999-4999-8999-999999999901'::uuid, 'agencyos', '99999999-9999-4999-8999-999999999901', 'project-trigger-owner@example.test', now(), '{}'::jsonb)
on conflict (id) do nothing;

select private.bootstrap_organization(
  '99999999-9999-4999-8999-999999999901',
  'Project Trigger Contract Organization',
  'project-trigger-contract-organization',
  'US',
  'UTC',
  'USD'
);

select lives_ok(
  $$
    insert into public.projects (
      organization_id,
      code,
      name,
      project_type,
      status,
      priority,
      visibility,
      currency,
      owner_membership_id,
      created_by_membership_id,
      created_by
    )
    select
      organization.id,
      'PRJ-9001',
      'Project trigger contract regression',
      'internal',
      'planned',
      'normal',
      'members',
      organization.default_currency,
      membership.id,
      membership.id,
      membership.user_id
    from public.organizations as organization
    join public.memberships as membership
      on membership.organization_id = organization.id
     and membership.status = 'active'
    where organization.slug = 'project-trigger-contract-organization'
  $$,
  'Creating a project and seeding its child records does not raise undefined-column errors'
);

select is(
  (
    select count(*)::integer
    from public.project_members as member
    join public.projects as project on project.id = member.project_id
    where project.code = 'PRJ-9001'
  ),
  1,
  'Project creation seeds the owner membership'
);

select is(
  (
    select count(*)::integer
    from public.project_task_statuses as status
    join public.projects as project on project.id = status.project_id
    where project.code = 'PRJ-9001'
  ),
  7,
  'Project creation seeds the default task workflow'
);

select is(
  (
    select count(*)::integer
    from public.project_closure_items as item
    join public.projects as project on project.id = item.project_id
    where project.code = 'PRJ-9001'
  ),
  8,
  'Project creation seeds the complete closure checklist'
);

select * from finish();
rollback;
