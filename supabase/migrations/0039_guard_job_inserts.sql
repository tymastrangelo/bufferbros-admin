-- 0038 follow-up (security review): the appointments guard only ran on UPDATE, so a worker could
-- INSERT a job that's already completed straight through the API and skip the payee rules. New
-- jobs from anyone but the owner/service role now start out scheduled (or pending) and untouched,
-- and a worker's charge must be the completed job's own price.

create or replace function appointments_guard_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  claims jsonb := auth.jwt();
begin
  if claims is null
     or claims ->> 'role' = 'service_role'
     or claims -> 'app_metadata' ->> 'role' = 'owner' then
    return new;
  end if;
  if new.status not in ('scheduled', 'pending')
     or new.completed_at is not null or new.started_at is not null or new.self_done then
    raise exception 'New jobs start out scheduled. Book it, then complete it.';
  end if;
  return new;
end $$;
create or replace trigger appointments_guard_insert before insert on appointments
  for each row execute function appointments_guard_insert();

alter policy crew_collects on ledger_entries with check (
  (select is_staff()) and settled_on is null and coalesce(processor_fee, 0) = 0 and (
    (kind = 'payment' and collected_by = 'washer' and case
       when appointment_id is not null then exists (
         select 1 from appointments a where a.id = appointment_id and a.employee_id = (select my_employee_id()))
       else employee_id = (select my_employee_id())
     end)
    or (kind = 'charge' and exists (
         select 1 from appointments a where a.id = appointment_id and a.employee_id = (select my_employee_id())
           and a.status = 'completed' and amount = -a.price))
  )
);
