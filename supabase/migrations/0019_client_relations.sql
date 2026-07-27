-- 0019: Client relations — outreach tracking, Google-review tracking, referrals.
--
-- Outreach: every client carries a relationship status. 'active' clients surface
-- on Today once their last detail/touch is older than settings.outreach_after_days
-- (and nothing is booked). 'seasonal' / 'declined' clients hide until resume_on.
-- Each touch is logged in outreach_log so the profile shows the whole history.
--
-- Reviews: two dates on the customer — asked / left. Recent completed details with
-- no review yet surface on Today as ask candidates.
--
-- Referrals: referred_by links the new client to who sent them; a one-shot button
-- credits both ledgers settings.referral_credit dollars (referral_credited_at
-- guards double-pay).

alter table customers
  add column if not exists outreach_status text not null default 'active'
    check (outreach_status in ('active','seasonal','declined','do_not_contact')),
  add column if not exists resume_on date,           -- surface again on this date (seasonal/declined/snooze)
  add column if not exists last_contacted_on date,
  add column if not exists review_asked_on date,
  add column if not exists review_left_on date,
  add column if not exists referred_by uuid references customers(id) on delete set null,
  add column if not exists referral_credited_at timestamptz;

create index if not exists customers_referred_by_idx on customers (referred_by) where referred_by is not null;

-- One row per touch (call/text/review ask/…). Status changes ride along on customers.
create table if not exists outreach_log (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  customer_id uuid not null references customers(id) on delete cascade,
  occurred_on date not null,
  outcome     text not null check (outcome in
    ('booked','follow_up','seasonal','declined','no_answer','asked_review','left_review','note')),
  note        text
);
create index if not exists outreach_log_customer_idx on outreach_log (customer_id, occurred_on desc);

-- Same blanket policy as every other table (grants come from 0001 default privileges).
alter table outreach_log enable row level security;
create policy owners_all on outreach_log for all to authenticated using (true) with check (true);

insert into settings (key, value) values
  ('outreach_after_days', '60'),
  ('review_ask_window_days', '14'),
  ('referral_credit', '10')
on conflict (key) do nothing;
