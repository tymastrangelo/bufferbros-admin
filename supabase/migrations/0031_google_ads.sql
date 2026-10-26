-- 0031: Google Ads through the dashboard.
--   * integration_secrets — the OAuth refresh token. RLS on, NO policies: only the
--     service role (server code) can read it; a browser never can.
--   * ad_campaigns / ad_metrics — a mirror of the Google account, refreshed nightly
--     (owner-only like the other marketing tables; always real, never LARP).
--   * marketing_campaigns.google_campaign_id — which Google campaign a CRM campaign is.
--   * expenses.source / google_campaign_id — synced spend rows the sync owns, one per
--     Google campaign per month, so Marketing's spend math stays untouched.

create table if not exists integration_secrets (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table integration_secrets enable row level security;

alter table marketing_campaigns add column if not exists google_campaign_id text unique;

create table if not exists ad_campaigns (
  google_id       text primary key,
  name            text not null,
  status          text not null,                 -- ENABLED | PAUSED | (never REMOVED)
  channel         text not null,                 -- SEARCH | LOCAL_SERVICES | PERFORMANCE_MAX | ...
  daily_budget    numeric(10,2),
  budget_resource text,                          -- customers/x/campaignBudgets/y — needed to change the budget
  synced_at       timestamptz not null default now()
);
create table if not exists ad_metrics (
  google_id   text not null references ad_campaigns(google_id) on delete cascade,
  date        date not null,
  cost        numeric(10,2) not null default 0,
  clicks      int not null default 0,
  impressions int not null default 0,
  conversions numeric not null default 0,
  conv_value  numeric(10,2) not null default 0,
  phone_calls int not null default 0,
  primary key (google_id, date)
);
alter table ad_campaigns enable row level security;
alter table ad_metrics enable row level security;
create policy owners_only on ad_campaigns for all to authenticated
  using    (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'washer') = 'owner')
  with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'washer') = 'owner');
create policy owners_only on ad_metrics for all to authenticated
  using    (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'washer') = 'owner')
  with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'washer') = 'owner');
alter publication supabase_realtime add table ad_campaigns, ad_metrics;

alter table expenses add column if not exists source text;                 -- 'google_ads' = owned by the sync
alter table expenses add column if not exists google_campaign_id text;     -- which Google campaign a synced row is for
-- first-of-month via date arithmetic (immutable, unlike date_trunc on a date)
create unique index if not exists expenses_synced_month
  on expenses (google_campaign_id, ((occurred_on - (extract(day from occurred_on)::int - 1))))
  where source = 'google_ads';

-- Non-secret connection state (settings is readable by every signed-in user).
insert into settings (key, value) values
  ('gads_customer_id', ''),
  ('gads_synced_at', ''),
  ('gads_last_error', ''),
  ('gads_token_level', 'unknown')   -- unknown | pending | basic
on conflict (key) do nothing;
