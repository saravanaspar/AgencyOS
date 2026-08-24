begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(13);

select has_table('public', 'automation_definitions', 'Automation definitions exist');
select has_column('public', 'automation_definitions', 'handler_key', 'Definitions store internal handler keys');
select hasnt_column('public', 'automation_definitions', 'secret_reference', 'Definitions do not store integration secret references');
select has_table('public', 'automation_execution_events', 'Automation execution events exist');
select has_column('public', 'automation_execution_events', 'execution_id', 'Execution events store internal execution IDs');
select has_column('public', 'automation_execution_events', 'handler_key', 'Execution events store handler keys');
select has_column('public', 'automation_execution_events', 'completed_at', 'Execution events store completion time');
select hasnt_column('public', 'automation_execution_events', 'nonce', 'Execution events do not store callback nonces');
select hasnt_column('public', 'automation_execution_events', 'payload_hash', 'Execution events do not store callback payload hashes');
select has_table('public', 'automation_dispatches', 'Automation dispatch queue remains available');
select hasnt_column('public', 'automation_dispatches', 'last_http_status', 'Dispatches do not store external HTTP status');
select has_table('public', 'vaultwarden_item_links', 'Vaultwarden links remain available');
select has_column('public', 'vaultwarden_item_links', 'item_reference', 'Vaultwarden links store only item references');

select * from finish();
rollback;
