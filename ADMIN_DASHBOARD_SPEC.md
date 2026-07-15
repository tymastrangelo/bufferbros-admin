# Buffer Bros — Admin Dashboard Build Spec (`admin.bufferbros.org`)

> **Who this document is for:** an AI agent (or developer) building the Buffer Bros CRM/admin
> dashboard from scratch, in a **new repository**, deployed at **admin.bufferbros.org**.
> Everything you need is in this file: the business, the existing website and its code,
> the data contracts you must honor, the full Supabase backend to create, every screen to
> build, and the quality bar to hit. Read the whole thing before writing code.
>
> **The bar:** this is not a throwaway internal tool. It is the operating system for a real
> business that two people run every day from their phones and laptops. It must be fast,
> beautiful, dense with real information, flawless on a phone screen, and it must NOT look
> AI-generated. Treat it like a product you'd charge money for.

---

## 1. The business

**Buffer Bros Mobile Detailing** — bufferbros.org

| Fact | Value |
|---|---|
| What | Mobile car detailing. The crew drives to the customer (home/office) with their own water and power, although we use the customers water and power if they have it. |
| Where | Marco Island & (South) Naples, FL (Southwest Florida) |
| Who | Two owners/operators: **Tyler** and **Gabe**. They book, answer the phone, and do the work themselves. |
| Founded | 2023 |
| Phone (call/text) | (239) 293-8511 |
| Instagram | https://www.instagram.com/bufferbros.fl (@bufferbros.fl) |
| Facebook | https://www.facebook.com/profile.php?id=61560055724078 |
| Google reviews | https://maps.app.goo.gl/y6Ws2vG7vtHUXxGX7 — leave-a-review link: https://g.page/r/CXiiEGVufNEdEAE/review |
| Hours | Open 7 days a week, default 8:00 AM – 6:00 PM |
| Timezone | **America/New_York** (everything scheduling-related is local wall-clock time) |
| Owner email (notifications) | Set via env — currently a Resend-verified sender on bufferbros.org |
| Google Analytics / Ads | GA4 `G-WG9M9W3RL8`, Google Ads `AW-17448688864` (website only, not needed on admin) |

### The service model (important — this drives the data model)

Buffer Bros deliberately sells **ONE detail**: "The Standard Detail" — a complete
inside-and-out detail, no bronze/silver/gold tiers. The only variables are:

1. **Vehicle size** (3 tiers) — changes price and duration.
2. **One-time vs. a maintenance plan** (recurring cadence) — recurring visits cost less per visit.
3. **Add-ons** (5 optional extras) — add price and time.

### Current pricing (single source of truth today: `public/js/services.js` on the website)

**Vehicle sizes**

| id | Label | Note |
|---|---|---|
| `sedan` | Car / Sedan / Coupe | Sedans, coupes, small hatchbacks |
| `midsize` | Midsize SUV / Truck | 2-row SUVs, midsize trucks |
| `large` | Large SUV / Truck | 3-row SUVs, full-size trucks, vans |

**The Standard Detail (one-time price / duration)**

| Size | Price | Duration |
|---|---|---|
| sedan | $229 | 120 min |
| midsize | $249 | 150 min |
| large | $269 | 180 min |

What's included (marketing copy, useful for invoices/emails): full interior vacuum (seats,
carpets, mats); hand wash with double foam bath; layer of protective wax; wheels, tires and
tire shine; all interior surfaces wiped down; interior and exterior glass; door jambs cleaned.

**Maintenance plans (same detail, recurring; price is per visit)**
*maintenance plans are set to be changed soon, new pricing model. paying upfront will get you discount, i want you to put in some mock values that would actually be worth our time. Also all payments right now are split so 60% goes to the guy washing the car (Gabe) and 40% goes back into the business to me (Tyler). This percentage is set to change too*

| Plan id | Cadence | sedan | midsize | large | Note |
|---|---|---|---|---|---|
| `weekly` | Every week | $139 | $159 | $179 | Lowest per-visit |
| `biweekly` | Every 2 weeks | $159 | $179 | $199 | Most popular |
| `monthly` | Every month | $179 | $199 | $219 | — |

**Add-ons**

| id | Name | Price | Extra minutes |
|---|---|---|---|
| `pet-hair` | Pet Hair Removal | $40 | 30 |
| `engine-bay` | Engine Bay Cleaning | $35 | 30 |
| `ceramic` | Ceramic Spray Coating | $60 | 45 |
| `headlights` | Headlight Restoration | $50 | 45 |
| `odor` | Odor / Ozone Treatment | $45 | 30 |

### How money actually flows (real-world, must be modeled)

- Payment is due **on completion**, collected in person: cash, Zelle, Venmo, check, card — no
  online payment on the website today. Final price can be adjusted on site (very dirty car =
  higher quote; the terms allow this).
- **Recurring customers are the backbone.** Real examples the data model MUST handle cleanly:
  - A customer on a **weekly plan who pays monthly** (one payment covers ~4 visits).
  - A customer who **prepaid for the rest of the year up front** (one large payment,
    visits draw the credit down over months).
  - Normal pay-per-visit customers, one-time customers, tips, occasional refunds/discounts.
- So: **appointments create charges, payments are independent events, and a customer has a
  running balance** (credit when they've prepaid, owed when they're behind). Do NOT tie one
  payment to one appointment 1:1 — use a ledger.

### The terms & conditions highlights (affect workflows)

- Prices are estimates for average condition; final price confirmed on site before work.
- Pre/post service inspection with photos is performed on every job.
- Appointment times may be an "arrival window."
- Customers should report issues within 24 hours; Buffer Bros makes it right.

---

## 2. The existing website (bufferbros.org) — what it is and what it does

Separate repo (`tymastrangelo/bufferbros-website` on GitHub). **Do not rebuild it — but you
must understand it because the dashboard shares its data.**

### Stack

- **Cloudflare Worker** (`wrangler.toml`, entry `src/index.js`): serves static HTML from
  `public/` via the ASSETS binding and routes `/api/*` to handler modules.
- **Cloudflare D1** (SQLite) database `bufferbros` — schema in `schema.sql` (reproduced below).
- **Resend** for transactional email (free tier, domain-verified sender on bufferbros.org).
- Static pages: Tailwind (CDN) + Inter font + Font Awesome + a small custom design system
  (`public/css/styles.css`). Brand color `#2563eb`, ink `#0a0e14`.
- Pages: `index`, `about`, `packages` (pricing), `portfolio` (links to IG), `booking`
  (the money page), `terms`, `privacy`, `connect` (link-in-bio page), `quote` (redirects
  to booking), `thank-you`.
- Auto-deploys on push to `main`.

### The customer booking flow (`booking.html`)

Six-step guided form, entirely client-side state, mobile-first:
1. Vehicle size → 2. Frequency (one-time or a plan) → 3. Add-ons → 4. Date + time
(fetches `/api/availability`) → 5. Contact details (name/phone/email/address/notes) →
6. Agree to terms → POST `/api/book`.

**Recurring bookings from the website are only the FIRST visit** — the site books one
appointment and the crew sets up the actual recurring schedule with the customer in person.
(The package name is stamped e.g. `The Standard Detail (Weekly plan)` so you can tell.)
Supports `?size=` and `?freq=` URL params (deep links from the packages page).

### Current D1 schema (this data gets migrated to Supabase)

```sql
CREATE TABLE weekly_hours (
  weekday   INTEGER PRIMARY KEY,          -- 0=Sunday .. 6=Saturday
  enabled   INTEGER NOT NULL DEFAULT 0,
  open_min  INTEGER NOT NULL DEFAULT 480, -- minutes from midnight local (480 = 8:00 AM)
  close_min INTEGER NOT NULL DEFAULT 1080 -- 1080 = 6:00 PM
);
CREATE TABLE blocks (                      -- one-off blocked time (vacation, personal)
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  date      TEXT NOT NULL,                -- YYYY-MM-DD local
  start_min INTEGER NOT NULL,
  end_min   INTEGER NOT NULL,             -- 0..1440 = all day
  reason    TEXT
);
CREATE TABLE bookings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  created_ts   INTEGER NOT NULL,           -- unix seconds
  name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL, address TEXT NOT NULL,
  package_id   TEXT NOT NULL,              -- 'standard' | 'manual'
  package_name TEXT NOT NULL,              -- e.g. "The Standard Detail (Weekly plan)"
  size_id      TEXT NOT NULL,              -- 'sedan' | 'midsize' | 'large' | ''
  size_label   TEXT NOT NULL,
  addons       TEXT NOT NULL DEFAULT '[]', -- JSON array of {id,name,price}
  date         TEXT NOT NULL,              -- YYYY-MM-DD local
  start_min    INTEGER NOT NULL,
  duration_min INTEGER NOT NULL,
  price        INTEGER NOT NULL DEFAULT 0, -- whole dollars
  notes        TEXT,
  status       TEXT NOT NULL DEFAULT 'confirmed'  -- confirmed | cancelled
);
CREATE TABLE settings ( key TEXT PRIMARY KEY, value TEXT NOT NULL );
-- settings rows: slot_granularity_min='30', min_lead_min='180', buffer_min='30'
```

### The availability engine (MUST be reimplemented identically over Supabase)

This is the heart of scheduling. Given a `date` and appointment `durationMin`:

```
total    = durationMin + buffer_min                 (buffer = pack-up/travel, default 30)
busy     = all blocks for that date, as [start_min, end_min]
         + all confirmed bookings for that date, as [start_min, start_min + duration_min + buffer_min]
earliest = if date == today: now_minutes + min_lead_min (default 180 = 3 hours)
           if date <  today: infinity (no slots)
           else: 0
slots    = for start in open_min .. (close_min - durationMin) step slot_granularity_min (default 30):
             skip if start < earliest
             skip if [start, start + total] overlaps any busy range
             else -> start is an offerable slot
day closed (weekly_hours.enabled = 0) -> no slots
```

Notes: the appointment itself must END by close (`start + durationMin <= close_min`), the
buffer may run past close; overlap test is `start < busyEnd && end > busyStart`; "today" is
computed in **America/New_York** wall-clock, never UTC.

### Public API contracts (the website depends on these EXACTLY)

**`GET /api/availability?date=YYYY-MM-DD&duration=150`** →
```json
{ "ok": true, "date": "2026-07-14", "durationMin": 150,
  "slots": [ { "min": 480, "label": "8:00 AM" }, { "min": 510, "label": "8:30 AM" } ] }
```

**`POST /api/book`** — body:
```json
{ "name": "...", "email": "...", "phone": "...", "address": "...",
  "packageId": "standard", "packageName": "The Standard Detail (Weekly plan)",
  "sizeId": "midsize", "sizeLabel": "Midsize SUV / Truck",
  "addons": [ { "id": "pet-hair", "name": "Pet Hair Removal", "price": 40 } ],
  "date": "2026-07-20", "startMin": 540, "durationMin": 180,
  "price": 239, "notes": "...", "agreedTerms": true }
```
→ `{ "ok": true, "id": 42, "when": "Monday, July 20, 2026 at 9:00 AM", "emailResults": {...} }`
Server **re-runs the availability check** before insert and returns
`409 { "ok": false, "error": "Sorry, that time was just taken..." }` on conflict.
On success it emails the owner (new-booking alert, reply-to = customer) and the customer
(confirmation) via Resend. Errors: `{ "ok": false, "error": "message" }` with 4xx.

Date formatting used everywhere in emails: **"Weekday, Month D, YYYY at H:MM AM/PM"**
(e.g. "Wednesday, June 6, 2026 at 9:00 AM").

### The old admin (JUST DELETED — you are its replacement)

The site had a password-gated single page `admin.html` + `/api/admin/*` routes on the same
Worker (HMAC cookie session, single shared `ADMIN_PASSWORD`). It has been **removed from the
website repo**. What it could do — the new dashboard must do ALL of this and much more:

- Log in / log out.
- Month calendar showing bookings, blocked time, and closed days; day detail view.
- Edit weekly hours (per-weekday enabled + open/close times).
- Block off time: single day, date range, all-day or a time window, with a reason; delete blocks.
- List upcoming confirmed bookings with full contact info.
- Manually add an appointment (phone bookings): name required, phone/email/address optional,
  vehicle size (auto-fills duration), date, start, duration, notes, optional confirmation email.
- Reschedule (change date/start/duration) with optional "your appointment was updated" email
  showing old vs new time.
- Cancel with optional cancellation email.

Email templates it used (Resend, keep the voice — plain, friendly, signed "Buffer Bros",
footer "Questions? Call or text us at (239) 293-8511."):
- **Confirmed:** "Your Buffer Bros appointment is confirmed" + what/when/where + "The time may
  be an arrival window, and final pricing is confirmed on site."
- **Updated:** shows the old time struck through, then "Now: {new time}".
- **Cancelled:** "Want to rebook? Visit bufferbros.org or call us and we will find a new time."

---

## 3. The mission

Build **admin.bufferbros.org** — a full CRM + operations dashboard, in a new repo, that becomes
the single place Tyler and Gabe run the business: schedule, customers, recurring plans, and money.

**Architecture decision (already made — follow it):**

- **Next.js (App Router, TypeScript) + Supabase** (Postgres, Auth, RLS). Host on Vercel
  (or Cloudflare — builder's choice, Vercel is the default) with the custom domain
  `admin.bufferbros.org`.
- **Supabase becomes the single source of truth for ALL data** — the dashboard reads/writes it
  directly with `@supabase/ssr`.
- The public website keeps its exact API contracts, but its Worker gets repointed from D1 to
  Supabase (small follow-up change in the website repo — see §8). Until that cutover, the
  website still writes to D1; after it, everything lives in one database.
- Emails continue through **Resend** (already domain-verified for bufferbros.org). Send from
  server code only (Next.js route handlers / server actions), never the client.

---

## 4. Supabase backend — create this

Create a new Supabase project (or use the owner's existing one if provided). Region: US East.
Apply the following as a migration. This schema is the contract — extend it if the build needs
more, but don't rename what's here without reason.

```sql
-- ============ ENUMS ============
create type appointment_status as enum ('scheduled','completed','cancelled','no_show');
create type appointment_source as enum ('web','manual','recurring');
create type plan_status        as enum ('active','paused','ended');
create type plan_cadence       as enum ('weekly','biweekly','monthly','custom');
create type payment_method     as enum ('cash','zelle','venmo','card','check','other');
create type entry_kind         as enum ('charge','payment','credit','refund','discount');

-- ============ CUSTOMERS & VEHICLES ============
create table customers (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text not null,
  phone       text,                        -- normalized E.164 where possible
  email       text,
  addresses   jsonb not null default '[]', -- [{label:'Home', address:'...'}]
  notes       text,
  tags        text[] not null default '{}',-- e.g. {'vip','weekly','prepaid'}
  source      text,                        -- 'website' | 'contacts-import' | 'manual'
  archived    boolean not null default false
);
create index on customers using gin (tags);
create index on customers (phone);
create index on customers (email);

create table vehicles (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  size_id     text not null default 'sedan',   -- 'sedan'|'midsize'|'large'
  make        text, model text, year int, color text, plate text,
  notes       text
);

-- ============ SERVICE CATALOG (replaces services.js as source of truth) ============
create table services (          -- the detail + add-ons, editable in Settings
  id          text primary key,  -- 'standard','pet-hair','engine-bay',...
  kind        text not null check (kind in ('detail','addon')),
  name        text not null,
  note        text,
  active      boolean not null default true,
  sort        int not null default 0
);
create table service_pricing (   -- price/duration per vehicle size (details) or flat (addons: size_id='*')
  service_id  text not null references services(id) on delete cascade,
  size_id     text not null,     -- 'sedan'|'midsize'|'large'|'*'
  price       numeric(10,2) not null default 0,
  minutes     int not null default 0,
  primary key (service_id, size_id)
);
create table plan_pricing (      -- per-visit price by cadence + size
  cadence     plan_cadence not null,
  size_id     text not null,
  price       numeric(10,2) not null,
  primary key (cadence, size_id)
);

-- ============ SCHEDULING ============
create table weekly_hours (
  weekday   int primary key check (weekday between 0 and 6),  -- 0=Sunday
  enabled   boolean not null default true,
  open_min  int not null default 480,
  close_min int not null default 1080
);
create table blocks (
  id        uuid primary key default gen_random_uuid(),
  date      date not null,
  start_min int not null default 0,
  end_min   int not null default 1440,
  reason    text
);
create index on blocks (date);

create table settings ( key text primary key, value text not null );
-- seed: slot_granularity_min='30', min_lead_min='180', buffer_min='30', timezone='America/New_York'

-- ============ RECURRING PLANS ============
create table plans (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  customer_id     uuid not null references customers(id) on delete cascade,
  vehicle_id      uuid references vehicles(id) on delete set null,
  cadence         plan_cadence not null,
  interval_days   int,                     -- only for cadence='custom'
  per_visit_price numeric(10,2) not null,
  preferred_dow   int,                     -- 0..6, preferred weekday
  preferred_min   int,                     -- preferred start time, minutes from midnight
  duration_min    int not null default 120,
  address         text,
  status          plan_status not null default 'active',
  starts_on       date not null default current_date,
  ends_on         date,
  billing_note    text,                    -- e.g. 'pays monthly', 'prepaid through Dec 2026'
  notes           text
);

-- ============ APPOINTMENTS ============
create table appointments (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  legacy_id    int,                          -- old D1 bookings.id (migration)
  customer_id  uuid references customers(id) on delete set null,
  vehicle_id   uuid references vehicles(id) on delete set null,
  plan_id      uuid references plans(id) on delete set null,
  source       appointment_source not null default 'manual',
  status       appointment_status not null default 'scheduled',
  date         date not null,
  start_min    int not null,
  duration_min int not null,
  size_id      text, size_label text,
  service_name text not null default 'The Standard Detail',
  addons       jsonb not null default '[]',  -- [{id,name,price}]
  price        numeric(10,2) not null default 0,  -- quoted; final may differ (edit on complete)
  address      text,
  -- denormalized contact for web bookings before they're linked to a customer:
  contact_name text, contact_phone text, contact_email text,
  notes        text,
  completed_at timestamptz
);
create index on appointments (date, start_min);
create index on appointments (customer_id);
create index on appointments (plan_id);
create index on appointments (status);

-- ============ MONEY: LEDGER + PAYMENTS + EXPENSES ============
-- Every financial event is a ledger entry. Customer balance = sum(amount).
--   charge  -> negative amount (they owe more)  — auto-created when an appointment completes
--   payment -> positive amount                  — money actually received
--   credit / refund / discount as needed
create table ledger_entries (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  customer_id    uuid not null references customers(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete set null,
  plan_id        uuid references plans(id) on delete set null,
  kind           entry_kind not null,
  amount         numeric(10,2) not null,    -- sign convention above
  method         payment_method,            -- for kind='payment'/'refund'
  occurred_on    date not null default current_date,
  memo           text
);
create index on ledger_entries (customer_id, occurred_on);
create index on ledger_entries (occurred_on);

create view customer_balances as
  select c.id as customer_id, c.name,
         coalesce(sum(l.amount), 0) as balance   -- >0 credit, <0 owes
  from customers c left join ledger_entries l on l.customer_id = c.id
  group by c.id, c.name;

create table expenses (
  id          uuid primary key default gen_random_uuid(),
  occurred_on date not null default current_date,
  category    text not null default 'supplies',  -- supplies|fuel|equipment|insurance|marketing|other
  amount      numeric(10,2) not null,
  memo        text,
  created_at  timestamptz not null default now()
);

-- ============ SEED DATA ============
insert into services (id, kind, name, note, sort) values
  ('standard',  'detail','The Standard Detail','Complete inside & out detail',0),
  ('pet-hair',  'addon','Pet Hair Removal','Heavy shedding and embedded hair',1),
  ('engine-bay','addon','Engine Bay Cleaning','Cleaned and dressed',2),
  ('ceramic',   'addon','Ceramic Spray Coating','Months of added protection',3),
  ('headlights','addon','Headlight Restoration','Clears yellowed, foggy lenses',4),
  ('odor',      'addon','Odor / Ozone Treatment','Smoke and stubborn smells',5);
insert into service_pricing (service_id, size_id, price, minutes) values
  ('standard','sedan',229,120), ('standard','midsize',249,150), ('standard','large',269,180),
  ('pet-hair','*',40,30), ('engine-bay','*',35,30), ('ceramic','*',60,45),
  ('headlights','*',50,45), ('odor','*',45,30);
insert into plan_pricing (cadence, size_id, price) values
  ('weekly','sedan',139),  ('weekly','midsize',159),  ('weekly','large',179),
  ('biweekly','sedan',159),('biweekly','midsize',179),('biweekly','large',199),
  ('monthly','sedan',179), ('monthly','midsize',199), ('monthly','large',219);
insert into weekly_hours (weekday, enabled, open_min, close_min)
  select d, true, 480, 1080 from generate_series(0,6) d;
insert into settings (key, value) values
  ('slot_granularity_min','30'), ('min_lead_min','180'),
  ('buffer_min','30'), ('timezone','America/New_York');
```

### Row Level Security

- **Enable RLS on every table.** Policy: full access (`for all using / with check`) for
  authenticated users — this is a two-person internal tool; every logged-in user is an owner.
- No anon policies at all. The public website integration uses the **service role key**
  server-side (Worker secret), which bypasses RLS.
- Auth: **Supabase email/password**, two users (Tyler + Gabe), created manually in the
  Supabase dashboard. **Disable public signups.** No roles/permissions UI needed.

### Availability RPC (so the engine lives in ONE place)

Implement the §2 availability algorithm as a Postgres function so both the dashboard and the
public website call the same logic:

```sql
create or replace function get_available_slots(p_date date, p_duration_min int)
returns table (slot_min int) ...
```

It reads `weekly_hours`, `blocks`, `appointments` (status='scheduled', same date), and
`settings`, computes "now" in the `settings.timezone`, and returns valid start minutes.
Also implement `book_appointment(...)` as a single transactional RPC that re-validates the
slot and inserts — this is what makes double-booking impossible even with two writers.

---

## 5. The dashboard — screens & features

Navigation (desktop: slim left sidebar; mobile: bottom tab bar + sheet for the rest):
**Today · Calendar · Customers · Plans · Money · Settings**, plus a global "＋ New" action
(new appointment / customer / payment / block) and global search (⌘K).

### 5.1 Login

- Full-screen, split or centered card. Buffer Bros logo, email + password, "remember me",
  clear error states. Supabase auth with `@supabase/ssr` cookie sessions; middleware protects
  every route; deep links return you where you were heading after login.
- No signup, no social buttons, no "forgot password" flow beyond Supabase's email reset.
- This page sets the design tone — make it feel like a real product, not a template.

### 5.2 Today (home)

The morning screen — answers "what's happening today?" at a glance on a phone:
- Today's schedule as a timeline: each job card = time, customer, vehicle/size, address
  (tap → opens Apple/Google Maps), phone (tap-to-call/text), add-ons, quoted price, plan badge
  if recurring, notes.
- One-tap job actions: **Complete** (opens a "finalize" sheet: confirm/adjust final price,
  record payment now or leave on account) · Reschedule · Cancel · No-show.
- Compact stat row: revenue this week / this month, jobs completed this month, outstanding
  balances total, active plans count.
- "Needs attention" list: unlinked web bookings (see 5.4), customers with balances owed,
  plans with no upcoming appointment scheduled.

### 5.3 Calendar

- Month / week / day views. Month shows chips (time + first name), week/day show
  proportional time blocks. Color code: scheduled / completed / recurring / blocked / closed.
- Tap a day → day panel with full detail; tap a job → job sheet (view/edit everything,
  including linking customer, changing addons, price).
- Create from the calendar: tap empty space → new appointment pre-filled with that date/time.
- **Availability-aware:** when picking a time, show the actual open slots (via the RPC) but
  allow an explicit override ("book anyway") since the owners may double up deliberately.
- Manage blocks and weekly hours from here (blocks inline; hours in Settings too).
- Drag-to-reschedule on desktop is a nice-to-have; a tap-driven reschedule flow is required
  and must be great on mobile.

### 5.4 Customers (the CRM)

- List: search-as-you-type (name/phone/email), tag filters, sort by recent activity.
  Row shows name, tags, phone, last visit, next visit, balance (credit green / owed red).
- **Customer profile** — the hub:
  - Contact card (call/text/email/maps links), addresses, tags, notes.
  - Vehicles (add/edit; size drives default pricing/duration).
  - Plan section: their recurring plan(s), status, cadence, price, next visits.
  - Appointment history (past + upcoming), with per-visit status and price.
  - **Ledger tab:** every charge/payment/credit with running balance; "Record payment" and
    "Add credit / discount" right there.
- **Import from phone contacts:** an Import page that accepts a **vCard (.vcf) export**
  (iPhone: Contacts → select all → share/export; or iCloud.com → export vCard) and also CSV.
  Parse client-side, show a preview table with checkboxes, dedupe against existing customers
  by normalized phone/email (show "already exists" matches), then bulk-insert the selected
  rows with `source='contacts-import'`. Handle multi-number/multi-address cards gracefully.
- **Web-booking linking:** website bookings arrive with only name/phone/email strings. Show
  them as "unlinked"; offer one-tap "link to existing customer" (auto-suggest by phone/email
  match) or "create customer from this booking."

### 5.5 Plans (recurring details)

- List of plans with status, customer, cadence, per-visit price, next visit, billing note.
- Create/edit plan: customer, vehicle, cadence (weekly/biweekly/monthly/custom every-N-days),
  per-visit price (auto-suggest from `plan_pricing`, editable per customer), preferred
  weekday + time, duration, address, start/end dates, billing note, notes.
- **Occurrence generation:** a "Schedule visits" action (and an automatic weekly job — Vercel
  cron or `pg_cron`) that materializes appointments (`source='recurring'`, linked `plan_id`)
  8 weeks ahead, skipping dates that already have that plan's appointment, defaulting to the
  preferred day/time and flagging conflicts for manual placement instead of silently moving them.
- Pause / resume / end a plan (future generated-but-unmodified appointments get cancelled).
- Plan economics on the plan page: visits completed, revenue to date, balance status —
  so "the guy who prepaid the year" shows remaining credit at a glance.

### 5.6 Money

- **Overview:** revenue this month vs last (collected vs earned), outstanding owed,
  total prepaid credit held, expenses this month, net. Simple bar chart of revenue by month
  (12 months) and by source (one-time vs plans). Keep charts minimal and clean — no chart junk.
- **Payments:** record a payment (customer, amount, method, date, memo, optionally attach to
  an appointment or plan); full payments list with filters (method, date range, customer);
  edit/delete (owners fix typos — allow it, it's their ledger).
- **Charges** are created automatically when a job is marked completed (at the final price);
  editable from the ledger.
- **Balances:** table of every customer with a non-zero balance (owed and credit views).
- **Expenses:** quick-add (amount, category, memo, date) + list. This is lightweight
  bookkeeping, not accounting software — no invoices, no taxes, no double-entry UI.
- **Export:** CSV export of payments, charges, and expenses for a date range (for the
  accountant at tax time).

### 5.7 Settings

- **Services & pricing:** edit detail pricing per size, add-on prices/minutes, plan pricing
  matrix. (After website cutover in §8, this drives the public site too — until then, note
  on screen that website prices are edited in `services.js`.)
- **Hours & booking rules:** weekly hours editor (the classic 7-row toggle + time ranges),
  slot granularity / minimum lead time / buffer minutes.
- **Blocks:** same block manager as the calendar.
- **Email:** from-address display, test-send button. Templates stay in code — keep the exact
  voice/format from §2.
- **Account:** change password, log out.

### 5.8 Emails the dashboard sends (Resend)

Port the three templates from §2 (confirmed / updated / cancelled) exactly in tone and
format; use them for manual bookings (optional checkbox, default on when email exists),
reschedules (only when the time actually changed), cancellations, and plan-generated
appointment confirmations (per-plan toggle, default off — regulars don't need weekly emails).
Owner new-booking alert stays a website concern.

---

## 6. Design bar — "must not look AI-generated"

This is a hard requirement. What that means in practice:

- **No generic AI-slop tells:** no purple-to-blue gradient heroes, no emoji in UI chrome, no
  giant rounded cards with drop shadows everywhere, no "✨ Welcome back, Tyler! ✨", no
  center-aligned everything, no default shadcn look left unthemed, no lorem-ipsum vibes,
  no 5 different border radii.
- **Personality:** this is a detailing company run by two guys who buff cars in the Florida
  sun. Confident, clean, a little industrial. Near-black ink (`#0a0e14`), white/gray surfaces
  (`#f6f8fb`), the brand blue `#2563eb` used **sparingly** as the accent (actions, selected
  states, "today"), semantic green/red/amber for money and statuses. A dark theme is optional;
  if you ship one, it must be first-class, not inverted colors.
- **Typography does the design work:** one excellent sans (Inter is the brand default —
  or a close pairing like Geist/General Sans for UI with Inter fallback), tight tracking on
  headings (-0.02em), **tabular numerals for every number that can change** (times, prices,
  balances), a real type scale, generous line-height in tables.
- **Density over decoration:** owners want information, not padding. Tables and lists should
  feel like Linear/Stripe — hairline borders (`#e5e7eb`), 8px spacing grid, small caps or
  11px uppercase labels for metadata, no card-inside-card nesting.
- **Motion:** fast and subtle (150–250ms ease); page transitions instant; skeletons for
  loading, never spinners on whole pages; optimistic UI for toggles and status changes.
- **Mobile is not an afterthought — it's the primary device.** Tyler runs the day from his
  phone between jobs with wet hands. Bottom tab bar, thumb-reachable primary actions, sheets
  instead of modals, 44px+ tap targets, safe-area insets, no horizontal scroll ever,
  tap-to-call/text/maps everywhere a phone/address appears.
- **Empty states, error states, and loading states are designed**, not defaulted — an empty
  Money page tells you how to record your first payment.
- Favicon + app icons from the Buffer Bros logo; `robots: noindex` on everything;
  proper `<title>`s ("Today — Buffer Bros"); PWA manifest so it can be added to the home
  screen with the right icon and name (a real installable feel with zero extra infra).

**Craft checklist (the "hard work" is here):** keyboard shortcuts on desktop (⌘K search,
N for new appointment), focus states, `Intl.NumberFormat` currency everywhere (no `$` string
concat), dates via a single util module in America/New_York (never raw `Date` math on
YYYY-MM-DD strings — reuse the UTC-noon trick from the website's `util.js` for weekday math),
phone numbers formatted `(239) 293-8511`, all times as `h:mm AM/PM`.

---

## 7. Tech notes & project shape

- **Next.js 15+ App Router, TypeScript, Tailwind.** Component library: none required —
  hand-rolled + Radix primitives, or shadcn/ui **heavily themed** to the design above.
- `@supabase/ssr` for auth-aware server components; middleware guards all routes except
  `/login`. Server actions or route handlers for mutations that also send email.
- Generate DB types (`supabase gen types typescript`) and use them end-to-end.
- Timezone: store dates as `date` + minutes-from-midnight ints (matches the engine and
  sidesteps DST entirely). One `lib/time.ts` owns all formatting.
- Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` (server only), `RESEND_API_KEY`, `EMAIL_FROM`
  (e.g. `Buffer Bros <bookings@bufferbros.org>`), `OWNER_EMAIL`.
- Domain: add `admin.bufferbros.org` as a custom domain on the host; DNS is on Cloudflare
  (site is a Cloudflare Worker on the apex), so it's one CNAME record.
- Seed a `README.md` with setup steps and a `supabase/migrations/` folder so the schema is
  reproducible.

---

## 8. Website cutover (small follow-up in the WEBSITE repo — plan for it)

Once Supabase is live, the public site's Worker swaps D1 for Supabase so there's one database:

1. Add Worker secrets `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
2. `functions/api/availability.js` → call the `get_available_slots` RPC
   (`POST {SUPABASE_URL}/rest/v1/rpc/get_available_slots`).
3. `functions/api/book.js` → call the transactional `book_appointment` RPC, which inserts an
   `appointments` row (`source='web'`, `status='scheduled'`, denormalized contact fields).
   Emails stay in the Worker unchanged.
4. **Response shapes must not change** — `booking.html` is untouched.
5. Then D1 is retired.

The dashboard agent doesn't edit the website repo, but MUST build the two RPCs with this in mind.

### Data migration (one-time, owner-assisted)

- Export D1: `npx wrangler d1 export bufferbros --remote --output=d1-dump.sql` (or
  `d1 execute ... --json` per table). Provide a small import script that:
  - copies `weekly_hours`, `blocks`, `settings` verbatim;
  - inserts `bookings` → `appointments` (`legacy_id` = old id, map `confirmed`→`scheduled`
    for future dates / `completed` for past dates, `cancelled`→`cancelled`, parse `addons` JSON,
    keep denormalized contact fields);
  - creates `customers` by deduping bookings on phone/email (source `'website'`) and links them.
- Phone contacts arrive later via the vCard import UI (§5.4) — the owner will do this himself.

---

## 9. Acceptance checklist (define "done")

**Functional**
- [ ] Login/logout works; every route is auth-guarded; sessions survive refresh.
- [ ] Today screen shows real schedule with working call/text/maps links.
- [ ] Complete-a-job flow: adjust final price → charge hits ledger → optional payment
      recorded in the same sheet → balance updates.
- [ ] Calendar month/week/day; create, reschedule, cancel with correct optional emails.
- [ ] Availability slots from the RPC match the §2 algorithm exactly (write a test:
      granularity, lead time, buffer, closed days, blocks, overlap edge `start < be && end > bs`).
- [ ] Double-booking impossible: two concurrent `book_appointment` calls for the same slot —
      one wins, one gets a clean conflict.
- [ ] Customers CRUD + vCard AND CSV import with preview + dedupe.
- [ ] Web bookings appear (after cutover) and can be linked to customers in one tap.
- [ ] Plans generate occurrences 8 weeks ahead, automatically, without duplicates; pausing
      stops generation; prepay scenario works end-to-end (record $2,000 credit → visits draw
      it down → balance always right).
- [ ] Money overview numbers reconcile with the ledger (spot-check by hand).
- [ ] CSV exports open cleanly in Excel/Numbers.

**Quality**
- [ ] Flawless at 375px width (iPhone SE/13 mini) — every screen, every sheet.
- [ ] Lighthouse: 90+ performance and accessibility on Today, Calendar, Customers.
- [ ] Zero layout shift on load; skeletons everywhere data streams in.
- [ ] Someone seeing it cold would guess "niche vertical SaaS," not "AI demo."
- [ ] No console errors, no unhandled promise rejections, empty/error states designed.
- [ ] README covers env setup, Supabase migration, seeding, local dev, deploy.

---

## 10. Defaults for open questions (don't block — do this)

- Two auth users: `tyler` and `gabe` (emails provided at setup; owner's is
  mastrangelo.tyler@gmail.com). Created manually, signups disabled.
- Prices are dollars; store `numeric(10,2)`, display whole dollars unless cents exist.
- Tips: record as part of the payment amount with memo "tip" (no separate field yet).
- No customer-facing portal, no online payments, no SMS sending (links open the native
  dialer/Messages) — all future phases, design the schema so they bolt on.
- If the Supabase project can't be created by the agent, generate the migration SQL + a
  `SETUP.md` so the owner can paste it into the Supabase SQL editor in one shot.
