-- Resolve pgTAP from the schema where the target PostgreSQL provider installed it.
-- Tests run through DATABASE_ADMIN_URL and do not depend on a hosted database CLI.
do $pgtap_bootstrap$
declare
  pgtap_schema text;
begin
  select ns.nspname
  into pgtap_schema
  from pg_catalog.pg_extension as ext
  join pg_catalog.pg_namespace as ns on ns.oid = ext.extnamespace
  where ext.extname = 'pgtap';

  if pgtap_schema is null then
    raise exception using
      errcode = '55000',
      message = 'The pgTAP extension is not installed in the target database.',
      hint = 'Run npm run db:migrate and verify migration 20260716002500_enable_pgtap.sql is applied.';
  end if;

  if not pg_catalog.has_schema_privilege(current_user, pgtap_schema, 'USAGE') then
    raise exception using
      errcode = '42501',
      message = pg_catalog.format(
        'Database test role %I does not have USAGE on the pgTAP schema %I.',
        current_user,
        pgtap_schema
      ),
      hint = 'Use the direct administrative DATABASE_ADMIN_URL for database tests.';
  end if;

  -- Several RLS suites intentionally SET LOCAL ROLE authenticated before making
  -- assertions. Allow that role to resolve pgTAP only for the surrounding test
  -- transaction; every suite ends with ROLLBACK, so production grants are unchanged.
  if pg_catalog.to_regrole('authenticated') is not null then
    execute pg_catalog.format('grant usage on schema %I to authenticated', pgtap_schema);
  end if;

  perform pg_catalog.set_config(
    'search_path',
    pg_catalog.format('pg_catalog,%I,public,private', pgtap_schema),
    true
  );
end
$pgtap_bootstrap$;
