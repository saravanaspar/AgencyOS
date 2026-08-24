set lock_timeout = '10s';
set statement_timeout = '60s';

-- The linked pgTAP suite runs inside the target database. Supabase projects do
-- not guarantee that pgTAP is enabled by default, so provision it explicitly.
create extension if not exists pgtap with schema extensions;

comment on extension pgtap is
  'Database assertion functions used by the AgencyOS linked pgTAP test suite.';
