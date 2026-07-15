-- Demo/mock data — a believable year of Buffer Bros business, all dates relative
-- to et_today() so it never goes stale. Run ONCE on a fresh database (local:
-- `npx supabase db reset` applies it automatically; real project: paste after the
-- migration, or skip entirely for a clean start).
--
-- The story it seeds:
--   · Joan Delgado    — weekly plan, PREPAID $2,000 (credit drawing down each visit)
--   · Rick Alvarez    — biweekly plan, pays monthly (currently owes a couple visits)
--   · Mark Sussman    — monthly plan, pays per visit
--   · Gene Whitfield  — paused weekly plan
--   · Tammy Nguyen    — completed yesterday, hasn't paid yet (owes $269)
--   · Pete Ramos      — tomorrow's WEB booking, not linked to a customer yet
--   · ~80 one-time jobs across 12 months (paid) → the Money chart has real shape
--   · blocks (boat day, vacation) and a year of expenses
-- Dates use et_today() (defined in the migration): "today" in Florida wall-clock.

-- ============ CUSTOMERS ============
insert into customers (id, name, phone, email, addresses, tags, notes, source) values
  ('c0000000-0000-4000-8000-000000000001','Joan Delgado','+12395550142','joan.delgado@gmail.com',
   '[{"label":"Home","address":"871 W Copeland Dr, Marco Island, FL 34145"}]','{vip,weekly,prepaid}',
   'Gate code 4471. Likes the wheels extra shiny.','manual'),
  ('c0000000-0000-4000-8000-000000000002','Rick Alvarez','+12395550178','ralvarez78@yahoo.com',
   '[{"label":"Home","address":"1420 Galleon Ave, Marco Island, FL 34145"}]','{biweekly}',
   'Pays monthly on the 1st. Truck lives outside — heavy love bugs in season.','manual'),
  ('c0000000-0000-4000-8000-000000000003','Mark Sussman','+12395550119','mark.sussman@outlook.com',
   '[{"label":"Office","address":"4980 Tamiami Trl E, Naples, FL 34113"}]','{monthly}',
   null,'manual'),
  ('c0000000-0000-4000-8000-000000000004','Tammy Nguyen','+12395550163','tammy.n@gmail.com',
   '[{"label":"Home","address":"219 Seminole Ct, Marco Island, FL 34145"}]','{}',
   'Two car seats — deep vacuum takes a while.','website'),
  ('c0000000-0000-4000-8000-000000000005','Bill Hartman','+12395550137','bhartman@comcast.net',
   '[{"label":"Home","address":"6081 Lancewood Way, Naples, FL 34116"}]','{}',null,'manual'),
  ('c0000000-0000-4000-8000-000000000006','Carol Pruitt','+12395550191','carol.pruitt@aol.com',
   '[{"label":"Condo","address":"693 Seaview Ct, Marco Island, FL 34145"}]','{}',
   'Condo garage — bring the long hose.','website'),
  ('c0000000-0000-4000-8000-000000000007','Dave Okafor','+12395550154','dokafor@gmail.com',
   '[{"label":"Home","address":"2865 44th Ter SW, Naples, FL 34116"}]','{}',
   'Gate code #4415, two golden retrievers.','manual'),
  ('c0000000-0000-4000-8000-000000000008','Lisa Trent','+12395550126','lisa.trent@gmail.com',
   '[{"label":"Home","address":"1180 Edington Pl, Marco Island, FL 34145"}]','{}',null,'website'),
  ('c0000000-0000-4000-8000-000000000009','Gene Whitfield','+12395550183','gwhitfield@icloud.com',
   '[{"label":"Home","address":"5117 Coral Wood Dr, Naples, FL 34119"}]','{}',
   'Snowbird — north for the summer, resume plan in November.','manual'),
  ('c0000000-0000-4000-8000-000000000010','Sandra Mills','+12395550109','sandra.mills@gmail.com',
   '[{"label":"Home","address":"468 Renard Ct, Marco Island, FL 34145"}]','{}',null,'manual');

-- ============ VEHICLES ============
insert into vehicles (customer_id, size_id, make, model, year, color) values
  ('c0000000-0000-4000-8000-000000000001','sedan','BMW','330i',2022,'Alpine White'),
  ('c0000000-0000-4000-8000-000000000002','large','Ford','F-150',2021,'Blue'),
  ('c0000000-0000-4000-8000-000000000003','midsize','Lexus','RX 350',2023,'Silver'),
  ('c0000000-0000-4000-8000-000000000004','large','Honda','Pilot',2020,'Gray'),
  ('c0000000-0000-4000-8000-000000000005','sedan','Toyota','Camry',2019,'Red'),
  ('c0000000-0000-4000-8000-000000000006','sedan','Buick','Encore',2021,'Champagne'),
  ('c0000000-0000-4000-8000-000000000007','large','Chevy','Tahoe',2022,'Black'),
  ('c0000000-0000-4000-8000-000000000008','midsize','Subaru','Outback',2021,'Green'),
  ('c0000000-0000-4000-8000-000000000009','midsize','Acura','MDX',2018,'White'),
  ('c0000000-0000-4000-8000-000000000010','midsize','Jeep','Grand Cherokee',2023,'Granite'),
  ('c0000000-0000-4000-8000-000000000010','sedan','Mazda','MX-5',2017,'Soul Red');

-- ============ PLANS ============
insert into plans (id, customer_id, cadence, per_visit_price, preferred_dow, preferred_min,
                   duration_min, address, status, starts_on, billing_note) values
  ('a0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001','weekly',139,
   extract(dow from et_today())::int, 510, 120,
   '871 W Copeland Dr, Marco Island, FL 34145','active', et_today() - 364,
   'Prepaid $2,000 up front — draws down per visit'),
  ('a0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000002','biweekly',199,
   extract(dow from et_today() + 4)::int, 540, 180,
   '1420 Galleon Ave, Marco Island, FL 34145','active', et_today() - 186,
   'Pays monthly on the 1st'),
  ('a0000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000003','monthly',199,
   extract(dow from et_today() + 15)::int, 600, 150,
   '4980 Tamiami Trl E, Naples, FL 34113','active', et_today() - 336, null),
  ('a0000000-0000-4000-8000-000000000009','c0000000-0000-4000-8000-000000000009','weekly',159,
   2, 540, 150, '5117 Coral Wood Dr, Naples, FL 34119','paused', et_today() - 300,
   'Snowbird — paused for the summer');

-- ============ JOAN: 52 weekly visits (this morning''s already done), prepaid credit ============
insert into appointments (customer_id, plan_id, source, status, date, start_min, duration_min,
                          size_id, size_label, price, address, completed_at)
select 'c0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','recurring','completed',
       et_today() - i*7, 510, 120, 'sedan','Car / Sedan / Coupe', 139,
       '871 W Copeland Dr, Marco Island, FL 34145',
       (et_today() - i*7)::timestamp + interval '10 hours 30 minutes'
from generate_series(0, 51) i;

insert into ledger_entries (customer_id, plan_id, kind, amount, occurred_on, memo)
select 'c0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','charge',-139,
       et_today() - i*7, 'The Standard Detail'
from generate_series(0, 51) i;
-- paid per visit until the prepay 60 days ago…
insert into ledger_entries (customer_id, plan_id, kind, amount, method, occurred_on, memo)
select 'c0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','payment',139,'zelle',
       et_today() - i*7, null
from generate_series(0, 51) i
where et_today() - i*7 < et_today() - 60;
-- …then $2,000 up front
insert into ledger_entries (customer_id, plan_id, kind, amount, method, occurred_on, memo) values
  ('c0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','credit',2000,'check',
   et_today() - 60, 'Prepaid through the end of the year');

-- next visit already on the books
insert into appointments (customer_id, plan_id, source, status, date, start_min, duration_min,
                          size_id, size_label, price, address)
values ('c0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','recurring','scheduled',
        et_today() + 7, 510, 120, 'sedan','Car / Sedan / Coupe', 139,
        '871 W Copeland Dr, Marco Island, FL 34145');

-- ============ RICK: biweekly, pays monthly (currently behind ~2 visits) ============
insert into appointments (customer_id, plan_id, source, status, date, start_min, duration_min,
                          size_id, size_label, price, address, completed_at)
select 'c0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000002','recurring','completed',
       et_today() - 3 - i*14, 540, 180, 'large','Large SUV / Truck', 199,
       '1420 Galleon Ave, Marco Island, FL 34145',
       (et_today() - 3 - i*14)::timestamp + interval '12 hours'
from generate_series(0, 12) i;

insert into ledger_entries (customer_id, plan_id, kind, amount, occurred_on, memo)
select 'c0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000002','charge',-199,
       et_today() - 3 - i*14, 'The Standard Detail'
from generate_series(0, 12) i;
-- monthly catch-up payments cover everything older than 30 days
insert into ledger_entries (customer_id, plan_id, kind, amount, method, occurred_on, memo)
select 'c0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000002','payment',199,'venmo',
       et_today() - 3 - i*14 + 6, 'Monthly settle-up'
from generate_series(0, 12) i
where et_today() - 3 - i*14 < et_today() - 30;

insert into appointments (customer_id, plan_id, source, status, date, start_min, duration_min,
                          size_id, size_label, price, address)
values ('c0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000002','recurring','scheduled',
        et_today() + 11, 540, 180, 'large','Large SUV / Truck', 199,
        '1420 Galleon Ave, Marco Island, FL 34145');

-- ============ MARK: monthly, pays every visit ============
insert into appointments (customer_id, plan_id, source, status, date, start_min, duration_min,
                          size_id, size_label, price, address, completed_at)
select 'c0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000003','recurring','completed',
       et_today() - 13 - i*28, 600, 150, 'midsize','Midsize SUV / Truck', 199,
       '4980 Tamiami Trl E, Naples, FL 34113',
       (et_today() - 13 - i*28)::timestamp + interval '12 hours 30 minutes'
from generate_series(0, 11) i;

insert into ledger_entries (customer_id, plan_id, kind, amount, occurred_on, memo)
select 'c0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000003','charge',-199,
       et_today() - 13 - i*28, 'The Standard Detail'
from generate_series(0, 11) i;
insert into ledger_entries (customer_id, plan_id, kind, amount, method, occurred_on)
select 'c0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000003','payment',199,'card',
       et_today() - 13 - i*28
from generate_series(0, 11) i;

insert into appointments (customer_id, plan_id, source, status, date, start_min, duration_min,
                          size_id, size_label, price, address)
values ('c0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000003','recurring','scheduled',
        et_today() + 15, 600, 150, 'midsize','Midsize SUV / Truck', 199,
        '4980 Tamiami Trl E, Naples, FL 34113');

-- ============ GENE: paused plan, history ended ~3 months ago ============
insert into appointments (customer_id, plan_id, source, status, date, start_min, duration_min,
                          size_id, size_label, price, address, completed_at)
select 'c0000000-0000-4000-8000-000000000009','a0000000-0000-4000-8000-000000000009','recurring','completed',
       et_today() - 90 - i*7, 540, 150, 'midsize','Midsize SUV / Truck', 159,
       '5117 Coral Wood Dr, Naples, FL 34119',
       (et_today() - 90 - i*7)::timestamp + interval '11 hours 30 minutes'
from generate_series(0, 5) i;
insert into ledger_entries (customer_id, plan_id, kind, amount, occurred_on, memo)
select 'c0000000-0000-4000-8000-000000000009','a0000000-0000-4000-8000-000000000009','charge',-159,
       et_today() - 90 - i*7, 'The Standard Detail'
from generate_series(0, 5) i;
insert into ledger_entries (customer_id, plan_id, kind, amount, method, occurred_on)
select 'c0000000-0000-4000-8000-000000000009','a0000000-0000-4000-8000-000000000009','payment',159,'cash',
       et_today() - 90 - i*7
from generate_series(0, 5) i;

-- ============ ONE-TIME HISTORY: ~80 paid jobs across 12 months (chart shape) ============
with hist as (
  select i,
         et_today() - 2 - (i * 9 / 2) as d,   -- every ~4.5 days back a year
         (array['c0000000-0000-4000-8000-000000000004','c0000000-0000-4000-8000-000000000005',
                'c0000000-0000-4000-8000-000000000006','c0000000-0000-4000-8000-000000000010'])[(i % 4) + 1]::uuid as cid,
         (array['sedan','midsize','large'])[(i % 3) + 1] as size_id,
         (array['Car / Sedan / Coupe','Midsize SUV / Truck','Large SUV / Truck'])[(i % 3) + 1] as size_label,
         (array[229,249,269])[(i % 3) + 1] as price,
         (array[120,150,180])[(i % 3) + 1] as mins,
         (array['zelle','venmo','cash','check','card'])[(i % 5) + 1]::payment_method as method,
         480 + ((i % 4) * 90) as start_min
  from generate_series(0, 79) i
)
, appts as (
  insert into appointments (customer_id, source, status, date, start_min, duration_min,
                            size_id, size_label, price, completed_at)
  select cid, 'manual', 'completed', d, start_min, mins, size_id, size_label, price,
         d::timestamp + interval '14 hours'
  from hist
  returning id, customer_id, date, price
)
insert into ledger_entries (customer_id, appointment_id, kind, amount, occurred_on, memo)
select customer_id, id, 'charge', -price, date, 'The Standard Detail' from appts;

insert into ledger_entries (customer_id, kind, amount, method, occurred_on)
select cid, 'payment', price, method, d
from (
  select et_today() - 2 - (i * 9 / 2) as d,
         (array['c0000000-0000-4000-8000-000000000004','c0000000-0000-4000-8000-000000000005',
                'c0000000-0000-4000-8000-000000000006','c0000000-0000-4000-8000-000000000010'])[(i % 4) + 1]::uuid as cid,
         (array[229,249,269])[(i % 3) + 1] as price,
         (array['zelle','venmo','cash','check','card'])[(i % 5) + 1]::payment_method as method
  from generate_series(0, 79) i
) h;

-- ============ TAMMY: completed yesterday, unpaid (shows up under "owed") ============
insert into appointments (id, customer_id, source, status, date, start_min, duration_min,
                          size_id, size_label, addons, price, address, notes, completed_at)
values ('b0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000004','web','completed',
        et_today() - 1, 570, 210, 'large','Large SUV / Truck',
        '[{"id":"pet-hair","name":"Pet Hair Removal","price":40}]', 309,
        '219 Seminole Ct, Marco Island, FL 34145','Will Zelle tonight',
        (et_today() - 1)::timestamp + interval '13 hours');
insert into ledger_entries (customer_id, appointment_id, kind, amount, occurred_on, memo)
values ('c0000000-0000-4000-8000-000000000004','b0000000-0000-4000-8000-000000000001','charge',-309,
        et_today() - 1, 'The Standard Detail + Pet Hair Removal');

-- ============ TODAY''S REMAINING JOBS ============
insert into appointments (customer_id, source, status, date, start_min, duration_min,
                          size_id, size_label, addons, price, address, notes) values
  ('c0000000-0000-4000-8000-000000000010','manual','scheduled', et_today(), 690, 180,
   'midsize','Midsize SUV / Truck',
   '[{"id":"pet-hair","name":"Pet Hair Removal","price":40}]', 289,
   '468 Renard Ct, Marco Island, FL 34145', null),
  ('c0000000-0000-4000-8000-000000000007','manual','scheduled', et_today(), 900, 180,
   'large','Large SUV / Truck', '[]', 269,
   '2865 44th Ter SW, Naples, FL 34116', 'Gate code #4415, two golden retrievers');

-- ============ PETE: tomorrow''s web booking, NOT linked yet ============
insert into appointments (source, status, date, start_min, duration_min, size_id, size_label,
                          addons, price, address, contact_name, contact_phone, contact_email, notes)
values ('web','scheduled', et_today() + 1, 600, 195, 'midsize','Midsize SUV / Truck',
        '[{"id":"ceramic","name":"Ceramic Spray Coating","price":60}]', 309,
        '331 Bald Eagle Dr, Marco Island, FL 34145','Pete Ramos','+12395550172','pete.ramos@gmail.com',
        'Booked from the website — first-time customer');

-- ============ LISA: an old migrated web booking (legacy_id) ============
insert into appointments (legacy_id, customer_id, source, status, date, start_min, duration_min,
                          size_id, size_label, price, address, contact_name, contact_phone,
                          contact_email, completed_at)
values (42,'c0000000-0000-4000-8000-000000000008','web','completed', et_today() - 45, 630, 150,
        'midsize','Midsize SUV / Truck', 249, '1180 Edington Pl, Marco Island, FL 34145',
        'Lisa Trent','+12395550126','lisa.trent@gmail.com',
        (et_today() - 45)::timestamp + interval '13 hours');
insert into ledger_entries (customer_id, kind, amount, occurred_on, memo) values
  ('c0000000-0000-4000-8000-000000000008','charge',-249, et_today() - 45, 'The Standard Detail');
insert into ledger_entries (customer_id, kind, amount, method, occurred_on) values
  ('c0000000-0000-4000-8000-000000000008','payment',249,'zelle', et_today() - 45);

-- ============ BLOCKS ============
insert into blocks (date, start_min, end_min, reason) values
  (et_today() + ((5 - extract(dow from et_today())::int + 7) % 7 + 7), 720, 1080, 'Boat day'),
  (et_today() + 21, 0, 1440, 'Vacation'),
  (et_today() + 22, 0, 1440, 'Vacation');

-- ============ EXPENSES: a year of light bookkeeping ============
insert into expenses (occurred_on, category, amount, memo)
select et_today() - 6 - i*30, 'supplies', 85 + (i % 4) * 15,
       (array['Chemical Guys order','Towels + interior brushes','Foam cannon soap restock','Tire shine + APC'])[(i % 4) + 1]
from generate_series(0, 11) i;
insert into expenses (occurred_on, category, amount, memo)
select et_today() - 16 - i*30, 'fuel', 62 + (i % 3) * 14, 'Truck fill-ups'
from generate_series(0, 11) i;
insert into expenses (occurred_on, category, amount, memo) values
  (et_today() - 100, 'equipment', 449, 'New dual-action polisher'),
  (et_today() - 40,  'equipment', 189, 'Replacement pressure washer hose reel'),
  (et_today() - 9,   'marketing', 120, 'Instagram boosted posts'),
  (et_today() - 70,  'insurance', 210, 'Quarterly liability premium'),
  (et_today() - 160, 'insurance', 210, 'Quarterly liability premium'),
  (et_today() - 250, 'insurance', 210, 'Quarterly liability premium'),
  (et_today() - 340, 'insurance', 210, 'Quarterly liability premium');
