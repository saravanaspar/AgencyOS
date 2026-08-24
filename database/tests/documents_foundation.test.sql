begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(47);

select has_table('public', 'document_folders', 'document folders table exists');
select has_table('public', 'document_categories', 'document categories table exists');
select has_table('public', 'document_tags', 'document tags table exists');
select has_table('public', 'documents', 'documents table exists');
select has_table('public', 'document_versions', 'document versions table exists');
select has_table('public', 'document_tag_links', 'document tag links table exists');
select has_table('public', 'document_entity_links', 'document entity links table exists');
select has_table('public', 'document_access_grants', 'document access grants table exists');
select has_table('public', 'document_comments', 'document comments table exists');
select has_table('public', 'document_events', 'document events table exists');
select has_column('public', 'documents', 'current_version_id', 'documents identify the current immutable version');
select has_column('public', 'documents', 'legal_hold', 'documents support legal hold');
select has_column('public', 'documents', 'retention_until', 'documents support retention dates');
select has_column('public', 'documents', 'review_date', 'documents support review dates');
select has_column('public', 'document_versions', 'private_file_id', 'versions reuse private files');
select has_index('public', 'document_versions', 'document_versions_history_idx', 'version history is indexed');
select has_index('public', 'document_entity_links', 'document_entity_links_entity_idx', 'entity links are indexed');
select has_index('public', 'document_events', 'document_events_history_idx', 'access history is indexed');
select ok((select relrowsecurity from pg_class where oid = 'public.document_folders'::regclass), 'folders have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.documents'::regclass), 'documents have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.document_versions'::regclass), 'versions have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.document_access_grants'::regclass), 'access grants have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.document_comments'::regclass), 'comments have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.document_events'::regclass), 'events have RLS');
select ok(exists(select 1 from public.permissions where key = 'documents.document.view' and is_sensitive), 'view permission exists');
select ok(exists(select 1 from public.permissions where key = 'documents.document.create' and is_sensitive), 'create permission exists');
select ok(exists(select 1 from public.permissions where key = 'documents.document.manage_access' and is_sensitive), 'access-management permission exists');
select ok(exists(select 1 from public.permissions where key = 'documents.document.legal_hold' and is_sensitive), 'legal-hold permission exists');
select ok(exists(
  select 1 from public.role_template_permissions rtp join public.permissions p on p.id = rtp.permission_id
  where rtp.role_template_key = 'employee' and p.key = 'documents.document.view' and rtp.scope = 'own'
), 'employees receive own-scope document visibility');
select ok(exists(
  select 1 from public.role_template_permissions rtp join public.permissions p on p.id = rtp.permission_id
  where rtp.role_template_key = 'legal_manager' and p.key = 'documents.document.legal_hold'
), 'legal managers receive legal-hold control');
select ok(exists(
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'document_membership_access_allowed' and p.prosecdef
), 'document access is decided by a security-definer helper');
select ok(exists(
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'membership_effective_permission_scope' and p.prosecdef
), 'arbitrary membership scope resolution is centralized for trusted workers');
select ok(exists(
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'membership_display_name' and p.prosecdef
), 'document member labels use one trusted display-name helper');
select ok(exists(
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'document_access_allowed' and p.prosecdef
), 'authenticated RLS uses a current-membership document access wrapper');
select ok(exists(select 1 from pg_trigger where tgname = 'document_versions_prevent_update' and not tgisinternal), 'version updates are blocked');
select ok(exists(select 1 from pg_trigger where tgname = 'document_versions_prevent_delete' and not tgisinternal), 'version deletion is blocked');
select ok(exists(select 1 from pg_trigger where tgname = 'document_comments_prevent_update' and not tgisinternal), 'comment updates are blocked');
select ok(exists(select 1 from pg_trigger where tgname = 'document_events_prevent_delete' and not tgisinternal), 'history deletion is blocked');
select ok(exists(select 1 from pg_trigger where tgname = 'document_entity_links_validate' and not tgisinternal), 'entity links are tenant validated');
select ok(exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'documents' and policyname = 'documents_select_authorized'), 'document select policy exists');
select ok(exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'document_versions' and policyname = 'document_versions_select_authorized'), 'version select policy exists');
select ok(exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'document_access_grants' and policyname = 'document_access_grants_select_authorized'), 'grant select policy exists');
select ok(
  has_column_privilege('authenticated', 'public.documents', 'title', 'SELECT')
  and not has_column_privilege('authenticated', 'public.documents', 'legal_hold_reason', 'SELECT')
  and not has_table_privilege('authenticated', 'public.documents', 'INSERT')
  and not has_table_privilege('authenticated', 'public.documents', 'UPDATE')
  and has_table_privilege('authenticated', 'public.document_versions', 'SELECT')
  and not has_table_privilege('authenticated', 'public.document_versions', 'INSERT'),
  'authenticated clients receive read-only safe-column document privileges'
);
select ok(
  has_column_privilege('authenticated', 'public.document_events', 'event_type', 'SELECT')
  and not has_column_privilege('authenticated', 'public.document_events', 'details', 'SELECT'),
  'authenticated clients cannot read sensitive event details directly'
);
select ok(
  not has_function_privilege(
    'authenticated', 'private.document_membership_access_allowed(uuid,uuid,text)', 'EXECUTE'
  )
  and has_function_privilege(
    'authenticated', 'private.document_access_allowed(uuid,text)', 'EXECUTE'
  ),
  'authenticated clients can use only the current-membership access wrapper'
);
select ok(exists(select 1 from pg_constraint where conname = 'documents_legal_hold_contract'), 'legal-hold evidence is constrained');
select ok(exists(select 1 from pg_constraint where conname = 'documents_archive_contract'), 'archive state is constrained');

select * from finish();
rollback;
