-- Lock the data to the crew. Supabase email sign-up is open on this project, and most business
-- tables had `owners_all using (true)` policies — so anyone who signed up an account (anon key is
-- in the admin site's JS) could read and edit every customer, job, and ledger row. Now a row is
-- visible only to the owner or an *active* employee linked to the signed-in user. Deactivating a
-- worker cuts their data access too (the app already shows them a sign-out screen).
-- Catalog + settings: the crew reads, only the owner writes (prices go live on bufferbros.org).
-- The website and the Mac texts sync use the service role, which bypasses RLS: unaffected.

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'owner'
      or exists (select 1 from employees where user_id = auth.uid() and active)
$$;

create or replace function is_owner() returns boolean
language sql stable as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'owner'
$$;

do $$
declare t text;
begin
  -- crew reads and writes (jobs, customers, money they collect on site)
  foreach t in array array[
    'customers', 'vehicles', 'weekly_hours', 'blocks', 'plans', 'appointments', 'ledger_entries',
    'expenses', 'payment_requests', 'reminders', 'appointment_vehicles', 'plan_vehicles',
    'outreach_log', 'appointment_employees'
  ] loop
    execute format('alter policy owners_all on %I using ((select is_staff())) with check ((select is_staff()))', t);
  end loop;
  -- crew reads, owner writes
  foreach t in array array['settings', 'services', 'service_pricing', 'plan_pricing'] loop
    execute format('alter policy owners_all on %I using ((select is_owner())) with check ((select is_owner()))', t);
    execute format('create policy staff_read on %I for select to authenticated using ((select is_staff()))', t);
  end loop;
end $$;

alter policy read_events on appointment_events using ((select is_staff()));
alter policy read_photos on appointment_photos using ((select is_staff()));
alter policy add_photos on appointment_photos with check (
  (select is_staff()) and ((select is_owner()) or taken_by is null or taken_by = my_employee_id())
);
alter policy "job photos read" on storage.objects using (bucket_id = 'job-photos' and (select is_staff()));
alter policy "job photos insert" on storage.objects with check (bucket_id = 'job-photos' and (select is_staff()));

alter function marketing_channel_ok(text) set search_path = public;
