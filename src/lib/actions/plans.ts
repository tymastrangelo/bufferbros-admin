"use server";

import { revalidatePath } from "next/cache";
import { generateOccurrences, type GenerateResult } from "@/lib/occurrences";
import { createClient } from "@/lib/supabase/server";
import { diffDays, todayYmd } from "@/lib/time";
import type { PlanCadence, PlanStatus } from "@/lib/types";
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
    const { error: cancelErr } = await db
      .from("appointments")
      .update({ status: "cancelled" })
      .eq("plan_id", id)
      .eq("source", "recurring")
      .eq("status", "scheduled")
      .gt("date", todayYmd());
    if (cancelErr) return { ok: false, error: cancelErr.message };
  }
  refresh();
  return { ok: true, id };
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
