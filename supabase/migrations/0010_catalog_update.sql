-- 0010: July 2026 catalog update.
-- New Clay Bar + Hand Wax add-on (priced per vehicle size) and refreshed
-- add-on prices/notes. Add-on pricing already supports per-size rows
-- (service_pricing is keyed by service_id + size_id) — this is the first
-- add-on to use them.

insert into services (id, kind, name, note, sort) values
  ('clay-bar','addon','Clay Bar + Hand Wax','Removes bonded contaminants, sealed with a hand wax',0)
on conflict (id) do update set name = excluded.name, note = excluded.note, sort = excluded.sort;

insert into service_pricing (service_id, size_id, price, minutes) values
  ('clay-bar','sedan',100,60), ('clay-bar','midsize',125,75), ('clay-bar','large',150,90)
on conflict (service_id, size_id) do update set price = excluded.price, minutes = excluded.minutes;

insert into service_pricing (service_id, size_id, price, minutes) values
  ('pet-hair','*',50,30), ('engine-bay','*',45,30), ('headlights','*',100,45), ('odor','*',65,45)
on conflict (service_id, size_id) do update set price = excluded.price, minutes = excluded.minutes;

-- Retired add-on. Past appointments keep their jsonb snapshot of it.
delete from services where id = 'ceramic';

update services set note = 'Heavy shedding cases may be quoted up' where id = 'pet-hair';
update services set note = 'Degreased and dressed'                 where id = 'engine-bay';
update services set note = 'Per pair — clears yellowed, foggy lenses' where id = 'headlights';
update services set note = 'Heavy smoke may be quoted up'          where id = 'odor';
