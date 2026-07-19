-- 0008_washer_collected_revenue_only.sql — Gabe is run as an employee: he sees the money
-- he's paid and the money he owes Tyler, never the company's gross flow. 0004 let him read
-- a job's full revenue whenever he had a payout on it — including jobs Tyler collected, where
-- Gabe never touched the cash and has no business seeing the client's total. Tighten it so
-- revenue is visible only for jobs Gabe himself collected (collected_by = 'washer', which the
-- mirror trigger stamps from the source payment). On Tyler-collected jobs he sees his payout
-- row alone. CEO payouts, capital, and expenses stay owner-only as before.
drop policy washer_own_pay on company_ledger;
create policy washer_own_pay on company_ledger for select to authenticated
  using (
    (kind = 'payout' and party = 'gabe')
    or (kind = 'revenue' and ledger_entry_id is not null
        and collected_by = 'washer' and has_gabe_payout(ledger_entry_id))
  );
