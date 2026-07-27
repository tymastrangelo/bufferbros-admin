// Pure projection of a plan's future visit dates — the TS mirror of
// plan_projection_busy (migration 0017) and generateOccurrences' stepping.
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
 * Dates this plan would claim in [from, to), beyond what's already materialized.
 * Continues from the last non-cancelled visit in step increments; with no visits yet,
 * starts at max(starts_on, today) advanced to the preferred weekday. Dates that have
 * any appointment row (even cancelled) were handled by a human and are skipped.
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
  const active = appts
    .filter((a) => a.status !== "cancelled")
    .map((a) => a.date)
    .sort();

  let cursor: string;
  if (active.length) {
    cursor = addDays(active[active.length - 1], step);
  } else {
    cursor = plan.starts_on > today ? plan.starts_on : today;
    if (plan.preferred_dow != null) {
      while (weekdayOf(cursor) !== plan.preferred_dow) cursor = addDays(cursor, 1);
    }
  }

  const out: string[] = [];
  while (cursor < to && (!plan.ends_on || cursor <= plan.ends_on)) {
    if (cursor >= from && cursor >= today && !handled.has(cursor)) out.push(cursor);
    cursor = addDays(cursor, step);
  }
  return out;
}
