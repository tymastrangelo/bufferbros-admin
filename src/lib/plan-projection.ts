// Pure projection of a plan's future visit dates — the TS mirror of
// plan_projection_busy (migrations 0017 + 0034) and generateOccurrences' stepping.
// Client-safe: string date math only.
import { addDays, weekdayOf } from "./time";
import type { Plan } from "./types";

export function stepDays(plan: Pick<Plan, "cadence" | "interval_days">): number {
  switch (plan.cadence) {
    case "weekly":
      return 7;
    case "biweekly":
      return 14;
    case "monthly":
      return 28; // ponytail: monthly = every 4 weeks so the weekday holds; calendar-month stepping if a customer ever needs it
    default:
      return plan.interval_days ?? 28;
  }
}

/** A plan visit that exists only as a projection — held on the calendar, not booked yet. */
export interface ProjectedVisit {
  plan_id: string;
  customer_name: string;
  date: string;
  start_min: number;
  duration_min: number;
  price: number;
}

/**
 * The first date a plan's visit chain continues from. With non-cancelled visits on file,
 * step from the last one (a moved visit moves the chain with it). With none, the chain is
 * anchored to starts_on advanced to the preferred weekday — so "every 2 weeks starting
 * Nov 10" lands on Nov 10, 24, … no matter when it's generated — then stepped up to today.
 * Shared by projectPlanDates and generateOccurrences; mirrored by plan_projection_busy (0034).
 */
export function firstPlanDate(
  plan: Pick<Plan, "cadence" | "interval_days" | "preferred_dow" | "starts_on">,
  activeDates: string[],
  today: string
): string {
  const step = stepDays(plan);
  if (activeDates.length) return addDays([...activeDates].sort()[activeDates.length - 1], step);
  let cursor = plan.starts_on;
  if (plan.preferred_dow != null) {
    while (weekdayOf(cursor) !== plan.preferred_dow) cursor = addDays(cursor, 1);
  }
  while (cursor < today) cursor = addDays(cursor, step);
  return cursor;
}

/**
 * Dates this plan would claim in [from, to), beyond what's already materialized.
 * Dates that have any appointment row (even cancelled) were handled by a human and are skipped.
 */
export function projectPlanDates(
  plan: Pick<Plan, "cadence" | "interval_days" | "preferred_dow" | "starts_on" | "ends_on">,
  appts: { date: string; status: string }[],
  today: string,
  from: string,
  to: string // exclusive
): string[] {
  const step = stepDays(plan);
  const handled = new Set(appts.map((a) => a.date));
  let cursor = firstPlanDate(
    plan,
    appts.filter((a) => a.status !== "cancelled").map((a) => a.date),
    today
  );

  const out: string[] = [];
  while (cursor < to && (!plan.ends_on || cursor <= plan.ends_on)) {
    if (cursor >= from && cursor >= today && !handled.has(cursor)) out.push(cursor);
    cursor = addDays(cursor, step);
  }
  return out;
}
