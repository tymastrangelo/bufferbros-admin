-- 0015: employees as first-class rows (Gabe becomes row #1), per-employee splits,
-- per-employee blocked time with iCal feed sync, and boats on vehicles.
--
-- Money model change: company_ledger payout rows now carry employee_id; the mirror
-- trigger resolves the employee from the payment's appointment (who did the detail)
-- and uses THAT employee's split_pct. Unlinked payments (balance/prepay) fall back
-- to the default employee (settings.default_employee_id, seeded to Gabe) so history
-- and behavior stay identical for a one-washer shop.

-- ============ EMPLOYEES ============
create table if not exists employees (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  user_id        uuid unique references auth.users(id) on delete set null,
  name           text not null,
  email          text,
  split_pct      numeric not null default 60,   -- % of collected revenue on their jobs
  ical_url       text,                          -- secret .ics address of their other-job calendar
  ical_synced_at timestamptz,
  active         boolean not null default true
);

-- Backfill Gabe from his auth user (the one non-owner account) + the old global split.
insert into employees (user_id, name, email, split_pct)
select u.id, 'Gabe', u.email,
       coalesce((select value::numeric from settings where key = 'split_washer_pct'), 60)
from auth.users u
where coalesce(u.raw_app_meta_data ->> 'role', 'washer') <> 'owner'
  and not exists (select 1 from employees)
order by u.created_at
limit 1
on conflict (user_id) do nothing;

insert into settings (key, value)
select 'default_employee_id', id::text from employees order by created_at limit 1
on conflict (key) do nothing;

alter table employees enable row level security;
-- Owner does everything; an employee can read their own row (name, split, feed url).
-- Employee writes (their own ical_url) go through server actions on the service role.
create policy owner_all on employees for all to authenticated
  using    (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'washer') = 'owner')
  with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'washer') = 'owner');
create policy employee_own_row on employees for select to authenticated
  using (user_id = auth.uid());

-- ============ WHO DID THE DETAIL ============
alter table appointments add column if not exists employee_id uuid references employees(id) on delete set null;

-- ============ COMPANY LEDGER: PER-EMPLOYEE PAYOUTS ============
alter table company_ledger add column if not exists employee_id uuid references employees(id) on delete set null;
-- party was check-constrained to ('gabe','ceo'); new employee payouts use party='employee'
-- with employee_id authoritative. Old 'gabe' rows get their employee_id backfilled.
alter table company_ledger drop constraint if exists company_ledger_party_check;
update company_ledger set employee_id = (
  select id from employees order by created_at limit 1
) where party = 'gabe' and employee_id is null;

create or replace function my_employee_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from employees where user_id = auth.uid();
$$;

-- Replaces has_gabe_payout (kept — 0004/0008 policies referenced it; dropped below).
create or replace function has_employee_payout(entry uuid, emp uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from company_ledger
    where kind = 'payout' and employee_id = emp and ledger_entry_id = entry
  );
$$;

drop policy if exists washer_own_pay on company_ledger;
create policy washer_own_pay on company_ledger for select to authenticated
  using (
    (kind = 'payout' and employee_id is not null and employee_id = my_employee_id())
    or (kind = 'revenue' and ledger_entry_id is not null
        and collected_by = 'washer' and has_employee_payout(ledger_entry_id, my_employee_id()))
  );
drop function if exists has_gabe_payout(uuid);

-- Mirror v5 (supersedes 0014). Split resolution per payment:
--   self_done appointment  -> no employee payout (money stays with the business)
--   appointment.employee_id -> that employee's split_pct
--   no appointment          -> default employee (settings.default_employee_id)
create or replace function mirror_cash_split() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_ceo  numeric := coalesce((select value::numeric from settings where key = 'split_ceo_pct'), 10);
  v_name text;
  v_net  numeric;
  v_self boolean := false;
  v_emp  employees%rowtype;
  v_emp_id uuid;
begin
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
end $$;

-- Re-mirror when attribution changes too, not just the keep-all flag — flipping who
-- did a past detail must move the payout to the right employee.
drop trigger if exists appointments_remirror_self_done on appointments;
create trigger appointments_remirror_self_done
  after update of self_done, employee_id on appointments
  for each row when (old.self_done is distinct from new.self_done
                  or old.employee_id is distinct from new.employee_id)
  execute function remirror_self_done();

-- ============ BLOCKS: PER-EMPLOYEE + ICAL SYNC ============
-- employee_id null = business-wide block (the owner's). All blocks still block
-- booking availability — one crew on the road at a time.
-- ponytail: per-employee availability math comes when two workers run jobs in parallel.
alter table blocks
  add column if not exists employee_id uuid references employees(id) on delete cascade,
  add column if not exists source text not null default 'manual' check (source in ('manual','ical')),
  add column if not exists ical_uid text;
-- One block per synced event occurrence; the sync upserts against this. Manual
-- blocks have null ical_uid — nulls are distinct, so they never collide.
-- (Full index, not partial: PostgREST's on_conflict can't target partial indexes.)
create unique index if not exists blocks_ical_key on blocks (employee_id, ical_uid, date);

-- ============ BOATS ============
alter table vehicles
  add column if not exists kind text not null default 'car' check (kind in ('car','boat')),
  add column if not exists length_ft numeric;

-- Boat detailing priced per foot: service_pricing row size_id='per-ft' holds the
-- $/ft and minutes/ft. Seed values are placeholders — edit in Settings once real
-- boat pricing exists.
insert into services (id, kind, name, note, sort) values
  ('boat-detail', 'detail', 'Boat Detail', 'Wash, wax & interior — priced per foot of boat.', 300)
on conflict (id) do update set kind = excluded.kind, name = excluded.name, note = excluded.note, sort = excluded.sort;
insert into service_pricing (service_id, size_id, price, minutes) values
  ('boat-detail', 'per-ft', 12, 8)
on conflict (service_id, size_id) do nothing;
