-- Washers may read the revenue rows their payouts derive from (they collected that cash
-- on the job), so My Pay can show collected / keep / send-back per job. CEO payouts,
-- capital, and expenses stay owner-only.
drop policy washer_own_pay on company_ledger;
create policy washer_own_pay on company_ledger for select to authenticated
  using (kind = 'revenue' or (kind = 'payout' and party = 'gabe'));
