// Crew helpers shared by the calendar lanes, the worker page and the slot engine's TS
// twin. `employees.hours` is per-weekday: absent/null = business hours, false = day off,
// [open, close] = that worker's own window (minutes from midnight). Keep in lockstep
// with emp_window_busy / crew_day_status in 0029_crew.sql.
import type { EmployeeHours, WeeklyHours } from "@/lib/types";

export type Hours = EmployeeHours | null;

/** Effective [open, close] for a worker on a weekday, or null for a day off. */
export function hoursFor(hours: Hours, weekday: number, business: Pick<WeeklyHours, "enabled" | "open_min" | "close_min"> | undefined): [number, number] | null {
  const own = hours?.[String(weekday)];
  if (own === false) return null;
  if (Array.isArray(own)) return [own[0], own[1]];
  return business?.enabled ? [business.open_min, business.close_min] : null;
}

/** Which calendar lanes a job belongs to: its assignees, or the owner's ("me") when it has none. */
export function lanesOf(assigneeIds: string[]): string[] {
  return assigneeIds.length ? assigneeIds : ["me"];
}

/** CSS color token for a worker's `color` (1–6). */
export const workerColor = (color: number) => `var(--color-worker-${Math.min(Math.max(color, 1), 6)})`;
export const workerWash = (color: number) => `var(--color-worker-${Math.min(Math.max(color, 1), 6)}-wash)`;
