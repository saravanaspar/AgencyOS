begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(25);

select has_table('public', 'support_ticket_routing_rules', 'Support routing rules exist');
select has_table('public', 'asset_requests', 'Asset requests exist');
select has_table('public', 'asset_return_requests', 'Asset return requests exist');
select has_column('public', 'support_tickets', 'triage_source', 'Support ticket triage source exists');
select has_column('public', 'procurement_vendor_bills', 'approval_request_id', 'Vendor bill approval link exists');

select ok(exists(select 1 from public.permissions where key = 'support.routing_rule.manage' and is_sensitive), 'Support routing management is sensitive');
select ok(exists(select 1 from public.permissions where key = 'assets.request.submit'), 'Asset request submit permission exists');
select ok(exists(select 1 from public.permissions where key = 'assets.request.manage' and is_sensitive), 'Asset request management is sensitive');
select ok(exists(select 1 from public.permissions where key = 'assets.return_request.acknowledge' and not is_sensitive), 'Return acknowledgement is narrow');
select ok(exists(select 1 from public.permissions where key = 'assets.return_request.manage' and is_sensitive), 'Return management is sensitive');
select ok(exists(select 1 from public.permissions where key = 'vendors.bill.submit' and is_sensitive), 'Vendor bill submission is sensitive');

select ok((select relrowsecurity from pg_class where oid = 'public.support_ticket_routing_rules'::regclass), 'Routing rules use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.asset_requests'::regclass), 'Asset requests use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.asset_return_requests'::regclass), 'Asset return requests use RLS');

select ok(exists(select 1 from pg_trigger where tgrelid = 'public.support_tickets'::regclass and tgname = 'support_tickets_automatic_triage' and not tgisinternal), 'Support automatic triage trigger exists');
select ok(exists(select 1 from pg_trigger where tgrelid = 'public.hr_offboarding_plans'::regclass and tgname = 'hr_offboarding_asset_return_requests' and not tgisinternal), 'Offboarding return trigger exists');
select ok(exists(select 1 from pg_trigger where tgrelid = 'public.hr_offboarding_plans'::regclass and tgname = 'hr_offboarding_sync_asset_return_requests' and not tgisinternal), 'Offboarding return synchronization exists');
select ok(exists(select 1 from pg_trigger where tgrelid = 'public.memberships'::regclass and tgname = 'memberships_transfer_asset_return_requests' and not tgisinternal), 'Transfer return trigger exists');
select ok(exists(select 1 from pg_trigger where tgrelid = 'public.approval_requests'::regclass and tgname = 'asset_request_approval_result' and not tgisinternal), 'Asset approval synchronization exists');
select ok(exists(select 1 from pg_trigger where tgrelid = 'public.approval_requests'::regclass and tgname = 'vendor_bill_approval_result' and not tgisinternal), 'Vendor bill approval synchronization exists');

select ok(not has_table_privilege('authenticated', 'public.asset_requests', 'INSERT'), 'Authenticated clients cannot forge Asset requests');
select ok(not has_table_privilege('authenticated', 'public.asset_return_requests', 'UPDATE'), 'Authenticated clients cannot rewrite return requests');
select ok(not has_table_privilege('authenticated', 'public.support_ticket_routing_rules', 'INSERT'), 'Authenticated clients cannot bypass routing actions');
select ok(has_table_privilege('authenticated', 'public.asset_requests', 'SELECT'), 'Authorized Asset requests are visible through RLS');
select ok(has_table_privilege('authenticated', 'public.asset_return_requests', 'SELECT'), 'Authorized return requests are visible through RLS');

select * from finish();
rollback;
