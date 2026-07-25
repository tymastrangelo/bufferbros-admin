-- 0014: "I did this one" — details Tyler washes himself pay no Gabe cut.
-- The flag lives on the appointment (the record of who did the job); the mirror
-- trigger derives from it, so every payment path (collected now, Stripe webhook,
-- later balance payment linked to the job) splits correctly with no app-side math.

alter table appointments add column if not exists self_done boolean not null default false;

-- Mirror v4. Two changes vs 0012:
--   1. Restores collected_by / settled_on on the derived company_ledger rows —
--      0007 added them (My Pay reads them) and 0012's rewrite dropped them.
--   2. Skips Gabe's payout row when the payment's appointment is self_done; his
--      cut stays in company capital. CEO cut and revenue are unchanged.
create or replace function mirror_cash_split() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_washer numeric := coalesce((select value::numeric from settings where key = 'split_washer_pct'), 60);
  v_ceo    numeric := coalesce((select value::numeric from settings where key = 'split_ceo_pct'), 10);
  v_name   text;
  v_net    numeric;
  v_self   boolean := false;
begin
  if tg_op in ('UPDATE','DELETE') then
    delete from company_ledger where ledger_entry_id = old.id;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.kind in ('payment','credit','refund') then
    select name into v_name from customers where id = new.customer_id;
    if new.appointment_id is not null then
      select self_done into v_self from appointments where id = new.appointment_id;
    end if;
    v_net := new.amount - coalesce(new.processor_fee, 0);
    insert into company_ledger (occurred_on, kind, amount, memo, ledger_entry_id, collected_by, settled_on)
      values (new.occurred_on, 'revenue', new.amount, v_name, new.id, new.collected_by, new.settled_on);
    if coalesce(new.processor_fee, 0) <> 0 then
      insert into company_ledger (occurred_on, kind, amount, memo, ledger_entry_id)
        values (new.occurred_on, 'expense', -new.processor_fee, 'Stripe fee — ' || coalesce(v_name, ''), new.id);
    end if;
    if v_washer <> 0 and not coalesce(v_self, false) then
      insert into company_ledger (occurred_on, kind, party, amount, memo, ledger_entry_id, collected_by, settled_on)
        values (new.occurred_on, 'payout', 'gabe', round(-v_net * v_washer / 100, 2), v_name, new.id, new.collected_by, new.settled_on);
    end if;
    if v_ceo <> 0 then
      insert into company_ledger (occurred_on, kind, party, amount, memo, ledger_entry_id, collected_by, settled_on)
        values (new.occurred_on, 'payout', 'ceo', round(-v_net * v_ceo / 100, 2), v_name, new.id, new.collected_by, new.settled_on);
    end if;
  end if;
  return new;
end $$;

-- Flipping self_done after payments exist re-mirrors them (the no-op update
-- fires ledger_entries_mirror, which rebuilds the derived rows).
create or replace function remirror_self_done() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update ledger_entries set amount = amount
    where appointment_id = new.id and kind in ('payment','credit','refund');
  return new;
end $$;

create trigger appointments_remirror_self_done
  after update of self_done on appointments
  for each row when (old.self_done is distinct from new.self_done)
  execute function remirror_self_done();
