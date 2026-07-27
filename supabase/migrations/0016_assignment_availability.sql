-- 0016: assignment-aware availability.
--   * appointment_employees — which workers a job is assigned to (booking-time),
--     appointments.employee_id stays the single money-split "who did it".
--   * get_available_slots / book_appointment learn employee targeting:
--       - p_employee_ids = {}            -> the owner ("my calendar in my head"):
--                                           only business-wide blocks + unassigned jobs busy
--       - p_employee_ids = {e1}          -> that worker's free time
--       - p_employee_ids = {e1,e2} + all -> times they're ALL free (multi-worker job)
--       - p_employee_ids = null          -> public website path: if the owner checked
--                                           workers in settings.web_slot_employee_ids,
--                                           a slot is offerable when ANY of them is free
--                                           (no names ever leave the database);
--                                           otherwise the original whole-business busy set.
--   Busy rules: business-wide blocks (employee_id null) and unassigned scheduled jobs
--   block everyone; a worker's blocks/assigned jobs block only them; the owner has no
--   calendar of their own — their time is assumed free.

-- ============ ASSIGNMENTS ============
create table if not exists appointment_employees (
  appointment_id uuid not null references appointments(id) on delete cascade,
  employee_id    uuid not null references employees(id) on delete cascade,
  primary key (appointment_id, employee_id)
);
create index if not exists appointment_employees_employee_idx on appointment_employees (employee_id);

alter table appointment_employees enable row level security;
create policy owners_all on appointment_employees for all to authenticated using (true) with check (true);

-- Backfill: every money-attributed job becomes an assignment row.
insert into appointment_employees (appointment_id, employee_id)
  select id, employee_id from appointments where employee_id is not null
  on conflict do nothing;

-- Which workers the public site draws times from ('' = whole-business calendar, as before).
insert into settings (key, value) values ('web_slot_employee_ids', '')
  on conflict (key) do nothing;

-- ============ BUSY CHECK (shared by slots + booking) ============
-- Is `p_emp` busy anywhere in [p_start, p_end) on p_date? p_emp null = the owner.
create or replace function emp_window_busy(p_date date, p_start int, p_end int, p_emp uuid, p_buffer int)
returns boolean
language sql stable
set search_path = public
as $$
  select exists (
    select 1 from (
      select b.start_min as bs, b.end_min as be
      from blocks b
      where b.date = p_date
        and (b.employee_id is null or b.employee_id = p_emp)
      union all
      select a.start_min, a.start_min + a.duration_min + p_buffer
      from appointments a
      where a.date = p_date and a.status = 'scheduled'
        and (not exists (select 1 from appointment_employees ae where ae.appointment_id = a.id)
             or exists (select 1 from appointment_employees ae where ae.appointment_id = a.id and ae.employee_id = p_emp))
    ) busy
    where p_start < busy.be and p_end > busy.bs
  );
$$;

-- ============ AVAILABILITY ============
drop function if exists get_available_slots(date, int);

create or replace function get_available_slots(
  p_date         date,
  p_duration_min int,
  p_employee_ids uuid[] default null,
  p_require_all  boolean default true
)
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
  v_ids      uuid[] := p_employee_ids;
  v_all      boolean := coalesce(p_require_all, true);
begin
  select coalesce((select value from settings where key='timezone'), 'America/New_York') into v_tz;
  select coalesce((select value::int from settings where key='slot_granularity_min'), 30) into v_gran;
  select coalesce((select value::int from settings where key='min_lead_min'), 180) into v_lead;
  select coalesce((select value::int from settings where key='buffer_min'), 30) into v_buffer;

  -- Public/no-target path: honor the website worker toggle when set.
  if v_ids is null then
    begin
      v_ids := nullif(string_to_array(coalesce((select value from settings where key='web_slot_employee_ids'), ''), ','), '{}')::uuid[];
    exception when others then
      v_ids := null;  -- unparseable setting: fall back to the whole-business calendar
    end;
    v_all := false;    -- website: a slot works if ANY checked worker can take it
  elsif array_length(v_ids, 1) is null then
    v_ids := array[null::uuid];  -- explicit {} = the owner
  end if;

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
    and (
      -- legacy whole-business calendar: every block + every scheduled job is busy
      (v_ids is null and not exists (
        select 1 from (
          select b.start_min as bs, b.end_min as be
          from blocks b where b.date = p_date
          union all
          select a.start_min, a.start_min + a.duration_min + v_buffer
          from appointments a where a.date = p_date and a.status = 'scheduled'
        ) busy
        where s < busy.be and s + v_total > busy.bs
      ))
      -- targeted: ALL listed free (multi-worker job) / ANY listed free (website)
      or (v_ids is not null and v_all
          and not exists (select 1 from unnest(v_ids) e where emp_window_busy(p_date, s, s + v_total, e, v_buffer)))
      or (v_ids is not null and not v_all
          and exists (select 1 from unnest(v_ids) e where not emp_window_busy(p_date, s, s + v_total, e, v_buffer)))
    )
  order by s;
end $$;

-- ============ BOOKING ============
drop function if exists book_appointment(date,int,int,text,text,text,text,text,text,text,jsonb,numeric,text,appointment_source,uuid,uuid,uuid,text);

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
  p_mode         text default 'strict',
  p_employee_ids uuid[] default null   -- assignees; {} = the owner, null = whole-business check
) returns appointments
language plpgsql
set search_path = public
as $$
declare
  v_row appointments;
  v_buffer int;
  v_ids uuid[] := p_employee_ids;
  v_first uuid;
  v_conflict boolean;
begin
  perform pg_advisory_xact_lock(hashtext('book:' || p_date::text));
  if p_mode = 'strict' and not exists (
    select 1 from get_available_slots(p_date, p_duration_min, p_employee_ids, true) where slot_min = p_start_min
  ) then
    raise exception 'slot_taken' using hint = 'Sorry, that time was just taken. Please pick another slot.';
  end if;
  if p_mode = 'overlap' then
    select coalesce((select value::int from settings where key='buffer_min'), 30) into v_buffer;
    if v_ids is not null and array_length(v_ids, 1) is null then v_ids := array[null::uuid]; end if;
    if v_ids is null then
      -- whole-business check, exactly as before (recurring generation uses this)
      select exists (
        select 1 from (
          select b.start_min as bs, b.end_min as be from blocks b where b.date = p_date
          union all
          select a.start_min, a.start_min + a.duration_min + v_buffer
          from appointments a where a.date = p_date and a.status = 'scheduled'
        ) busy
        where p_start_min < busy.be and p_start_min + p_duration_min + v_buffer > busy.bs
      ) into v_conflict;
    else
      -- every assignee must be free
      select exists (
        select 1 from unnest(v_ids) e
        where emp_window_busy(p_date, p_start_min, p_start_min + p_duration_min + v_buffer, e, v_buffer)
      ) into v_conflict;
    end if;
    if v_conflict then
      raise exception 'slot_taken' using hint = 'That time overlaps another job or a blocked window.';
    end if;
  end if;

  select e into v_first from unnest(p_employee_ids) e where e is not null limit 1;

  insert into appointments
    (date, start_min, duration_min, size_id, size_label, service_name, addons, price,
     address, contact_name, contact_phone, contact_email, notes, source,
     customer_id, vehicle_id, plan_id, employee_id)
  values
    (p_date, p_start_min, p_duration_min, p_size_id, p_size_label, p_service_name,
     coalesce(p_addons, '[]'::jsonb), coalesce(p_price, 0),
     p_address, p_name, p_phone, p_email, p_notes, p_source,
     p_customer_id, p_vehicle_id, p_plan_id, v_first)
  returning * into v_row;

  insert into appointment_employees (appointment_id, employee_id)
    select v_row.id, e from unnest(p_employee_ids) e where e is not null
    on conflict do nothing;

  return v_row;
end $$;

revoke execute on function get_available_slots(date, int, uuid[], boolean) from public, anon;
revoke execute on function emp_window_busy(date, int, int, uuid, int) from public, anon;
revoke execute on function book_appointment(date,int,int,text,text,text,text,text,text,text,jsonb,numeric,text,appointment_source,uuid,uuid,uuid,text,uuid[]) from public, anon;
