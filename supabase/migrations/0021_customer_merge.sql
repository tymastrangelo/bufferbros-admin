-- Merge duplicate customers (Apple Contacts-style). One atomic RPC folds any number
-- of duplicate rows into a keeper: every child row is re-pointed, contact info and
-- relationship fields are unioned, then the duplicates are deleted.
-- Detection runs in the app (src/lib/duplicates.ts); "Not duplicates" answers are
-- remembered here so a dismissed suggestion never comes back.

create table if not exists customer_not_duplicates (
  a uuid not null references customers(id) on delete cascade,
  b uuid not null references customers(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (a, b),
  check (a < b)
);
alter table customer_not_duplicates enable row level security;
create policy owners_only on customer_not_duplicates for all to authenticated
  using    (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'washer') = 'owner')
  with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'washer') = 'owner');
alter publication supabase_realtime add table customer_not_duplicates;

-- The cash-split mirror rebuilds company_ledger rows on ANY ledger update, at the
-- worker's *current* split. Re-pointing payments to the keeper must not rewrite
-- historical payouts, so the merge sets bb.skip_mirror for its transaction only.
-- Body otherwise identical to the live definition.
create or replace function public.mirror_cash_split()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_ceo  numeric := coalesce((select value::numeric from settings where key = 'split_ceo_pct'), 10);
  v_name text;
  v_net  numeric;
  v_self boolean := false;
  v_emp  employees%rowtype;
  v_emp_id uuid;
begin
  if tg_op = 'UPDATE' and current_setting('bb.skip_mirror', true) = 'on' then
    return new;
  end if;
  if tg_op in ('UPDATE','DELETE') then
    delete from company_ledger where ledger_entry_id = old.id;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.kind in ('payment','credit','refund') then
    select name into v_name from customers where id = new.customer_id;
    if new.appointment_id is not null then
      select a.self_done, a.employee_id into v_self, v_emp_id from appointments a where a.id = new.appointment_id;
    end if;
    if v_emp_id is null then
      v_emp_id := (select value::uuid from settings where key = 'default_employee_id');
    end if;
    select * into v_emp from employees where id = v_emp_id;

    v_net := new.amount - coalesce(new.processor_fee, 0);
    insert into company_ledger (occurred_on, kind, amount, memo, ledger_entry_id, collected_by, settled_on)
      values (new.occurred_on, 'revenue', new.amount, v_name, new.id, new.collected_by, new.settled_on);
    if coalesce(new.processor_fee, 0) <> 0 then
      insert into company_ledger (occurred_on, kind, amount, memo, ledger_entry_id)
        values (new.occurred_on, 'expense', -new.processor_fee, 'Stripe fee — ' || coalesce(v_name, ''), new.id);
    end if;
    if not coalesce(v_self, false) and v_emp.id is not null and coalesce(v_emp.split_pct, 0) <> 0 then
      insert into company_ledger (occurred_on, kind, party, amount, memo, ledger_entry_id, collected_by, settled_on, employee_id)
        values (new.occurred_on, 'payout', 'employee', round(-v_net * v_emp.split_pct / 100, 2), v_name, new.id, new.collected_by, new.settled_on, v_emp.id);
    end if;
    if v_ceo <> 0 then
      insert into company_ledger (occurred_on, kind, party, amount, memo, ledger_entry_id, collected_by, settled_on)
        values (new.occurred_on, 'payout', 'ceo', round(-v_net * v_ceo / 100, 2), v_name, new.id, new.collected_by, new.settled_on);
    end if;
  end if;
  return new;
end $function$;

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
    referral_credited_at = coalesce(k.referral_credited_at, (select min(c.referral_credited_at) from customers c where c.id = any(v_ids)))
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
  update customers        set referred_by = p_keep where referred_by = any(v_ids) and id <> p_keep;

  -- 3. Drop the duplicates (their not-duplicate answers cascade away with them).
  delete from customers where id = any(v_ids);
end $$;

grant execute on function merge_customers(uuid, uuid[]) to authenticated;
