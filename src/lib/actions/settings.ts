"use server";

import { revalidatePath } from "next/cache";
import { confirmedEmail, sendEmail } from "@/lib/email";
import { createClient } from "@/lib/supabase/server";
import { addDays, diffDays, todayYmd } from "@/lib/time";
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
  refresh();
  return { ok: true };
}

export async function saveSettings(entries: Record<string, string>): Promise<ActionResult> {
  const db = await createClient();
  const { error } = await db
    .from("settings")
    .upsert(Object.entries(entries).map(([key, value]) => ({ key, value })));
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

export async function saveServicePricing(
  rows: { service_id: string; size_id: string; price: number; minutes: number }[]
): Promise<ActionResult> {
  const db = await createClient();
  const { error } = await db.from("service_pricing").upsert(rows);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

export async function savePlanPricing(
  rows: { cadence: string; size_id: string; price: number }[]
): Promise<ActionResult> {
  const db = await createClient();
  const { error } = await db.from("plan_pricing").upsert(rows);
  if (error) return { ok: false, error: error.message };
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

  const rows = Array.from({ length: days }, (_, i) => ({
    date: addDays(from, i),
    start_min: startMin,
    end_min: endMin,
    reason: fields.reason?.trim() || null,
  }));
  const db = await createClient();
  const { error } = await db.from("blocks").insert(rows);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

export async function deleteBlock(id: string): Promise<ActionResult> {
  const db = await createClient();
  const { error } = await db.from("blocks").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

export async function sendTestEmail(): Promise<ActionResult> {
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
  if (newPassword.length < 8) return { ok: false, error: "Use at least 8 characters." };
  const db = await createClient();
  const { error } = await db.auth.updateUser({ password: newPassword });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
