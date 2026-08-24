begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(48);

select has_table('public', 'legal_access_review_campaigns', 'legal access-review campaigns exist');
select has_table('public', 'legal_access_review_items', 'legal access-review item snapshots exist');
select has_table('public', 'legal_access_review_attestations', 'legal access-review attestations exist');
select has_table('public', 'legal_access_review_completions', 'legal access-review completions exist');

select has_column('public', 'legal_access_review_campaigns', 'scheduled_for', 'campaign cycle date is retained');
select has_column('public', 'legal_access_review_campaigns', 'due_at', 'campaign review deadline is retained');
select has_column('public', 'legal_access_review_campaigns', 'snapshot_item_count', 'campaign snapshot count is retained');
select has_column('public', 'legal_access_review_items', 'access_snapshot', 'effective access sources are retained');
select has_column('public', 'legal_access_review_items', 'snapshot_digest', 'item SHA-256 is retained');
select has_column('public', 'legal_access_review_attestations', 'decision', 'retain or revoke decision is retained');
select has_column('public', 'legal_access_review_attestations', 'rationale', 'attestation rationale is retained');
select has_column('public', 'legal_access_review_attestations', 'self_review', 'self-review evidence is explicit');
select has_column('public', 'legal_access_review_attestations', 'revocation_snapshot', 'deny override evidence is retained');
select has_column('public', 'legal_access_review_attestations', 'attestation_digest', 'attestation SHA-256 is retained');
select has_column('public', 'legal_access_review_completions', 'evidence_snapshot', 'completion evidence is retained');
select has_column('public', 'legal_access_review_completions', 'evidence_digest', 'completion SHA-256 is retained');

select has_index('public', 'legal_access_review_campaigns', 'legal_access_review_campaigns_one_open_idx', 'only one campaign can remain open per organization');
select has_index('public', 'legal_access_review_campaigns', 'legal_access_review_campaigns_history_idx', 'campaign history is indexed');
select has_index('public', 'legal_access_review_items', 'legal_access_review_items_campaign_idx', 'campaign items are indexed');
select has_index('public', 'legal_access_review_attestations', 'legal_access_review_attestations_campaign_idx', 'campaign attestations are indexed');
select has_index('public', 'legal_access_review_completions', 'legal_access_review_completions_history_idx', 'completion history is indexed');

select ok((select relrowsecurity from pg_class where oid = 'public.legal_access_review_campaigns'::regclass), 'campaigns have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.legal_access_review_items'::regclass), 'items have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.legal_access_review_attestations'::regclass), 'attestations have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.legal_access_review_completions'::regclass), 'completions have RLS');

select ok(exists(select 1 from public.permissions where key = 'legal.access_review.view' and is_sensitive), 'sensitive review-view permission exists');
select ok(exists(select 1 from public.permissions where key = 'legal.access_review.manage_access' and is_sensitive), 'sensitive review-management permission exists');
select ok(exists(
  select 1 from public.role_template_permissions as grant_row
  join public.permissions as permission on permission.id = grant_row.permission_id
  where grant_row.role_template_key = 'owner'
    and permission.key = 'legal.access_review.manage_access'
    and grant_row.scope = 'organization'
), 'owners manage organization access reviews');
select ok(exists(
  select 1 from public.role_template_permissions as grant_row
  join public.permissions as permission on permission.id = grant_row.permission_id
  where grant_row.role_template_key = 'legal_manager'
    and permission.key = 'legal.access_review.manage_access'
    and grant_row.scope = 'organization'
), 'legal managers manage organization access reviews');
select ok(exists(
  select 1 from public.role_template_permissions as grant_row
  join public.permissions as permission on permission.id = grant_row.permission_id
  where grant_row.role_template_key = 'auditor'
    and permission.key = 'legal.access_review.view'
    and grant_row.scope = 'organization'
), 'auditors receive organization review visibility');
select ok(not exists(
  select 1 from public.role_template_permissions as grant_row
  join public.permissions as permission on permission.id = grant_row.permission_id
  where grant_row.role_template_key = 'auditor'
    and permission.key = 'legal.access_review.manage_access'
), 'auditors do not receive review management');

select ok(exists(select 1 from pg_trigger where tgname = 'legal_access_review_campaigns_protect' and not tgisinternal), 'campaign identity and history are protected');
select ok(exists(select 1 from pg_trigger where tgname = 'legal_access_review_items_immutable' and not tgisinternal), 'item snapshots are immutable');
select ok(exists(select 1 from pg_trigger where tgname = 'legal_access_review_attestations_immutable' and not tgisinternal), 'attestations are immutable');
select ok(exists(select 1 from pg_trigger where tgname = 'legal_access_review_completions_immutable' and not tgisinternal), 'completion evidence is immutable');
select ok(exists(select 1 from pg_trigger where tgname = 'legal_access_review_completions_validate' and not tgisinternal), 'completion validates full attestation coverage');

select ok(exists(select 1 from pg_constraint where conname = 'legal_access_review_campaigns_schedule_valid'), 'fourteen-day campaign window is constrained');
select ok(exists(select 1 from pg_constraint where conname = 'legal_access_review_attestations_item_fk'), 'attestations bind to campaign items');
select ok(exists(select 1 from pg_constraint where conname = 'legal_access_review_attestations_decision_valid'), 'attestation decision vocabulary is constrained');
select ok(exists(select 1 from pg_constraint where conname = 'legal_access_review_completions_counts_valid'), 'completion counts must reconcile');

select ok(exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'legal_access_review_campaigns' and policyname = 'legal_access_review_campaigns_select'), 'campaign select policy exists');
select ok(exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'legal_access_review_items' and policyname = 'legal_access_review_items_select'), 'item select policy exists');
select ok(exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'legal_access_review_attestations' and policyname = 'legal_access_review_attestations_select'), 'attestation select policy exists');
select ok(exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'legal_access_review_completions' and policyname = 'legal_access_review_completions_select'), 'completion select policy exists');

select ok(
  has_table_privilege('authenticated', 'public.legal_access_review_campaigns', 'SELECT')
  and not has_table_privilege('authenticated', 'public.legal_access_review_campaigns', 'INSERT')
  and not has_table_privilege('authenticated', 'public.legal_access_review_campaigns', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.legal_access_review_campaigns', 'DELETE'),
  'authenticated campaign access is read-only'
);
select ok(
  has_table_privilege('authenticated', 'public.legal_access_review_items', 'SELECT')
  and not has_table_privilege('authenticated', 'public.legal_access_review_items', 'INSERT')
  and not has_table_privilege('authenticated', 'public.legal_access_review_items', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.legal_access_review_items', 'DELETE'),
  'authenticated item evidence is read-only'
);
select ok(
  has_table_privilege('authenticated', 'public.legal_access_review_attestations', 'SELECT')
  and not has_table_privilege('authenticated', 'public.legal_access_review_attestations', 'INSERT')
  and not has_table_privilege('authenticated', 'public.legal_access_review_completions', 'INSERT'),
  'attestation and completion writes remain server-only'
);
select ok(
  not has_function_privilege('authenticated', 'private.legal_access_review_membership_access_allowed(uuid,uuid,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'private.legal_access_review_access_allowed(uuid,text)', 'EXECUTE'),
  'authenticated clients can invoke only the current-membership access wrapper'
);

select * from finish();
rollback;
