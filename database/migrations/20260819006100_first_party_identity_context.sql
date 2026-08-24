-- Remove the final runtime dependency on provider-owned auth helpers.
-- Historical migrations used auth.uid(); current AgencyOS policies and trigger
-- guards resolve identity from the AgencyOS request identity setting instead.

set lock_timeout = '10s';
set statement_timeout = '120s';

create or replace function private.current_identity_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('request.identity.id', true), '')::uuid
$$;

-- Replace auth.uid() in existing private functions without copying their
-- business logic into another migration. Database-scoped RLS tests and any future constrained
-- client set only request.identity.id; runtime server authorization remains explicit.
do $functions$
declare
  function_row record;
  definition text;
begin
  for function_row in
    select procedure.oid
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.prokind in ('f', 'p')
      and pg_get_functiondef(procedure.oid) like '%auth.uid()%'
  loop
    definition := pg_get_functiondef(function_row.oid);
    definition := replace(definition, 'auth.uid()', 'private.current_identity_id()');
    execute definition;
  end loop;
end
$functions$;

-- Policies are catalog objects rather than function bodies, so update only the
-- policies that still contain the legacy helper.
do $policies$
declare
  policy_row record;
  using_expression text;
  check_expression text;
  statement text;
begin
  for policy_row in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where coalesce(qual, '') like '%auth.uid()%'
       or coalesce(with_check, '') like '%auth.uid()%'
  loop
    using_expression := case
      when policy_row.qual is null then null
      else replace(policy_row.qual, 'auth.uid()', 'private.current_identity_id()')
    end;
    check_expression := case
      when policy_row.with_check is null then null
      else replace(policy_row.with_check, 'auth.uid()', 'private.current_identity_id()')
    end;

    statement := format(
      'alter policy %I on %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
    if using_expression is not null then
      statement := statement || format(' using (%s)', using_expression);
    end if;
    if check_expression is not null then
      statement := statement || format(' with check (%s)', check_expression);
    end if;
    execute statement;
  end loop;
end
$policies$;

revoke all on function private.current_identity_id() from public, anon;
grant execute on function private.current_identity_id() to authenticated, service_role;

comment on function private.current_identity_id() is
  'AgencyOS request identity for RLS and database-scoped authorization tests.';
