// All date/time logic lives here. Dates are YYYY-MM-DD strings + minutes-from-midnight
// ints in America/New_York wall-clock. Never do raw Date math on date strings —
// weekday/offset math uses the UTC-noon trick (noon UTC is the same calendar day
// in every US timezone, so DST can never shift the date).

export const TZ = "America/New_York";

const ymdFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const hmFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
});

/** Date at noon UTC for safe weekday/offset math on a YYYY-MM-DD string. */
export function atNoonUTC(ymd: string): Date {
  return new Date(`${ymd}T12:00:00Z`);
}

/** Today's date in America/New_York, as YYYY-MM-DD. */
export function todayYmd(): string {
  return ymdFmt.format(new Date());
}

/** Minutes since midnight, right now, in America/New_York. */
export function nowMinutes(): number {
  const [h, m] = hmFmt.format(new Date()).split(":").map(Number);
  return (h === 24 ? 0 : h) * 60 + m;
}

export function addDays(ymd: string, days: number): string {
  const d = atNoonUTC(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0=Sunday .. 6=Saturday */
export function weekdayOf(ymd: string): number {
  return atNoonUTC(ymd).getUTCDay();
}

export function diffDays(a: string, b: string): number {
  return Math.round((atNoonUTC(b).getTime() - atNoonUTC(a).getTime()) / 86400000);
}

/** 540 -> "9:00 AM" */
export function minToLabel(min: number): string {
  const h24 = Math.floor(min / 60) % 24;
  const m = min % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

/** "9:00 AM" / "09:00" / "9" -> minutes, or null */
export function labelToMin(label: string): number | null {
  const m = label.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const ap = m[3]?.toLowerCase();
  if (ap === "pm" && h !== 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** "2026-06-06" -> "Wednesday, June 6, 2026" (email format from the website) */
export function fmtDateLong(ymd: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(atNoonUTC(ymd));
}

/** "2026-06-06" -> "Wed, Jun 6" */
export function fmtDateShort(ymd: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(atNoonUTC(ymd));
}

/** "2026-06" -> "June 2026" */
export function fmtMonth(ym: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" }).format(
    atNoonUTC(`${ym}-01`)
  );
}

/** The exact string used in every email: "Wednesday, June 6, 2026 at 9:00 AM" */
export function whenLabel(ymd: string, startMin: number): string {
  return `${fmtDateLong(ymd)} at ${minToLabel(startMin)}`;
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** First day of the month grid (Sunday-start) for a YYYY-MM month. */
export function monthGridStart(ym: string): string {
  const first = `${ym}-01`;
  return addDays(first, -weekdayOf(first));
}

export function ymOf(ymd: string): string {
  return ymd.slice(0, 7);
}

export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}
