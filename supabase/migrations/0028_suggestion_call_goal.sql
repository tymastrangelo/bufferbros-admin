-- Allow the "call" suggestion goal on customer_insights. 0027 created suggestion_goal with a CHECK
-- that only permitted reply/rebook/review/check_in/none, so any card Claude marked "call" failed to
-- save (Postgres 23514) and aborted the whole text-sync run. "call" is a follow-up that recommends a
-- phone call but still carries a prepped text. Drop the old check (whatever Postgres auto-named it)
-- and re-add it with "call" included.
do $$
declare cn text;
begin
  select conname into cn from pg_constraint
    where conrelid = 'public.customer_insights'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%suggestion_goal%';
  if cn is not null then execute format('alter table public.customer_insights drop constraint %I', cn); end if;
end $$;

alter table public.customer_insights
  add constraint customer_insights_suggestion_goal_check
  check (suggestion_goal in ('reply', 'rebook', 'review', 'check_in', 'call', 'none'));
