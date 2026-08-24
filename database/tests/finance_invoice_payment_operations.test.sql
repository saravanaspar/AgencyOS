begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(35);

select has_table('public', 'finance_invoice_attachments', 'Invoice attachments exist');
select has_table('public', 'finance_payment_refunds', 'Payment refunds exist');

select has_column('public', 'finance_invoices', 'exchange_rate', 'Invoices retain exchange-rate evidence');
select has_column('public', 'finance_invoices', 'dispute_reason', 'Invoices retain dispute evidence');
select has_column('public', 'finance_invoices', 'dispute_resolved_at', 'Invoices retain dispute resolution time');
select has_column('public', 'finance_payments', 'refunded_minor', 'Payments retain refunded total');

select has_function('private', 'validate_finance_invoice_attachment', array[]::text[], 'Attachment tenant validation exists');
select has_function('private', 'prevent_issued_invoice_attachment_delete', array[]::text[], 'Issued attachments cannot be deleted');
select has_function('private', 'prevent_issued_invoice_exchange_rate_mutation', array[]::text[], 'Issued exchange rate is immutable');
select has_function('private', 'validate_finance_payment_refund', array[]::text[], 'Refund validation exists');
select has_function('private', 'refresh_finance_payment_refund_state', array[]::text[], 'Refund state refresh exists');
select has_function('private', 'prevent_finance_payment_refund_mutation', array[]::text[], 'Refund evidence is immutable');

select ok(exists (select 1 from pg_trigger where tgname = 'finance_invoice_attachments_validate' and not tgisinternal), 'Attachment validation trigger exists');
select ok(exists (select 1 from pg_trigger where tgname = 'finance_invoice_attachments_prevent_issued_delete' and not tgisinternal), 'Issued attachment delete trigger exists');
select ok(exists (select 1 from pg_trigger where tgname = 'finance_invoices_prevent_issued_exchange_rate_mutation' and not tgisinternal), 'Exchange-rate immutability trigger exists');
select ok(exists (select 1 from pg_trigger where tgname = 'finance_payment_refunds_validate' and not tgisinternal), 'Refund validation trigger exists');
select ok(exists (select 1 from pg_trigger where tgname = 'finance_payment_refunds_refresh_payment' and not tgisinternal), 'Refund-state trigger exists');
select ok(exists (select 1 from pg_trigger where tgname = 'finance_payment_refunds_prevent_update' and not tgisinternal), 'Refund update is blocked');
select ok(exists (select 1 from pg_trigger where tgname = 'finance_payment_refunds_prevent_delete' and not tgisinternal), 'Refund deletion is blocked');

select is((select relrowsecurity from pg_class where oid = 'public.finance_invoice_attachments'::regclass), true, 'Invoice attachments have RLS');
select is((select relrowsecurity from pg_class where oid = 'public.finance_payment_refunds'::regclass), true, 'Payment refunds have RLS');

select ok(not has_table_privilege('anon', 'public.finance_invoice_attachments', 'SELECT'), 'Anonymous users cannot read invoice attachments');
select ok(not has_table_privilege('anon', 'public.finance_payment_refunds', 'SELECT'), 'Anonymous users cannot read payment refunds');
select ok(has_table_privilege('authenticated', 'public.finance_invoice_attachments', 'SELECT'), 'Authenticated users may read invoice attachments through RLS');
select ok(has_table_privilege('authenticated', 'public.finance_payment_refunds', 'SELECT'), 'Authenticated users may read payment refunds through RLS');
select ok(not has_table_privilege('authenticated', 'public.finance_payment_refunds', 'DELETE'), 'Authenticated users cannot delete refund evidence');

select ok(exists (select 1 from public.permissions where key = 'finance.invoice_attachment.manage' and is_sensitive), 'Attachment permission exists');
select ok(exists (select 1 from public.permissions where key = 'finance.invoice_status.manage' and is_sensitive), 'Invoice status permission exists');
select ok(exists (select 1 from public.permissions where key = 'finance.payment.refund' and is_sensitive), 'Refund permission exists');

select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'finance_invoice_attachments' and policyname = 'finance_invoice_attachments_select_authorized'), 'Attachment select policy exists');
select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'finance_payment_refunds' and policyname = 'finance_payment_refunds_insert_authorized'), 'Refund insert policy exists');

select ok(exists (
  select 1 from pg_constraint where conrelid = 'public.finance_document_snapshots'::regclass
    and pg_get_constraintdef(oid) ilike '%payment_receipt%'
), 'Immutable finance snapshots accept payment receipts');
select ok(exists (
  select 1 from pg_constraint where conrelid = 'public.finance_invoice_events'::regclass
    and pg_get_constraintdef(oid) ilike '%disputed%'
    and pg_get_constraintdef(oid) ilike '%overdue%'
), 'Invoice events accept operational statuses');
select ok(exists (
  select 1 from pg_constraint where conrelid = 'public.finance_payments'::regclass
    and conname = 'finance_payments_refunded_valid'
), 'Refund total is bounded by payment amount');
select ok(exists (
  select 1 from pg_indexes where schemaname = 'public'
    and indexname = 'finance_payment_refunds_reference_unique'
), 'Refund references are duplicate protected');

select * from finish();
rollback;
