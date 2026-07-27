// iCal feed → blocks sync (parser lives in ical-parse.ts).
import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { expandEvents, parseIcs, type Occurrence } from "@/lib/ical-parse";
import { createServiceClient } from "@/lib/supabase/server";
import { addDays, todayYmd } from "@/lib/time";

export const SYNC_WINDOW_DAYS = 56; // matches the plan-generation horizon

/* ---------------- SSRF guard ----------------
 * Feed URLs are typed in by workers and fetched server-side — never let one point
 * at loopback/private/metadata addresses. https only, every DNS answer checked,
 * redirects re-validated hop by hop.
 * ponytail: resolve-then-fetch has a DNS-rebinding TOCTOU window; pinning the
 * resolved IP into the request is the upgrade if this ever guards real secrets. */

function isPrivateAddr(addr: string): boolean {
  let a = addr.toLowerCase();
  if (a.startsWith("::ffff:")) a = a.slice(7); // IPv6-mapped IPv4
  if (a.includes(".")) {
    const [o1, o2] = a.split(".").map(Number);
    return (
      o1 === 0 || o1 === 127 || o1 === 10 || (o1 === 172 && o2 >= 16 && o2 <= 31) || (o1 === 192 && o2 === 168) || (o1 === 169 && o2 === 254)
    );
  }
  return a === "::1" || a === "::" || a.startsWith("fe8") || a.startsWith("fe9") || a.startsWith("fea") || a.startsWith("feb") || a.startsWith("fc") || a.startsWith("fd");
}

async function assertPublicHttps(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("Calendar links must start with https://");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addrs.some((a) => isPrivateAddr(a.address))) throw new Error("That link points somewhere private — use the public iCal address.");
  return url;
}

/** fetch() with the guard applied to the URL and to every redirect hop. */
async function fetchPublic(raw: string): Promise<Response> {
  let url = await assertPublicHttps(raw);
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { accept: "text/calendar" },
      redirect: "manual",
    });
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) return res;
    url = await assertPublicHttps(new URL(location, url).toString());
  }
  throw new Error("Too many redirects.");
}



/**
 * Mirror an employee's iCal feed into their blocks for the next 8 weeks.
 * Upsert-then-prune so existing blocks never vanish mid-booking.
 */
export async function syncEmployeeCalendar(employeeId: string): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const db = createServiceClient();
  const { data: emp } = await db.from("employees").select("id,ical_url").eq("id", employeeId).single();
  if (!emp) return { ok: false, error: "Employee not found." };

  const from = todayYmd();
  const to = addDays(from, SYNC_WINDOW_DAYS);

  let occurrences: Occurrence[] = [];
  if (emp.ical_url) {
    let text: string;
    try {
      const res = await fetchPublic(emp.ical_url);
      if (!res.ok) return { ok: false, error: `Calendar feed returned ${res.status}.` };
      text = await res.text();
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error && e.message.includes("private") ? e.message : "Couldn't reach the calendar feed — check the link.",
      };
    }
    if (!text.includes("BEGIN:VCALENDAR")) return { ok: false, error: "That link isn't an iCal feed (.ics)." };
    occurrences = expandEvents(parseIcs(text), from, to);
  }

  // Dedupe to the unique key (employee, uid, date) — overrides can double up a day.
  const byKey = new Map(occurrences.map((o) => [`${o.uid}|${o.date}`, o]));
  const rows = [...byKey.values()].map((o) => ({
    employee_id: employeeId,
    date: o.date,
    start_min: o.startMin,
    end_min: o.endMin,
    reason: o.summary || "Other job",
    source: "ical",
    ical_uid: o.uid,
  }));

  if (rows.length) {
    const { error } = await db.from("blocks").upsert(rows, { onConflict: "employee_id,ical_uid,date" });
    if (error) return { ok: false, error: error.message };
  }
  // Prune synced blocks in the window that no longer exist on the calendar.
  const { data: existing } = await db
    .from("blocks")
    .select("id,ical_uid,date")
    .eq("employee_id", employeeId)
    .eq("source", "ical")
    .gte("date", from)
    .lt("date", to);
  const stale = (existing ?? []).filter((b) => !byKey.has(`${b.ical_uid}|${b.date}`)).map((b) => b.id);
  if (stale.length) await db.from("blocks").delete().in("id", stale);

  await db.from("employees").update({ ical_synced_at: new Date().toISOString() }).eq("id", employeeId);
  return { ok: true, count: rows.length };
}

/** Sync every active employee with a feed; used by the cron + stale refresh. */
export async function syncAllCalendars(): Promise<void> {
  const db = createServiceClient();
  const { data } = await db.from("employees").select("id").eq("active", true).not("ical_url", "is", null);
  for (const e of data ?? []) {
    const res = await syncEmployeeCalendar(e.id);
    if (!res.ok) console.error(`ical sync ${e.id}:`, res.error);
  }
}
