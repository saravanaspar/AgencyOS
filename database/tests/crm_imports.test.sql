begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(18);

select has_table('public', 'crm_import_connections', 'CRM import connections table exists');
select has_table('public', 'crm_import_runs', 'CRM import runs table exists');
select has_table('public', 'crm_import_errors', 'CRM import row errors table exists');
select has_table('public', 'crm_external_records', 'External CRM identity table exists');
select has_table('public', 'crm_webhook_deliveries', 'Webhook idempotency table exists');

select has_column(
  'public',
  'crm_import_connections',
  'encrypted_credentials',
  'Connector credentials have a dedicated encrypted envelope column'
);
select has_column(
  'public',
  'crm_import_connections',
  'webhook_key_hash',
  'Webhook keys can be stored as one-way hashes'
);
select has_column(
  'public',
  'crm_import_errors',
  'redacted_payload',
  'Import errors retain only redacted payload data'
);
select has_column(
  'public',
  'crm_external_records',
  'payload_hash',
  'External records retain a deterministic payload hash'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'crm_import_connections_provider_mode_valid'
  ),
  'Provider mode combinations are constrained'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'crm_import_runs_duplicate_policy_valid'
  ),
  'Duplicate policy is constrained to skip or merge'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.crm_external_records'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) =
        'UNIQUE (organization_id, provider, external_object, external_id)'
  ),
  'External lead identifiers are unique per organization and provider'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'crm_webhook_deliveries_connection_id_provider_event_id_key'
  ),
  'Webhook event identifiers are idempotent per connection'
);

select is(
  (select relrowsecurity from pg_class where oid = 'public.crm_import_connections'::regclass),
  true,
  'CRM import connections have RLS enabled'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.crm_import_runs'::regclass),
  true,
  'CRM import runs have RLS enabled'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.crm_external_records'::regclass),
  true,
  'External CRM records have RLS enabled'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'crm_import_connections'
      and policyname = 'crm_import_connections_select_authorized'
  ),
  'Connection metadata requires the CRM import view permission'
);
select ok(
  not has_table_privilege('authenticated', 'public.crm_import_connections', 'INSERT'),
  'Authenticated clients cannot write connector secrets directly'
);

select * from finish();
rollback;
