"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { EntryKind, PaymentMethod } from "@/lib/types";
import type { ActionResult } from "./appointments";

const refresh = () => revalidatePath("/", "layout");

// Sign convention: charge/refund make the balance go down (they owe more / money returned),
// payment/credit/discount make it go up.
const NEGATIVE_KINDS: EntryKind[] = ["charge", "refund"];

export interface LedgerFields {
  customerId: string;
  kind: EntryKind;
  amount: number; // always entered positive in the UI
  method?: PaymentMethod | null;
  occurredOn: string;
  memo?: string | null;
  appointmentId?: string | null;
  planId?: string | null;
}

function signed(kind: EntryKind, amount: number): number {
  const abs = Math.abs(amount);
  return NEGATIVE_KINDS.includes(kind) ? -abs : abs;
}

export async function addLedgerEntry(fields: LedgerFields): Promise<ActionResult> {
  if (!fields.amount || fields.amount <= 0) return { ok: false, error: "Enter an amount greater than zero." };
  const db = await createClient();
  const { data, error } = await db
    .from("ledger_entries")
    .insert({
      customer_id: fields.customerId,
      kind: fields.kind,
      amount: signed(fields.kind, fields.amount),
      method: fields.kind === "payment" || fields.kind === "refund" ? fields.method ?? null : null,
      occurred_on: fields.occurredOn,
      memo: fields.memo?.trim() || null,
      appointment_id: fields.appointmentId || null,
      plan_id: fields.planId || null,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, id: data.id };
}

export async function updateLedgerEntry(
  id: string,
  fields: Pick<LedgerFields, "kind" | "amount" | "method" | "occurredOn" | "memo">
): Promise<ActionResult> {
  if (!fields.amount || fields.amount <= 0) return { ok: false, error: "Enter an amount greater than zero." };
  const db = await createClient();
  const { error } = await db
    .from("ledger_entries")
    .update({
      kind: fields.kind,
      amount: signed(fields.kind, fields.amount),
      method: fields.kind === "payment" || fields.kind === "refund" ? fields.method ?? null : null,
      occurred_on: fields.occurredOn,
      memo: fields.memo?.trim() || null,
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, id };
}

export async function deleteLedgerEntry(id: string): Promise<ActionResult> {
  const db = await createClient();
  const { error } = await db.from("ledger_entries").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

export interface ExpenseFields {
  occurredOn: string;
  category: string;
  amount: number;
  memo?: string | null;
}

export async function saveExpense(fields: ExpenseFields, id?: string | null): Promise<ActionResult> {
  if (!fields.amount || fields.amount <= 0) return { ok: false, error: "Enter an amount greater than zero." };
  const db = await createClient();
  const row = {
    occurred_on: fields.occurredOn,
    category: fields.category,
    amount: Math.abs(fields.amount),
    memo: fields.memo?.trim() || null,
  };
  const { error } = id ? await db.from("expenses").update(row).eq("id", id) : await db.from("expenses").insert(row);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

export async function deleteExpense(id: string): Promise<ActionResult> {
  const db = await createClient();
  const { error } = await db.from("expenses").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}
