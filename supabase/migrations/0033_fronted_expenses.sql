-- 0033: expenses a worker paid out of pocket (supplies on the way to a job, a part, gas).
-- The owner records them (the worker texts a receipt); until reimbursed they count as
-- money the owner owes that worker, right next to their job cuts on Payouts / My Pay.
alter table expenses add column if not exists paid_by_employee_id uuid references employees(id) on delete set null;
alter table expenses add column if not exists reimbursed_on date;
create index if not exists expenses_fronted_open on expenses (paid_by_employee_id) where paid_by_employee_id is not null and reimbursed_on is null;
