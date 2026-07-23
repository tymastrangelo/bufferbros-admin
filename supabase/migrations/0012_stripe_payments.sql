-- 0012: Stripe payments — emailed checkout links, fee-aware Tyler/Gabe settlement.
-- Money still lands on the same customer ledger; Stripe is just another way it arrives.

-- Per-customer toggle: when on, completing a job with no payment collected
-- automatically emails them a Stripe payment link.
alter table customers add column if not exists stripe_payments boolean not null default false;

-- What the processor kept out of a payment. 0 for cash/zelle/etc. Splits are
-- computed on the net (amount - fee): Gabe gets his % of what actually arrived.
alter table ledger_entries add column if not exists processor_fee numeric(10,2) not null default 0;

-- One row per payment link sent. Drives the "who hasn't paid yet" view + digest.
create table if not exists payment_requests (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  customer_id       uuid not null references customers(id) on delete cascade,
  appointment_id    uuid references appointments(id) on delete set null,
  plan_id           uuid references plans(id) on delete set null,
  kind              text not null default 'balance' check (kind in ('job','balance','prepay')),
  amount            numeric(10,2) not null,
  visits            int,                                   -- prepay only
  discount          numeric(10,2) not null default 0,      -- prepay: extra ledger credit on payment
  memo              text,
  stripe_session_id text,
  url               text,
  status            text not null default 'pending' check (status in ('pending','paid','canceled','expired')),
  paid_at           timestamptz,
  processor_fee     numeric(10,2),
  ledger_entry_id   uuid references ledger_entries(id) on delete set null
);
create index on payment_requests (customer_id);
create index on payment_requests (status);
create unique index on payment_requests (stripe_session_id) where stripe_session_id is not null;

alter table payment_requests enable row level security;
create policy owners_all on payment_requests for all to authenticated using (true) with check (true);

-- Fee-aware split: revenue mirrors the gross, the fee books as a company expense,
-- and both payout cuts come off the net. Replaces 0002's mirror_cash_split.
create or replace function mirror_cash_split() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_washer numeric := coalesce((select value::numeric from settings where key = 'split_washer_pct'), 60);
  v_ceo    numeric := coalesce((select value::numeric from settings where key = 'split_ceo_pct'), 10);
  v_name   text;
  v_net    numeric;
begin
  if tg_op in ('UPDATE','DELETE') then
    delete from company_ledger where ledger_entry_id = old.id;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.kind in ('payment','credit','refund') then
    select name into v_name from customers where id = new.customer_id;
    v_net := new.amount - coalesce(new.processor_fee, 0);
    insert into company_ledger (occurred_on, kind, amount, memo, ledger_entry_id)
      values (new.occurred_on, 'revenue', new.amount, v_name, new.id);
    if coalesce(new.processor_fee, 0) <> 0 then
      insert into company_ledger (occurred_on, kind, amount, memo, ledger_entry_id)
        values (new.occurred_on, 'expense', -new.processor_fee, 'Stripe fee — ' || coalesce(v_name, ''), new.id);
    end if;
    if v_washer <> 0 then
      insert into company_ledger (occurred_on, kind, party, amount, memo, ledger_entry_id)
        values (new.occurred_on, 'payout', 'gabe', round(-v_net * v_washer / 100, 2), v_name, new.id);
    end if;
    if v_ceo <> 0 then
      insert into company_ledger (occurred_on, kind, party, amount, memo, ledger_entry_id)
        values (new.occurred_on, 'payout', 'ceo', round(-v_net * v_ceo / 100, 2), v_name, new.id);
    end if;
  end if;
  return new;
end $$;
