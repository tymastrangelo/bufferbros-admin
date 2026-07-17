-- Web-booking approval flow + phone notifications (design: docs/superpowers/specs/
-- 2026-07-17-notifications-approval-design.md).
--
-- 1. Washer-visible completion note on appointments.
-- 2. Pending appointments hold their slot (busy in both availability paths).
-- 3. book_appointment: source='web' lands as 'pending' — the website Worker keeps
--    calling the RPC unchanged; the dashboard approves before it's confirmed.
-- 4. pg_net trigger pushes the owner's phone (ntfy) the moment a web booking lands.
--    The ntfy topic is the secret; it lives in Vault under 'ntfy_topic_owner'
--    (inserted at setup time, never in a migration file).

alter table appointments add column if not exists completion_note text;

create extension if not exists pg_net;

-- ============ AVAILABILITY: pending counts as busy ============
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
        from appointments a where a.date = p_date and a.status in ('scheduled','pending')
      ) busy
      where s < busy.be and s + v_total > busy.bs
    )
  order by s;
end $$;

-- ============ BOOKING: web bookings land as 'pending' ============
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
        from appointments a where a.date = p_date and a.status in ('scheduled','pending')
      ) busy
      where p_start_min < busy.be and p_start_min + p_duration_min + v_buffer > busy.bs
    ) then
      raise exception 'slot_taken' using hint = 'That time overlaps another job or a blocked window.';
    end if;
  end if;

  insert into appointments
    (date, start_min, duration_min, size_id, size_label, service_name, addons, price,
     address, contact_name, contact_phone, contact_email, notes, source,
     customer_id, vehicle_id, plan_id, status)
  values
    (p_date, p_start_min, p_duration_min, p_size_id, p_size_label, p_service_name,
     coalesce(p_addons, '[]'::jsonb), coalesce(p_price, 0),
     p_address, p_name, p_phone, p_email, p_notes, p_source,
     p_customer_id, p_vehicle_id, p_plan_id,
     case when p_source = 'web' then 'pending' else 'scheduled' end::appointment_status)
  returning * into v_row;
  return v_row;
end $$;

-- ============ PUSH THE OWNER WHEN A WEB BOOKING LANDS ============
create or replace function notify_owner_web_booking() returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_topic text;
begin
  select decrypted_secret into v_topic
  from vault.decrypted_secrets where name = 'ntfy_topic_owner';
  if v_topic is null then return new; end if;   -- not configured yet: booking still succeeds

  perform net.http_post(
    url  := 'https://ntfy.sh',
    body := jsonb_build_object(
      'topic',   v_topic,
      'title',   'New web booking — needs approval',
      'message', coalesce(new.contact_name, 'Someone')
                 || ' · ' || to_char(new.date, 'Dy Mon FMDD')
                 || ' ' || to_char(make_time(new.start_min / 60, new.start_min % 60, 0), 'FMHH12:MI AM')
                 || ' · ' || new.service_name || ' · $' || new.price::text,
      'click',   'https://admin.bufferbros.org/',
      'tags',    jsonb_build_array('bellhop_bell')
    )
  );
  return new;
end $$;

drop trigger if exists appointments_web_booking_notify on appointments;
create trigger appointments_web_booking_notify
  after insert on appointments
  for each row when (new.source = 'web')
  execute function notify_owner_web_booking();
