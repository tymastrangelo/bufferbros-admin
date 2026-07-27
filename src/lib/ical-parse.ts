// iCal parsing for the feed → blocks sync (see ical.ts). An employee pastes their Google Calendar "secret address
// in iCal format" (Sling shifts land there); we mirror upcoming events into the
// blocks table so their other-job time is unbookable automatically.
//
// Parser scope (ponytail): single events, all-day events, and simple RRULEs
// (DAILY/WEEKLY with INTERVAL/BYDAY/UNTIL/COUNT) within the sync window, plus
// EXDATE/RECURRENCE-ID overrides and STATUS:CANCELLED. That covers what Google
// exports for a shift calendar; exotic recurrences (monthly-by-position, etc.)
// are skipped — add expansion rules if a feed ever needs them.
// Pure parsing + expansion — no server imports, so `npx tsx src/lib/ical.check.ts` runs it.
import { addDays, TZ } from "./time";

interface IcsEvent {
  uid: string;
  summary: string;
  start: IcsTime;
  end: IcsTime | null;
  rrule: string | null;
  exdates: Set<string>; // local ymd of excluded occurrences
  recurrenceId: string | null; // local ymd — this VEVENT replaces that occurrence
  cancelled: boolean;
}

interface IcsTime {
  ymd: string; // in business TZ
  min: number; // minutes from midnight in business TZ
  allDay: boolean;
}

export interface Occurrence {
  uid: string;
  date: string;
  startMin: number;
  endMin: number;
  summary: string;
}

/* ---------------- datetime handling ---------------- */

const partsInTz = (d: Date, tz: string) => {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)!.value;
  return { ymd: `${get("year")}-${get("month")}-${get("day")}`, min: Number(get("hour")) * 60 + Number(get("minute")) };
};

/** Epoch of naive wall-clock parts in a named zone (two-pass offset guess — DST-safe). */
function zonedEpoch(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  let ts = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 2; i++) {
    const p = partsInTz(new Date(ts), tz);
    const [py, pm, pd] = p.ymd.split("-").map(Number);
    const diff = Date.UTC(y, mo - 1, d, h, mi) - Date.UTC(py, pm - 1, pd, Math.floor(p.min / 60), p.min % 60);
    ts += diff;
    if (diff === 0) break;
  }
  return ts;
}

/** "20260801T090000[Z]" (+ optional TZID) → business-TZ date + minutes. */
function parseIcsTime(value: string, params: Record<string, string>): IcsTime | null {
  if (params.VALUE === "DATE" || /^\d{8}$/.test(value)) {
    const m = value.match(/^(\d{4})(\d{2})(\d{2})/);
    if (!m) return null;
    return { ymd: `${m[1]}-${m[2]}-${m[3]}`, min: 0, allDay: true };
  }
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!m) return null;
  const [y, mo, d, h, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])];
  const tz = m[7] ? "UTC" : params.TZID || TZ;
  const epoch = zonedEpoch(y, mo, d, h, mi, tz);
  const local = partsInTz(new Date(epoch), TZ);
  return { ymd: local.ymd, min: local.min, allDay: false };
}

/* ---------------- parsing ---------------- */

export function parseIcs(text: string): IcsEvent[] {
  // Unfold: CRLF followed by a space/tab continues the previous line.
  const lines = text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const events: IcsEvent[] = [];
  let cur: Partial<IcsEvent> | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      cur = { exdates: new Set(), cancelled: false, rrule: null, recurrenceId: null, end: null, summary: "" };
      continue;
    }
    if (line === "END:VEVENT") {
      if (cur?.uid && cur.start) events.push(cur as IcsEvent);
      cur = null;
      continue;
    }
    if (!cur) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const [head, value] = [line.slice(0, idx), line.slice(idx + 1)];
    const [name, ...paramParts] = head.split(";");
    const params = Object.fromEntries(paramParts.map((p) => p.split("=") as [string, string]));

    switch (name) {
      case "UID":
        cur.uid = value;
        break;
      case "SUMMARY":
        cur.summary = value.replace(/\\([,;nN])/g, (_, c) => (c === "," || c === ";" ? c : " "));
        break;
      case "DTSTART":
        cur.start = parseIcsTime(value, params) ?? undefined;
        break;
      case "DTEND":
        cur.end = parseIcsTime(value, params);
        break;
      case "RRULE":
        cur.rrule = value;
        break;
      case "EXDATE":
        for (const v of value.split(",")) {
          const t = parseIcsTime(v.trim(), params);
          if (t) cur.exdates!.add(t.ymd);
        }
        break;
      case "RECURRENCE-ID": {
        const t = parseIcsTime(value, params);
        cur.recurrenceId = t?.ymd ?? null;
        break;
      }
      case "STATUS":
        cur.cancelled = value === "CANCELLED";
        break;
    }
  }
  return events;
}

/* ---------------- expansion ---------------- */

const DOW = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const dowOf = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay(); // UTC-noon trick, same as time.ts

/** Expand events into per-day occurrences inside [from, to) in business time. */
export function expandEvents(events: IcsEvent[], from: string, to: string): Occurrence[] {
  const out: Occurrence[] = [];
  // A VEVENT with RECURRENCE-ID overrides that date of its master series.
  const overridden = new Set(events.filter((e) => e.recurrenceId).map((e) => `${e.uid}|${e.recurrenceId}`));

  const push = (e: IcsEvent, startYmd: string) => {
    if (e.start.allDay) {
      // DTEND for all-day is exclusive; a missing one means a single day.
      const endYmd = e.end?.ymd ?? addDays(startYmd, 1);
      for (let d = startYmd; d < endYmd; d = addDays(d, 1)) {
        if (d >= from && d < to) out.push({ uid: e.uid, date: d, startMin: 0, endMin: 1440, summary: e.summary });
      }
      return;
    }
    // Timed event: same-day duration from the original start/end pair, split at midnight.
    const durMin = e.end
      ? Math.max((Date.parse(`${e.end.ymd}T00:00Z`) - Date.parse(`${e.start.ymd}T00:00Z`)) / 60000 + e.end.min - e.start.min, 0)
      : 60;
    let d = startYmd;
    let startMin = e.start.min;
    let remaining = durMin;
    while (remaining > 0) {
      const chunk = Math.min(remaining, 1440 - startMin);
      if (chunk > 0 && d >= from && d < to) {
        out.push({ uid: e.uid, date: d, startMin, endMin: startMin + chunk, summary: e.summary });
      }
      remaining -= chunk;
      d = addDays(d, 1);
      startMin = 0;
    }
  };

  for (const e of events) {
    if (e.cancelled) continue;
    if (!e.rrule) {
      if (e.recurrenceId || !overridden.has(`${e.uid}|${e.start.ymd}`)) push(e, e.start.ymd);
      continue;
    }
    const rule = Object.fromEntries(e.rrule.split(";").map((p) => p.split("=") as [string, string]));
    if (rule.FREQ !== "DAILY" && rule.FREQ !== "WEEKLY") continue; // unsupported recurrence — skip
    const interval = Math.max(Number(rule.INTERVAL) || 1, 1);
    const until = rule.UNTIL ? parseIcsTime(rule.UNTIL, {})?.ymd ?? null : null;
    const byday = rule.BYDAY ? rule.BYDAY.split(",").map((s) => DOW.indexOf(s.slice(-2))) : null;
    let count = rule.COUNT ? Number(rule.COUNT) : Infinity;

    // Walk day by day from the series start — the window is 8 weeks, so this stays tiny.
    for (let d = e.start.ymd, i = 0; d < to && count > 0 && i < 1000; d = addDays(d, 1), i++) {
      if (until && d > until) break;
      const daysFromStart = Math.round((Date.parse(`${d}T00:00Z`) - Date.parse(`${e.start.ymd}T00:00Z`)) / 86400000);
      const onCadence =
        rule.FREQ === "DAILY"
          ? daysFromStart % interval === 0
          : Math.floor(daysFromStart / 7) % interval === 0 && (byday ? byday.includes(dowOf(d)) : dowOf(d) === dowOf(e.start.ymd));
      if (!onCadence) continue;
      count--;
      if (e.exdates.has(d) || overridden.has(`${e.uid}|${d}`)) continue;
      push(e, d);
    }
  }
  return out;
}
