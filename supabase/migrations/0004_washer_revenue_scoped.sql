-- Tighten 0003: washers see a revenue row only when it pairs with one of Gabe's
-- payouts. If an owner deletes Gabe's payout for a job he didn't work, the job's
-- revenue disappears from his view too.
-- security definer helper because a policy can't subquery its own table (recursion).
create or replace function has_gabe_payout(entry uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from company_ledger
    where kind = 'payout' and party = 'gabe' and ledger_entry_id = entry
  );
$$;

drop policy washer_own_pay on company_ledger;
create policy washer_own_pay on company_ledger for select to authenticated
  using (
    (kind = 'payout' and party = 'gabe')
    or (kind = 'revenue' and ledger_entry_id is not null and has_gabe_payout(ledger_entry_id))
  );
