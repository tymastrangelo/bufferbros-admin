# Buffer Bros Admin — admin.bufferbros.org

The operating system for Buffer Bros Mobile Detailing (Marco Island & Naples, FL): schedule,
CRM, recurring plans, and money — built for two owners running the day from their phones.

**Stack:** Next.js 16 (App Router, TypeScript) · Tailwind v4 · Supabase (Postgres, Auth, RLS)
· Resend · Vercel (weekly cron). Full build spec in [`ADMIN_DASHBOARD_SPEC.md`](ADMIN_DASHBOARD_SPEC.md);
setup + deploy + data migration in [`SETUP.md`](SETUP.md).

## What's where

| Area | Path |
|---|---|
| Schema, RLS, availability + booking RPCs, seed | `supabase/migrations/0001_init.sql` |
| Availability engine tests (run in SQL editor) | `scripts/test-availability.sql` |
| D1 → Supabase one-time migration | `scripts/migrate-d1.mjs` |
| Auth guard (Next 16 proxy) | `src/proxy.ts` |
| Time/date rules (America/New_York, UTC-noon math) | `src/lib/time.ts` |
| Money/phone formatting | `src/lib/format.ts` |
| Resend templates (confirmed / updated / cancelled) | `src/lib/email.ts` |
| Server actions (all writes) | `src/lib/actions/*` |
| Recurring visit generation (action + cron share it) | `src/lib/occurrences.ts` |
| Weekly cron route | `src/app/api/cron/generate-occurrences/route.ts` |
| CSV export (payments/charges/expenses) | `src/app/api/export/route.ts` |
| Screens | `src/app/(app)/{page,calendar,customers,plans,money,settings}` |

## Key data rules

- **Dates** are `date` + minutes-from-midnight ints in America/New_York wall-clock. Never raw
  `Date` math on date strings — `lib/time.ts` owns it all (UTC-noon trick for weekday math).
- **Money is a ledger.** Appointments create charges on completion; payments are independent
  events; a customer's balance = `sum(ledger_entries.amount)` (>0 credit, <0 owed). Never 1:1
  payment↔appointment. Charges/refunds negative; payments/credits/discounts positive.
- **Booking goes through the `book_appointment` RPC** (advisory-lock transactional) so two
  writers can't double-book: `strict` (public grid slots), `overlap` (dashboard/recurring),
  `force` (explicit "book anyway").
- Plans generate visits 8 weeks ahead (button + Monday cron); conflicts are flagged for manual
  placement, never silently moved.

## Dev

### Local demo (already wired up)

`.env.local` points at a local Supabase stack seeded with a year of demo data
(`supabase/seed.sql` — plans, a prepaid customer, owed balances, expenses):

```bash
npx supabase start    # needs Docker; local API on 127.0.0.1:54321, Studio on :54323
npm run dev           # sign in: mastrangelo.tyler@gmail.com / bufferbros (or gabe@bufferbros.org)
```

`npx supabase db reset` rebuilds schema + demo data from scratch (auth users need
re-creating after a reset — see SETUP.md). `npx supabase stop` shuts the stack down.

Heads-up on this machine: the shell exports `NODE_ENV=production`, which makes plain
`npm install` skip devDependencies — use `NODE_ENV=development npm install --include=dev`.

### Real backend

Replace the three Supabase values in `.env.local` with the real project's (SETUP.md walks
through it), add Resend keys, and everything else is identical. `npm run build` must stay
clean. There is no signup — create the two owner users in the Supabase dashboard.

## Deviations from spec (deliberate, small)

- "Remember me" checkbox omitted: sessions are always persistent (what two owners on their own
  phones actually want); the login page says so instead of showing a dead toggle.
- Monthly plan cadence = every 28 days (keeps the preferred weekday); calendar-month stepping
  can be added if a customer ever needs it.
- App icons: `src/app/icon.svg` is a placeholder monogram — export real PNGs from the Buffer
  Bros logo into `public/icons/` and list them in `src/app/manifest.ts` for the home-screen icon.
- Pausing/ending a plan cancels **all** of its future generated visits (can't tell hand-tweaked
  ones apart); re-book the rare exception by hand.
