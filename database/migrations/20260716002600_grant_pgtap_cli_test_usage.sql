set lock_timeout = '10s';
set statement_timeout = '60s';

-- `supabase test db --linked` connects as the CLI-managed login role. PostgreSQL
-- requires USAGE on an extension's schema before functions in that schema can
-- be resolved, even when the role already has EXECUTE on those functions.
do $grant_pgtap_cli_test_usage$
begin
  if pg_catalog.to_regrole('cli_login_postgres') is not null then
    execute 'grant usage on schema extensions to cli_login_postgres';
  end if;
end
$grant_pgtap_cli_test_usage$;
