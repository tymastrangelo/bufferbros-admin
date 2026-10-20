// Runnable check: `npx tsx src/lib/suggestions.check.ts`
import assert from "node:assert/strict";
import { liveSuggestion, liveSuggestions, type SuggestionCustomer } from "./suggestions";

const today = "2026-10-20";
const cust = (o: Partial<SuggestionCustomer> = {}): SuggestionCustomer => ({
  id: "c",
  name: "Chris Hennessey",
  phone: "+12395550100",
  archived: false,
  outreach_status: "active",
  last_contacted_on: "2026-10-01",
  review_asked_on: null,
  review_left_on: null,
  ...o,
});
const card = (o: Record<string, unknown> = {}) => ({
  customer_id: "c",
  updated_at: "2026-10-20T08:00:00Z", // Oct 20, 4am ET
  suggestion_goal: "rebook" as const,
  suggestion_text: "Hey Chris, want me to get you back on Tuesdays?",
  suggestion_why: "Two cancelled visits, nothing booked.",
  suggest_on: "2026-10-20",
  suggestion_done_at: null,
  ...o,
});
const live = (c: ReturnType<typeof card>, cu = cust(), nextVisit: string | null = null) => liveSuggestion(c as never, cu, { today, nextVisit });

assert.equal(live(card())?.goal, "rebook");
assert.equal(live(card({ suggestion_goal: "none" })), null);
assert.equal(live(card({ suggestion_text: "  " })), null);
assert.equal(live(card({ suggestion_done_at: "2026-10-20T15:00:00Z" })), null); // marked sent
assert.equal(live(card({ suggest_on: "2026-11-03" })), null); // not time yet
assert.equal(live(card(), cust({ outreach_status: "do_not_contact" })), null);
assert.equal(live(card(), cust({ last_contacted_on: "2026-10-21" })), null); // texted after the draft
assert.equal(live(card(), cust({ last_contacted_on: "2026-10-20" }))?.goal, "rebook"); // same day the card was written still counts
assert.equal(live(card(), cust(), "2026-10-27"), null); // already booked
assert.equal(live(card({ suggestion_goal: "reply" }), cust(), "2026-10-27")?.goal, "reply"); // a reply is owed even if booked
assert.equal(live(card({ suggestion_goal: "review" }), cust({ review_left_on: "2026-08-01" })), null);
assert.equal(live(card({ suggestion_goal: "review" }), cust({ review_asked_on: "2026-07-27" }))?.goal, "review"); // asked long ago: one more nudge is fine
assert.equal(live(card({ suggestion_goal: "review", updated_at: "2026-10-18T08:00:00Z", suggest_on: null }), cust({ review_asked_on: "2026-10-19" })), null);

// Ordering: replies first, then rebook, review, check-in; earlier send date first within a goal.
const list = liveSuggestions(
  [
    card({ customer_id: "a", suggestion_goal: "check_in" }),
    card({ customer_id: "b", suggestion_goal: "reply" }),
    card({ customer_id: "c", suggestion_goal: "review", suggest_on: "2026-10-18" }),
  ] as never,
  [cust({ id: "a" }), cust({ id: "b" }), cust({ id: "c" })],
  new Map(),
  today
);
assert.deepEqual(list.map((s) => s.customerId), ["b", "c", "a"]);

console.log("suggestions.check: ok");
