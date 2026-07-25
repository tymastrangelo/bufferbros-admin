"use server";

// Manual reminders ("call Katy in November"). The morning-digest cron pushes
// them to Tyler's phone on the due date; they stay on Today until marked done.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./appointments";

const refresh = () => revalidatePath("/", "layout");

export interface ReminderFields {
  dueOn: string;
  title: string;
  body?: string | null;
  customerId?: string | null;
  vehicleIds?: string[];
}

export async function createReminder(fields: ReminderFields): Promise<ActionResult> {
  if (!fields.title.trim()) return { ok: false, error: "Give the reminder a title." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.dueOn)) return { ok: false, error: "Pick a date." };
  const db = await createClient();
  const { data, error } = await db
    .from("reminders")
    .insert({
      due_on: fields.dueOn,
      title: fields.title.trim(),
      body: fields.body?.trim() || null,
      customer_id: fields.customerId || null,
      vehicle_ids: fields.vehicleIds ?? [],
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, id: data.id };
}

export async function completeReminder(id: string): Promise<ActionResult> {
  const db = await createClient();
  const { error } = await db.from("reminders").update({ done_at: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, id };
}

export async function deleteReminder(id: string): Promise<ActionResult> {
  const db = await createClient();
  const { error } = await db.from("reminders").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, id };
}
