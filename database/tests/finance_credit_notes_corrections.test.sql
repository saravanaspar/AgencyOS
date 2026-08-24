begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(41);

select has_table('public', 'finance_credit_notes', 'Credit notes exist');
select has_table('public', 'finance_credit_note_lines', 'Credit-note lines exist');
select has_table('public', 'finance_credit_note_events', 'Credit-note events exist');

select has_column('public', 'finance_invoices', 'correction_of_invoice_id', 'Revised invoices retain source lineage');
select has_column('public', 'finance_invoices', 'credited_minor', 'Invoices retain applied credit total');
select has_column('public', 'finance_invoices', 'credit_due_minor', 'Invoices retain refundable credit due');
select has_column('public', 'finance_credit_notes', 'original_invoice_id', 'Credit notes reference an original invoice');
select has_column('public', 'finance_credit_notes', 'original_invoice_snapshot', 'Issued credit notes freeze original invoice evidence');

select has_function('private', 'validate_invoice_correction_tenant', array[]::text[], 'Revised invoice tenant validation exists');
select has_function('private', 'validate_credit_note_tenant', array[]::text[], 'Credit-note tenant validation exists');
select has_function('private', 'validate_credit_note_line_tenant', array[]::text[], 'Credit-note line tenant validation exists');
select has_function('private', 'refresh_finance_credit_note_totals', array[]::text[], 'Credit-note totals refresh exists');
select has_function('private', 'prevent_issued_credit_note_mutation', array[]::text[], 'Issued credit notes are immutable');
select has_function('private', 'prevent_issued_credit_note_line_mutation', array[]::text[], 'Issued credit-note lines are immutable');
select has_function('private', 'refresh_invoice_credit_totals', array[]::text[], 'Invoice credit application and reversal exists');

select ok(exists (select 1 from pg_trigger where tgname = 'finance_invoices_validate_correction' and not tgisinternal), 'Revised invoice validation trigger exists');
select ok(exists (select 1 from pg_trigger where tgname = 'finance_credit_notes_validate_tenant' and not tgisinternal), 'Credit-note validation trigger exists');
select ok(exists (select 1 from pg_trigger where tgname = 'finance_credit_notes_prevent_issued_mutation' and not tgisinternal), 'Issued credit-note mutation trigger exists');
select ok(exists (select 1 from pg_trigger where tgname = 'finance_credit_note_lines_prevent_issued_mutation' and not tgisinternal), 'Issued line mutation trigger exists');
select ok(exists (select 1 from pg_trigger where tgname = 'finance_credit_notes_refresh_invoice' and not tgisinternal), 'Credit application trigger exists');
select ok(exists (select 1 from pg_trigger where tgname = 'finance_credit_note_events_prevent_update' and not tgisinternal), 'Credit-note events are append-only');

select is((select relrowsecurity from pg_class where oid = 'public.finance_credit_notes'::regclass), true, 'Credit notes have RLS');
select is((select relrowsecurity from pg_class where oid = 'public.finance_credit_note_lines'::regclass), true, 'Credit-note lines have RLS');
select is((select relrowsecurity from pg_class where oid = 'public.finance_credit_note_events'::regclass), true, 'Credit-note events have RLS');

select ok(not has_table_privilege('anon', 'public.finance_credit_notes', 'SELECT'), 'Anonymous users cannot read credit notes');
select ok(not has_table_privilege('anon', 'public.finance_credit_note_lines', 'SELECT'), 'Anonymous users cannot read credit-note lines');
select ok(not has_table_privilege('anon', 'public.finance_credit_note_events', 'SELECT'), 'Anonymous users cannot read credit-note events');
select ok(has_table_privilege('authenticated', 'public.finance_credit_notes', 'SELECT'), 'Authenticated users may read credit notes through RLS');
select ok(has_table_privilege('authenticated', 'public.finance_credit_note_lines', 'SELECT'), 'Authenticated users may read credit-note lines through RLS');
select ok(not has_table_privilege('authenticated', 'public.finance_credit_note_events', 'INSERT'), 'Authenticated users cannot forge credit-note events');

select ok(exists (select 1 from public.permissions where key = 'finance.invoice.correct' and is_sensitive), 'Invoice correction permission exists');
select ok(exists (select 1 from public.permissions where key = 'finance.credit_note.view' and is_sensitive), 'Credit-note view permission exists');
select ok(exists (select 1 from public.permissions where key = 'finance.credit_note.create' and is_sensitive), 'Credit-note create permission exists');
select ok(exists (select 1 from public.permissions where key = 'finance.credit_note.approve' and is_sensitive), 'Credit-note approval permission exists');
select ok(exists (select 1 from public.permissions where key = 'finance.credit_note.issue' and is_sensitive), 'Credit-note issue permission exists');
select ok(exists (select 1 from public.permissions where key = 'finance.credit_note.void' and is_sensitive), 'Credit-note void permission exists');

select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'finance_credit_notes' and policyname = 'finance_credit_notes_select_authorized'), 'Credit-note select policy exists');
select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'finance_credit_note_lines' and policyname = 'finance_credit_note_lines_insert_authorized'), 'Credit-note line insert policy exists');
select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'finance_credit_note_events' and policyname = 'finance_credit_note_events_select_authorized'), 'Credit-note event select policy exists');

select ok(exists (
  select 1 from pg_indexes where schemaname = 'public'
    and indexname = 'finance_credit_notes_draft_content_unique'
    and indexdef ilike '%where%'
), 'Open credit-note drafts are duplicate protected');
select ok(exists (
  select 1 from pg_constraint where conrelid = 'public.finance_document_snapshots'::regclass
    and pg_get_constraintdef(oid) ilike '%credit_note%'
), 'Immutable finance snapshots accept credit notes');

select * from finish();
rollback;
