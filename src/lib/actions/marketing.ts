"use server";
// activity: Marketing is owner-only (RLS owner_only on campaigns/leads/tasks, page behind
// requireOwner), so a worker can never trigger these and logActivity would always no-op.

import { revalidatePath } from "next/cache";
import { normalizeEmail, normalizePhone, phoneDigits } from "@/lib/format";
import { isChannel, slugify } from "@/lib/marketing";
import { createClient } from "@/lib/supabase/server";
import { todayYmd } from "@/lib/time";
import type { CampaignStatus, ChannelId, LeadKind, LeadStatus, TaskPhase } from "@/lib/types";
import type { ActionResult } from "./appointments";

const refresh = () => revalidatePath("/", "layout");
const num = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.max(0, v));

// ── Campaigns ────────────────────────────────────────────────────────────────

export interface CampaignFields {
  name: string;
  channel: ChannelId;
  status: CampaignStatus;
  startOn?: string | null;
  endOn?: string | null;
  monthlyBudget?: number | null;
  targetCpa?: number | null;
  utmCampaign?: string | null;
  notes?: string | null;
}

export async function saveCampaign(fields: CampaignFields, id?: string | null): Promise<ActionResult> {
  if (!fields.name.trim()) return { ok: false, error: "Give the campaign a name." };
  if (!isChannel(fields.channel)) return { ok: false, error: "Pick a channel." };
  const db = await createClient({ realData: true });
  const row = {
    name: fields.name.trim(),
    channel: fields.channel,
    status: fields.status,
    start_on: fields.startOn || null,
    end_on: fields.endOn || null,
    monthly_budget: num(fields.monthlyBudget),
    target_cpa: num(fields.targetCpa),
    utm_campaign: slugify(fields.utmCampaign || fields.name) || null,
    notes: fields.notes?.trim() || null,
  };
  const res = id
    ? await db.from("marketing_campaigns").update(row).eq("id", id).select("id").single()
    : await db.from("marketing_campaigns").insert(row).select("id").single();
  if (res.error) {
    return { ok: false, error: res.error.code === "23505" ? `Another campaign already uses the tracking name “${row.utm_campaign}”. Pick a different one.` : res.error.message };
  }
  refresh();
  return { ok: true, id: res.data.id };
}

/** Its spend stays in Money as plain marketing expenses; leads and customers just lose the link. */
export async function deleteCampaign(id: string): Promise<ActionResult> {
  const db = await createClient({ realData: true });
  const { error } = await db.from("marketing_campaigns").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

/** Ad spend is a marketing expense tagged with its campaign, so it lands in Money too. */
export async function logAdSpend(fields: { campaignId: string | null; amount: number; occurredOn: string; memo: string }): Promise<ActionResult> {
  if (!(fields.amount > 0)) return { ok: false, error: "Enter an amount greater than zero." };
  const db = await createClient({ realData: true });
  const { error } = await db.from("expenses").insert({
    occurred_on: fields.occurredOn,
    category: "marketing",
    amount: Math.round(fields.amount * 100) / 100,
    memo: fields.memo.trim() || "Ad spend",
    campaign_id: fields.campaignId,
  });
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

/** What a new customer should cost; channels under it get a Scale call. */
export async function saveMarketingTarget(dollars: number): Promise<ActionResult> {
  if (!(dollars > 0)) return { ok: false, error: "Enter a target above $0." };
  const db = await createClient({ realData: true });
  const { error } = await db.from("settings").upsert({ key: "marketing_target_cpa", value: String(Math.round(dollars)) });
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

// ── Leads ────────────────────────────────────────────────────────────────────

export interface LeadFields {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  kind: LeadKind;
  channel?: ChannelId | null;
  campaignId?: string | null;
  estValue?: number | null;
  notes?: string | null;
}

export async function saveLead(fields: LeadFields, id?: string | null): Promise<ActionResult> {
  if (!fields.name?.trim() && !fields.phone?.trim() && !fields.email?.trim()) {
    return { ok: false, error: "Add a name, phone or email so you can follow up." };
  }
  const db = await createClient({ realData: true });
  const row = {
    name: fields.name?.trim() || null,
    phone: normalizePhone(fields.phone),
    email: normalizeEmail(fields.email),
    kind: fields.kind,
    channel: fields.channel && isChannel(fields.channel) ? fields.channel : null,
    campaign_id: fields.campaignId || null,
    est_value: num(fields.estValue),
    notes: fields.notes?.trim() || null,
  };
  const res = id
    ? await db.from("leads").update(row).eq("id", id).select("id").single()
    : await db.from("leads").insert(row).select("id").single();
  if (res.error) return { ok: false, error: res.error.message };
  refresh();
  return { ok: true, id: res.data.id };
}

/** Moving a lead past "new" stamps the first reply time (speed to lead), once. */
export async function setLeadStatus(id: string, status: LeadStatus, lostReason?: string | null): Promise<ActionResult> {
  const db = await createClient({ realData: true });
  const { data: before } = await db.from("leads").select("contacted_at").eq("id", id).maybeSingle();
  const { error } = await db
    .from("leads")
    .update({
      status,
      lost_reason: status === "lost" ? lostReason?.trim() || null : null,
      ...(status !== "new" && !before?.contacted_at && { contacted_at: new Date().toISOString() }),
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, id };
}

/**
 * Lead → customer: links an existing customer with the same phone or email, otherwise
 * creates one carrying the lead's channel + campaign as their acquisition source.
 * Returns the customer id so the UI can open their profile to book.
 */
export async function convertLead(id: string, channel: ChannelId | null, campaignId: string | null): Promise<ActionResult> {
  const db = await createClient({ realData: true });
  const { data: lead, error } = await db.from("leads").select("*").eq("id", id).single();
  if (error || !lead) return { ok: false, error: error?.message ?? "Lead not found." };
  if (lead.customer_id) return { ok: true, id: lead.customer_id };

  const digits = phoneDigits(lead.phone);
  const { data: existing } = await db.from("customers").select("id,phone,email,acquired_via");
  const match = (existing ?? []).find(
    (c: { phone: string | null; email: string | null }) =>
      (digits.length === 10 && phoneDigits(c.phone) === digits) || (lead.email && c.email?.toLowerCase() === lead.email)
  ) as { id: string; acquired_via: string | null } | undefined;

  let customerId = match?.id;
  if (!customerId) {
    const { data: created, error: cErr } = await db
      .from("customers")
      .insert({
        name: lead.name || lead.email || lead.phone || "New customer",
        phone: normalizePhone(lead.phone),
        email: normalizeEmail(lead.email),
        notes: lead.notes,
        source: "manual",
        acquired_via: channel,
        acquired_campaign_id: campaignId,
      })
      .select("id")
      .single();
    if (cErr) return { ok: false, error: cErr.message };
    customerId = created.id;
  } else if (!match?.acquired_via && channel) {
    await db.from("customers").update({ acquired_via: channel, acquired_campaign_id: campaignId }).eq("id", customerId);
  }

  const { error: lErr } = await db
    .from("leads")
    .update({ customer_id: customerId, status: "booked", contacted_at: lead.contacted_at ?? new Date().toISOString() })
    .eq("id", id);
  if (lErr) return { ok: false, error: lErr.message };
  refresh();
  return { ok: true, id: customerId };
}

export async function deleteLead(id: string): Promise<ActionResult> {
  const db = await createClient({ realData: true });
  const { error } = await db.from("leads").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

// ── Customer source ──────────────────────────────────────────────────────────

export async function setCustomerSource(customerId: string, channel: ChannelId | null, campaignId: string | null = null): Promise<ActionResult> {
  if (channel !== null && !isChannel(channel)) return { ok: false, error: "Unknown channel." };
  const db = await createClient({ realData: true });
  const { error } = await db
    .from("customers")
    .update({ acquired_via: channel, acquired_campaign_id: channel ? campaignId : null })
    .eq("id", customerId);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, id: customerId };
}

// ── Playbook ─────────────────────────────────────────────────────────────────

export async function setTaskDone(id: string, done: boolean): Promise<ActionResult> {
  const db = await createClient({ realData: true });
  const { error } = await db
    .from("marketing_tasks")
    .update({ done_on: done ? todayYmd() : null })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, id };
}

export interface TaskFields {
  title: string;
  detail?: string | null;
  phase: TaskPhase;
  channel?: ChannelId | null;
  dueOn?: string | null;
}

export async function saveTask(fields: TaskFields, id?: string | null): Promise<ActionResult> {
  if (!fields.title.trim()) return { ok: false, error: "Give the step a title." };
  const db = await createClient({ realData: true });
  const row = {
    title: fields.title.trim(),
    detail: fields.detail?.trim() || null,
    phase: fields.phase,
    channel: fields.channel && isChannel(fields.channel) ? fields.channel : null,
    due_on: fields.dueOn || null,
  };
  let res;
  if (id) res = await db.from("marketing_tasks").update(row).eq("id", id).select("id").single();
  else {
    // new steps go to the end of their phase
    const { data: last } = await db.from("marketing_tasks").select("sort").eq("phase", row.phase).order("sort", { ascending: false }).limit(1).maybeSingle();
    res = await db.from("marketing_tasks").insert({ ...row, sort: (last?.sort ?? 0) + 1 }).select("id").single();
  }
  if (res.error) return { ok: false, error: res.error.message };
  refresh();
  return { ok: true, id: res.data.id };
}

export async function deleteTask(id: string): Promise<ActionResult> {
  const db = await createClient({ realData: true });
  const { error } = await db.from("marketing_tasks").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}
