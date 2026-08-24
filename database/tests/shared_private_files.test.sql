begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(30);

select has_table('public', 'private_files', 'Shared private-file registry exists');
select has_table('public', 'private_file_events', 'Private-file lifecycle history exists');
select has_column('public', 'private_files', 'status', 'Files store lifecycle status');
select has_column('public', 'private_files', 'quarantine_path', 'Files store quarantine object path');
select has_column('public', 'private_files', 'storage_path', 'Files store released object path');
select has_column('public', 'private_files', 'scan_attempt_count', 'Files store bounded scan attempts');
select has_column('public', 'private_files', 'lock_token', 'Files store worker lock tokens');
select has_column('public', 'private_files', 'retention_state', 'Files store retention state');
select has_column('public', 'project_task_attachments', 'private_file_id', 'Project attachments link to shared files');

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'private_files_active_entity_sha_unique'
      and indexdef ilike '%where%'
  ),
  'Active duplicate files are prevented per linked entity'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'private_files_scan_due_idx'
      and indexdef ilike '%where%'
  ),
  'Scan workers use a partial due index'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'private_files_purge_due_idx'
      and indexdef ilike '%where%'
  ),
  'Lifecycle cleanup uses a partial purge index'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'private_files_quarantine_cleanup_idx'
      and indexdef ilike '%where%'
  ),
  'Released quarantine-copy cleanup uses a partial due index'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'private_file_events_file_idx'
  ),
  'File lifecycle history has a file timeline index'
);
select ok(
  exists (select 1 from pg_trigger where tgname = 'private_files_validate_tenant' and not tgisinternal),
  'Private files validate uploader tenancy'
);
select ok(
  exists (select 1 from pg_trigger where tgname = 'private_files_validate_transition' and not tgisinternal),
  'Private files validate lifecycle transitions'
);
select ok(
  exists (select 1 from pg_trigger where tgname = 'private_files_prevent_delete' and not tgisinternal),
  'Private files require the audited soft-delete lifecycle'
);
select ok(
  not (select attnotnull from pg_attribute where attrelid = 'public.private_files'::regclass and attname = 'next_scan_at'),
  'Exhausted and completed scans may clear the next scan timestamp'
);
select ok(
  exists (select 1 from pg_trigger where tgname = 'private_file_events_validate_tenant' and not tgisinternal),
  'File history validates tenant ownership'
);
select ok(
  exists (select 1 from pg_trigger where tgname = 'private_file_events_prevent_update' and not tgisinternal),
  'File history rejects updates'
);
select ok(
  exists (select 1 from pg_trigger where tgname = 'private_file_events_prevent_delete' and not tgisinternal),
  'File history rejects deletes'
);
select ok(
  exists (select 1 from pg_trigger where tgname = 'project_task_attachments_validate_private_file' and not tgisinternal),
  'Project attachment links validate shared-file identity'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.private_files'::regclass),
  true,
  'Private files have RLS enabled'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.private_file_events'::regclass),
  true,
  'Private-file history has RLS enabled'
);
select ok(
  not has_table_privilege('anon', 'public.private_files', 'SELECT'),
  'Anonymous clients cannot read private-file metadata'
);
select ok(
  not has_table_privilege('authenticated', 'public.private_files', 'SELECT'),
  'Authenticated clients cannot bypass server file authorization'
);
select ok(
  not has_table_privilege('authenticated', 'public.private_files', 'INSERT'),
  'Authenticated clients cannot forge private-file rows'
);
select ok(
  has_table_privilege('service_role', 'public.private_files', 'INSERT'),
  'Trusted server services can create private-file rows'
);
select ok(
  not has_table_privilege('authenticated', 'public.private_file_events', 'SELECT'),
  'Authenticated clients cannot read lifecycle history directly'
);
select ok(
  (select attnotnull
   from pg_attribute
   where attrelid = 'public.project_task_attachments'::regclass
     and attname = 'private_file_id'),
  'Every project attachment must link to a shared private file'
);

select * from finish();
rollback;
