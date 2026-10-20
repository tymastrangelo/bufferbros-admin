// Runnable check for the proactive-ask selection: `node scripts/client-texts/summarize.check.mjs`
// Pins when a client with no new texts still gets a drafted review or rebook text.
import assert from "node:assert";
import { proactiveGoal } from "./summarize.mjs";

const T = "2026-10-20";
const base = { archived: false, outreach_status: "active", resume_on: null, last_contacted_on: null, review_asked_on: null, review_left_on: null };
const g = (c, o) => proactiveGoal({ ...base, ...c }, { today: T, hasNextVisit: false, lastDetail: "2026-08-01", ...o });

// Review: detailed, never reviewed, never asked. Wins over rebook so the one-time ask goes first.
assert.equal(g({}), "review");
// Review suppressed once they've left one; falls through to rebook.
assert.equal(g({ review_left_on: "2026-07-01" }), "rebook");
// Asked recently (<30d) and already booked: nothing to send.
assert.equal(g({ review_asked_on: "2026-10-10" }, { hasNextVisit: true }), null);
// Asked over a month ago: a gentle re-ask is allowed (rebook off here via a booking).
assert.equal(g({ review_asked_on: "2026-09-01" }, { hasNextVisit: true }), "review");

// Rebook needs: no booking, active, a past detail >=30d, not contacted in the last 30d.
assert.equal(g({ review_left_on: "2026-07-01" }), "rebook");
assert.equal(g({ review_left_on: "2026-07-01" }, { hasNextVisit: true }), null); // booked
assert.equal(g({ review_left_on: "2026-07-01", last_contacted_on: "2026-10-15" }), null); // texted 5d ago
assert.equal(g({ review_left_on: "2026-07-01" }, { lastDetail: "2026-10-10" }), null); // detailed 10d ago, too soon
assert.equal(g({ review_left_on: "2026-07-01", last_contacted_on: "2026-08-01" }, { lastDetail: null }), "rebook"); // never detailed but texted long ago, gone quiet
assert.equal(g({ review_left_on: "2026-07-01", resume_on: "2026-12-01" }), null); // snoozed until December

// Seasonal/snoozed: wait for their date (even if otherwise review-due), then surface as a check-in.
assert.equal(g({ resume_on: "2026-11-01" }), null); // snoozed until Nov, nothing goes out
assert.equal(g({ review_left_on: "2026-07-01", outreach_status: "seasonal", resume_on: "2026-10-01" }), "check_in"); // date arrived

// Never-detailed and do-not-contact are always out.
assert.equal(g({}, { lastDetail: null }), null);
assert.equal(g({ outreach_status: "do_not_contact" }), null);
assert.equal(g({ archived: true }), null);

console.log("summarize.check.mjs ok");
