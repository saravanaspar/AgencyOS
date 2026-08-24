begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(41);

select has_table('public', 'legal_contract_templates', 'legal contract templates exist');
select has_table('public', 'legal_contracts', 'legal contracts exist');
select has_table('public', 'legal_contract_versions', 'legal contract versions exist');
select has_table('public', 'legal_contract_events', 'legal contract events exist');
select has_table('public', 'legal_contract_reminders', 'legal contract reminders exist');
select has_column('public', 'legal_contracts', 'internal_reference', 'contracts have internal references');
select has_column('public', 'legal_contracts', 'counterparty_name', 'contracts have counterparties');
select has_column('public', 'legal_contracts', 'renewal_date', 'contracts track renewal dates');
select has_column('public', 'legal_contracts', 'notice_period_days', 'contracts track notice periods');
select has_column('public', 'legal_contracts', 'signature_status', 'contracts track signatures');
select has_column('public', 'legal_contracts', 'approval_request_id', 'contracts link approvals');
select has_column('public', 'legal_contract_versions', 'document_version_id', 'versions reuse Documents versions');
select has_index('public', 'legal_contracts', 'legal_contracts_workspace_idx', 'workspace query is indexed');
select has_index('public', 'legal_contracts', 'legal_contracts_renewal_idx', 'renewals are indexed');
select has_index('public', 'legal_contract_versions', 'legal_contract_versions_history_idx', 'version history is indexed');
select has_index('public', 'legal_contract_events', 'legal_contract_events_history_idx', 'lifecycle history is indexed');
select has_index('public', 'legal_contract_reminders', 'legal_contract_reminders_due_idx', 'due reminders are indexed');
select ok((select relrowsecurity from pg_class where oid = 'public.legal_contract_templates'::regclass), 'templates have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.legal_contracts'::regclass), 'contracts have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.legal_contract_versions'::regclass), 'versions have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.legal_contract_events'::regclass), 'events have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.legal_contract_reminders'::regclass), 'reminders have RLS');
select ok(exists(select 1 from public.permissions where key = 'legal.contract.view' and is_sensitive), 'view permission exists');
select ok(exists(select 1 from public.permissions where key = 'legal.contract.manage_templates' and is_sensitive), 'template permission exists');
select ok(exists(select 1 from public.permissions where key = 'legal.contract.manage_signatures' and is_sensitive), 'signature permission exists');
select ok(exists(select 1 from public.permissions where key = 'legal.contract.manage_lifecycle' and is_sensitive), 'lifecycle permission exists');
select ok(exists(
  select 1 from public.role_template_permissions rtp join public.permissions p on p.id = rtp.permission_id
  where rtp.role_template_key = 'legal_manager' and p.key = 'legal.contract.manage_lifecycle'
), 'legal managers receive lifecycle control');
select ok(exists(
  select 1 from public.role_template_permissions rtp join public.permissions p on p.id = rtp.permission_id
  where rtp.role_template_key = 'sales_manager' and p.key = 'legal.contract.create' and rtp.scope = 'own'
), 'business managers receive own-scope requests');
select ok(exists(
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'legal_contract_membership_access_allowed' and p.prosecdef
), 'contract scope uses a security-definer helper');
select ok(exists(select 1 from pg_trigger where tgname = 'legal_contract_versions_no_update' and not tgisinternal), 'approved version mutation is blocked');
select ok(exists(select 1 from pg_trigger where tgname = 'legal_contract_versions_no_delete' and not tgisinternal), 'version deletion is blocked');
select ok(exists(select 1 from pg_trigger where tgname = 'approval_requests_apply_legal_contract' and not tgisinternal), 'approval results update contracts');
select ok(exists(select 1 from pg_trigger where tgname = 'legal_contracts_sync_reminders' and not tgisinternal), 'contract dates create reminder rows');
select ok(exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'legal_contracts' and policyname = 'legal_contracts_select'), 'contract select policy exists');
select ok(exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'legal_contract_reminders' and policyname = 'legal_contract_reminders_select'), 'reminder select policy exists');
select ok(
  has_column_privilege('authenticated', 'public.legal_contracts', 'title', 'SELECT')
  and not has_column_privilege('authenticated', 'public.legal_contracts', 'termination_reason', 'SELECT')
  and not has_table_privilege('authenticated', 'public.legal_contracts', 'INSERT'),
  'authenticated clients receive read-only safe contract columns'
);
select ok(
  has_column_privilege('authenticated', 'public.legal_contract_events', 'event_type', 'SELECT')
  and not has_column_privilege('authenticated', 'public.legal_contract_events', 'details', 'SELECT')
  and not has_table_privilege('authenticated', 'public.legal_contract_events', 'INSERT'),
  'authenticated clients cannot read sensitive legal event details'
);
select ok(
  not has_function_privilege('authenticated', 'private.legal_contract_membership_access_allowed(uuid,uuid,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'private.legal_contract_access_allowed(uuid,text)', 'EXECUTE'),
  'authenticated users can invoke only the current-membership access wrapper'
);
select ok(exists(select 1 from pg_constraint where conname = 'legal_contracts_termination_contract'), 'termination evidence is constrained');
select ok(exists(select 1 from pg_constraint where conname = 'legal_contract_reminders_ack_contract'), 'reminder acknowledgement evidence is constrained');
select ok(exists(select 1 from pg_constraint where conname = 'document_entity_links_type_valid'), 'document links accept contract entities');

select * from finish();
rollback;
