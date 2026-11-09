// Google Calendar sync via a service account (share the calendar with GCAL_SA_EMAIL
// as "Make changes to events"). One idempotent function: read the appointment row,
// make the calendar match. Fire-and-forget like notify.ts — a dead sync must never
// fail the action that triggered it. Unconfigured env = silently skip (local dev).
// reconcileGcal() sweeps daily (sync-calendars cron) and on page loads for anything missed.
import "server-only";

import { createSign } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { addDays, todayYmd, TZ } from "@/lib/time";
import type { Appointment } from "@/lib/types";

const CAL_ID = process.env.GCAL_CALENDAR_ID;
const SA_EMAIL = process.env.GCAL_SA_EMAIL;
const SA_KEY = process.env.GCAL_SA_KEY?.replace(/\\n/g, "\n"); // Vercel env vars flatten newlines

let cached: { token: string; exp: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && Date.now() < cached.exp - 60_000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: SA_EMAIL,
    scope: "https://www.googleapis.com/auth/calendar.events",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const assertion = `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(SA_KEY!, "base64url")}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`gcal token ${res.status}: ${JSON.stringify(json)}`);
  cached = { token: json.access_token, exp: Date.now() + json.expires_in * 1000 };
  return cached.token;
}

type ApptRow = Appointment & {
  customers: { name: string; phone: string | null } | null;
  appointment_employees: { employees: { name: string } | null }[];
};

const OFF_CALENDAR = ["pending", "cancelled", "no_show"]; // pending web bookings wait for approval

function eventBody(appt: ApptRow) {
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const endMin = appt.start_min + appt.duration_min;
  const endDate = endMin >= 1440 ? addDays(appt.date, 1) : appt.date; // job runs past midnight
  const name = appt.customers?.name ?? appt.contact_name ?? "Customer";
  const phone = appt.customers?.phone ?? appt.contact_phone;
  const crew = appt.appointment_employees.map((r) => r.employees?.name).filter(Boolean);
  const description = [
    `$${appt.price}`,
    crew.length ? `Crew: ${crew.join(" + ")}` : null,
    appt.addons.length ? `Add-ons: ${appt.addons.map((a) => a.name).join(", ")}` : null,
    phone ? `Phone: ${phone}` : null,
    appt.notes,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    status: "confirmed", // un-deletes an event someone removed by hand in Google Calendar
    summary: `${name} — ${appt.service_name}`,
    location: appt.address ?? "", // "" (not undefined) so clearing the address clears it on Google too
    description,
    start: { dateTime: `${appt.date}T${hhmm(appt.start_min)}:00`, timeZone: TZ },
    end: { dateTime: `${endDate}T${hhmm(endMin % 1440)}:00`, timeZone: TZ },
  };
}

/** Make Google Calendar match the appointment row: create, patch, or delete as needed. */
export async function syncAppointmentToGcal(id: string): Promise<void> {
  if (!CAL_ID || !SA_EMAIL || !SA_KEY) return; // not configured: silently skip
  try {
    const db = createServiceClient();
    const { data } = await db
      .from("appointments")
      .select("*, customers(name,phone), appointment_employees(employees(name))")
      .eq("id", id)
      .single();
    const appt = data as ApptRow | null;
    if (!appt) return;

    const headers = { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" };
    const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CAL_ID)}/events`;
    const gone = (s: number) => s === 404 || s === 410;
    // Event id derived from the appointment id (UUID hex is valid base32hex): two syncs racing on a
    // brand-new job hit the same event instead of each creating one — no more duplicates.
    const ownId = appt.id.replace(/-/g, "");

    if (OFF_CALENDAR.includes(appt.status)) {
      // Try the derived id too: a racing create may have made it before gcal_event_id was saved.
      const res = await fetch(`${base}/${appt.gcal_event_id ?? ownId}`, { method: "DELETE", headers });
      if (!res.ok && !gone(res.status)) return console.error(`gcal delete ${res.status}: ${await res.text()}`);
      if (appt.gcal_event_id) await db.from("appointments").update({ gcal_event_id: null }).eq("id", id);
      return;
    }

    const ev = eventBody(appt);
    const patch = (eventId: string) => fetch(`${base}/${eventId}`, { method: "PATCH", headers, body: JSON.stringify(ev) });
    let eventId = appt.gcal_event_id;
    let res = eventId ? await patch(eventId) : null;
    if (!res || gone(res.status)) {
      eventId = ownId;
      res = await fetch(base, { method: "POST", headers, body: JSON.stringify({ ...ev, id: ownId }) });
      if (res.status === 409) res = await patch(ownId); // already exists (a racing sync, or deleted earlier)
    }
    if (!res.ok) return console.error(`gcal upsert ${res.status}: ${await res.text()}`);
    if (appt.gcal_event_id !== eventId) await db.from("appointments").update({ gcal_event_id: eventId }).eq("id", id);
  } catch (e) {
    console.error("gcal sync:", e);
  }
}

/**
 * Sweep the calendar back in line with the database, a week back to four months out. Catches
 * what the per-action sync can't: website bookings (the website books straight into Supabase),
 * jobs made before sync was set up, failed or racing syncs, renamed or merged customers.
 * `missingOnly` = just jobs that never made it onto the calendar (cheap; runs on page loads).
 */
export async function reconcileGcal(missingOnly = false): Promise<number> {
  if (!CAL_ID || !SA_EMAIL || !SA_KEY) return 0;
  const db = createServiceClient();
  let q = db
    .from("appointments")
    .select("id,status,gcal_event_id")
    .gte("date", addDays(todayYmd(), -7))
    .lte("date", addDays(todayYmd(), 120));
  if (missingOnly) q = q.is("gcal_event_id", null).in("status", ["scheduled", "completed"]);
  const { data } = await q;
  const todo = (data ?? []).filter((a) => a.gcal_event_id || !OFF_CALENDAR.includes(a.status));
  // ponytail: sequential, ~40 jobs/day is well under Google's quota; batch if the book grows 10x
  for (const a of todo) await syncAppointmentToGcal(a.id);
  return todo.length;
}
