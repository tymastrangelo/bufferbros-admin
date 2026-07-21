-- Google Calendar sync: remember the event each appointment maps to.
alter table appointments add column if not exists gcal_event_id text;
