-- 0029: a real crew.
--   * employees.hours (per-weekday working hours), takes_web_bookings (replaces the
--     settings.web_slot_employee_ids CSV), phone, color (calendar lane / avatar ring).
--   * plans.employee_id — who does a plan's visits; recurring generation assigns them.
--   * ledger_entries.employee_id — explicit payee for payments with no appointment.
--   * Payee rule (Tyler, 2026-10-26): appointments.employee_id → ledger_entries.employee_id
--     → the plan's worker → NOBODY. settings.default_employee_id is no longer read:
--     unattributed payments no longer silently pay the first worker.
--   * emp_window_busy honors a worker's hours; get_available_slots' website path reads
--     the takes_web_bookings flags; crew_day_status(p_date) powers "who's free".

-- ============ EMPLOYEES ============
alter table employees
  add column if not exists hours jsonb,                               -- {"0":null,"1":[480,1080],"2":false,...}; null day = business hours, false = off
  add column if not exists takes_web_bookings boolean not null default false,
  add column if not exists phone text,
  add column if not exists color smallint not null default 1;
alter table employees add constraint employees_color_check check (color between 1 and 6);

-- Backfill the website toggle from the old CSV setting, then colors by seniority.
update employees e set takes_web_bookings = true
where e.id::text = any (string_to_array(coalesce((select value from settings where key = 'web_slot_employee_ids'), ''), ','));

with ranked as (select id, row_number() over (order by created_at) as n from employees)
update employees e set color = least(ranked.n, 6)::smallint from ranked where ranked.id = e.id;

-- ============ PLANS + LEDGER ============
alter table plans add column if not exists employee_id uuid references employees(id) on delete set null;
alter table ledger_entries add column if not exists employee_id uuid references employees(id) on delete set null;

-- settings.default_employee_id / web_slot_employee_ids are no longer read by anything;
-- the rows are left in place (deleting them is a separate, manual cleanup).

-- ============ BUSY CHECK (0016 + the worker's own hours) ============
-- Is `p_emp` busy anywhere in [p_start, p_end) on p_date? p_emp null = the owner.
-- p_end includes the booking buffer; hours are compared without it (a job may end at close).
-- ponytail: unassigned scheduled jobs still block every worker (one truck on the road);
-- revisit when two crews run at once.
create or replace function emp_window_busy(p_date date, p_start int, p_end int, p_emp uuid, p_buffer int)
returns boolean
language sql stable
set search_path = public
as $$
  select
    (p_emp is not null and coalesce((
      select case
        when h is null or jsonb_typeof(h) = 'null' then false                    -- business hours (checked by the caller)
        when h = 'false'::jsonb then true                                          -- day off
        when jsonb_typeof(h) = 'array' then p_start < (h ->> 0)::int or (p_end - p_buffer) > (h ->> 1)::int
        else false end
      from (select hours -> extract(dow from p_date)::int::text as h from employees where id = p_emp) x
    ), false))
    or exists (
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

-- ============ AVAILABILITY (0017 + takes_web_bookings) ============
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

  -- Public/no-target path: the workers flagged to take web jobs; none flagged = whole business.
  if v_ids is null then
    select array_agg(id) into v_ids from employees where active and takes_web_bookings;
    v_all := false;    -- website: a slot works if ANY flagged worker can take it
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
    and not plan_projection_busy(p_date, s, s + v_total, v_buffer)
    and (
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
      or (v_ids is not null and v_all
          and not exists (select 1 from unnest(v_ids) e where emp_window_busy(p_date, s, s + v_total, e, v_buffer)))
      or (v_ids is not null and not v_all
          and exists (select 1 from unnest(v_ids) e where not emp_window_busy(p_date, s, s + v_total, e, v_buffer)))
    )
  order by s;
end $$;

-- ============ WHO'S FREE TODAY ============
-- One row per active worker for a date: free | off | busy (+ when they free up).
create or replace function crew_day_status(p_date date)
returns table (employee_id uuid, status text, free_from_min int)
language plpgsql stable
set search_path = public
as $$
declare
  v_tz      text;
  v_local   timestamp;
  v_now     int := 0;
  v_enabled boolean;
  v_buffer  int;
  e         record;
  h         jsonb;
  v_until   int;
begin
  select coalesce((select value from settings where key='timezone'), 'America/New_York') into v_tz;
  select coalesce((select value::int from settings where key='buffer_min'), 30) into v_buffer;
  v_local := now() at time zone v_tz;
  if p_date = v_local::date then
    v_now := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;
  end if;
  select enabled into v_enabled from weekly_hours where weekday = extract(dow from p_date)::int;

  for e in select id, hours from employees where active order by created_at loop
    employee_id := e.id;
    h := e.hours -> extract(dow from p_date)::int::text;
    if (h is not null and h = 'false'::jsonb)
       or ((h is null or jsonb_typeof(h) = 'null') and not coalesce(v_enabled, false))
       or exists (select 1 from blocks b where b.date = p_date and (b.employee_id is null or b.employee_id = e.id)
                  and b.start_min = 0 and b.end_min = 1440) then
      status := 'off'; free_from_min := null; return next; continue;
    end if;
    -- same busy set as emp_window_busy, looking from now forward
    select max(w.be) into v_until from (
      select b.end_min as be from blocks b
        where b.date = p_date and (b.employee_id is null or b.employee_id = e.id)
      union all
      select a.start_min + a.duration_min + v_buffer from appointments a
        where a.date = p_date and a.status = 'scheduled'
          and (not exists (select 1 from appointment_employees ae where ae.appointment_id = a.id)
               or exists (select 1 from appointment_employees ae where ae.appointment_id = a.id and ae.employee_id = e.id))
    ) w where w.be > v_now;
    if v_until is null then status := 'free'; free_from_min := null;
    else status := 'busy'; free_from_min := v_until; end if;
    return next;
  end loop;
end $$;
grant execute on function crew_day_status(date) to authenticated;

-- ============ CASH SPLIT: payee = job's worker → payment's worker → plan's worker → nobody ============
create or replace function public.mirror_cash_split()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_ceo  numeric := coalesce((select value::numeric from settings where key = 'split_ceo_pct'), 10);
  v_name text;
  v_net  numeric;
  v_self boolean := false;
  v_emp  employees%rowtype;
  v_emp_id uuid;
  v_plan uuid;
begin
  if tg_op = 'UPDATE' and current_setting('bb.skip_mirror', true) = 'on' then
    return new;
  end if;
  if tg_op in ('UPDATE','DELETE') then
    delete from company_ledger where ledger_entry_id = old.id;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.kind in ('payment','credit','refund') then
    select name into v_name from customers where id = new.customer_id;
    if new.appointment_id is not null then
      select a.self_done, a.employee_id, a.plan_id into v_self, v_emp_id, v_plan from appointments a where a.id = new.appointment_id;
    end if;
    if v_emp_id is null then v_emp_id := new.employee_id; end if;
    if v_emp_id is null then
      v_plan := coalesce(new.plan_id, v_plan);
      if v_plan is not null then
        select p.employee_id into v_emp_id from plans p where p.id = v_plan;
      end if;
    end if;
    if v_emp_id is not null then
      select * into v_emp from employees where id = v_emp_id;
    end if;

    v_net := new.amount - coalesce(new.processor_fee, 0);
    insert into company_ledger (occurred_on, kind, amount, memo, ledger_entry_id, collected_by, settled_on)
      values (new.occurred_on, 'revenue', new.amount, v_name, new.id, new.collected_by, new.settled_on);
    if coalesce(new.processor_fee, 0) <> 0 then
      insert into company_ledger (occurred_on, kind, amount, memo, ledger_entry_id)
        values (new.occurred_on, 'expense', -new.processor_fee, 'Stripe fee — ' || coalesce(v_name, ''), new.id);
    end if;
    if not coalesce(v_self, false) and v_emp.id is not null and coalesce(v_emp.split_pct, 0) <> 0 then
      insert into company_ledger (occurred_on, kind, party, amount, memo, ledger_entry_id, collected_by, settled_on, employee_id)
        values (new.occurred_on, 'payout', 'employee', round(-v_net * v_emp.split_pct / 100, 2), v_name, new.id, new.collected_by, new.settled_on, v_emp.id);
    end if;
    if v_ceo <> 0 then
      insert into company_ledger (occurred_on, kind, party, amount, memo, ledger_entry_id, collected_by, settled_on)
        values (new.occurred_on, 'payout', 'ceo', round(-v_net * v_ceo / 100, 2), v_name, new.id, new.collected_by, new.settled_on);
    end if;
  end if;
  return new;
end $function$;
