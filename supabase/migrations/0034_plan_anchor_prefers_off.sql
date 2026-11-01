-- 0034: plan visits anchor to the start week; workers can mark days they'd rather not work.
--   * plan_projection_busy — a plan with no live visits used to anchor at max(starts_on, today),
--     so an every-2-weeks plan drifted onto whichever week "today" fell in (and after every visit
--     was cancelled it re-anchored to this week: a phantom slot nobody could remove). Now the
--     chain is anchored to starts_on advanced to the preferred weekday, then stepped up to today.
--     Mirrors firstPlanDate in src/lib/plan-projection.ts (shared by generateOccurrences).
--   * employees.prefers_off — weekdays (0=Sun..6=Sat) this worker would rather not work. A soft
--     flag only: it never blocks booking, it shows as a hint on the calendar and when assigning.

alter table employees add column if not exists prefers_off smallint[] not null default '{}';

create or replace function plan_projection_busy(
  p_date date, p_start int, p_end int, p_buffer int, p_exclude_plan uuid default null
) returns boolean
language plpgsql stable
set search_path = public
as $$
declare
  r record;
  v_tz    text := coalesce((select value from settings where key = 'timezone'), 'America/New_York');
  v_today date;
  v_step  int;
  v_anchor date;
begin
  v_today := (now() at time zone v_tz)::date;
  if p_date < v_today then return false; end if;

  for r in
    select p.id, p.cadence, p.interval_days, p.preferred_dow, p.starts_on, la.last_date
    from plans p
    left join lateral (
      select max(a.date) as last_date
      from appointments a
      where a.plan_id = p.id and a.status <> 'cancelled'
    ) la on true
    where p.status = 'active'
      and p.preferred_min is not null
      and (p_exclude_plan is null or p.id <> p_exclude_plan)
      and p.starts_on <= p_date
      and (p.ends_on is null or p_date <= p.ends_on)
      and p_start < p.preferred_min + p.duration_min + p_buffer
      and p_end > p.preferred_min
  loop
    -- any appointment on this exact date (even cancelled) = human handled it
    continue when exists (select 1 from appointments a where a.plan_id = r.id and a.date = p_date);

    v_step := case r.cadence
      when 'weekly' then 7 when 'biweekly' then 14 when 'monthly' then 28
      else coalesce(r.interval_days, 28) end;

    if r.last_date is not null then
      if p_date > r.last_date and (p_date - r.last_date) % v_step = 0 then return true; end if;
    else
      -- anchored to the start week (not today): the phase is set by starts_on
      v_anchor := r.starts_on;
      if r.preferred_dow is not null then
        v_anchor := v_anchor + ((r.preferred_dow - extract(dow from v_anchor)::int + 7) % 7);
      end if;
      if p_date >= v_anchor and (p_date - v_anchor) % v_step = 0 then return true; end if;
    end if;
  end loop;
  return false;
end $$;
