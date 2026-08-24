begin;

\ir ./_helpers/pgtap-bootstrap.inc

select plan(18);

select has_table('public', 'calendar_events', 'calendar events table exists');
select has_table('public', 'calendar_event_attendees', 'calendar attendees table exists');
select has_table('public', 'calendar_event_events', 'calendar lifecycle history exists');

select col_is_pk('public', 'calendar_events', 'id', 'calendar events use a UUID primary key');
select col_not_null('public', 'calendar_events', 'organization_id', 'calendar events are tenant scoped');
select col_not_null('public', 'calendar_events', 'owner_membership_id', 'calendar event owner is required');
select col_not_null('public', 'calendar_events', 'starts_at', 'calendar event start is required');
select col_not_null('public', 'calendar_events', 'ends_at', 'calendar event end is required');

select has_function('private', 'calendar_event_membership_access_allowed', array['uuid', 'uuid', 'text'], 'calendar membership scope helper exists');
select has_function('private', 'calendar_event_access_allowed', array['uuid', 'text'], 'calendar current-user access helper exists');
select has_function('private', 'calendar_event_management_allowed', array['uuid', 'uuid'], 'calendar management scope helper exists');
select has_function('private', 'prevent_calendar_history_mutation', array[], 'append-only calendar history guard exists');

select policies_are('public', 'calendar_events', array['calendar_events_select'], 'calendar events expose one scoped select policy');
select policies_are('public', 'calendar_event_attendees', array['calendar_event_attendees_select'], 'attendees expose one scoped select policy');
select policies_are('public', 'calendar_event_events', array['calendar_event_events_select'], 'history exposes one scoped select policy');

select has_check('public', 'calendar_events', 'calendar_events_scope_target_valid', 'calendar scope target is constrained');
select has_check('public', 'calendar_events', 'calendar_events_recurrence_valid', 'calendar recurrence is constrained');
select has_check('public', 'calendar_event_attendees', 'calendar_attendees_response_valid', 'attendee response state is constrained');

select * from finish();
rollback;
