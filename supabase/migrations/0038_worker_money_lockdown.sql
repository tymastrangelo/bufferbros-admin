-- Crew can work jobs, not move money. Before this, any worker could (through the app's server
-- actions or straight through the REST API with their own login) add/edit/delete ledger rows,
-- log fake fronted expenses, send discounted prepay links, re-point a finished job's payee, or
-- add themselves to a job and complete it as the payee. Payouts are derived from those rows, so
-- each was a way to pay yourself. Now, for anyone who isn't the owner:
--   * ledger_entries: read; insert only cash they were handed (collected_by 'washer', on their
--     own job or attributed to themselves) and the charge on a job they're completing. No edits,
--     no deletes, no credits/discounts/refunds, nothing owner-collected or pre-settled.
--   * appointment_employees: read; assign crew only while booking a new job (same transaction).
--   * expenses: see only what they fronted themselves; Tyler logs and edits expenses.
--   * payment_requests: plain job links only (no prepay, no discount, can't mark paid).
--   * plans, plan_vehicles, weekly_hours: read only. appointments, customers: no deletes.
--   * appointments guard: a worker completes only a job they're assigned to, as its payee, and
--     can't change a completed job's price, customer, or payee, or anyone's payee otherwise.
-- One charge per job (DB-enforced), and one photo row per stored file (a worker can't point a
-- row at someone else's photo and delete it out from under them).

-- ledger_entries
alter policy owners_all on ledger_entries using ((select is_owner())) with check ((select is_owner()));
create policy staff_read on ledger_entries for select to authenticated using ((select is_staff()));
create policy crew_collects on ledger_entries for insert to authenticated with check (
  (select is_staff()) and settled_on is null and coalesce(processor_fee, 0) = 0 and (
    (kind = 'payment' and collected_by = 'washer' and case
       when appointment_id is not null then exists (
         select 1 from appointments a where a.id = appointment_id and a.employee_id = (select my_employee_id()))
       else employee_id = (select my_employee_id())
     end)
    or (kind = 'charge' and exists (
         select 1 from appointments a where a.id = appointment_id and a.employee_id = (select my_employee_id())))
  )
);
create unique index if not exists ledger_entries_one_charge_per_job on ledger_entries (appointment_id) where kind = 'charge';

-- appointment_employees: book_appointment inserts the job and its crew in one transaction, so the
-- job's created_at equals now(); an existing job's crew is Tyler's to change.
alter policy owners_all on appointment_employees using ((select is_owner())) with check ((select is_owner()));
create policy staff_read on appointment_employees for select to authenticated using ((select is_staff()));
create policy crew_books on appointment_employees for insert to authenticated with check (
  (select is_staff()) and exists (select 1 from appointments a where a.id = appointment_id and a.created_at = now())
);

-- expenses
alter policy owners_all on expenses using ((select is_owner())) with check ((select is_owner()));
create policy own_fronted on expenses for select to authenticated using (paid_by_employee_id = (select my_employee_id()));

-- payment_requests
alter policy owners_all on payment_requests using ((select is_owner())) with check ((select is_owner()));
create policy staff_read on payment_requests for select to authenticated using ((select is_staff()));
create policy crew_job_links on payment_requests for all to authenticated
  using ((select is_staff()) and kind = 'job' and coalesce(discount, 0) = 0 and status = 'pending')
  with check ((select is_staff()) and kind = 'job' and coalesce(discount, 0) = 0 and status = 'pending');

-- read-only for the crew
do $$
declare t text;
begin
  foreach t in array array['plans', 'plan_vehicles', 'weekly_hours'] loop
    execute format('alter policy owners_all on %I using ((select is_owner())) with check ((select is_owner()))', t);
    execute format('create policy staff_read on %I for select to authenticated using ((select is_staff()))', t);
  end loop;
  -- crew reads/adds/edits, only the owner deletes
  foreach t in array array['appointments', 'customers'] loop
    execute format('alter policy owners_all on %I using ((select is_owner())) with check ((select is_owner()))', t);
    execute format('create policy staff_read on %I for select to authenticated using ((select is_staff()))', t);
    execute format('create policy staff_insert on %I for insert to authenticated with check ((select is_staff()))', t);
    execute format('create policy staff_update on %I for update to authenticated using ((select is_staff())) with check ((select is_staff()))', t);
  end loop;
end $$;

create unique index if not exists appointment_photos_path_key on appointment_photos (path);

-- appointments guard (0011 + payee rules). Owner, service role and direct SQL pass straight through.
create or replace function appointments_guard_completed() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  claims jsonb := auth.jwt();
  v_me uuid;
begin
  if claims is null
     or claims ->> 'role' = 'service_role'
     or claims -> 'app_metadata' ->> 'role' = 'owner' then
    return new;
  end if;
  if old.status = 'completed' and new.status is distinct from old.status then
    raise exception 'Only the owner can reopen a completed job.';
  end if;
  if old.status = 'completed'
     and (new.completed_at is distinct from old.completed_at
       or new.started_at is distinct from old.started_at) then
    raise exception 'Only the owner can adjust job times.';
  end if;
  if old.status = 'completed'
     and (new.price is distinct from old.price
       or new.customer_id is distinct from old.customer_id
       or new.employee_id is distinct from old.employee_id
       or new.self_done is distinct from old.self_done) then
    raise exception 'Only the owner can change a completed job''s price, customer, or who did it.';
  end if;
  v_me := my_employee_id();
  if new.status = 'completed' and old.status is distinct from 'completed' then
    if v_me is null or new.employee_id is distinct from v_me or new.self_done
       or not exists (select 1 from appointment_employees ae where ae.appointment_id = new.id and ae.employee_id = v_me) then
      raise exception 'This job isn''t assigned to you. Ask Tyler to add you to it, then complete it.';
    end if;
  elsif new.employee_id is distinct from old.employee_id or new.self_done is distinct from old.self_done then
    raise exception 'Only the owner can change who gets paid for a job.';
  end if;
  return new;
end $$;
