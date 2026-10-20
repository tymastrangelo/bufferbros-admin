-- Website email list + welcome offer ("Get 5% off your first detail" popup).
-- The website inserts with the service role; the dashboard reads it (owner only).
-- redeemed_at / appointment_id are stamped when a booking uses the offer code.
create table if not exists email_signups (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  email text not null,
  offer_code text,
  attribution jsonb,
  redeemed_at timestamptz,
  appointment_id uuid references appointments(id) on delete set null,
  unsubscribed_at timestamptz
);
-- stored lowercased (the website lowercases before insert) so a plain unique
-- constraint works with PostgREST's on_conflict=email upsert
alter table email_signups add constraint email_signups_email_key unique (email);
alter table email_signups add constraint email_signups_email_lower check (email = lower(email));
alter table email_signups enable row level security;
create policy owners_only on email_signups for all to authenticated
  using    (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'washer') = 'owner')
  with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'washer') = 'owner');
alter publication supabase_realtime add table email_signups;
