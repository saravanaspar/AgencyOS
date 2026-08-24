begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(4);

select has_column(
  'public',
  'organization_security_policies',
  'ai_limit_per_minute',
  'Organization security policies expose a dedicated AI limit'
);
select col_not_null(
  'public',
  'organization_security_policies',
  'ai_limit_per_minute',
  'AI limits cannot be null'
);
select col_default_is(
  'public',
  'organization_security_policies',
  'ai_limit_per_minute',
  '10',
  'AI limits default to ten chat requests per minute'
);
select ok(
  (
    select pg_get_constraintdef(oid) ilike '%ai_limit_per_minute between 1 and 100%'
    from pg_constraint
    where conrelid = 'public.organization_security_policies'::regclass
      and conname = 'organization_security_policy_rate_bounds'
  ),
  'The database bounds the dedicated AI limit'
);

select * from finish();
rollback;
