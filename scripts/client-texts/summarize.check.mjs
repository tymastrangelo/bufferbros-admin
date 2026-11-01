// Runnable check for the proactive-ask selection: `node scripts/client-texts/summarize.check.mjs`
// Pins when a client with no new texts still gets a drafted review or rebook text.
import assert from "node:assert";
import { money, proactiveGoal, schedule } from "./summarize.mjs";

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
// A next-day review reminder already covers them (created on detail completion): don't also draft one.
assert.equal(g({}, { hasOpenReviewReminder: true, hasNextVisit: true }), null);

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

// Schedule block: booked visits read as weekday + time + who, a plan states its rhythm and the next
// date after what's booked (anchored to the start week — biweekly from Nov 10 → Nov 24 after Nov 10).
const workerName = new Map([["g", "Gabe"]]);
const plan = { id: "p", cadence: "biweekly", interval_days: null, status: "active", per_visit_price: 257, preferred_dow: 2, preferred_min: 585, duration_min: 330, employee_id: "g", starts_on: "2026-11-10", ends_on: null, billing_note: null };
const booked = { date: "2026-11-10", start_min: 585, duration_min: 330, status: "scheduled", service_name: "The Standard Detail", size_label: "SUV + Truck", price: 257, address: null, employee_id: "g", plan_id: "p" };
let sched = schedule({ today: "2026-11-01", appts: [booked], plans: [plan], workerName });
assert.match(sched, /booked: Tuesday, Nov 10 at 9:45 AM \(330 min, The Standard Detail for SUV \+ Truck, \$257, Gabe doing it, plan visit\)/);
assert.match(sched, /every 2 weeks on Tuesdays at 9:45 AM, \$257 per visit, Gabe does it/);
assert.match(sched, /next plan date is Tuesday, Nov 24/);
// Nothing materialized yet: the plan's first date comes from its start week, not from today.
sched = schedule({ today: "2026-11-01", appts: [], plans: [plan], workerName });
assert.match(sched, /^nothing booked on the calendar\. active plan/);
assert.match(sched, /next plan date is Tuesday, Nov 10/);
// Money: prepaid credit vs owed, and how they usually pay.
assert.match(money({ ledger: [{ kind: "payment", amount: 500, method: "zelle", occurred_on: "2026-10-01" }, { kind: "charge", amount: -257, method: null, occurred_on: "2026-10-05" }] }), /^\$243 credit on account \(prepaid\); last payment \$500 by zelle on 2026-10-01; usually pays by zelle$/);
assert.match(money({ ledger: [{ kind: "charge", amount: -60, method: null, occurred_on: "2026-10-05" }] }), /^owes \$60; no payments on record$/);
assert.equal(money({ ledger: [] }), "balance even; no payments on record");

console.log("summarize.check.mjs ok");
