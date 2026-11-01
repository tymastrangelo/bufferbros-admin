// Runnable check for plan-slot projection: `npx tsx src/lib/plan-projection.check.ts`
// Must stay in lockstep with plan_projection_busy (migrations 0017 + 0034) and generateOccurrences.
import assert from "node:assert/strict";
import { firstPlanDate, projectPlanDates, stepDays } from "./plan-projection";

const TODAY = "2026-07-27"; // a Monday

const biweekly = {
  cadence: "biweekly" as const,
  interval_days: null,
  preferred_dow: null,
  starts_on: "2026-06-01",
  ends_on: null,
};

// Continues from the last non-cancelled visit in step increments.
assert.deepEqual(
  projectPlanDates(biweekly, [{ date: "2026-08-01", status: "scheduled" }], TODAY, "2026-08-01", "2026-09-13"),
  ["2026-08-15", "2026-08-29", "2026-09-12"]
);

// A handled date (even cancelled) is skipped, but stepping continues through it.
assert.deepEqual(
  projectPlanDates(
    biweekly,
    [
      { date: "2026-08-01", status: "scheduled" },
      { date: "2026-08-29", status: "cancelled" },
    ],
    TODAY,
    "2026-08-01",
    "2026-09-13"
  ),
  ["2026-08-15", "2026-09-12"]
);

// Fresh plan: anchored to starts_on advanced to the preferred weekday, stepped up to today —
// the start week sets the biweekly phase (2026-06-01 is a Monday → Fri 06-05, then every 14 days).
assert.deepEqual(
  projectPlanDates({ ...biweekly, preferred_dow: 5 }, [], TODAY, TODAY, "2026-09-01"),
  ["2026-07-31", "2026-08-14", "2026-08-28"]
);
assert.equal(firstPlanDate({ ...biweekly, preferred_dow: 5 }, [], TODAY), "2026-07-31");
// A future start week is honored exactly, even when today is in between phases.
assert.equal(firstPlanDate({ ...biweekly, starts_on: "2026-11-10", preferred_dow: 2 }, [], "2026-11-01"), "2026-11-10");
assert.deepEqual(
  projectPlanDates({ ...biweekly, starts_on: "2026-11-10", preferred_dow: 2 }, [], "2026-11-01", "2026-11-01", "2026-12-10"),
  ["2026-11-10", "2026-11-24", "2026-12-08"]
);
// All visits cancelled → the chain re-anchors to the start week, not to today (no phantom on the off week).
assert.deepEqual(
  projectPlanDates(
    { ...biweekly, starts_on: "2026-11-10", preferred_dow: 2 },
    [{ date: "2026-11-17", status: "cancelled" }],
    "2026-11-01",
    "2026-11-01",
    "2026-12-10"
  ),
  ["2026-11-10", "2026-11-24", "2026-12-08"]
);
// With a live visit, the chain follows it (a moved visit moves the phase).
assert.equal(firstPlanDate(biweekly, [{ date: "2026-08-01" }].map((a) => a.date), TODAY), "2026-08-15");

// ends_on caps the projection; range start crops the front.
assert.deepEqual(
  projectPlanDates({ ...biweekly, ends_on: "2026-08-20" }, [{ date: "2026-07-20", status: "completed" }], TODAY, "2026-08-01", "2026-12-31"),
  ["2026-08-03", "2026-08-17"]
);

// Cadence steps match generateOccurrences.
assert.equal(stepDays({ cadence: "weekly", interval_days: null }), 7);
assert.equal(stepDays({ cadence: "monthly", interval_days: null }), 28);
assert.equal(stepDays({ cadence: "custom", interval_days: 10 }), 10);

console.log("plan-projection.check ok");
