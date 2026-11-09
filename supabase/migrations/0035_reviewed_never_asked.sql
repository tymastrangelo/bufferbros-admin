-- A client who already left a Google review never gets asked again.
-- The 10/20 batch of "Ask X for a Google review" reminders kept coming due for clients Tyler had
-- already marked reviewed (Brian Bockholdt 10/31 and Mike Held 11/6 got the link twice), because
-- marking a review never touched the reminders. Now:
--   1. marking review_left_on closes every open review-ask reminder for that client;
--   2. a review-ask reminder queued for someone who already reviewed is born done.
-- A review ask is a reminder whose body carries the review link (same rule as reminders-card and
-- customer_message_touch). Security definer: a worker logging "left review" must still close them.

create or replace function customers_review_left() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update reminders set done_at = now()
    where customer_id = new.id and done_at is null and body like '%g.page/r/%';
  return new;
end $$;
create or replace trigger customers_review_left after update of review_left_on on customers
  for each row when (new.review_left_on is not null and old.review_left_on is null)
  execute function customers_review_left();

create or replace function reminders_skip_reviewed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from customers where id = new.customer_id and review_left_on is not null) then
    new.done_at := now();
  end if;
  return new;
end $$;
create or replace trigger reminders_skip_reviewed before insert on reminders
  for each row when (new.done_at is null and new.body like '%g.page/r/%')
  execute function reminders_skip_reviewed();

-- Backfill: the ones still waiting to nag (Phran Geasling 11/17, Scott E. McRoy 11/19).
update reminders r set done_at = now()
  from customers c
  where c.id = r.customer_id and c.review_left_on is not null
    and r.done_at is null and r.body like '%g.page/r/%';
