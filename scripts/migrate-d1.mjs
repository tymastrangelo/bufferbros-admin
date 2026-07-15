#!/usr/bin/env node
// One-time D1 → Supabase migration (owner-assisted).
//
// 1) Export each table from the website's D1 database:
//    npx wrangler d1 execute bufferbros --remote --json --command "SELECT * FROM weekly_hours" > d1/weekly_hours.json
//    npx wrangler d1 execute bufferbros --remote --json --command "SELECT * FROM blocks"       > d1/blocks.json
//    npx wrangler d1 execute bufferbros --remote --json --command "SELECT * FROM settings"     > d1/settings.json
//    npx wrangler d1 execute bufferbros --remote --json --command "SELECT * FROM bookings"     > d1/bookings.json
//
// 2) SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//      node scripts/migrate-d1.mjs ./d1
//
// Idempotent: appointments carry legacy_id (unique), customers dedupe by phone/email,
// weekly_hours + settings upsert, blocks skip if the exact row already exists.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const dir = process.argv[2] ?? "./d1";
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const db = createClient(url, key);

function load(name) {
  const raw = JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8"));
  // wrangler --json emits [{results:[...], ...}]
  const rows = Array.isArray(raw) ? raw[0]?.results ?? raw : raw.results ?? [];
  console.log(`${name}: ${rows.length} rows`);
  return rows;
}

const digits = (p) => {
  let d = String(p ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d;
};
const e164 = (p) => (digits(p).length === 10 ? `+1${digits(p)}` : String(p ?? "").trim() || null);
const cleanEmail = (e) => String(e ?? "").trim().toLowerCase() || null;

const todayET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

async function must(promise, label) {
  const { data, error } = await promise;
  if (error) {
    console.error(`FAILED ${label}:`, error.message);
    process.exit(1);
  }
  return data;
}

// ---- weekly_hours / settings: straight upserts ----
const hours = load("weekly_hours").map((r) => ({
  weekday: r.weekday,
  enabled: !!r.enabled,
  open_min: r.open_min,
  close_min: r.close_min,
}));
if (hours.length) await must(db.from("weekly_hours").upsert(hours), "weekly_hours");

const settings = load("settings").map((r) => ({ key: r.key, value: String(r.value) }));
if (settings.length) await must(db.from("settings").upsert(settings), "settings");

// ---- blocks: insert missing ----
const existingBlocks = await must(db.from("blocks").select("date,start_min,end_min"), "read blocks");
const haveBlock = new Set(existingBlocks.map((b) => `${b.date}|${b.start_min}|${b.end_min}`));
const newBlocks = load("blocks")
  .map((b) => ({ date: b.date, start_min: b.start_min, end_min: b.end_min, reason: b.reason ?? null }))
  .filter((b) => !haveBlock.has(`${b.date}|${b.start_min}|${b.end_min}`));
if (newBlocks.length) await must(db.from("blocks").insert(newBlocks), "blocks");
console.log(`blocks: inserted ${newBlocks.length} new`);

// ---- bookings → customers (dedupe) + appointments ----
const bookings = load("bookings");

const existingCustomers = await must(db.from("customers").select("id,phone,email"), "read customers");
const byPhone = new Map(existingCustomers.filter((c) => c.phone).map((c) => [digits(c.phone), c.id]));
const byEmail = new Map(existingCustomers.filter((c) => c.email).map((c) => [c.email.toLowerCase(), c.id]));

const existingLegacy = await must(
  db.from("appointments").select("legacy_id").not("legacy_id", "is", null),
  "read appointments"
);
const haveLegacy = new Set(existingLegacy.map((a) => a.legacy_id));

let createdCustomers = 0;
let createdAppointments = 0;

for (const b of bookings) {
  if (haveLegacy.has(b.id)) continue;

  // find or create the customer
  let customerId = byPhone.get(digits(b.phone)) ?? byEmail.get(cleanEmail(b.email) ?? "") ?? null;
  if (!customerId && (b.name ?? "").trim()) {
    const row = {
      name: b.name.trim(),
      phone: e164(b.phone),
      email: cleanEmail(b.email),
      addresses: b.address ? [{ label: "Home", address: b.address }] : [],
      source: "website",
    };
    const data = await must(db.from("customers").insert(row).select("id").single(), `customer ${b.name}`);
    customerId = data.id;
    createdCustomers++;
    if (digits(b.phone)) byPhone.set(digits(b.phone), customerId);
    if (cleanEmail(b.email)) byEmail.set(cleanEmail(b.email), customerId);
  }

  let addons = [];
  try {
    addons = JSON.parse(b.addons || "[]");
  } catch {
    /* keep [] */
  }

  const status =
    b.status === "cancelled" ? "cancelled" : b.date >= todayET ? "scheduled" : "completed";

  await must(
    db.from("appointments").insert({
      legacy_id: b.id,
      created_at: new Date((b.created_ts ?? 0) * 1000).toISOString(),
      customer_id: customerId,
      source: "web",
      status,
      date: b.date,
      start_min: b.start_min,
      duration_min: b.duration_min,
      size_id: b.size_id || null,
      size_label: b.size_label || null,
      service_name: b.package_name || "The Standard Detail",
      addons,
      price: b.price ?? 0,
      address: b.address || null,
      contact_name: b.name,
      contact_phone: e164(b.phone),
      contact_email: cleanEmail(b.email),
      notes: b.notes || null,
      completed_at: status === "completed" ? new Date((b.created_ts ?? 0) * 1000).toISOString() : null,
    }),
    `appointment legacy ${b.id}`
  );
  createdAppointments++;
}

console.log(`customers: created ${createdCustomers}`);
console.log(`appointments: created ${createdAppointments} (skipped ${bookings.length - createdAppointments} already migrated)`);
console.log("Done. Past completed web bookings have NO ledger charges — history predates the ledger; balances start clean.");
