begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(18);

select has_table('public', 'automation_domain_events', 'Automation domain-event outbox exists');
select has_table('public', 'automation_dispatches', 'Per-workflow dispatch state exists');
select has_table('public', 'automation_dispatch_attempts', 'Dispatch attempt evidence exists');
select has_table('public', 'automation_ai_mutation_intents', 'Sensitive AI mutation intents exist');
select has_table('public', 'automation_ai_execution_events', 'Redacted AI execution evidence exists');

select ok(
  exists(select 1 from public.permissions where key = 'automation.execution.retry' and is_sensitive),
  'Dead-letter retry is a sensitive permission'
);
select ok(
  exists(select 1 from public.permissions where key = 'automation.ai_execution.view' and is_sensitive),
  'AI execution evidence is protected by a sensitive permission'
);
select ok(
  exists(
    select 1
    from public.role_template_permissions as grant_row
    join public.permissions as permission on permission.id = grant_row.permission_id
    where grant_row.role_template_key = 'owner'
      and permission.key = 'automation.execution.retry'
      and grant_row.scope = 'organization'
  ),
  'Owner receives organization-scoped dispatch retry'
);
select ok(
  exists(
    select 1
    from public.role_template_permissions as grant_row
    join public.permissions as permission on permission.id = grant_row.permission_id
    where grant_row.role_template_key = 'auditor'
      and permission.key = 'automation.ai_execution.view'
      and grant_row.scope = 'organization'
  ),
  'Auditor can view redacted AI execution evidence'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.automation_domain_events'::regclass),
  'Domain events use RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.automation_dispatches'::regclass),
  'Dispatches use RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.automation_ai_mutation_intents'::regclass),
  'AI intents use RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.automation_ai_execution_events'::regclass),
  'AI execution evidence uses RLS'
);

select has_function(
  'private',
  'emit_automation_domain_event',
  array['uuid', 'text', 'text', 'text', 'uuid', 'uuid', 'jsonb', 'text', 'timestamp with time zone'],
  'Transactional domain-event emitter exists'
);
select ok(
  exists(
    select 1 from pg_trigger
    where tgrelid = 'public.automation_dispatch_attempts'::regclass
      and tgname = 'automation_dispatch_attempts_no_update'
      and not tgisinternal
  ),
  'Dispatch attempt history is append-only'
);
select ok(
  exists(
    select 1 from pg_trigger
    where tgrelid = 'public.automation_ai_execution_events'::regclass
      and tgname = 'automation_ai_execution_events_no_update'
      and not tgisinternal
  ),
  'AI execution evidence is append-only'
);
select ok(
  not has_table_privilege('authenticated', 'public.automation_dispatches', 'UPDATE'),
  'Authenticated clients cannot rewrite dispatch state directly'
);
select ok(
  has_table_privilege('authenticated', 'public.automation_dispatches', 'SELECT'),
  'Authorized authenticated clients may read dispatch metadata through RLS'
);

select * from finish();
rollback;
