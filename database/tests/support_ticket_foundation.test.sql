begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(18);

select has_table('public', 'support_tickets', 'support tickets table exists');
select has_table('public', 'support_ticket_categories', 'support categories table exists');
select has_table('public', 'support_ticket_messages', 'support messages table exists');
select has_table('public', 'support_ticket_watchers', 'support watchers table exists');
select has_table('public', 'support_ticket_events', 'support events table exists');
select has_column('public', 'support_tickets', 'first_response_due_at', 'first-response SLA timestamp exists');
select has_column('public', 'support_tickets', 'resolution_due_at', 'resolution SLA timestamp exists');
select has_column('public', 'support_tickets', 'waiting_total_seconds', 'waiting-clock accumulation exists');
select has_column('public', 'support_tickets', 'satisfaction_score', 'satisfaction score exists');
select has_function('private', 'support_ticket_membership_access_allowed', array['uuid','uuid','text'], 'membership access helper exists');
select has_function('private', 'support_ticket_access_allowed', array['uuid','text'], 'current-session access helper exists');
select has_function('private', 'support_ticket_sla_minutes', array['text','text'], 'SLA calculation helper exists');
select row_security_active('public', 'support_tickets', 'support tickets use RLS');
select row_security_active('public', 'support_ticket_messages', 'support messages use RLS');
select row_security_active('public', 'support_ticket_watchers', 'support watchers use RLS');
select row_security_active('public', 'support_ticket_events', 'support events use RLS');
select col_is_fk('public', 'support_tickets', 'client_company_id', 'ticket client reuses CRM company');
select col_is_fk('public', 'support_tickets', 'project_id', 'ticket project reuses Projects');

select * from finish();
rollback;
