-- Availability engine test — run in the Supabase SQL editor (or psql).
-- Everything happens inside a transaction that ROLLS BACK: safe on live data.
-- Each assert raises an exception on failure; "availability tests passed" at the
-- end means all cases hold: granularity, lead time, buffer, closed days, blocks,
-- and the overlap edge (start < busyEnd && end > busyStart).

begin;

-- Freeze the world: a far-future test date avoids the today/lead-time branch,
-- and we clear that date's rows only inside this rolled-back transaction.
do $$
declare
  d date := '2030-06-05';         -- a Wednesday
  slots int[];
begin
  delete from appointments where date between d - 1 and d + 1;
  delete from blocks where date between d - 1 and d + 1;
  update weekly_hours set enabled = true, open_min = 480, close_min = 1080; -- 8:00–18:00
  update settings set value = '30'  where key = 'slot_granularity_min';
  update settings set value = '180' where key = 'min_lead_min';
  update settings set value = '30'  where key = 'buffer_min';

  -- 1. Empty day, 120-min job: slots 8:00..16:00 every 30 min = 480..960 (17 slots).
  --    Appointment must END by close (960+120=1080 ✓); buffer may run past close.
  select array_agg(slot_min order by slot_min) into slots from get_available_slots(d, 120);
  if slots[1] <> 480 or slots[array_length(slots,1)] <> 960 or array_length(slots,1) <> 17 then
    raise exception 'empty day failed: %', slots;
  end if;

  -- 2. Granularity: no slot off the 30-min grid.
  if exists (select 1 from get_available_slots(d, 120) where slot_min % 30 <> 0) then
    raise exception 'granularity failed';
  end if;

  -- 3. Closed day -> no slots.
  update weekly_hours set enabled = false where weekday = 3; -- Wednesday
  if exists (select 1 from get_available_slots(d, 120)) then
    raise exception 'closed day failed';
  end if;
  update weekly_hours set enabled = true where weekday = 3;

  -- 4. Past date -> no slots.
  if exists (select 1 from get_available_slots('2001-01-01', 120)) then
    raise exception 'past date failed';
  end if;

  -- 5. Booking 10:00–12:00 (600–720) + 30 buffer busy to 750.
  --    total = 120+30 = 150. Overlap: start < 750 && start+150 > 600 -> blocked 480..720.
  --    8:00 slot: 480+150=630 > 600 -> BLOCKED (buffer collision). First open slot: 750 (12:30).
  insert into appointments (date, start_min, duration_min, status) values (d, 600, 120, 'scheduled');
  select array_agg(slot_min order by slot_min) into slots from get_available_slots(d, 120);
  if 480 = any(slots) or 570 = any(slots) or 720 = any(slots) or not (750 = any(slots)) or not (450 >= 0) then
    raise exception 'booking overlap failed: %', slots;
  end if;

  -- 6. Overlap edge: a job ending EXACTLY when busy starts is allowed (end > busyStart is strict).
  --    With busy starting at 600, a 90-min job at 420 runs 420+90+30=540 <= 600 -> would be fine,
  --    but 420 < open. Instead test edge at the end: busy ends 750; slot 750 has start = busyEnd -> allowed.
  --    (Already asserted 750 present above.) Cancelled bookings must NOT block:
  update appointments set status = 'cancelled' where date = d;
  select array_agg(slot_min order by slot_min) into slots from get_available_slots(d, 120);
  if array_length(slots,1) <> 17 then
    raise exception 'cancelled booking still blocks: %', slots;
  end if;
  delete from appointments where date = d;

  -- 7. Block 8:00–12:00 (480–720), no buffer applied to blocks.
  --    total 150: start < 720 && start+150 > 480 -> blocked 480..690; 720 (12:00) is open.
  insert into blocks (date, start_min, end_min, reason) values (d, 480, 720, 'test');
  select array_agg(slot_min order by slot_min) into slots from get_available_slots(d, 120);
  if slots[1] <> 720 then
    raise exception 'block failed: first slot %', slots[1];
  end if;
  delete from blocks where date = d;

  -- 8. Lead time: for TODAY (in settings.timezone), no slot before now + 180 min.
  if exists (
    select 1 from get_available_slots((now() at time zone (select value from settings where key='timezone'))::date, 60)
    where slot_min < extract(hour from now() at time zone (select value from settings where key='timezone'))::int * 60
                   + extract(minute from now() at time zone (select value from settings where key='timezone'))::int
                   + 180
  ) then
    raise exception 'lead time failed';
  end if;

  -- 9. Transactional booking: strict mode takes the slot, an identical second call conflicts.
  perform book_appointment(d, 720, 120, 'Test A', p_mode => 'strict');
  begin
    perform book_appointment(d, 720, 120, 'Test B', p_mode => 'strict');
    raise exception 'double booking was allowed';
  exception when others then
    if sqlerrm not like '%slot_taken%' then raise; end if;
  end;

  raise notice 'availability tests passed';
end $$;

rollback;
