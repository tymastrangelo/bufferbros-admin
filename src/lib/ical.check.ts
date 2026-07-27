// Runnable check for the iCal parser + expansion: `npx tsx src/lib/ical.check.ts`
import assert from "node:assert/strict";
import { expandEvents, parseIcs } from "./ical-parse";

const ICS = [
  "BEGIN:VCALENDAR",
  // Timed shift in Eastern time (what Sling→Google exports look like)
  "BEGIN:VEVENT",
  "UID:shift-1",
  "SUMMARY:Marriott shift",
  "DTSTART;TZID=America/New_York:20260801T090000",
  "DTEND;TZID=America/New_York:20260801T170000",
  "END:VEVENT",
  // UTC-stamped event: 18:00Z = 2:00pm EDT on Aug 1
  "BEGIN:VEVENT",
  "UID:utc-1",
  "SUMMARY:Meeting",
  "DTSTART:20260801T180000Z",
  "DTEND:20260801T190000Z",
  "END:VEVENT",
  // Two-day all-day event (DTEND exclusive)
  "BEGIN:VEVENT",
  "UID:vac-1",
  "SUMMARY:Vacation",
  "DTSTART;VALUE=DATE:20260810",
  "DTEND;VALUE=DATE:20260812",
  "END:VEVENT",
  // Weekly Mon/Wed recurrence with one excluded date
  "BEGIN:VEVENT",
  "UID:rec-1",
  "SUMMARY:Weekly shift",
  "DTSTART;TZID=America/New_York:20260803T100000",
  "DTEND;TZID=America/New_York:20260803T140000",
  "RRULE:FREQ=WEEKLY;BYDAY=MO,WE",
  "EXDATE;TZID=America/New_York:20260805T100000",
  "END:VEVENT",
  // Cancelled event: never blocks
  "BEGIN:VEVENT",
  "UID:dead-1",
  "SUMMARY:Cancelled thing",
  "DTSTART;TZID=America/New_York:20260801T120000",
  "STATUS:CANCELLED",
  "END:VEVENT",
].join("\r\n");

const events = parseIcs(ICS);
assert.equal(events.length, 5);

const occ = expandEvents(events, "2026-08-01", "2026-08-13");
const by = (uid: string) => occ.filter((o) => o.uid === uid);

// Timed shift lands as 9a–5p on its day.
assert.deepEqual(by("shift-1"), [{ uid: "shift-1", date: "2026-08-01", startMin: 540, endMin: 1020, summary: "Marriott shift" }]);
// UTC converts to Eastern wall-clock (EDT = UTC-4).
assert.deepEqual(by("utc-1")[0], { uid: "utc-1", date: "2026-08-01", startMin: 840, endMin: 900, summary: "Meeting" });
// All-day spans exactly its two days, full-day blocks.
assert.deepEqual(
  by("vac-1").map((o) => [o.date, o.startMin, o.endMin]),
  [
    ["2026-08-10", 0, 1440],
    ["2026-08-11", 0, 1440],
  ]
);
// Weekly Mon/Wed inside the window: Aug 3 (Mon), Aug 5 excluded, Aug 10, Aug 12.
assert.deepEqual(
  by("rec-1").map((o) => o.date),
  ["2026-08-03", "2026-08-10", "2026-08-12"]
);
// Cancelled events don't block.
assert.equal(by("dead-1").length, 0);

console.log("ical.check ok");
