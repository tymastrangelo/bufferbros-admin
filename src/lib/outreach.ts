// Who's due for a reach-out — one pure function shared by the Today page and the
// morning-digest cron so the dashboard and the phone push can never disagree.

import type { OutreachStatus } from "./types";

export interface OutreachCustomer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  archived: boolean;
  outreach_status: OutreachStatus;
  resume_on: string | null;
  last_contacted_on: string | null;
  review_asked_on: string | null;
  review_left_on: string | null;
}

export interface OutreachDue {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  status: OutreachStatus;
  /** overdue = quiet too long; resume = their snooze/season date arrived. */
  reason: "overdue" | "resume";
  lastDetail: string | null;
  lastTouch: string | null;
  /** Days since we last did or said anything (or since resume_on for "resume"). */
  days: number;
}

export interface ReviewAsk {
  id: string;
  name: string;
  phone: string | null;
  lastDetail: string;
}

/** Whole days from `from` to `to` (YYYY-MM-DD strings, parsed UTC). */
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86400000);

export function computeOutreachDue(opts: {
  customers: OutreachCustomer[];
  /** customer_id -> date of most recent completed appointment */
  lastDetail: Map<string, string>;
  /** customer_id -> date of next scheduled appointment (>= today) */
  nextVisit: Map<string, string>;
  today: string;
  afterDays: number;
}): OutreachDue[] {
  const { customers, lastDetail, nextVisit, today, afterDays } = opts;
  const due: OutreachDue[] = [];
  for (const c of customers) {
    if (c.archived || c.outreach_status === "do_not_contact") continue;
    if (nextVisit.has(c.id)) continue; // already booked — nothing to chase
    const last = lastDetail.get(c.id) ?? null;
    const touch = c.last_contacted_on;
    const base = { id: c.id, name: c.name, phone: c.phone, email: c.email, status: c.outreach_status, lastDetail: last, lastTouch: touch };
    if (c.resume_on) {
      // Snoozed/seasonal/declined-with-a-date: hide until the date, then surface.
      if (c.resume_on <= today) due.push({ ...base, reason: "resume", days: daysBetween(c.resume_on, today) });
      continue;
    }
    if (c.outreach_status !== "active") continue; // seasonal/declined with no date wait for one
    // Active: due once the last detail *and* the last touch are both stale.
    // Never-detailed never-touched contacts stay out (imported address books would flood the list).
    const latest = [last, touch].filter(Boolean).sort().pop();
    if (!latest) continue;
    const days = daysBetween(latest, today);
    if (days >= afterDays) due.push({ ...base, reason: "overdue", days });
  }
  return due.sort((a, b) => b.days - a.days);
}

/** Recently detailed clients we've never asked for a Google review. */
export function computeReviewAsks(opts: {
  customers: OutreachCustomer[];
  lastDetail: Map<string, string>;
  today: string;
  windowDays: number;
}): ReviewAsk[] {
  const { customers, lastDetail, today, windowDays } = opts;
  const asks: ReviewAsk[] = [];
  for (const c of customers) {
    if (c.archived || c.outreach_status === "do_not_contact") continue;
    if (c.review_left_on || c.review_asked_on) continue;
    const last = lastDetail.get(c.id);
    if (!last || daysBetween(last, today) > windowDays) continue;
    asks.push({ id: c.id, name: c.name, phone: c.phone, lastDetail: last });
  }
  return asks.sort((a, b) => (a.lastDetail < b.lastDetail ? 1 : -1));
}
