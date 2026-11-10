-- "Handle an issue" on a client's profile (Tyler, 2026-11-10: "a button on a client page that
-- syncs conversation(s), customer profile and past visits … give $ off if i reschedule and its
-- our fault … write all messages in my voice").
-- The dashboard queues a text_sync_runs row carrying the customer + Tyler's note. The listener
-- on Tyler's Mac (scripts/client-texts/run.mjs) syncs texts first, then has Claude draft a short
-- reply in Tyler's voice from that client's profile, visits, plan, balance and full thread, and
-- writes it to `result` ({ text, our_fault, credit, notes[], credit_applied_at? }).
-- Rows with customer_id are help requests; rows without are the plain "Sync texts now" runs.
alter table text_sync_runs
  add column if not exists customer_id uuid references customers(id) on delete cascade,
  add column if not exists ask text,
  add column if not exists result jsonb;
create index if not exists text_sync_runs_customer on text_sync_runs (customer_id, requested_at desc) where customer_id is not null;

-- Dollars off their next visit when it's on us (we moved/cancelled, ran late, missed something).
insert into settings (key, value) values ('make_good_credit', '20') on conflict (key) do nothing;
