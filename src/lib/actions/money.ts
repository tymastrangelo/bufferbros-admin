"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getRole } from "@/lib/auth";
import { notify } from "@/lib/notify";
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
  if (fields.kind === "payment" && (await getRole()) === "washer") {
    const { data: cust } = await db.from("customers").select("name").eq("id", fields.customerId).single();
    const push = `${cust?.name ?? "Customer"} · $${Math.abs(fields.amount)} ${fields.method ?? ""}`.trimEnd();
    after(() => notify("owner", "Payment recorded", push, "/money/payments"));
  }
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
  recurringId?: string | null;
}

export async function saveExpense(fields: ExpenseFields, id?: string | null): Promise<ActionResult> {
  if (!fields.amount || fields.amount <= 0) return { ok: false, error: "Enter an amount greater than zero." };
  const db = await createClient();
  const row = {
    occurred_on: fields.occurredOn,
    category: fields.category,
    amount: Math.abs(fields.amount),
    memo: fields.memo?.trim() || null,
    // undefined = leave the recurring link alone on edits
    ...(fields.recurringId !== undefined && { recurring_id: fields.recurringId }),
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

export interface CapitalFields {
  occurredOn: string;
  amount: number; // entered positive
  memo?: string | null;
}

export async function addCapital(fields: CapitalFields): Promise<ActionResult> {
  if (!fields.amount || fields.amount <= 0) return { ok: false, error: "Enter an amount greater than zero." };
  const db = await createClient();
  const { error } = await db.from("company_ledger").insert({
    occurred_on: fields.occurredOn,
    kind: "capital",
    amount: Math.abs(fields.amount),
    memo: fields.memo?.trim() || null,
  });
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

// Capital and payout rows only — revenue/expense mirrors are edited via their source rows.
export async function updateCompanyEntry(
  id: string,
  fields: { kind: "capital" | "payout"; occurredOn: string; amount: number; memo?: string | null }
): Promise<ActionResult> {
  if (!fields.amount || fields.amount <= 0) return { ok: false, error: "Enter an amount greater than zero." };
  const db = await createClient();
  const { error } = await db
    .from("company_ledger")
    .update({
      occurred_on: fields.occurredOn,
      amount: fields.kind === "capital" ? Math.abs(fields.amount) : -Math.abs(fields.amount),
      memo: fields.memo?.trim() || null,
    })
    .eq("id", id)
    .in("kind", ["capital", "payout"]);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

export async function deleteCompanyEntry(id: string): Promise<ActionResult> {
  const db = await createClient();
  const { error } = await db.from("company_ledger").delete().eq("id", id).in("kind", ["capital", "payout"]);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

export interface RecurringFields {
  name: string;
  category: string;
  expectedAmount: number;
  cadence: "monthly" | "yearly";
  dueDay: number;
  dueMonth?: number | null;
  active?: boolean;
}

export async function saveRecurring(fields: RecurringFields, id?: string | null): Promise<ActionResult> {
  if (!fields.name.trim()) return { ok: false, error: "Give it a name." };
  const db = await createClient();
  const row = {
    name: fields.name.trim(),
    category: fields.category,
    expected_amount: Math.abs(fields.expectedAmount || 0),
    cadence: fields.cadence,
    due_day: fields.dueDay,
    due_month: fields.cadence === "yearly" ? fields.dueMonth ?? 1 : null,
    active: fields.active ?? true,
  };
  const { error } = id
    ? await db.from("recurring_expenses").update(row).eq("id", id)
    : await db.from("recurring_expenses").insert(row);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

export async function deleteRecurring(id: string): Promise<ActionResult> {
  const db = await createClient();
  const { error } = await db.from("recurring_expenses").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}
