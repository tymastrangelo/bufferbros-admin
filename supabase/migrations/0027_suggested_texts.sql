-- The nightly Claude card also drafts the one text Tyler should send next (in his own voice,
-- timed): reply to an unanswered ask, rebook someone past their usual gap, ask for a review,
-- or check in. Shown on Today ("Texts to send") and the profile card; hidden by rules in
-- src/lib/suggestions.ts once it no longer fits (booked, reviewed, texted since). Marking it
-- sent stamps suggestion_done_at; the next card (new texts or a new detail) resets it.
alter table customer_insights
  add column if not exists suggestion_goal text check (suggestion_goal in ('reply', 'rebook', 'review', 'check_in', 'none')),
  add column if not exists suggestion_text text,
  add column if not exists suggestion_why text,
  add column if not exists suggest_on date,
  add column if not exists suggestion_done_at timestamptz;

-- A FRESH text with the review link (sent in the last 2 days) means they were just asked: close
-- every open review reminder for them, whatever its date, so a drafted review text and a scheduled
-- reminder never both ask. Older texts (history imports) still only close reminders due within a
-- week of that text.
create or replace function customer_message_touch() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_on date := (new.sent_at at time zone 'America/New_York')::date;
begin
  if not new.from_me then return new; end if;
  update customers set last_contacted_on = greatest(coalesce(last_contacted_on, v_on), v_on)
    where id = new.customer_id;
  if new.body like '%g.page/r/%' then
    update customers set review_asked_on = greatest(coalesce(review_asked_on, v_on), v_on)
      where id = new.customer_id;
    update reminders set done_at = now()
      where customer_id = new.customer_id and done_at is null and body like '%g.page/r/%'
        and (new.sent_at > now() - interval '2 days' or due_on <= v_on + 7);
  end if;
  return new;
end $$;
