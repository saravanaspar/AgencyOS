begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(38);

select has_table('public', 'project_phases', 'Project phases table exists');
select has_table('public', 'project_milestones', 'Project milestones table exists');
select has_table('public', 'project_labels', 'Project labels table exists');
select has_table('public', 'project_task_labels', 'Task labels table exists');
select has_table('public', 'project_task_watchers', 'Task watchers table exists');
select has_table('public', 'project_task_checklist_items', 'Task checklist table exists');
select has_table('public', 'project_task_attachments', 'Private task attachment metadata table exists');
select has_table('public', 'project_task_recurrences', 'Task recurrence table exists');
select has_table('public', 'project_closure_items', 'Project closure checklist table exists');

select has_column('public', 'projects', 'closure_status', 'Projects track closure workflow state');
select has_column('public', 'projects', 'closure_requested_at', 'Projects track closure requests');
select has_column('public', 'projects', 'closed_at', 'Projects track final closure time');
select has_column('public', 'project_tasks', 'phase_id', 'Tasks can belong to phases');
select has_column('public', 'project_tasks', 'milestone_id', 'Tasks can target milestones');
select has_column('public', 'project_tasks', 'recurrence_id', 'Tasks can link to recurrence definitions');

select has_function(
  'private',
  'seed_project_closure_items',
  array[]::text[],
  'New projects receive a standard closure checklist'
);
select has_function(
  'private',
  'validate_project_stage_two_child',
  array[]::text[],
  'Stage-two child records are tenant validated'
);
select has_function(
  'private',
  'validate_project_task_stage_two_links',
  array[]::text[],
  'Task phase, milestone, and recurrence links are validated'
);
select has_function(
  'private',
  'prevent_read_only_project_mutation',
  array[]::text[],
  'Archived and closed project child records are database guarded'
);
select has_function(
  'private',
  'validate_project_closure_transition',
  array[]::text[],
  'Project closure transitions are database guarded'
);
select has_function(
  'private',
  'validate_project_task_dependency_cycle',
  array[]::text[],
  'Blocking dependency cycles are database guarded'
);

select is(
  (select relrowsecurity from pg_class where oid = 'public.project_phases'::regclass),
  true,
  'Project phases have RLS enabled'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.project_milestones'::regclass),
  true,
  'Project milestones have RLS enabled'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.project_labels'::regclass),
  true,
  'Project labels have RLS enabled'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.project_task_labels'::regclass),
  true,
  'Task labels have RLS enabled'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.project_task_watchers'::regclass),
  true,
  'Task watchers have RLS enabled'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.project_task_checklist_items'::regclass),
  true,
  'Task checklist items have RLS enabled'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.project_task_attachments'::regclass),
  true,
  'Task attachment metadata has RLS enabled'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.project_task_recurrences'::regclass),
  true,
  'Task recurrences have RLS enabled'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.project_closure_items'::regclass),
  true,
  'Project closure items have RLS enabled'
);

select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'project_task_attachments'
      and policyname = 'project_task_attachments_select_visible'
  ),
  'Attachment metadata reads require visible-task permission'
);
select ok(
  not has_table_privilege('authenticated', 'public.project_task_attachments', 'INSERT')
  and not has_table_privilege('authenticated', 'public.project_task_attachments', 'DELETE'),
  'Attachment metadata writes remain server-only'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'project_task_watchers'
      and policyname = 'project_task_watchers_insert_authorized'
  ),
  'Watcher creation is scoped and self-service aware'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'project_closure_items'
      and policyname = 'project_closure_items_update_authorized'
  ),
  'Closure checks require project update permission'
);


select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.project_task_dependencies'::regclass
      and tgname = 'project_task_dependencies_prevent_cycles'
      and not tgisinternal
  ),
  'Task dependencies have a cycle-prevention trigger'
);
select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.projects'::regclass
      and tgname = 'projects_validate_closure'
      and not tgisinternal
  ),
  'Projects have a closure-transition trigger'
);
select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.project_tasks'::regclass
      and tgname = 'project_tasks_prevent_read_only_mutation'
      and not tgisinternal
  ),
  'Task mutations are blocked for archived and closed projects'
);
select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.project_task_attachments'::regclass
      and tgname = 'project_task_attachments_prevent_read_only_mutation'
      and not tgisinternal
  ),
  'Attachment metadata mutations are blocked for archived and closed projects'
);

select * from finish();
rollback;
