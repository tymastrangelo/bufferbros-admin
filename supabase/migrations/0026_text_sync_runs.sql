-- One row per client-texts run (scripts/client-texts/run.mjs on Tyler's Mac): the nightly job,
-- the dashboard's "Sync texts now" button, or a manual run. The button inserts a pending row;
-- the listener on the Mac (Realtime) picks it up within seconds and reports back here, so the
-- dashboard can show "Syncing…" / "Last synced 9:41 PM · 3 new texts".
create table if not exists text_sync_runs (
  id uuid primary key default gen_random_uuid(),
  requested_at timestamptz not null default now(),
  source text not null default 'button' check (source in ('button', 'nightly', 'manual')),
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'error')),
  started_at timestamptz,
  finished_at timestamptz,
  texts_synced int,
  cards_updated int,
  error text
);
create index if not exists text_sync_runs_recent on text_sync_runs (requested_at desc);

alter table text_sync_runs enable row level security;
create policy owners_only on text_sync_runs for all to authenticated
  using    (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'washer') = 'owner')
  with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'washer') = 'owner');
alter publication supabase_realtime add table text_sync_runs;
