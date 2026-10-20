// Which drafted texts (written by the nightly Claude card, scripts/client-texts/summarize.mjs)
// still make sense today. Pure, shared by the Today page and the profile card; checked by
// suggestions.check.ts. Claude picks the goal and the best day; these rules hide a draft once
// the world moved on without waiting for the next card: they booked, they reviewed, Tyler
// already texted them, or it was marked sent.
import type { CustomerInsight } from "./types";

export type SuggestionGoal = "reply" | "rebook" | "review" | "check_in" | "call";

export const GOAL_LABEL: Record<SuggestionGoal, string> = {
  reply: "Reply",
  rebook: "Rebook",
  review: "Review",
  check_in: "Check in",
  call: "Call",
};
/** Most urgent first: an unanswered customer beats everything; a call means it needs a real talk. */
const GOAL_ORDER: SuggestionGoal[] = ["reply", "call", "rebook", "review", "check_in"];

export interface SuggestionCustomer {
  id: string;
  name: string;
  phone: string | null;
  archived: boolean;
  outreach_status: string;
  last_contacted_on: string | null;
  review_asked_on: string | null;
  review_left_on: string | null;
}

export interface Suggestion {
  customerId: string;
  name: string;
  phone: string | null;
  goal: SuggestionGoal;
  text: string;
  why: string | null;
  sendOn: string;
}

type Card = Pick<CustomerInsight, "customer_id" | "updated_at" | "suggestion_goal" | "suggestion_text" | "suggestion_why" | "suggest_on" | "suggestion_done_at">;

/** The card's calendar day in New York (cards are written at night/early morning ET). */
const cardDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

/** Is this card's draft still worth sending today? Returns it shaped for the UI, or null. */
export function liveSuggestion(card: Card, c: SuggestionCustomer | undefined, opts: { today: string; nextVisit: string | null }): Suggestion | null {
  const goal = card.suggestion_goal;
  if (!c || !goal || goal === "none" || !card.suggestion_text?.trim()) return null;
  if (card.suggestion_done_at) return null; // marked sent
  if (c.archived || c.outreach_status === "do_not_contact") return null;
  const sendOn = card.suggest_on ?? cardDay(card.updated_at);
  if (sendOn > opts.today) return null; // not time yet
  const written = cardDay(card.updated_at);
  // Tyler texted (or logged a touch) after the draft was written: the next card will catch up.
  if (c.last_contacted_on && c.last_contacted_on > written) return null;
  if ((goal === "rebook" || goal === "check_in") && opts.nextVisit) return null; // already booked
  if (goal === "review" && (c.review_left_on || (c.review_asked_on && c.review_asked_on > written))) return null;
  return { customerId: c.id, name: c.name, phone: c.phone, goal, text: card.suggestion_text.trim(), why: card.suggestion_why, sendOn };
}

export function liveSuggestions(
  cards: Card[],
  customers: SuggestionCustomer[],
  nextVisit: Map<string, string>,
  today: string
): Suggestion[] {
  const byId = new Map(customers.map((c) => [c.id, c]));
  return cards
    .map((card) => liveSuggestion(card, byId.get(card.customer_id), { today, nextVisit: nextVisit.get(card.customer_id) ?? null }))
    .filter((s): s is Suggestion => !!s)
    .sort((a, b) => GOAL_ORDER.indexOf(a.goal) - GOAL_ORDER.indexOf(b.goal) || a.sendOn.localeCompare(b.sendOn));
}
