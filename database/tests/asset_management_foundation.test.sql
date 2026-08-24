begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(18);

select has_table('public', 'asset_categories', 'asset categories table exists');
select has_table('public', 'assets', 'assets table exists');
select has_table('public', 'asset_assignments', 'asset assignments table exists');
select has_table('public', 'asset_condition_events', 'asset condition history exists');
select has_table('public', 'asset_maintenance_records', 'asset maintenance history exists');
select has_table('public', 'asset_events', 'asset lifecycle events exist');

select col_is_pk('public', 'assets', 'id', 'assets use a UUID primary key');
select col_not_null('public', 'assets', 'organization_id', 'assets are tenant scoped');
select col_not_null('public', 'assets', 'asset_tag', 'asset tag is required');
select col_not_null('public', 'assets', 'condition', 'condition is required');
select col_not_null('public', 'assets', 'status', 'lifecycle status is required');

select has_index('public', 'assets', 'assets_serial_unique_idx', 'serial numbers are duplicate safe');
select has_index('public', 'asset_assignments', 'asset_assignments_active_asset_idx', 'only one active assignment is allowed');
select has_function('private', 'asset_membership_access_allowed', array['uuid', 'uuid', 'text'], 'asset scope helper exists');
select has_function('private', 'asset_access_allowed', array['uuid', 'text'], 'asset RLS helper exists');

select policies_are('public', 'assets', array['assets_select'], 'assets expose one permission-scoped select policy');
select policies_are('public', 'asset_assignments', array['asset_assignments_select'], 'assignments expose one permission-scoped select policy');
select policies_are('public', 'asset_events', array['asset_events_select'], 'events expose one permission-scoped select policy');

select * from finish();
rollback;
