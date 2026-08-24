begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(36);

select has_table('public', 'document_review_requests', 'document review requests table exists');
select has_table('public', 'document_publications', 'document publications table exists');
select has_table('public', 'document_publication_audiences', 'document publication audiences table exists');
select has_column('public', 'document_review_requests', 'approval_request_id', 'review links the shared approval request');
select has_column('public', 'document_review_requests', 'version_id', 'review pins one immutable version');
select has_column('public', 'document_publications', 'version_id', 'publication pins one immutable version');
select has_column('public', 'document_publications', 'supersedes_publication_id', 'publication tracks supersession lineage');
select has_column('public', 'document_publications', 'withdrawal_reason', 'withdrawal evidence is retained');
select has_column('public', 'document_publication_audiences', 'audience_type', 'publication audience type is stored');
select has_index('public', 'document_review_requests', 'document_review_requests_pending_document_unique', 'one pending review per document is enforced');
select has_index('public', 'document_publications', 'document_publications_one_active_unique', 'one active publication per document is enforced');
select has_index('public', 'document_publications', 'document_publications_history_idx', 'publication history is indexed');
select ok((select relrowsecurity from pg_class where oid = 'public.document_review_requests'::regclass), 'review requests have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.document_publications'::regclass), 'publications have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.document_publication_audiences'::regclass), 'publication audiences have RLS');
select ok(exists(select 1 from public.permissions where key = 'documents.document.submit_approval' and is_sensitive), 'review submission permission exists');
select ok(exists(select 1 from public.permissions where key = 'documents.document.publish' and is_sensitive), 'publication permission exists');
select ok(exists(select 1 from public.permissions where key = 'documents.document.withdraw' and is_sensitive), 'withdrawal permission exists');
select ok(exists(
  select 1 from public.role_template_permissions rtp join public.permissions p on p.id = rtp.permission_id
  where rtp.role_template_key = 'legal_manager' and p.key = 'documents.document.publish'
), 'legal managers receive publication control');
select ok(exists(
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'apply_document_review_approval_result' and p.prosecdef
), 'approval results synchronize review history through a security-definer trigger');
select ok(exists(select 1 from pg_trigger where tgname = 'approval_requests_apply_document_review' and not tgisinternal), 'approval result trigger exists');
select ok(exists(select 1 from pg_trigger where tgname = 'document_versions_block_pending_review' and not tgisinternal), 'pending review blocks new versions');
select ok(exists(select 1 from pg_trigger where tgname = 'document_review_requests_prevent_delete' and not tgisinternal), 'review history deletion is blocked');
select ok(exists(select 1 from pg_trigger where tgname = 'document_publications_prevent_delete' and not tgisinternal), 'publication deletion is blocked');
select ok(exists(select 1 from pg_trigger where tgname = 'document_publication_audiences_prevent_update' and not tgisinternal), 'audience mutation is blocked');
select ok(exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'document_review_requests' and policyname = 'document_review_requests_select_authorized'), 'review select policy exists');
select ok(exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'document_publications' and policyname = 'document_publications_select_authorized'), 'publication select policy exists');
select ok(exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'document_publication_audiences' and policyname = 'document_publication_audiences_select_authorized'), 'audience select policy exists');
select ok(
  has_column_privilege('authenticated', 'public.document_review_requests', 'status', 'SELECT')
  and not has_table_privilege('authenticated', 'public.document_review_requests', 'INSERT')
  and not has_table_privilege('authenticated', 'public.document_review_requests', 'UPDATE'),
  'review history is authenticated read-only'
);
select ok(
  has_column_privilege('authenticated', 'public.document_publications', 'release_note', 'SELECT')
  and not has_column_privilege('authenticated', 'public.document_publications', 'withdrawal_reason', 'SELECT')
  and not has_table_privilege('authenticated', 'public.document_publications', 'INSERT')
  and not has_table_privilege('authenticated', 'public.document_publications', 'UPDATE'),
  'publication history exposes safe columns only and is authenticated read-only'
);
select ok(
  has_column_privilege('authenticated', 'public.document_publication_audiences', 'audience_type', 'SELECT')
  and not has_column_privilege('authenticated', 'public.document_publication_audiences', 'audience_id', 'SELECT')
  and not has_table_privilege('authenticated', 'public.document_publication_audiences', 'INSERT'),
  'audience target identifiers are hidden from ordinary authenticated SQL clients'
);
select ok(
  not has_function_privilege('authenticated', 'private.apply_document_review_approval_result()', 'EXECUTE'),
  'authenticated clients cannot invoke review synchronization directly'
);
select ok(exists(select 1 from pg_constraint where conname = 'document_publications_terminal_contract'), 'publication terminal evidence is constrained');
select ok(exists(select 1 from pg_constraint where conname = 'document_publication_audiences_target_contract'), 'publication audience targets are constrained');
select ok(exists(select 1 from pg_constraint where conname = 'document_review_requests_completion_contract'), 'review completion evidence is constrained');
select ok(exists(
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'document_membership_access_allowed'
    and pg_get_functiondef(p.oid) like '%v_publication_allowed%'
), 'published audience visibility is evaluated by the existing document access helper');

select * from finish();
rollback;
