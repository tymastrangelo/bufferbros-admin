"use server";

// Client relations: outreach touches, review tracking, referrals.
// logOutreach is the workhorse — one call writes the log row AND moves the
// customer's status/dates so the Today queue reacts immediately.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { todayYmd } from "@/lib/time";
import type { OutreachOutcome, OutreachStatus } from "@/lib/types";
import type { ActionResult } from "./appointments";

const refresh = () => revalidatePath("/", "layout");
const isYmd = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export interface OutreachFields {
  customerId: string;
  outcome: OutreachOutcome;
  /** Defaults to today. */
  occurredOn?: string | null;
  note?: string | null;
  /** follow_up / seasonal / declined: when to resurface them on Today. */
  resumeOn?: string | null;
}

export async function logOutreach(fields: OutreachFields): Promise<ActionResult> {
  const db = await createClient();
  const on = isYmd(fields.occurredOn) ? fields.occurredOn : todayYmd();
  const resumeOn = isYmd(fields.resumeOn) ? fields.resumeOn : null;

  const { error } = await db.from("outreach_log").insert({
    customer_id: fields.customerId,
    occurred_on: on,
    outcome: fields.outcome,
    note: fields.note?.trim() || null,
  });
  if (error) return { ok: false, error: error.message };

  // Everything except a bare note counts as "we talked" for staleness purposes.
  const patch: Record<string, unknown> = fields.outcome === "note" ? {} : { last_contacted_on: on };
  switch (fields.outcome) {
    case "booked":
      Object.assign(patch, { outreach_status: "active", resume_on: null });
      break;
    case "follow_up": // stays active, just snoozed until the date
      Object.assign(patch, { outreach_status: "active", resume_on: resumeOn });
      break;
    case "seasonal":
      Object.assign(patch, { outreach_status: "seasonal", resume_on: resumeOn });
      break;
    case "declined":
      Object.assign(patch, { outreach_status: "declined", resume_on: resumeOn });
      break;
    case "asked_review":
      patch.review_asked_on = on;
      break;
    case "left_review":
      patch.review_left_on = on;
      break;
  }
  if (Object.keys(patch).length) {
    const { error: err2 } = await db.from("customers").update(patch).eq("id", fields.customerId);
    if (err2) return { ok: false, error: err2.message };
  }
  refresh();
  return { ok: true, id: fields.customerId };
}

/** Direct status edit from the profile card (no log row — use logOutreach for touches). */
export async function setOutreachStatus(
  customerId: string,
  status: OutreachStatus,
  resumeOn?: string | null
): Promise<ActionResult> {
  const db = await createClient();
  const { error } = await db
    .from("customers")
    .update({ outreach_status: status, resume_on: isYmd(resumeOn) ? resumeOn : null })
    .eq("id", customerId);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, id: customerId };
}

export async function setReferredBy(customerId: string, referrerId: string | null): Promise<ActionResult> {
  if (referrerId === customerId) return { ok: false, error: "A customer can't refer themselves." };
  const db = await createClient();
  const { error } = await db.from("customers").update({ referred_by: referrerId }).eq("id", customerId);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, id: customerId };
}

/** One-shot: credits BOTH ledgers settings.referral_credit dollars. */
export async function giveReferralCredit(customerId: string): Promise<ActionResult> {
  const db = await createClient();
  const { data: cust, error } = await db
    .from("customers")
    .select("id,name,referred_by,referral_credited_at")
    .eq("id", customerId)
    .single();
  if (error || !cust) return { ok: false, error: error?.message ?? "Customer not found." };
  if (!cust.referred_by) return { ok: false, error: "Set who referred them first." };
  if (cust.referral_credited_at) return { ok: false, error: "Referral credit already given." };

  const [{ data: referrer }, { data: setting }] = await Promise.all([
    db.from("customers").select("id,name").eq("id", cust.referred_by).single(),
    db.from("settings").select("value").eq("key", "referral_credit").single(),
  ]);
  if (!referrer) return { ok: false, error: "Referrer not found." };
  const amount = Number(setting?.value ?? 10);
  if (!(amount > 0)) return { ok: false, error: "Set a referral credit amount in Settings first." };

  const today = todayYmd();
  const { error: insErr } = await db.from("ledger_entries").insert([
    {
      customer_id: cust.id,
      kind: "credit",
      amount,
      occurred_on: today,
      memo: `Referral credit — referred by ${referrer.name}`,
      collected_by: "owner",
    },
    {
      customer_id: referrer.id,
      kind: "credit",
      amount,
      occurred_on: today,
      memo: `Referral credit — sent us ${cust.name}`,
      collected_by: "owner",
    },
  ]);
  if (insErr) return { ok: false, error: insErr.message };

  const { error: markErr } = await db
    .from("customers")
    .update({ referral_credited_at: new Date().toISOString() })
    .eq("id", cust.id);
  if (markErr) return { ok: false, error: markErr.message };
  refresh();
  return { ok: true, id: cust.id };
}
