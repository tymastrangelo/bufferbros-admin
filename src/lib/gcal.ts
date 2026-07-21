// Google Calendar sync via a service account (share the calendar with GCAL_SA_EMAIL
// as "Make changes to events"). One idempotent function: read the appointment row,
// make the calendar match. Fire-and-forget like notify.ts — a dead sync must never
// fail the action that triggered it. Unconfigured env = silently skip (local dev).
import "server-only";

import { createSign } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { addDays, TZ } from "@/lib/time";
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

type ApptRow = Appointment & { customers: { name: string; phone: string | null } | null };

function eventBody(appt: ApptRow) {
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const endMin = appt.start_min + appt.duration_min;
  const endDate = endMin >= 1440 ? addDays(appt.date, 1) : appt.date; // job runs past midnight
  const name = appt.customers?.name ?? appt.contact_name ?? "Customer";
  const phone = appt.customers?.phone ?? appt.contact_phone;
  const description = [
    `$${appt.price}`,
    appt.addons.length ? `Add-ons: ${appt.addons.map((a) => a.name).join(", ")}` : null,
    phone ? `Phone: ${phone}` : null,
    appt.notes,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    summary: `${name} — ${appt.service_name}`,
    location: appt.address ?? undefined,
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
    const { data } = await db.from("appointments").select("*, customers(name,phone)").eq("id", id).single();
    const appt = data as ApptRow | null;
    if (!appt) return;

    const headers = { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" };
    const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CAL_ID)}/events`;
    const gone = (s: number) => s === 404 || s === 410;

    // Pending web bookings stay off the calendar until approved; cancelled/no-show come off.
    if (appt.status === "pending" || appt.status === "cancelled" || appt.status === "no_show") {
      if (!appt.gcal_event_id) return;
      const res = await fetch(`${base}/${appt.gcal_event_id}`, { method: "DELETE", headers });
      if (res.ok || gone(res.status)) await db.from("appointments").update({ gcal_event_id: null }).eq("id", id);
      else console.error(`gcal delete ${res.status}: ${await res.text()}`);
      return;
    }

    const body = JSON.stringify(eventBody(appt));
    if (appt.gcal_event_id) {
      const res = await fetch(`${base}/${appt.gcal_event_id}`, { method: "PATCH", headers, body });
      if (!gone(res.status)) {
        if (!res.ok) console.error(`gcal patch ${res.status}: ${await res.text()}`);
        return;
      }
      // event was deleted on Google's side — fall through and recreate
    }
    const res = await fetch(base, { method: "POST", headers, body });
    if (!res.ok) return console.error(`gcal create ${res.status}: ${await res.text()}`);
    const ev = await res.json();
    await db.from("appointments").update({ gcal_event_id: ev.id }).eq("id", id);
  } catch (e) {
    console.error("gcal sync:", e);
  }
}
