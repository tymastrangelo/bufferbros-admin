-- Client texts. A sync on Tyler's Mac (scripts/client-texts/sync.mjs) copies 1:1 iMessage/SMS
-- threads with CRM customers (matched by phone; nobody else's texts leave the Mac) into
-- customer_messages. A nightly Claude Code run on the Mac reads each changed thread with the
-- customer's CRM record and writes customer_insights (the "What we know" card on the profile).
-- Owner-only: Gabe never sees texts.

create table if not exists customer_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- Messages' own message GUID: re-syncing the same text is a no-op
  guid text not null unique,
  customer_id uuid not null references customers(id) on delete cascade,
  sent_at timestamptz not null,
  from_me boolean not null,
  body text,
  service text,
  has_attachment boolean not null default false
);
create index if not exists customer_messages_thread on customer_messages (customer_id, sent_at desc);

create table if not exists customer_insights (
  customer_id uuid primary key references customers(id) on delete cascade,
  updated_at timestamptz not null default now(),
  -- newest message the card has read; the nightly job redoes customers with newer texts
  through_message_at timestamptz,
  message_count int not null default 0,
  summary text,
  facts jsonb not null default '[]'::jsonb,       -- [{label, value}]
  open_items jsonb not null default '[]'::jsonb,  -- [{text, since}] asked/promised, not done
  sentiment text check (sentiment in ('happy', 'neutral', 'at_risk')),
  next_step text
);

alter table customer_messages enable row level security;
alter table customer_insights enable row level security;
create policy owners_only on customer_messages for all to authenticated
  using    (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'washer') = 'owner')
  with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'washer') = 'owner');
create policy owners_only on customer_insights for all to authenticated
  using    (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'washer') = 'owner')
  with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'washer') = 'owner');
alter publication supabase_realtime add table customer_messages, customer_insights;

-- A text Tyler sends is a touch (keeps the outreach queue honest), and a text carrying the
-- Google review link means they've been asked: stamp it and close their review reminder.
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
      where customer_id = new.customer_id and done_at is null and body like '%g.page/r/%' and due_on <= v_on + 7;
  end if;
  return new;
end $$;
drop trigger if exists customer_messages_touch on customer_messages;
create trigger customer_messages_touch after insert on customer_messages
  for each row execute function customer_message_touch();

-- Customer merge also moves texts to the keeper. Body otherwise identical to 0024.
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
  update customer_messages set customer_id = p_keep where customer_id = any(v_ids);
  delete from customer_insights where customer_id = any(v_ids); -- the keeper's card regenerates nightly
  update customers        set referred_by = p_keep where referred_by = any(v_ids) and id <> p_keep;

  -- 3. Drop the duplicates (their not-duplicate answers cascade away with them).
  delete from customers where id = any(v_ids);
end $$;


