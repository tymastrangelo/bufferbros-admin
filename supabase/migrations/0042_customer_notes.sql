-- 0042: crew notes. A thread of short, signed notes on a client and/or one of their jobs
-- ("prefers no tire shine", "ran 30 min over — pet hair"), so anyone on the crew can leave
-- what they learned without overwriting the booking note or the profile's notes blob.
--   * customer_id only            → about the client; shows on every one of their jobs.
--   * appointment_id (+ customer) → about that one job; also listed on the client's profile.
-- Anyone on the crew reads and adds; you delete your own, the owner deletes any.

create table if not exists customer_notes (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  customer_id    uuid references customers(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete cascade,
  author_user_id uuid not null default auth.uid(),
  author_name    text not null,
  body           text not null check (length(trim(body)) between 1 and 2000),
  check (customer_id is not null or appointment_id is not null)
);
create index if not exists customer_notes_customer_idx on customer_notes (customer_id, created_at desc);
create index if not exists customer_notes_appt_idx on customer_notes (appointment_id);

alter table customer_notes enable row level security;
create policy owners_all on customer_notes for all to authenticated using ((select is_owner())) with check ((select is_owner()));
create policy staff_read on customer_notes for select to authenticated using ((select is_staff()));
create policy staff_insert on customer_notes for insert to authenticated
  with check ((select is_staff()) and author_user_id = (select auth.uid()));
create policy own_delete on customer_notes for delete to authenticated
  using ((select is_staff()) and author_user_id = (select auth.uid()));

-- A job's notes follow the job: linking a web booking to a customer (or re-pointing it) carries them.
create or replace function customer_notes_follow_job() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update customer_notes set customer_id = new.customer_id where appointment_id = new.id;
  return new;
end $$;
create or replace trigger customer_notes_follow_job after update of customer_id on appointments
  for each row when (old.customer_id is distinct from new.customer_id)
  execute function customer_notes_follow_job();

-- Customer merge also moves notes to the keeper. Body otherwise identical to 0025.
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
  update customer_notes    set customer_id = p_keep where customer_id = any(v_ids);
  delete from customer_insights where customer_id = any(v_ids); -- the keeper's card regenerates nightly
  update customers        set referred_by = p_keep where referred_by = any(v_ids) and id <> p_keep;

  -- 3. Drop the duplicates (their not-duplicate answers cascade away with them).
  delete from customers where id = any(v_ids);
end $$;

