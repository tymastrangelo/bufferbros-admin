-- Live dashboard: publish every app table to Supabase Realtime so open pages refresh
-- themselves (src/components/live-refresh.tsx). Realtime applies each table's RLS
-- per subscriber, so washers only hear about rows they can already select.
-- New tables: add them here too, or their changes won't push to open screens.
alter publication supabase_realtime add table
  appointment_employees, appointment_vehicles, appointments, blocks, company_ledger,
  customers, employees, expenses, ledger_entries, outreach_log, payment_requests,
  plan_pricing, plan_vehicles, plans, recurring_expenses, reminders, service_pricing,
  services, settings, vehicles, weekly_hours;
