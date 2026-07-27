// Runnable check for plan-slot projection: `npx tsx src/lib/plan-projection.check.ts`
// Must stay in lockstep with plan_projection_busy (migration 0017) and generateOccurrences.
import assert from "node:assert/strict";
import { projectPlanDates, stepDays } from "./plan-projection";

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

// Fresh plan: anchors at max(starts_on, today) advanced to the preferred weekday.
assert.deepEqual(
  projectPlanDates({ ...biweekly, preferred_dow: 5 }, [], TODAY, TODAY, "2026-09-01"),
  ["2026-07-31", "2026-08-14", "2026-08-28"]
);

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
