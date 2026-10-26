"use server";

import { revalidatePath } from "next/cache";
import { getRole } from "@/lib/auth";
import { confirmedEmail, sendEmail } from "@/lib/email";
import { logActivity } from "@/lib/notify";
import { createClient } from "@/lib/supabase/server";
import { addDays, diffDays, minToLabel, todayYmd } from "@/lib/time";
import type { WeeklyHours } from "@/lib/types";
import type { ActionResult } from "./appointments";

const refresh = () => revalidatePath("/", "layout");

export async function saveWeeklyHours(rows: WeeklyHours[]): Promise<ActionResult> {
  for (const r of rows) {
    if (r.enabled && r.open_min >= r.close_min) {
      return { ok: false, error: "Open time must be before close time." };
    }
  }
  const db = await createClient();
  const { error } = await db.from("weekly_hours").upsert(rows);
  if (error) return { ok: false, error: error.message };
  await logActivity("changed business hours", [], "/settings", { tags: ["gear"], priority: 4 });
  refresh();
  return { ok: true };
}

export async function saveSettings(entries: Record<string, string>): Promise<ActionResult> {
  const db = await createClient();
  const { error } = await db
    .from("settings")
    .upsert(Object.entries(entries).map(([key, value]) => ({ key, value })));
  if (error) return { ok: false, error: error.message };
  await logActivity("changed settings", Object.entries(entries).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`), "/settings", { tags: ["gear"], priority: 4 });
  refresh();
  return { ok: true };
}

export async function saveServicePricing(
  rows: { service_id: string; size_id: string; price: number; minutes: number }[]
): Promise<ActionResult> {
  const db = await createClient();
  const { error } = await db.from("service_pricing").upsert(rows);
  if (error) return { ok: false, error: error.message };
  await logActivity("changed service pricing", rows.map((r) => `${r.service_id} ${r.size_id}: $${r.price} · ${r.minutes} min`), "/settings", { tags: ["gear"], priority: 4 });
  refresh();
  return { ok: true };
}

export interface AddonInput {
  id: string;
  name: string;
  note: string | null;
  pricing: { size_id: string; price: number; minutes: number }[]; // one '*' row, or one row per size
}

/** Owner-only: the steps a base service includes — seeds every new job's checklist. */
export async function saveServiceChecklist(serviceId: "standard" | "ceramic-coating", steps: string[]): Promise<ActionResult> {
  if ((await getRole()) !== "owner") return { ok: false, error: "Owner only." };
  const clean = steps.map((x) => x.trim()).filter(Boolean).slice(0, 30);
  const db = await createClient();
  const { error } = await db.from("services").update({ checklist: clean }).eq("id", serviceId);
  if (error) return { ok: false, error: error.message };
  await logActivity(`changed what's included in ${serviceId === "standard" ? "the Standard Detail" : "Ceramic Coating"}`, [`${clean.length} steps`], "/settings", { tags: ["gear"], priority: 4 });
  refresh();
  return { ok: true };
}

export async function saveAddons(addons: AddonInput[]): Promise<ActionResult> {
  if (addons.some((a) => !a.name.trim())) return { ok: false, error: "Every add-on needs a name." };
  const ids = addons.map((a) => a.id);
  if (new Set(ids).size !== ids.length) return { ok: false, error: "Two add-ons ended up with the same id — rename one." };

  const db = await createClient();
  const { error } = await db.from("services").upsert(
    addons.map((a, i) => ({ id: a.id, kind: "addon", name: a.name.trim(), note: a.note?.trim() || null, active: true, sort: i + 1 }))
  );
  if (error) return { ok: false, error: error.message };

  // ponytail: delete-then-insert replaces each add-on's pricing wholesale (handles the
  // '*' ↔ per-size switch). Not transactional; fine for a single-admin settings page.
  const del = await db.from("service_pricing").delete().in("service_id", ids);
  if (del.error) return { ok: false, error: del.error.message };
  const ins = await db
    .from("service_pricing")
    .insert(addons.flatMap((a) => a.pricing.map((p) => ({ service_id: a.id, ...p }))));
  if (ins.error) return { ok: false, error: ins.error.message };
  await logActivity("changed add-ons", addons.map((a) => a.name.trim()), "/settings", { tags: ["gear"], priority: 4 });
  refresh();
  return { ok: true };
}

export async function deleteAddon(id: string): Promise<ActionResult> {
  const db = await createClient();
  // kind guard keeps 'standard' (the detail) undeletable; pricing rows cascade.
  const { error } = await db.from("services").delete().eq("id", id).eq("kind", "addon");
  if (error) return { ok: false, error: error.message };
  await logActivity(`deleted the “${id}” add-on`, [], "/settings", { tags: ["wastebasket"], priority: 4 });
  refresh();
  return { ok: true };
}

export async function savePlanPricing(
  rows: { cadence: string; size_id: string; price: number }[]
): Promise<ActionResult> {
  const db = await createClient();
  const { error } = await db.from("plan_pricing").upsert(rows);
  if (error) return { ok: false, error: error.message };
  await logActivity("changed plan pricing", rows.map((r) => `${r.cadence} ${r.size_id}: $${r.price}`), "/settings", { tags: ["gear"], priority: 4 });
  refresh();
  return { ok: true };
}

export interface BlockFields {
  dateFrom: string;
  dateTo?: string | null; // inclusive; defaults to dateFrom
  allDay: boolean;
  startMin?: number;
  endMin?: number;
  reason?: string | null;
}

export async function addBlock(fields: BlockFields): Promise<ActionResult> {
  const from = fields.dateFrom;
  const to = fields.dateTo || from;
  if (to < from) return { ok: false, error: "End date is before start date." };
  const days = diffDays(from, to) + 1;
  if (days > 92) return { ok: false, error: "That's more than 3 months of blocks — split it up." };

  const startMin = fields.allDay ? 0 : fields.startMin ?? 0;
  const endMin = fields.allDay ? 1440 : fields.endMin ?? 1440;
  if (startMin >= endMin) return { ok: false, error: "Start time must be before end time." };

  const db = await createClient();
  // A worker's manual block is tagged as theirs; the owner's stays business-wide.
  // Either way it blocks booking — one crew on the road.
  const {
    data: { user },
  } = await db.auth.getUser();
  const { data: mine } = user
    ? await db.from("employees").select("id").eq("user_id", user.id).maybeSingle()
    : { data: null };

  const rows = Array.from({ length: days }, (_, i) => ({
    date: addDays(from, i),
    start_min: startMin,
    end_min: endMin,
    reason: fields.reason?.trim() || null,
    employee_id: mine?.id ?? null,
  }));
  const { error } = await db.from("blocks").insert(rows);
  if (error) return { ok: false, error: error.message };
  await logActivity(
    "blocked off time",
    [
      days > 1 ? `${from} → ${to} (${days} days)` : from,
      fields.allDay ? "All day" : `${minToLabel(startMin)} – ${minToLabel(endMin)}`,
      fields.reason?.trim() && `Reason: ${fields.reason.trim()}`,
      "Bookings can't land in this window",
    ],
    `/calendar?view=week&d=${from}`,
    { tags: ["no_entry"] }
  );
  refresh();
  return { ok: true };
}

export async function deleteBlock(id: string): Promise<ActionResult> {
  const db = await createClient();
  const { data: b } = await db.from("blocks").select("*").eq("id", id).maybeSingle();
  const { error } = await db.from("blocks").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  if (b) {
    await logActivity(
      "removed blocked time",
      [`${b.date} · ${b.start_min === 0 && b.end_min === 1440 ? "all day" : `${minToLabel(b.start_min)} – ${minToLabel(b.end_min)}`}`, b.reason && `Was: ${b.reason}`],
      `/calendar?view=week&d=${b.date}`,
      { tags: ["no_entry"] }
    );
  }
  refresh();
  return { ok: true };
}

export async function sendTestEmail(): Promise<ActionResult> {
  // activity: sends only to the caller's own inbox
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user?.email) return { ok: false, error: "No email on your account." };
  const { subject, html } = confirmedEmail({
    name: "Test",
    when: `${todayYmd()} (test send)`,
    address: "123 Test Ln, Marco Island, FL",
    serviceName: "The Standard Detail",
    addons: [{ name: "Pet Hair Removal" }],
    price: 249,
  });
  const res = await sendEmail(user.email, `[Test] ${subject}`, html);
  if (!res.ok) return { ok: false, error: res.error ?? "Send failed." };
  return { ok: true };
}

export async function changePassword(newPassword: string): Promise<ActionResult> {
  // activity: personal account change
  if (newPassword.length < 8) return { ok: false, error: "Use at least 8 characters." };
  const db = await createClient();
  const { error } = await db.auth.updateUser({ password: newPassword });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
