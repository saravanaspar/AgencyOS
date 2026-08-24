begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(34);

select has_table('public', 'finance_document_sequences', 'Finance document sequences exist');
select has_table('public', 'finance_catalog_items', 'Finance catalogue exists');
select has_table('public', 'finance_estimates', 'Estimates exist');
select has_table('public', 'finance_estimate_lines', 'Estimate lines exist');
select has_table('public', 'finance_estimate_versions', 'Estimate version history exists');
select has_table('public', 'finance_invoices', 'Invoices exist');
select has_table('public', 'finance_invoice_lines', 'Invoice lines exist');
select has_table('public', 'finance_invoice_events', 'Invoice event history exists');
select has_table('public', 'finance_payments', 'Payments exist');
select has_table('public', 'finance_payment_allocations', 'Payment allocations exist');

select has_column('public', 'finance_invoices', 'seller_snapshot', 'Invoices preserve seller snapshots');
select has_column('public', 'finance_invoices', 'client_snapshot', 'Invoices preserve client snapshots');
select has_column('public', 'finance_invoices', 'calculation_snapshot', 'Invoices preserve calculation snapshots');
select has_column('public', 'finance_invoices', 'payment_snapshot', 'Invoices preserve payment snapshots');
select has_column('public', 'finance_invoices', 'issued_pdf_file_id', 'Issued invoice PDF may be retained privately');
select has_column('public', 'finance_payments', 'reconciliation_status', 'Payments track reconciliation');

select has_function(
  'private',
  'next_finance_document_number',
  array['uuid', 'text', 'integer', 'text'],
  'Finance numbers are allocated by a database function'
);
select has_function('private', 'set_finance_line_totals', array[]::text[], 'Line totals use one database trigger function');
select has_function('private', 'prevent_issued_invoice_mutation', array[]::text[], 'Issued invoices have an immutability guard');
select has_function('private', 'prevent_issued_invoice_line_mutation', array[]::text[], 'Issued lines have an immutability guard');
select has_function('private', 'prevent_finance_event_mutation', array[]::text[], 'Invoice events are append-only');

select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'finance_estimates_draft_content_unique' and indexdef ilike '%where%'), 'Open estimate duplicates are prevented');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'finance_invoices_draft_content_unique' and indexdef ilike '%where%'), 'Open invoice-draft duplicates are prevented');
select ok(exists (select 1 from pg_trigger where tgname = 'finance_invoices_prevent_issued_mutation' and not tgisinternal), 'Issued invoice mutation trigger exists');
select ok(exists (select 1 from pg_trigger where tgname = 'finance_invoice_lines_prevent_issued_mutation' and not tgisinternal), 'Issued line mutation trigger exists');
select ok(exists (select 1 from pg_trigger where tgname = 'finance_invoice_events_prevent_update' and not tgisinternal), 'Invoice history rejects updates');
select ok(exists (select 1 from pg_trigger where tgname = 'finance_invoice_events_prevent_delete' and not tgisinternal), 'Invoice history rejects deletes');

select is((select relrowsecurity from pg_class where oid = 'public.finance_catalog_items'::regclass), true, 'Catalogue has RLS');
select is((select relrowsecurity from pg_class where oid = 'public.finance_estimates'::regclass), true, 'Estimates have RLS');
select is((select relrowsecurity from pg_class where oid = 'public.finance_invoices'::regclass), true, 'Invoices have RLS');
select is((select relrowsecurity from pg_class where oid = 'public.finance_payments'::regclass), true, 'Payments have RLS');

select ok(not has_table_privilege('anon', 'public.finance_invoices', 'SELECT'), 'Anonymous users cannot read invoices');
select ok(not has_table_privilege('authenticated', 'public.finance_document_sequences', 'UPDATE'), 'Authenticated clients cannot allocate invoice numbers directly');
select ok(exists (select 1 from public.permissions where key = 'finance.invoice.issue'), 'Invoice issue permission is registered');

select * from finish();
rollback;
