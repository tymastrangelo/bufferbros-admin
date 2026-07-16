-- 0002_company_money.sql — company capital ledger, auto-split payouts, recurring expenses.
-- Company capital = sum(company_ledger.amount). Nothing else.

create table company_ledger (
  id              uuid primary key default gen_random_uuid(),
  occurred_on     date not null default current_date,
  kind            text not null check (kind in ('revenue','payout','capital','expense')),
  party           text check (party in ('gabe','ceo')),   -- payouts only
  amount          numeric(10,2) not null,                 -- revenue/capital > 0, payout/expense < 0
  memo            text,
  ledger_entry_id uuid references ledger_entries(id) on delete cascade,
  expense_id      uuid references expenses(id) on delete cascade,
  created_at      timestamptz not null default now(),
  check (party is null or kind = 'payout')
);
create index on company_ledger (occurred_on);
create index on company_ledger (ledger_entry_id);
create index on company_ledger (expense_id);

create table recurring_expenses (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  category        text not null default 'other',
  expected_amount numeric(10,2) not null default 0,
  cadence         text not null default 'monthly' check (cadence in ('monthly','yearly')),
  due_day         int not null default 1 check (due_day between 1 and 31),
  due_month       int check (due_month between 1 and 12), -- yearly only
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

alter table expenses add column recurring_id uuid references recurring_expenses(id) on delete set null;

insert into settings (key, value) values ('split_ceo_pct','10') on conflict (key) do nothing;

-- ============ TRIGGERS ============
-- security definer: mirrors must write even when the acting user's JWT lacks the
-- owner role (public-site service writes, or an owner whose token hasn't refreshed).
create or replace function mirror_cash_split() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_washer numeric := coalesce((select value::numeric from settings where key = 'split_washer_pct'), 60);
  v_ceo    numeric := coalesce((select value::numeric from settings where key = 'split_ceo_pct'), 10);
  v_name   text;
begin
  if tg_op in ('UPDATE','DELETE') then
    delete from company_ledger where ledger_entry_id = old.id;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.kind in ('payment','credit','refund') then
    select name into v_name from customers where id = new.customer_id;
    insert into company_ledger (occurred_on, kind, amount, memo, ledger_entry_id)
      values (new.occurred_on, 'revenue', new.amount, v_name, new.id);
    if v_washer <> 0 then
      insert into company_ledger (occurred_on, kind, party, amount, memo, ledger_entry_id)
        values (new.occurred_on, 'payout', 'gabe', round(-new.amount * v_washer / 100, 2), v_name, new.id);
    end if;
    if v_ceo <> 0 then
      insert into company_ledger (occurred_on, kind, party, amount, memo, ledger_entry_id)
        values (new.occurred_on, 'payout', 'ceo', round(-new.amount * v_ceo / 100, 2), v_name, new.id);
    end if;
  end if;
  return new;
end $$;

create trigger ledger_entries_mirror
  after insert or update or delete on ledger_entries
  for each row execute function mirror_cash_split();

create or replace function mirror_expense() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE','DELETE') then
    delete from company_ledger where expense_id = old.id;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  insert into company_ledger (occurred_on, kind, amount, memo, expense_id)
    values (new.occurred_on, 'expense', -abs(new.amount), new.category || coalesce(' — ' || new.memo, ''), new.id);
  return new;
end $$;

create trigger expenses_mirror
  after insert or update or delete on expenses
  for each row execute function mirror_expense();

-- No backfill: existing ledger_entries/expenses rows get no mirrors on purpose.

-- ============ RLS ============
-- Role lives in auth app_metadata; missing role = washer (least privilege).
alter table company_ledger enable row level security;
create policy owner_all on company_ledger for all to authenticated
  using    (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'washer') = 'owner')
  with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'washer') = 'owner');
create policy washer_own_pay on company_ledger for select to authenticated
  using (kind = 'payout' and party = 'gabe');

alter table recurring_expenses enable row level security;
create policy owner_all on recurring_expenses for all to authenticated
  using    (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'washer') = 'owner')
  with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'washer') = 'owner');
