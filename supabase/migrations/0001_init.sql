-- Buffer Bros admin — full backend. Paste into the Supabase SQL editor in one shot,
-- or apply with `supabase db push`.

-- ============ ENUMS ============
create type appointment_status as enum ('scheduled','completed','cancelled','no_show');
create type appointment_source as enum ('web','manual','recurring');
create type plan_status        as enum ('active','paused','ended');
create type plan_cadence       as enum ('weekly','biweekly','monthly','custom');
create type payment_method     as enum ('cash','zelle','venmo','card','check','other');
create type entry_kind         as enum ('charge','payment','credit','refund','discount');

-- ============ CUSTOMERS & VEHICLES ============
create table customers (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text not null,
  phone       text,                        -- normalized E.164 where possible
  email       text,
  addresses   jsonb not null default '[]', -- [{label:'Home', address:'...'}]
  notes       text,
  tags        text[] not null default '{}',
  source      text,                        -- 'website' | 'contacts-import' | 'manual'
  archived    boolean not null default false
);
create index on customers using gin (tags);
create index on customers (phone);
create index on customers (email);

create table vehicles (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  size_id     text not null default 'sedan',   -- 'sedan'|'midsize'|'large'
  make        text, model text, year int, color text, plate text,
  notes       text
);
create index on vehicles (customer_id);

-- ============ SERVICE CATALOG ============
create table services (
  id          text primary key,  -- 'standard','pet-hair','engine-bay',...
  kind        text not null check (kind in ('detail','addon')),
  name        text not null,
  note        text,
  active      boolean not null default true,
  sort        int not null default 0
);
create table service_pricing (
  service_id  text not null references services(id) on delete cascade,
  size_id     text not null,     -- 'sedan'|'midsize'|'large'|'*'
  price       numeric(10,2) not null default 0,
  minutes     int not null default 0,
  primary key (service_id, size_id)
);
create table plan_pricing (
  cadence     plan_cadence not null,
  size_id     text not null,
  price       numeric(10,2) not null,
  primary key (cadence, size_id)
);

-- ============ SCHEDULING ============
create table weekly_hours (
  weekday   int primary key check (weekday between 0 and 6),  -- 0=Sunday
  enabled   boolean not null default true,
  open_min  int not null default 480,
  close_min int not null default 1080
);
create table blocks (
  id        uuid primary key default gen_random_uuid(),
  date      date not null,
  start_min int not null default 0,
  end_min   int not null default 1440,
  reason    text
);
create index on blocks (date);

create table settings ( key text primary key, value text not null );

-- "Today" in Buffer Bros wall-clock time (the DB clock is UTC — a day ahead of
-- Florida every evening). Used by seeds and handy in ad-hoc SQL.
create function et_today() returns date language sql stable as
$fn$ select (now() at time zone 'America/New_York')::date $fn$;

-- ============ RECURRING PLANS ============
create table plans (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  customer_id     uuid not null references customers(id) on delete cascade,
  vehicle_id      uuid references vehicles(id) on delete set null,
  cadence         plan_cadence not null,
  interval_days   int,                     -- only for cadence='custom'
  per_visit_price numeric(10,2) not null,
  preferred_dow   int,                     -- 0..6
  preferred_min   int,                     -- minutes from midnight
  duration_min    int not null default 120,
  address         text,
  status          plan_status not null default 'active',
  starts_on       date not null default current_date,
  ends_on         date,
  billing_note    text,
  notes           text,
  email_confirmations boolean not null default false  -- email customer when a recurring visit is generated
);
create index on plans (customer_id);
create index on plans (status);

-- ============ APPOINTMENTS ============
create table appointments (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  legacy_id    int,                          -- old D1 bookings.id
  customer_id  uuid references customers(id) on delete set null,
  vehicle_id   uuid references vehicles(id) on delete set null,
  plan_id      uuid references plans(id) on delete set null,
  source       appointment_source not null default 'manual',
  status       appointment_status not null default 'scheduled',
  date         date not null,
  start_min    int not null,
  duration_min int not null,
  size_id      text, size_label text,
  service_name text not null default 'The Standard Detail',
  addons       jsonb not null default '[]',  -- [{id,name,price}]
  price        numeric(10,2) not null default 0,
  address      text,
  contact_name text, contact_phone text, contact_email text,
  notes        text,
  completed_at timestamptz
);
create index on appointments (date, start_min);
create index on appointments (customer_id);
create index on appointments (plan_id);
create index on appointments (status);
create unique index appointments_legacy_id_key on appointments (legacy_id) where legacy_id is not null;

-- ============ MONEY ============
create table ledger_entries (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  customer_id    uuid not null references customers(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete set null,
  plan_id        uuid references plans(id) on delete set null,
  kind           entry_kind not null,
  amount         numeric(10,2) not null,    -- charge<0, payment>0
  method         payment_method,
  occurred_on    date not null default current_date,
  memo           text
);
create index on ledger_entries (customer_id, occurred_on);
create index on ledger_entries (occurred_on);

create view customer_balances with (security_invoker = true) as
  select c.id as customer_id, c.name,
         coalesce(sum(l.amount), 0) as balance   -- >0 credit, <0 owes
  from customers c left join ledger_entries l on l.customer_id = c.id
  group by c.id, c.name;

create table expenses (
  id          uuid primary key default gen_random_uuid(),
  occurred_on date not null default current_date,
  category    text not null default 'supplies',  -- supplies|fuel|equipment|insurance|marketing|other
  amount      numeric(10,2) not null,
  memo        text,
  created_at  timestamptz not null default now()
);
create index on expenses (occurred_on);

-- ============ GRANTS + ROW LEVEL SECURITY ============
-- Two-person internal tool: every authenticated user is an owner. No anon access —
-- anon gets neither grants nor policies; the public website talks through the
-- service role. Explicit grants because default privileges don't reliably cover
-- migration-created tables.
grant usage on schema public to authenticated, service_role;
grant all on all tables in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;
alter default privileges in schema public grant all on tables to authenticated, service_role;
alter default privileges in schema public grant execute on functions to authenticated, service_role;
do $$
declare t text;
begin
  foreach t in array array['customers','vehicles','services','service_pricing','plan_pricing',
                           'weekly_hours','blocks','settings','plans','appointments',
                           'ledger_entries','expenses']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy owners_all on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ============ AVAILABILITY ENGINE (single source of truth) ============
-- Mirrors the website engine exactly: buffer applies to appointments (pack-up/travel),
-- the appointment itself must END by close, buffer may run past close, overlap test is
-- start < busyEnd && end > busyStart, "today" is wall-clock in settings.timezone.
create or replace function get_available_slots(p_date date, p_duration_min int)
returns table (slot_min int)
language plpgsql stable
set search_path = public
as $$
declare
  v_tz       text;
  v_gran     int;
  v_lead     int;
  v_buffer   int;
  v_enabled  boolean;
  v_open     int;
  v_close    int;
  v_local    timestamp;
  v_today    date;
  v_earliest int := 0;
  v_total    int;
begin
  select coalesce((select value from settings where key='timezone'), 'America/New_York') into v_tz;
  select coalesce((select value::int from settings where key='slot_granularity_min'), 30) into v_gran;
  select coalesce((select value::int from settings where key='min_lead_min'), 180) into v_lead;
  select coalesce((select value::int from settings where key='buffer_min'), 30) into v_buffer;

  select enabled, open_min, close_min into v_enabled, v_open, v_close
  from weekly_hours where weekday = extract(dow from p_date)::int;
  if not found or not v_enabled then return; end if;

  v_local := now() at time zone v_tz;
  v_today := v_local::date;
  if p_date < v_today then return; end if;
  if p_date = v_today then
    v_earliest := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int + v_lead;
  end if;

  v_total := p_duration_min + v_buffer;

  return query
  select s
  from generate_series(v_open, v_close - p_duration_min, v_gran) as s
  where s >= v_earliest
    and not exists (
      select 1 from (
        select b.start_min as bs, b.end_min as be
        from blocks b where b.date = p_date
        union all
        select a.start_min, a.start_min + a.duration_min + v_buffer
        from appointments a where a.date = p_date and a.status = 'scheduled'
      ) busy
      where s < busy.be and s + v_total > busy.bs
    )
  order by s;
end $$;

-- ============ TRANSACTIONAL BOOKING ============
-- Re-validates the slot under an advisory lock so two concurrent writers can never
-- double-book. Modes:
--   'strict'  — start must be an offerable public slot (grid + lead time); the website uses this
--   'overlap' — only requires no overlap with blocks/appointments; dashboard + recurring
--               generation use this (owners book off-grid times, lead time doesn't apply to them)
--   'force'   — no checks; the owners' explicit "book anyway"
create or replace function book_appointment(
  p_date         date,
  p_start_min    int,
  p_duration_min int,
  p_name         text default null,
  p_email        text default null,
  p_phone        text default null,
  p_address      text default null,
  p_size_id      text default null,
  p_size_label   text default null,
  p_service_name text default 'The Standard Detail',
  p_addons       jsonb default '[]',
  p_price        numeric default 0,
  p_notes        text default null,
  p_source       appointment_source default 'web',
  p_customer_id  uuid default null,
  p_vehicle_id   uuid default null,
  p_plan_id      uuid default null,
  p_mode         text default 'strict'
) returns appointments
language plpgsql
set search_path = public
as $$
declare
  v_row appointments;
  v_buffer int;
begin
  perform pg_advisory_xact_lock(hashtext('book:' || p_date::text));
  if p_mode = 'strict' and not exists (
    select 1 from get_available_slots(p_date, p_duration_min) where slot_min = p_start_min
  ) then
    raise exception 'slot_taken' using hint = 'Sorry, that time was just taken. Please pick another slot.';
  end if;
  if p_mode = 'overlap' then
    select coalesce((select value::int from settings where key='buffer_min'), 30) into v_buffer;
    if exists (
      select 1 from (
        select b.start_min as bs, b.end_min as be from blocks b where b.date = p_date
        union all
        select a.start_min, a.start_min + a.duration_min + v_buffer
        from appointments a where a.date = p_date and a.status = 'scheduled'
      ) busy
      where p_start_min < busy.be and p_start_min + p_duration_min + v_buffer > busy.bs
    ) then
      raise exception 'slot_taken' using hint = 'That time overlaps another job or a blocked window.';
    end if;
  end if;

  insert into appointments
    (date, start_min, duration_min, size_id, size_label, service_name, addons, price,
     address, contact_name, contact_phone, contact_email, notes, source,
     customer_id, vehicle_id, plan_id)
  values
    (p_date, p_start_min, p_duration_min, p_size_id, p_size_label, p_service_name,
     coalesce(p_addons, '[]'::jsonb), coalesce(p_price, 0),
     p_address, p_name, p_phone, p_email, p_notes, p_source,
     p_customer_id, p_vehicle_id, p_plan_id)
  returning * into v_row;
  return v_row;
end $$;

revoke execute on function get_available_slots(date, int) from public, anon;
revoke execute on function book_appointment(date,int,int,text,text,text,text,text,text,text,jsonb,numeric,text,appointment_source,uuid,uuid,uuid,text) from public, anon;

-- ============ SEED DATA ============
insert into services (id, kind, name, note, sort) values
  ('standard',  'detail','The Standard Detail','Complete inside & out detail',0),
  ('pet-hair',  'addon','Pet Hair Removal','Heavy shedding and embedded hair',1),
  ('engine-bay','addon','Engine Bay Cleaning','Cleaned and dressed',2),
  ('ceramic',   'addon','Ceramic Spray Coating','Months of added protection',3),
  ('headlights','addon','Headlight Restoration','Clears yellowed, foggy lenses',4),
  ('odor',      'addon','Odor / Ozone Treatment','Smoke and stubborn smells',5);
insert into service_pricing (service_id, size_id, price, minutes) values
  ('standard','sedan',229,120), ('standard','midsize',249,150), ('standard','large',269,180),
  ('pet-hair','*',40,30), ('engine-bay','*',35,30), ('ceramic','*',60,45),
  ('headlights','*',50,45), ('odor','*',45,30);
insert into plan_pricing (cadence, size_id, price) values
  ('weekly','sedan',139),  ('weekly','midsize',159),  ('weekly','large',179),
  ('biweekly','sedan',159),('biweekly','midsize',179),('biweekly','large',199),
  ('monthly','sedan',179), ('monthly','midsize',199), ('monthly','large',219);
insert into weekly_hours (weekday, enabled, open_min, close_min)
  select d, true, 480, 1080 from generate_series(0,6) d;
insert into settings (key, value) values
  ('slot_granularity_min','30'), ('min_lead_min','180'),
  ('buffer_min','30'), ('timezone','America/New_York'),
  -- mock values, editable in Settings — new pricing model lands soon:
  ('prepay_discount_pct','10'),   -- pay a plan period up front -> 10% off per visit
  ('split_washer_pct','60');      -- 60% of collected revenue to the washer (Gabe), 40% to the business (Tyler)
