-- 0018: boat pricing grows from 3 additive components into a per-foot service menu
-- (modeled on SWFL market pricing — Polish Pros' public sheet), plus the scaling
-- knobs a flat per-foot rate lacks:
--   * service_pricing rows (size_id = component key): maintenance wash, deluxe wash,
--     spray wax, interior cabin, hull/oxidation removal, polymer sealant, ceramic.
--     Jobs pick which services apply; wash+wax is the default "deluxe exterior".
--   * settings: size tiers (bigger hulls cost more per foot), condition levels
--     (maintained / average / neglected), and an in-water/dock surcharge.
--   * maintenance-ft is the boat maintenance-plan rate (recurring dockside washes).
insert into service_pricing (service_id, size_id, price, minutes) values
  ('boat-detail', 'maintenance-ft',   6, 3),   -- recurring maintenance wash (plan rate)
  ('boat-detail', 'oxidation-ft',    20, 6),   -- hull cleaning / oxidation removal
  ('boat-detail', 'sealant-ft',      25, 4),   -- wax / polymer sealant
  ('boat-detail', 'ceramic-ft',     100, 8)    -- marine ceramic coating
on conflict (service_id, size_id) do nothing;

insert into settings (key, value) values
  ('boat_tier2_from_ft', '30'),   -- 30 ft and up: per-foot rates × tier2 %
  ('boat_tier2_pct',     '125'),
  ('boat_tier3_from_ft', '45'),   -- 45 ft and up: per-foot rates × tier3 %
  ('boat_tier3_pct',     '175'),
  ('boat_level2_pct',    '120'),  -- condition: average
  ('boat_level3_pct',    '150'),  -- condition: neglected / oxidized
  ('boat_dock_pct',      '15')    -- boat sits in the water instead of on a trailer
on conflict (key) do nothing;

update services
  set note = 'Per-foot service menu — pick services per job; rates scale with hull size, condition, and dock vs trailer.'
  where id = 'boat-detail';
