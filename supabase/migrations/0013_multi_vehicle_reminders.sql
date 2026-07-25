-- 0013: Multi-vehicle bookings & plans + manual reminders.
-- A visit can now cover several of a customer's cars. appointments.vehicle_id /
-- plans.vehicle_id stay as the "first vehicle" for back-compat (website flow,
-- gcal, existing queries); the join tables are the full list.

create table if not exists appointment_vehicles (
  appointment_id uuid not null references appointments(id) on delete cascade,
  vehicle_id     uuid not null references vehicles(id) on delete cascade,
  primary key (appointment_id, vehicle_id)
);
create index if not exists appointment_vehicles_vehicle_idx on appointment_vehicles (vehicle_id);

create table if not exists plan_vehicles (
  plan_id    uuid not null references plans(id) on delete cascade,
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  primary key (plan_id, vehicle_id)
);
create index if not exists plan_vehicles_vehicle_idx on plan_vehicles (vehicle_id);

-- Backfill: every existing single-vehicle link becomes a join row.
insert into appointment_vehicles (appointment_id, vehicle_id)
  select id, vehicle_id from appointments where vehicle_id is not null
  on conflict do nothing;
insert into plan_vehicles (plan_id, vehicle_id)
  select id, vehicle_id from plans where vehicle_id is not null
  on conflict do nothing;

-- Manual reminders ("call Katy in November"). Delivered to the owner's phone by
-- the morning-digest cron on due_on (sent_at marks delivery); they stay on the
-- Today list until marked done.
create table if not exists reminders (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  due_on      date not null,
  title       text not null,
  body        text,
  customer_id uuid references customers(id) on delete cascade,
  vehicle_ids uuid[] not null default '{}',  -- informational; no FK on array elements
  sent_at     timestamptz,
  done_at     timestamptz
);
create index if not exists reminders_open_idx on reminders (due_on) where done_at is null;

-- Same blanket policy as every other table (grants come from 0001 default privileges).
do $$
declare t text;
begin
  foreach t in array array['appointment_vehicles','plan_vehicles','reminders'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy owners_all on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- Discount when a maintenance plan covers 2+ cars cleaned in the same visit.
insert into settings (key, value) values ('multi_car_discount_pct', '5')
  on conflict (key) do nothing;
