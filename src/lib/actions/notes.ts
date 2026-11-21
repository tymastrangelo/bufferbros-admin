"use server";

// Crew notes on a client and/or one of their jobs (0042). Anyone on the crew adds;
// RLS lets you delete your own, the owner any.
import { revalidatePath } from "next/cache";
import { customerName, getActor, logActivity } from "@/lib/notify";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./appointments";

export async function addNote(input: { customerId: string | null; appointmentId: string | null; body: string }): Promise<ActionResult> {
  const body = input.body.trim().slice(0, 2000);
  if (!body) return { ok: false, error: "Write the note first." };
  if (!input.customerId && !input.appointmentId) return { ok: false, error: "Open a client or a job to add a note." };
  const db = await createClient();
  const who = await getActor();
  const { data, error } = await db
    .from("customer_notes")
    .insert({ customer_id: input.customerId, appointment_id: input.appointmentId, author_name: who.role === "owner" ? "Tyler" : who.name, body })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  await logActivity(
    `left a note on ${await customerName(input.customerId)}${input.appointmentId ? "'s job" : ""}`,
    [body.slice(0, 300)],
    input.customerId ? `/customers/${input.customerId}` : "/calendar",
    { tags: ["memo"] }
  );
  revalidatePath("/", "layout");
  return { ok: true, id: data.id };
}

export async function deleteNote(id: string): Promise<ActionResult> {
  const db = await createClient();
  // RLS decides who may: .select() tells "deleted" from "not yours" (a refused delete is not an error).
  const { data, error } = await db.from("customer_notes").delete().eq("id", id).select("customer_id,body");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "You can only delete your own notes." };
  await logActivity(`deleted a note on ${await customerName(data[0].customer_id)}`, [data[0].body.slice(0, 300)], data[0].customer_id ? `/customers/${data[0].customer_id}` : "/calendar", { tags: ["wastebasket"] });
  revalidatePath("/", "layout");
  return { ok: true, id };
}
