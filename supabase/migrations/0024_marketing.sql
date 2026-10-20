-- Marketing manager. Where every customer came from, what each channel cost, every
-- inquiry from first ring to booked, and the ad playbook as a checklist.
--
-- Ad spend is NOT a new money table: it's an expense (category 'marketing') tagged with
-- campaign_id, so Money's net stays the one source of truth and the expense mirror keeps
-- working. Channel math (attribution → channel, cost per customer, the weekly call per
-- channel) lives in src/lib/marketing.ts so the rules stay testable.

-- One list of channels, shared by campaigns, leads and customers (keep in sync with
-- CHANNELS in src/lib/marketing.ts).
create or replace function marketing_channel_ok(c text) returns boolean
language sql immutable as $$
  select c is null or c in ('google_ads','google_lsa','google_organic','meta_ads','social','nextdoor',
                            'print','partnership','referral','word_of_mouth','other')
$$;

create table if not exists marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  channel text not null check (channel is not null and marketing_channel_ok(channel)),
  name text not null,
  status text not null default 'planned' check (status in ('planned','active','paused','ended')),
  start_on date,
  end_on date,
  monthly_budget numeric(10,2),
  -- cost per NEW customer this campaign should beat; null = use settings.marketing_target_cpa
  target_cpa numeric(10,2),
  -- matches utm_campaign on website bookings and email signups
  utm_campaign text unique,
  notes text
);

alter table expenses add column if not exists campaign_id uuid references marketing_campaigns(id) on delete set null;
create index if not exists expenses_campaign on expenses (campaign_id) where campaign_id is not null;

-- How the customer found us. Null = derive from their first booking's attribution
-- (website), then referred_by, else unknown.
alter table customers add column if not exists acquired_via text check (marketing_channel_ok(acquired_via));
alter table customers add column if not exists acquired_campaign_id uuid references marketing_campaigns(id) on delete set null;

-- Every inquiry, any channel: calls, texts, DMs, boat quote requests, email signups.
-- Online bookings skip this table (they're already customers + appointments).
create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  phone text,
  email text,
  kind text not null default 'call' check (kind in ('call','text','form','email_signup','boat_inquiry','dm','in_person')),
  channel text check (marketing_channel_ok(channel)),
  campaign_id uuid references marketing_campaigns(id) on delete set null,
  status text not null default 'new' check (status in ('new','contacted','quoted','booked','lost')),
  lost_reason text,
  est_value numeric(10,2),
  -- first reply: speed to lead is the #1 Local Services Ads ranking lever
  contacted_at timestamptz,
  customer_id uuid references customers(id) on delete set null,
  email_signup_id uuid unique references email_signups(id) on delete cascade,
  attribution jsonb,
  notes text
);
create index if not exists leads_created on leads (created_at desc);
create index if not exists leads_open on leads (status) where status in ('new','contacted','quoted');

-- The ad playbook: what to do, in what order. Seeded below; Tyler adds his own.
create table if not exists marketing_tasks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  phase text not null default 'now' check (phase in ('now','month','season','ongoing')),
  sort int not null default 0,
  title text not null,
  detail text,
  channel text check (marketing_channel_ok(channel)),
  due_on date,
  done_on date
);

-- Owner only, like email_signups.
alter table marketing_campaigns enable row level security;
alter table leads enable row level security;
alter table marketing_tasks enable row level security;
create policy owners_only on marketing_campaigns for all to authenticated
  using    (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'washer') = 'owner')
  with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'washer') = 'owner');
create policy owners_only on leads for all to authenticated
  using    (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'washer') = 'owner')
  with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'washer') = 'owner');
create policy owners_only on marketing_tasks for all to authenticated
  using    (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'washer') = 'owner')
  with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'washer') = 'owner');
alter publication supabase_realtime add table marketing_campaigns, leads, marketing_tasks;

-- Website popup signups become leads automatically; redeeming WELCOME5 on a booking
-- closes the lead as booked. Channel stays null: the app derives it from attribution.
create or replace function email_signup_lead() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into leads (kind, email, attribution, email_signup_id, notes)
      values ('email_signup', new.email, new.attribution, new.id,
              'Signed up on the website' || coalesce(' for ' || new.offer_code, ''))
      on conflict (email_signup_id) do nothing;
  elsif new.redeemed_at is not null and old.redeemed_at is null then
    update leads set status = 'booked',
                     contacted_at = coalesce(contacted_at, new.redeemed_at),
                     customer_id = coalesce(customer_id, (select customer_id from appointments where id = new.appointment_id))
      where email_signup_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists email_signups_lead on email_signups;
create trigger email_signups_lead after insert or update of redeemed_at on email_signups
  for each row execute function email_signup_lead();

insert into settings (key, value) values ('marketing_target_cpa', '60') on conflict (key) do nothing;

-- Customer merge (0021) also re-points leads and keeps the first known acquisition
-- source. Body otherwise identical to 0021.
create or replace function merge_customers(p_keep uuid, p_merge uuid[])
returns void
language plpgsql
set search_path = public
as $$
declare
  v_ids  uuid[];
  v_all  uuid[];
  v_keep customers%rowtype;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'washer') <> 'owner' then
    raise exception 'Only the owner can merge customers.';
  end if;
  v_ids := array(select distinct x from unnest(p_merge) x where x is not null and x <> p_keep);
  if cardinality(v_ids) = 0 then return; end if;
  select * into v_keep from customers where id = p_keep for update;
  if not found then raise exception 'Customer to keep no longer exists.'; end if;
  if (select count(*) from customers where id = any(v_ids)) <> cardinality(v_ids) then
    raise exception 'One of those customers was already merged or deleted — refresh and try again.';
  end if;
  v_all := v_ids || p_keep;

  -- 1. Fold profile fields into the keeper (keeper wins; blanks fill from the others,
  --    oldest first; lists union; dates take the latest; do-not-contact is sticky).
  update customers k set
    phone   = coalesce(k.phone, (select c.phone from customers c where c.id = any(v_ids) and c.phone is not null order by c.created_at limit 1)),
    email   = coalesce(k.email, (select c.email from customers c where c.id = any(v_ids) and c.email is not null order by c.created_at limit 1)),
    addresses = (
      select coalesce(jsonb_agg(addr order by ord), '[]'::jsonb) from (
        select distinct on (lower(trim(e.addr ->> 'address'))) e.addr, e.ord
        from (
          select a.value as addr, (case when c.id = p_keep then 0 else 1 end) * 1000000 + a.ordinality as ord
          from customers c, jsonb_array_elements(c.addresses) with ordinality a
          where c.id = any(v_all) and coalesce(trim(a.value ->> 'address'), '') <> ''
        ) e
        order by lower(trim(e.addr ->> 'address')), e.ord
      ) d
    ),
    notes = nullif(array_to_string(array(
      select n from (
        select distinct on (trim(c.notes)) trim(c.notes) as n, (c.id <> p_keep) as other, c.created_at
        from customers c where c.id = any(v_all) and coalesce(trim(c.notes), '') <> ''
        order by trim(c.notes), (c.id <> p_keep), c.created_at
      ) t order by other, created_at
    ), E'\n\n'), ''),
    tags = array(select distinct t from customers c, unnest(c.tags) t where c.id = any(v_all) order by t),
    stripe_payments   = (select bool_or(c.stripe_payments) from customers c where c.id = any(v_all)),
    archived          = (select bool_and(c.archived) from customers c where c.id = any(v_all)),
    created_at        = (select min(c.created_at) from customers c where c.id = any(v_all)),
    outreach_status   = case when exists (select 1 from customers c where c.id = any(v_all) and c.outreach_status = 'do_not_contact')
                             then 'do_not_contact' else k.outreach_status end,
    resume_on         = coalesce(k.resume_on, (select max(c.resume_on) from customers c where c.id = any(v_ids))),
    last_contacted_on = (select max(c.last_contacted_on) from customers c where c.id = any(v_all)),
    review_asked_on   = (select max(c.review_asked_on) from customers c where c.id = any(v_all)),
    review_left_on    = (select max(c.review_left_on) from customers c where c.id = any(v_all)),
    referred_by       = coalesce(
                          case when k.referred_by = any(v_all) then null else k.referred_by end,
                          (select c.referred_by from customers c where c.id = any(v_ids) and c.referred_by is not null
                             and not (c.referred_by = any(v_all)) order by c.created_at limit 1)),
    referral_credited_at = coalesce(k.referral_credited_at, (select min(c.referral_credited_at) from customers c where c.id = any(v_ids))),
    acquired_via         = coalesce(k.acquired_via, (select c.acquired_via from customers c where c.id = any(v_ids) and c.acquired_via is not null order by c.created_at limit 1)),
    acquired_campaign_id = coalesce(k.acquired_campaign_id, (select c.acquired_campaign_id from customers c where c.id = any(v_ids) and c.acquired_campaign_id is not null order by c.created_at limit 1))
  where k.id = p_keep;

  -- 2. Re-point every child row. Ledger moves without re-mirroring (see above);
  --    the company-ledger memos (customer name) follow the keeper.
  perform set_config('bb.skip_mirror', 'on', true);
  update ledger_entries set customer_id = p_keep where customer_id = any(v_ids);
  perform set_config('bb.skip_mirror', 'off', true);
  update company_ledger cl set memo = (select name from customers where id = p_keep)
    where cl.ledger_entry_id in (select id from ledger_entries where customer_id = p_keep)
      and cl.kind in ('revenue', 'payout')
      and cl.memo in (select name from customers where id = any(v_ids));
  update vehicles         set customer_id = p_keep where customer_id = any(v_ids);
  update plans            set customer_id = p_keep where customer_id = any(v_ids);
  update appointments     set customer_id = p_keep where customer_id = any(v_ids);
  update reminders        set customer_id = p_keep where customer_id = any(v_ids);
  update payment_requests set customer_id = p_keep where customer_id = any(v_ids);
  update outreach_log     set customer_id = p_keep where customer_id = any(v_ids);
  update leads            set customer_id = p_keep where customer_id = any(v_ids);
  update customers        set referred_by = p_keep where referred_by = any(v_ids) and id <> p_keep;

  -- 3. Drop the duplicates (their not-duplicate answers cascade away with them).
  delete from customers where id = any(v_ids);
end $$;


-- Starter campaigns (planned, not spending): each has a tracking slug so the links on the
-- Campaigns tab work before the first dollar goes out. Budgets are proposals; targets stay
-- null so every campaign is judged against settings.marketing_target_cpa.
insert into marketing_campaigns (channel, name, status, start_on, monthly_budget, target_cpa, utm_campaign, notes) values
  ('google_organic', 'Google Business Profile', 'active', '2026-10-20', 0, null, 'gbp', 'Free. Ranks on reviews, category and weekly activity.'),
  ('google_ads', 'Search · Marco + Naples detailing', 'planned', '2026-11-01', 450, null, 'search-detailing', '$15 a day. Starts only after conversion tracking fires.'),
  ('google_lsa', 'Local Services Ads', 'planned', '2026-12-01', 400, null, 'lsa', 'Pay per lead. Live once Google verification clears.'),
  ('partnership', 'Condo + HOA detail days', 'planned', '2026-11-01', 0, null, 'condo-days', 'Batch 4 to 6 cars per trip. Use the QR on building flyers.'),
  ('print', 'Door hangers on job streets', 'planned', '2026-11-01', 60, null, 'doorhanger', '10 neighbors per job.'),
  ('meta_ads', 'Meta · before/after test', 'planned', '2026-12-15', 300, null, 'meta-test', 'Needs the Meta pixel on the site first. Pause at ~$150 with no booking.')
on conflict (utm_campaign) do nothing;

-- The ad plan (researched 2026-10-20 for the Marco Island + Naples snowbird season).
insert into marketing_tasks (phase, sort, title, channel, due_on, detail) values
  ('now', 1, 'Turn on Google Ads conversion tracking', 'google_ads', '2026-10-27',
   $$Nothing gets spent until this works. In Google Ads (account AW-17448688864) go to Goals → Conversions → New → Website and create two actions: "Booking" (count one, use the booking value) and "Call or text tap" (count one). Paste each conversion label into Cloudflare (website → Settings → Variables) as NEXT_PUBLIC_GADS_BOOKING_LABEL and NEXT_PUBLIC_GADS_CALL_LABEL, redeploy, then make a test booking and check that Google Ads shows it within a day.$$),
  ('now', 2, 'Finish the Google Business Profile', 'google_organic', '2026-10-27',
   $$The free version of the ads: it ranks on reviews, category and activity. Primary category: Car detailing service (add Boat detailing service only if you want those searches). Set it up as a service-area business covering Marco Island and the Naples ZIP codes you actually drive to. Add every service with its price, 15+ real job photos and your hours. Use the Google Business Profile tracking link from the Campaigns tab as the website and booking link so Maps bookings get credited.$$),
  ('now', 3, 'Ask past customers for Google reviews, about 6 a week', 'google_organic', '2026-10-27',
   $$Reviews are the biggest ranking lever you control for Maps and Local Services Ads, and recent ones count most. Google trusts a steady flow over a burst, so text about 6 past customers a week (not all of them at once) with the review link g.page/r/CXiiEGVufNEdEAE/review and mark each one asked on their profile. Never offer anything in exchange for a review; Google removes incentivized reviews. Goal: 4 to 8 new reviews a month, every month.$$),
  ('now', 4, 'Apply for Local Services Ads', 'google_lsa', '2026-10-27',
   $$Car wash and detailing is an eligible category. Start at ads.google.com/local-services-ads, confirm Marco Island and Naples are available, and submit the business and owner verification now: it can take a few weeks and you want the Google Verified badge live before peak season. You pay per lead (call, message or booking), not per click. Google is moving these ads into Google Ads for service-area businesses in late 2026; same placement, new lead inbox.$$),
  ('now', 5, 'Tag where every customer came from', null, '2026-10-24',
   $$Open Overview → "Customers with no source" and pick a channel for each. Every cost-per-customer number here depends on it. From now on, set it when you add a customer.$$),
  ('now', 6, 'Claim the free listings', 'google_organic', '2026-10-31',
   $$Use the same name, phone ((239) 293-8511) and service area everywhere: Apple Business Connect (Apple Maps and Siri), Bing Places, Yelp (free listing only, skip Yelp ads), a Nextdoor business page and the Facebook page. Matching listings help the Google ranking and catch people who don't search on Google.$$),

  ('month', 1, 'Launch Google Search ads', 'google_ads', '2026-11-01',
   $$Start at $15 a day (about $450 a month), only once tracking fires. Keywords, phrase and exact match: mobile detailing naples, mobile car detailing, car detailing near me, auto detailing naples fl, car detailing marco island, ceramic coating naples. Location: Marco Island and Naples, set to "Presence: people in or regularly in your locations" (the default also pays for people elsewhere). Hours 7am to 8pm. Negative keywords: jobs, hiring, salary, course, training, supplies, products, equipment, for sale, diy, how to, self serve, coin. Send clicks to the booking page with the Search tracking link, add a call asset, and write ads that name the island, the starting price and "we come to you". Start on Maximize clicks with a $6 max CPC, switch to Maximize conversions after about 15 bookings. Expect roughly $3 to $6 a click.$$),
  ('month', 2, 'Text everyone about an arrival detail', null, '2026-11-03',
   $$Snowbirds arrive November through December and Marco's population roughly doubles. Text past and seasonal customers something like "Car sat all summer? We'll have it detailed before you land." Post the same on the Business Profile and Nextdoor. Free, and it fills the calendar while the ads learn.$$),
  ('month', 3, 'Pitch three condo buildings or HOAs on a detail day', 'partnership', '2026-11-20',
   $$One trip, four to six cars, no ad cost. Ask property managers on Marco to put a resident detail day in their newsletter or on the lobby board; the multi-car discount covers the building rate. Put the condo-days tracking QR on the flyer so bookings get credited.$$),
  ('month', 4, 'Introduce yourselves at two marinas', 'partnership', '2026-11-20',
   $$Boat work on your price list runs $5 to $100 a foot (a $10/ft wash on a 30 ft boat is $300; ceramic is $100/ft), so one boat can be worth several cars. Bring cards and photos to the dock masters at the marinas on Marco and ask about a referral arrangement. Log every quote request as a lead; website boat quotes land here automatically.$$),
  ('month', 5, 'Decide on a bigger referral credit', 'referral', '2026-11-15',
   $$A referral is worth $10 to each side right now. From your real numbers, a new customer can cost about $88 before the first detail stops paying for itself ($245 average first detail, minus the 60% worker split and about $10 of supplies; the live figure is on Overview). $25 each side is still well under that and cheaper than any ad. Change it in Settings if you agree, then mention it at the end of every job.$$),
  ('month', 6, 'Leave door hangers on every job street', 'print', '2026-11-30',
   $$When you detail a car, leave a door hanger with a before/after photo and the doorhanger tracking QR on 10 neighbors' doors. Log the printing cost as spend on the Door hangers campaign so its cost per customer shows up here.$$),

  ('season', 1, 'Go live on Local Services Ads', 'google_lsa', '2026-12-01',
   $$Once verified, start around $100 a week. Answer every call during business hours or call back within 15 minutes: responsiveness is the biggest ranking factor, and missed calls can be billed. Mark booked leads as booked and dispute junk leads (wrong service, outside the area, spam) within 30 days. Log the weekly charge as spend on the LSA campaign.$$),
  ('season', 2, 'Test Meta ads only after Google is working', 'meta_ads', '2026-12-15',
   $$Needs the Meta pixel on the website first (not installed yet). Run before/after video reels with broad targeting about 15 miles around Marco and Naples, $10 a day for three weeks, using the Meta tracking link. If it hasn't produced a booking by about $150, pause it. Don't boost posts: that buys likes, not bookings.$$),
  ('season', 3, 'Push ceramic coating before snowbirds leave', null, '2027-03-01',
   $$In March, text and email every seasonal customer: ceramic protects a car that sits in a garage or under the Florida sun all summer. $699 to $899 a job, the highest-value thing you sell.$$),

  ('ongoing', 1, 'Monday check, 15 minutes', null, null,
   $$Open Overview. Log last week's spend on each campaign, read the call next to each channel and do what it says. Scale: raise that budget up to 20%, never more in one week. Fix: change keywords, offer or page before spending more. Pause: stop it. Leave everything else alone; daily tinkering resets the ad platforms' learning.$$),
  ('ongoing', 2, 'Reply to every lead within 15 minutes', null, null,
   $$Most people book whoever answers first. Add calls and texts as leads here so the reply speed and the result get tracked.$$),
  ('ongoing', 3, 'Post a before/after to the Business Profile every week', 'google_organic', null,
   $$A fresh photo from that week's best job, with the town in the caption. Active profiles rank higher.$$),
  ('ongoing', 4, 'Ask for a review within two days of every job', 'google_organic', null,
   $$The Today page already lists who's due. A steady trickle beats a burst; recent reviews count most.$$);
