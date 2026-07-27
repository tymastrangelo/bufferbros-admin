// Runnable check for the outreach-due rules: `npx tsx src/lib/outreach.check.ts`
import assert from "node:assert/strict";
import { computeOutreachDue, computeReviewAsks, daysBetween, type OutreachCustomer } from "./outreach";

const today = "2026-07-27";
const cust = (o: Partial<OutreachCustomer> & { id: string }): OutreachCustomer => ({
  name: o.id,
  phone: null,
  email: null,
  archived: false,
  outreach_status: "active",
  resume_on: null,
  last_contacted_on: null,
  review_asked_on: null,
  review_left_on: null,
  ...o,
});

assert.equal(daysBetween("2026-07-25", today), 2);

const due = computeOutreachDue({
  customers: [
    cust({ id: "stale" }), //           last detail 90d ago -> due
    cust({ id: "fresh" }), //           detailed 10d ago -> not due
    cust({ id: "touched", last_contacted_on: "2026-07-25" }), // old detail but texted 2d ago -> not due
    cust({ id: "booked" }), //          stale but has an upcoming visit -> not due
    cust({ id: "seasonal-wait", outreach_status: "seasonal", resume_on: "2026-11-01" }),
    cust({ id: "seasonal-now", outreach_status: "seasonal", resume_on: "2026-07-20" }), // date arrived -> due
    cust({ id: "declined", outreach_status: "declined" }), //   no date -> never surfaces
    cust({ id: "dnc", outreach_status: "do_not_contact", last_contacted_on: "2026-01-01" }),
    cust({ id: "never" }), //           no detail, no touch -> stays out (import flood guard)
    cust({ id: "snoozed", resume_on: "2026-08-15" }), //        active but snoozed -> waits
  ],
  lastDetail: new Map([
    ["stale", "2026-04-28"],
    ["fresh", "2026-07-17"],
    ["touched", "2026-03-01"],
    ["booked", "2026-03-01"],
  ]),
  nextVisit: new Map([["booked", "2026-08-01"]]),
  today,
  afterDays: 60,
});
assert.deepEqual(due.map((d) => d.id), ["stale", "seasonal-now"]);
assert.equal(due[0].reason, "overdue");
assert.equal(due[0].days, 90);
assert.equal(due[1].reason, "resume");

// touched: last_contacted_on beats the old detail date
assert.equal(
  computeOutreachDue({
    customers: [cust({ id: "touched", last_contacted_on: "2026-07-25" })],
    lastDetail: new Map([["touched", "2026-03-01"]]),
    nextVisit: new Map(),
    today,
    afterDays: 60,
  }).length,
  0
);

const asks = computeReviewAsks({
  customers: [
    cust({ id: "candidate" }), //                                  detailed 5d ago, never asked -> ask
    cust({ id: "already-asked", review_asked_on: "2026-07-01" }),
    cust({ id: "already-left", review_left_on: "2026-06-01" }),
    cust({ id: "too-old" }), //                                    detail outside the window
  ],
  lastDetail: new Map([
    ["candidate", "2026-07-22"],
    ["already-asked", "2026-07-22"],
    ["already-left", "2026-07-22"],
    ["too-old", "2026-05-01"],
  ]),
  today,
  windowDays: 14,
});
assert.deepEqual(asks.map((a) => a.id), ["candidate"]);

console.log("outreach.check.ts: all assertions passed");
