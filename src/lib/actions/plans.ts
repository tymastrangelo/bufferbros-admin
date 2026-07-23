"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getRole } from "@/lib/auth";
import { visitsPerQuarter } from "@/lib/catalog";
import { syncAppointmentToGcal } from "@/lib/gcal";
import { notify } from "@/lib/notify";
import { generateOccurrences, type GenerateResult } from "@/lib/occurrences";
import { createClient } from "@/lib/supabase/server";
import { diffDays, todayYmd } from "@/lib/time";
import type { PaymentMethod, Plan, PlanCadence, PlanStatus } from "@/lib/types";
import type { ActionResult } from "./appointments";

const refresh = () => revalidatePath("/", "layout");

export interface PlanFields {
  customerId: string;
  vehicleId?: string | null;
  cadence: PlanCadence;
  intervalDays?: number | null;
  perVisitPrice: number;
  preferredDow?: number | null;
  preferredMin?: number | null;
  durationMin: number;
  address?: string | null;
  startsOn: string;
  endsOn?: string | null;
  billingNote?: string | null;
  notes?: string | null;
  emailConfirmations?: boolean;
}

function toRow(fields: PlanFields) {
  return {
    customer_id: fields.customerId,
    vehicle_id: fields.vehicleId || null,
    cadence: fields.cadence,
    interval_days: fields.cadence === "custom" ? fields.intervalDays ?? null : null,
    per_visit_price: fields.perVisitPrice,
    preferred_dow: fields.preferredDow ?? null,
    preferred_min: fields.preferredMin ?? null,
    duration_min: fields.durationMin,
    address: fields.address?.trim() || null,
    starts_on: fields.startsOn,
    ends_on: fields.endsOn || null,
    billing_note: fields.billingNote?.trim() || null,
    notes: fields.notes?.trim() || null,
    email_confirmations: fields.emailConfirmations ?? false,
  };
}

export async function createPlan(fields: PlanFields): Promise<ActionResult> {
  if (fields.cadence === "custom" && !fields.intervalDays) {
    return { ok: false, error: "Custom cadence needs an every-N-days interval." };
  }
  const db = await createClient();
  const { data, error } = await db.from("plans").insert(toRow(fields)).select("id").single();
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, id: data.id };
}

export async function updatePlan(
  id: string,
  fields: PlanFields,
  /** also push price/duration/time/address onto this plan's future scheduled visits */
  applyToScheduled = false
): Promise<ActionResult & { updatedVisits?: number }> {
  const db = await createClient();
  const { error } = await db.from("plans").update(toRow(fields)).eq("id", id);
  if (error) return { ok: false, error: error.message };

  let updatedVisits = 0;
  if (applyToScheduled) {
    const patch: Record<string, unknown> = {
      price: fields.perVisitPrice,
      duration_min: fields.durationMin,
    };
    if (fields.preferredMin != null) patch.start_min = fields.preferredMin;
    if (fields.address?.trim()) patch.address = fields.address.trim();

    const { data, error: applyErr } = await db
      .from("appointments")
      .update(patch)
      .eq("plan_id", id)
      .eq("status", "scheduled")
      .gte("date", todayYmd())
      .select("id");
    if (applyErr) return { ok: false, error: `Plan saved, but updating visits failed: ${applyErr.message}` };
    updatedVisits = data?.length ?? 0;
    const ids = (data ?? []).map((a) => a.id);
    after(() => Promise.all(ids.map(syncAppointmentToGcal)));
  }
  refresh();
  return { ok: true, id, updatedVisits };
}

/** Pause/resume/end. Pausing or ending cancels this plan's future generated visits. */
export async function setPlanStatus(id: string, status: PlanStatus): Promise<ActionResult> {
  const db = await createClient();
  const { error } = await db.from("plans").update({ status }).eq("id", id);
  if (error) return { ok: false, error: error.message };

  if (status !== "active") {
    // ponytail: cancels ALL future scheduled recurring visits for the plan — we can't
    // tell hand-tweaked ones apart; owners can re-book the rare exception.
    const { data: cancelled, error: cancelErr } = await db
      .from("appointments")
      .update({ status: "cancelled" })
      .eq("plan_id", id)
      .eq("source", "recurring")
      .eq("status", "scheduled")
      .gt("date", todayYmd())
      .select("id");
    if (cancelErr) return { ok: false, error: cancelErr.message };
    const ids = (cancelled ?? []).map((a) => a.id);
    after(() => Promise.all(ids.map(syncAppointmentToGcal)));
  }
  refresh();
  return { ok: true, id };
}

/**
 * Record an upfront block of plan visits paid in one go. Books the cash as a payment
 * (which mirrors into company capital via the ledger trigger) plus a discount credit,
 * so the customer's balance covers exactly `visits` future charges at full per-visit price.
 * The discount only kicks in at a quarterly block or bigger.
 */
export async function recordPlanPrepay(
  planId: string,
  input: { visits: number; method: PaymentMethod; occurredOn: string; memo?: string | null }
): Promise<ActionResult & { paid?: number; discount?: number }> {
  if (!Number.isInteger(input.visits) || input.visits < 1) return { ok: false, error: "Enter how many visits they're prepaying." };
  const db = await createClient();
  const { data: planData, error: planErr } = await db.from("plans").select("*, customers(name)").eq("id", planId).single();
  if (planErr || !planData) return { ok: false, error: "Plan not found." };
  const plan = planData as Plan & { customers: { name: string } | null };
  const perVisit = Number(plan.per_visit_price);
  if (perVisit <= 0) return { ok: false, error: "Set the plan's per-visit price first." };

  const { data: settingRow } = await db.from("settings").select("value").eq("key", "prepay_discount_pct").single();
  const pct = Number(settingRow?.value) || 5;
  const minVisits = visitsPerQuarter(plan.cadence, plan.interval_days);
  const qualifies = input.visits >= minVisits;

  const full = perVisit * input.visits;
  const discount = qualifies ? Math.round(full * (pct / 100)) : 0;
  const paid = full - discount;

  const base = {
    customer_id: plan.customer_id,
    plan_id: planId,
    occurred_on: input.occurredOn,
  };
  const role = await getRole();
  const rows = [
    {
      ...base,
      kind: "payment",
      amount: paid,
      method: input.method,
      collected_by: role,
      memo: input.memo?.trim() || `Prepaid ${input.visits} visits upfront`,
    },
    ...(discount > 0
      ? [{ ...base, kind: "discount", amount: discount, memo: `Prepay discount (${pct}% · ${input.visits} visits)` }]
      : []),
  ];
  const { error } = await db.from("ledger_entries").insert(rows);
  if (error) return { ok: false, error: error.message };

  if (role === "washer") {
    const push = `${plan.customers?.name ?? "Customer"} · $${paid} for ${input.visits} visits${discount ? ` (saved $${discount})` : ""}`;
    after(() => notify("owner", "Plan prepay collected", push, `/plans/${planId}`));
  }
  refresh();
  return { ok: true, id: planId, paid, discount };
}

/** Materialize visits up to untilYmd (default: 8 weeks out, what the cron uses). */
export async function schedulePlanVisits(
  planId?: string,
  untilYmd?: string
): Promise<{ ok: true; result: GenerateResult } | { ok: false; error: string }> {
  if (untilYmd) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(untilYmd)) return { ok: false, error: "Pick a valid date." };
    const today = todayYmd();
    if (untilYmd <= today) return { ok: false, error: "Pick a date in the future." };
    if (diffDays(today, untilYmd) > 550) {
      return { ok: false, error: "That's more than 18 months out — schedule in smaller stretches." };
    }
  }
  const db = await createClient();
  try {
    const result = await generateOccurrences(db, planId, untilYmd);
    refresh();
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
