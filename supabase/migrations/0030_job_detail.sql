-- 0030: jobs carry the detail a crew needs.
--   * customers.site_notes — gate code, parking, water/power; shows on every job.
--   * services.checklist — the steps a service includes (seeded from the website copy);
--     appointments.checklist — per-job copy workers tick through.
--   * appointment_events — the timeline, written by triggers so nothing can forget to log.
--   * appointment_photos + private Storage bucket job-photos (signed URLs only).
--   * ledger_entries.tip — pass-through to the worker: not revenue, not in the split
--     base, never in customer_balances (amount stays "what paid the charge").

-- ============ COLUMNS ============
alter table customers add column if not exists site_notes text;
alter table services add column if not exists checklist jsonb not null default '[]'::jsonb;
alter table appointments add column if not exists checklist jsonb not null default '[]'::jsonb;
alter table appointments add column if not exists cancelled_at timestamptz;
alter table ledger_entries add column if not exists tip numeric(10,2) not null default 0;

-- What's included (the website's promise list, verbatim) — editable in Settings.
update services set checklist = '["Full interior vacuum, seats, carpets and mats","Hand wash with a double foam bath","Layer of protective spray wax","Wheels, tires and tire shine","All interior surfaces wiped down","Interior and exterior glass","Door jambs cleaned"]'::jsonb
where id = 'standard' and checklist = '[]'::jsonb;
update services set checklist = '["Wash + decontaminate","Paint correction as quoted","Ceramic coat applied","Cure instructions given"]'::jsonb
where id = 'ceramic-coating' and checklist = '[]'::jsonb;

-- ============ TIMELINE ============
create table if not exists appointment_events (
  id             bigserial primary key,
  appointment_id uuid not null references appointments(id) on delete cascade,
  at             timestamptz not null default now(),
  actor_user_id  uuid,                        -- auth.uid() when a person did it; null = system
  kind           text not null,               -- booked|started|completed|cancelled|no_show|reopened|rescheduled|assigned|price_changed|edited
  detail         jsonb not null default '{}'::jsonb
);
create index if not exists appointment_events_appt_idx on appointment_events (appointment_id, at);
alter table appointment_events enable row level security;
create policy owners_all on appointment_events for all to authenticated using (true) with check (true);

create or replace function appointments_timeline() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into appointment_events (appointment_id, actor_user_id, kind, detail)
      values (new.id, v_actor, 'booked', jsonb_build_object('source', new.source, 'date', new.date, 'start_min', new.start_min));
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into appointment_events (appointment_id, actor_user_id, kind, detail)
      values (new.id, v_actor,
              case when new.status = 'scheduled' then 'reopened' else new.status::text end,
              jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  if new.started_at is not null and old.started_at is null then
    insert into appointment_events (appointment_id, actor_user_id, kind) values (new.id, v_actor, 'started');
  end if;
  if new.date is distinct from old.date or new.start_min is distinct from old.start_min then
    insert into appointment_events (appointment_id, actor_user_id, kind, detail)
      values (new.id, v_actor, 'rescheduled',
              jsonb_build_object('from', jsonb_build_object('date', old.date, 'start_min', old.start_min),
                                 'to',   jsonb_build_object('date', new.date, 'start_min', new.start_min)));
  end if;
  if new.employee_id is distinct from old.employee_id then
    insert into appointment_events (appointment_id, actor_user_id, kind, detail)
      values (new.id, v_actor, 'assigned', jsonb_build_object('from', old.employee_id, 'to', new.employee_id));
  end if;
  if new.price is distinct from old.price then
    insert into appointment_events (appointment_id, actor_user_id, kind, detail)
      values (new.id, v_actor, 'price_changed', jsonb_build_object('from', old.price, 'to', new.price));
  end if;
  return new;
end $$;
create trigger appointments_timeline
  after insert or update on appointments
  for each row execute function appointments_timeline();

-- cancelled_at stamps itself
create or replace function appointments_stamp_cancelled() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status = 'cancelled' and (tg_op = 'INSERT' or old.status is distinct from 'cancelled') then
    new.cancelled_at := now();
  elsif new.status <> 'cancelled' then
    new.cancelled_at := null;
  end if;
  return new;
end $$;
create trigger appointments_stamp_cancelled
  before insert or update of status on appointments
  for each row execute function appointments_stamp_cancelled();

-- ============ PHOTOS ============
create table if not exists appointment_photos (
  id             uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references appointments(id) on delete cascade,
  path           text not null,               -- storage object path: {appointment_id}/{kind}-{uuid}.jpg
  kind           text not null check (kind in ('before','after')),
  taken_by       uuid references employees(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists appointment_photos_appt_idx on appointment_photos (appointment_id, created_at);
alter table appointment_photos enable row level security;
create policy owners_all on appointment_photos for all to authenticated using (true) with check (true);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('job-photos', 'job-photos', false, 10485760, array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do nothing;
create policy "job photos read"   on storage.objects for select to authenticated using (bucket_id = 'job-photos');
create policy "job photos insert" on storage.objects for insert to authenticated with check (bucket_id = 'job-photos');
create policy "job photos delete" on storage.objects for delete to authenticated using (bucket_id = 'job-photos');

alter publication supabase_realtime add table appointment_events, appointment_photos;

-- ============ TIP PASS-THROUGH IN THE CASH SPLIT ============
-- Identical to 0029 plus: a tip on a worker's job writes revenue +tip and payout −tip
-- for that worker (company nets zero). Owner / self-done jobs: the tip is already theirs.
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
    if not coalesce(v_self, false) and v_emp.id is not null and coalesce(new.tip, 0) > 0 then
      insert into company_ledger (occurred_on, kind, amount, memo, ledger_entry_id, collected_by, settled_on)
        values (new.occurred_on, 'revenue', new.tip, 'tip — ' || coalesce(v_name, ''), new.id, new.collected_by, new.settled_on);
      insert into company_ledger (occurred_on, kind, party, amount, memo, ledger_entry_id, collected_by, settled_on, employee_id)
        values (new.occurred_on, 'payout', 'employee', -new.tip, 'tip — ' || coalesce(v_name, ''), new.id, new.collected_by, new.settled_on, v_emp.id);
    end if;
    if v_ceo <> 0 then
      insert into company_ledger (occurred_on, kind, party, amount, memo, ledger_entry_id, collected_by, settled_on)
        values (new.occurred_on, 'payout', 'ceo', round(-v_net * v_ceo / 100, 2), v_name, new.id, new.collected_by, new.settled_on);
    end if;
  end if;
  return new;
end $function$;
