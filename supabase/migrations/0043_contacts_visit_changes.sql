-- 0043: more than one person per client, and a paper trail when a visit changes on site.
--   * customer_contacts — a spouse, assistant or property manager who also texts/calls about
--     the same cars. The Mac text sync matches their numbers too, so both threads land on the
--     one client; customer_messages.contact_id says whose thread a text came from
--     (null = the client's own number).
--   * appointments_timeline also logs when the vehicles on a visit change (size_label holds
--     the vehicle labels), so "we only did the Defender today" shows on the job's timeline.

create table if not exists customer_contacts (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  customer_id uuid not null references customers(id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 120),
  relation    text,          -- "wife", "assistant", "property manager"
  phone       text,
  notes       text
);
create index if not exists customer_contacts_customer_idx on customer_contacts (customer_id);

alter table customer_contacts enable row level security;
create policy owners_all on customer_contacts for all to authenticated using ((select is_owner())) with check ((select is_owner()));
-- the crew needs to know who to call at the door
create policy staff_read on customer_contacts for select to authenticated using ((select is_staff()));

alter table customer_messages add column if not exists contact_id uuid references customer_contacts(id) on delete set null;

alter publication supabase_realtime add table customer_contacts;

-- Customer merge carries contacts to the keeper. Patches the 0042 body in place (one added
-- line) instead of repeating all of it; fails loudly if that body ever changes shape.
do $$
declare
  src    text := pg_get_functiondef('merge_customers(uuid,uuid[])'::regprocedure);
  anchor text := 'update customer_notes    set customer_id = p_keep where customer_id = any(v_ids);';
begin
  if position('customer_contacts' in src) > 0 then return; end if;
  if position(anchor in src) = 0 then raise exception 'merge_customers changed shape; add customer_contacts to it by hand'; end if;
  execute replace(src, anchor, anchor || E'\n  update customer_contacts set customer_id = p_keep where customer_id = any(v_ids);');
end $$;

-- Timeline: identical to 0030 plus the vehicles-changed event.
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
  if new.size_label is distinct from old.size_label then
    insert into appointment_events (appointment_id, actor_user_id, kind, detail)
      values (new.id, v_actor, 'vehicles_changed', jsonb_build_object('from', old.size_label, 'to', new.size_label));
  end if;
  return new;
end $$;
