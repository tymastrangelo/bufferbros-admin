-- 0011: Ceramic coating as a real bookable service, plan onboarding/prepay knobs,
-- and job time tracking with owner-only edits on completed jobs.

-- ============ CERAMIC COATING ============
-- A second kind='detail' service (not an add-on — it replaces the base service and
-- already includes a full Standard Detail). The website only renders 'standard' +
-- add-ons, so this stays quote-generator / dashboard only.
insert into services (id, kind, name, note, sort) values
  ('ceramic-coating', 'detail', 'Ceramic Coating',
   'Multi-year ceramic protection. Includes a full in-and-out Standard Detail — the paint has to be perfectly clean before coating.', 100)
on conflict (id) do update set kind = excluded.kind, name = excluded.name, note = excluded.note, sort = excluded.sort;

-- Seed pricing (editable in Settings, like everything else).
insert into service_pricing (service_id, size_id, price, minutes) values
  ('ceramic-coating', 'sedan',   699, 480),
  ('ceramic-coating', 'midsize', 799, 540),
  ('ceramic-coating', 'large',   899, 600)
on conflict (service_id, size_id) do nothing;

-- Booking rules, all editable in Settings:
--   ceramic_lead_days    — minimum days of notice for a ceramic job
--   ceramic_deposit_pct  — % of the price collected up front when booking
--   plan_initial_discount_pct — discount on the required first Standard Detail
--                               before a maintenance plan starts
--   prepay_discount_pct  — discount for paying a quarter (or more) of plan visits up front
insert into settings (key, value) values
  ('ceramic_lead_days', '7'),
  ('ceramic_deposit_pct', '50'),
  ('plan_initial_discount_pct', '10'),
  ('prepay_discount_pct', '5')
on conflict (key) do nothing;

-- ============ JOB TIME TRACKING ============
alter table appointments add column if not exists started_at timestamptz;

-- Only the owner may reopen a completed job or touch its start/completion timestamps.
-- App-level checks exist too; this backstops them at the database no matter the client.
-- No JWT (migrations, SQL editor) and service_role are exempt.
create or replace function appointments_guard_completed() returns trigger
language plpgsql security definer set search_path = public as $$
declare claims jsonb;
begin
  claims := auth.jwt();
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
  return new;
end $$;

drop trigger if exists appointments_guard_completed on appointments;
create trigger appointments_guard_completed
  before update on appointments
  for each row execute function appointments_guard_completed();
