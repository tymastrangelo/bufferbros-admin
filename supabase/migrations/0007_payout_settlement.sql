-- 0007_payout_settlement.sql — track who collected each payment and whether Tyler & Gabe
-- have squared up the split. Settlement is a per-payment fact, so it lives on the source
-- ledger_entries row; the mirror trigger copies it onto company_ledger so Gabe's My Pay
-- (which reads company_ledger) shows status with no new read path or RLS.

alter table ledger_entries
  add column collected_by text not null default 'owner'
    check (collected_by in ('owner','washer')),
  add column settled_on date;                       -- null = unsettled; money-in kinds only

alter table company_ledger
  add column collected_by text,
  add column settled_on  date;

-- Recreate the mirror to carry collected_by / settled_on onto every derived row. The
-- trigger already deletes + re-inserts on any ledger_entries UPDATE, so marking a payment
-- settled (an UPDATE of settled_on) re-stamps the company_ledger rows automatically.
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
    insert into company_ledger (occurred_on, kind, amount, memo, ledger_entry_id, collected_by, settled_on)
      values (new.occurred_on, 'revenue', new.amount, v_name, new.id, new.collected_by, new.settled_on);
    if v_washer <> 0 then
      insert into company_ledger (occurred_on, kind, party, amount, memo, ledger_entry_id, collected_by, settled_on)
        values (new.occurred_on, 'payout', 'gabe', round(-new.amount * v_washer / 100, 2), v_name, new.id, new.collected_by, new.settled_on);
    end if;
    if v_ceo <> 0 then
      insert into company_ledger (occurred_on, kind, party, amount, memo, ledger_entry_id, collected_by, settled_on)
        values (new.occurred_on, 'payout', 'ceo', round(-new.amount * v_ceo / 100, 2), v_name, new.id, new.collected_by, new.settled_on);
    end if;
  end if;
  return new;
end $$;
