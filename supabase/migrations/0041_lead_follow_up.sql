-- Leads get a next-touch date, so an open lead comes back up when it's time to chase it
-- instead of sitting in "contacted" forever. The app sets it two days out on a first
-- reply or a quote (src/lib/marketing.ts FOLLOW_UP_DAYS) and clears it on booked / lost.
alter table leads add column if not exists follow_up_on date;
