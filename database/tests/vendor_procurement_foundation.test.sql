begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(25);

select has_table('public', 'vendors', 'vendors table exists');
select has_table('public', 'vendor_financial_profiles', 'vendor financial profiles exist');
select has_table('public', 'vendor_contacts', 'vendor contacts exist');
select has_table('public', 'vendor_notes', 'vendor notes exist');
select has_table('public', 'procurement_purchase_requests', 'purchase requests exist');
select has_table('public', 'procurement_vendor_quotations', 'vendor quotations exist');
select has_table('public', 'procurement_purchase_orders', 'purchase orders exist');
select has_table('public', 'procurement_goods_receipts', 'goods receipts exist');
select has_table('public', 'procurement_vendor_bills', 'vendor bills exist');
select has_table('public', 'vendor_events', 'vendor history exists');
select has_table('public', 'procurement_events', 'procurement history exists');

select col_is_pk('public', 'vendors', 'id', 'vendors use a UUID primary key');
select col_not_null('public', 'vendors', 'organization_id', 'vendors are tenant scoped');
select col_not_null('public', 'vendors', 'vendor_number', 'vendor number is required');
select col_not_null('public', 'procurement_purchase_requests', 'request_number', 'request number is required');
select col_not_null('public', 'procurement_purchase_orders', 'purchase_order_number', 'PO number is required');
select has_column('public', 'assets', 'vendor_id', 'assets link to vendors');

select has_function('private', 'vendor_membership_access_allowed', array['uuid', 'uuid', 'text'], 'vendor scope helper exists');
select has_function('private', 'purchase_request_membership_access_allowed', array['uuid', 'uuid', 'text'], 'purchase request scope helper exists');
select has_function('private', 'purchase_order_membership_access_allowed', array['uuid', 'uuid', 'text'], 'purchase order scope helper exists');
select has_function('private', 'apply_procurement_approval_result', array[], 'approval result synchronizer exists');

select policies_are('public', 'vendors', array['vendors_select'], 'vendors expose one permission-scoped select policy');
select policies_are('public', 'procurement_purchase_requests', array['procurement_requests_select'], 'requests expose one scoped select policy');
select policies_are('public', 'procurement_purchase_orders', array['procurement_orders_select'], 'orders expose one scoped select policy');
select policies_are('public', 'vendor_events', array['vendor_events_select'], 'history exposes one scoped select policy');

select * from finish();
rollback;
