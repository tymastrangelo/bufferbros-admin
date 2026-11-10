"use server";
// activity: owner-only — returns early for anyone but the owner (texts sync from Tyler's own Mac).

import { revalidatePath } from "next/cache";
import { getRole, ownerOnly } from "@/lib/auth";
import { logOutreach } from "@/lib/actions/relations";
import { createClient } from "@/lib/supabase/server";
import { todayYmd } from "@/lib/time";
import type { HelpResult } from "@/lib/types";
import type { ActionResult } from "./appointments";

/**
 * "Handle an issue" on a client's profile: queue a help request for the listener on Tyler's Mac,
 * which syncs texts, then drafts the reply in his voice from the client's profile, visits, plan,
 * balance and thread (scripts/client-texts/help.mjs). The profile shows it live when it lands.
 */
export async function requestClientHelp(customerId: string, ask: string): Promise<ActionResult> {
  const denied = await ownerOnly("draft client replies");
  if (denied) return denied;
  const note = ask.trim();
  if (!note) return { ok: false, error: "Say what's going on first, like \"moving her Thursday to Friday 10am, Gabe's sick\"." };
  const db = await createClient();
  const { data, error } = await db.from("text_sync_runs").insert({ source: "button", customer_id: customerId, ask: note.slice(0, 1000) }).select("id").single();
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/customers/${customerId}`);
  return { ok: true, id: data.id };
}

/** The make-good from a help draft: a ledger discount (lowers what they owe, no revenue or
 *  payout booked) for the amount the Mac set from settings.make_good_credit. Once per draft. */
export async function applyMakeGood(runId: string): Promise<ActionResult> {
  const denied = await ownerOnly("give credits");
  if (denied) return denied;
  const db = await createClient();
  const { data: run, error } = await db.from("text_sync_runs").select("customer_id,ask,result").eq("id", runId).single();
  if (error || !run?.customer_id || !run.result) return { ok: false, error: error?.message ?? "That draft is gone. Draft it again." };
  const result = run.result as HelpResult;
  if (!(result.credit > 0)) return { ok: false, error: "This draft has no credit to give." };
  if (result.credit_applied_at) return { ok: false, error: "Credit already added." };
  const { error: insErr } = await db.from("ledger_entries").insert({
    customer_id: run.customer_id,
    kind: "discount",
    amount: result.credit,
    occurred_on: todayYmd(),
    memo: `Make-good: ${(run.ask ?? "on us").slice(0, 120)}`,
    collected_by: "owner",
  });
  if (insErr) return { ok: false, error: insErr.message };
  await db.from("text_sync_runs").update({ result: { ...result, credit_applied_at: new Date().toISOString() } }).eq("id", runId);
  revalidatePath(`/customers/${run.customer_id}`);
  return { ok: true, id: runId };
}

/**
 * "Sync texts now": queue a run for the listener on Tyler's Mac (scripts/client-texts/run.mjs
 * --listen), which picks it up via Realtime within seconds. Reuses a recent pending/running run
 * instead of stacking duplicates.
 */
export async function requestTextSync(): Promise<ActionResult> {
  if ((await getRole()) !== "owner") return { ok: false, error: "Only the owner can sync texts." };
  const db = await createClient();
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data: open } = await db
    .from("text_sync_runs")
    .select("id")
    .is("customer_id", null) // a client help request isn't a full sync
    .in("status", ["pending", "running"])
    .gte("requested_at", since)
    .limit(1);
  if (open?.length) return { ok: true, id: open[0].id };
  const { data, error } = await db.from("text_sync_runs").insert({ source: "button" }).select("id").single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/", "layout");
  return { ok: true, id: data.id };
}

/**
 * "Mark as sent" on a drafted text: logs the touch the way the Relations card would (a review
 * ask, or a follow-up that resets "last contacted") and clears the draft until the next card.
 */
export async function markSuggestionSent(customerId: string, goal: "reply" | "rebook" | "review" | "check_in" | "call"): Promise<ActionResult> {
  if ((await getRole()) !== "owner") return { ok: false, error: "Only the owner can do this." };
  const logged = await logOutreach({ customerId, outcome: goal === "review" ? "asked_review" : "follow_up" });
  if (!logged.ok) return logged;
  const db = await createClient();
  // They've been asked now: close any scheduled review reminder so it doesn't ask twice.
  if (goal === "review") {
    await db.from("reminders").update({ done_at: new Date().toISOString() }).eq("customer_id", customerId).is("done_at", null).like("body", "%g.page/r/%");
  }
  const { error } = await db.from("customer_insights").update({ suggestion_done_at: new Date().toISOString() }).eq("customer_id", customerId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/", "layout");
  return { ok: true, id: customerId };
}
