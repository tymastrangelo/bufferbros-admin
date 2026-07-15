# Buffer Bros Admin — one-shot setup

Everything the owner needs to go from zero to live at `admin.bufferbros.org`.

## 1. Supabase project

1. Create a project (US East) at supabase.com — or ask Claude to create it via the connected
   Supabase account (~$10/mo on the current org plan).
2. Open **SQL Editor**, paste the whole of [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql), run it once.
   That creates the schema, RLS, the availability + booking RPCs, and seeds pricing/hours/settings.
3. **Auth → Providers → Email**: leave email/password on. **Auth → Settings**: *disable* "Allow new users to sign up."
4. **Auth → Users → Add user**: create the two owner accounts (Tyler: mastrangelo.tyler@gmail.com, plus Gabe's email), "Auto confirm" on.
5. Verify the engine: paste [`scripts/test-availability.sql`](scripts/test-availability.sql) into the SQL editor and run — expect the notice `availability tests passed` (it rolls back, safe on live data).

## 2. Environment

Copy `.env.example` → `.env.local` and fill in:

- `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Project Settings → API
- `SUPABASE_SERVICE_ROLE_KEY` — same page (server-only; used by the weekly cron)
- `RESEND_API_KEY` + `EMAIL_FROM` — existing Resend account (domain already verified)
- `CRON_SECRET` — any long random string

## 3. Local dev

```bash
npm install
npm run dev   # http://localhost:3000 → redirects to /login
```

## 4. Deploy (Vercel)

```bash
npm i -g vercel
vercel link
vercel env add   # add every var from .env.local (SUPABASE_SERVICE_ROLE_KEY + CRON_SECRET as sensitive)
vercel --prod
```

- Add the custom domain `admin.bufferbros.org` in Vercel → Project → Domains; DNS is on
  Cloudflare, so add one **CNAME** record `admin` → `cname.vercel-dns.com` (proxy off / DNS-only).
- `vercel.json` already schedules the weekly plan-visit generation cron (Mondays 10:00 UTC);
  it authenticates with `CRON_SECRET` automatically once that env var exists.

## 5. Migrate the old D1 data (one-time)

From the **website** repo (where wrangler is configured):

```bash
mkdir d1
npx wrangler d1 execute bufferbros --remote --json --command "SELECT * FROM weekly_hours" > d1/weekly_hours.json
npx wrangler d1 execute bufferbros --remote --json --command "SELECT * FROM blocks"       > d1/blocks.json
npx wrangler d1 execute bufferbros --remote --json --command "SELECT * FROM settings"     > d1/settings.json
npx wrangler d1 execute bufferbros --remote --json --command "SELECT * FROM bookings"     > d1/bookings.json
```

Move the `d1/` folder into this repo, then:

```bash
SUPABASE_URL=https://YOUR-REF.supabase.co SUPABASE_SERVICE_ROLE_KEY=eyJ... node scripts/migrate-d1.mjs ./d1
```

Re-runnable: it skips anything already migrated (`legacy_id`).

## 6. Website cutover (in the website repo, later)

The two RPCs are built for this (spec §8):

1. Worker secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
2. `/api/availability` → `POST {SUPABASE_URL}/rest/v1/rpc/get_available_slots`
   body `{"p_date":"2026-07-14","p_duration_min":150}` → rows `[{"slot_min":480},…]`; keep the
   existing response shape by mapping `slot_min` → `{min, label}`.
3. `/api/book` → `POST {SUPABASE_URL}/rest/v1/rpc/book_appointment` with
   `{"p_date":…,"p_start_min":…,"p_duration_min":…,"p_name":…,"p_email":…,"p_phone":…,"p_address":…,"p_size_id":…,"p_size_label":…,"p_service_name":…,"p_addons":[…],"p_price":…,"p_notes":…}`
   (defaults: `p_source='web'`, `p_mode='strict'`). A `slot_taken` error → return the existing
   409 message. Emails stay in the Worker unchanged.
4. Response shapes unchanged; then retire D1.

Until the cutover, website prices/hours still come from the website repo — the Settings page
notes this.
