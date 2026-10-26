"use server";

import { revalidatePath } from "next/cache";
import { getRole } from "@/lib/auth";
import { change, customerName, logActivity, usd } from "@/lib/notify";
import { createClient } from "@/lib/supabase/server";
import { todayYmd } from "@/lib/time";
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
  collectedBy?: "owner" | "washer"; // who received the client's cash (money-in kinds)
  /** Tip handed over with a payment — the worker's, outside the split and the balance. */
  tip?: number;
}

// collected_by only means something for money-in kinds; charges/discounts stay 'owner'.
const isCashIn = (k: EntryKind) => k === "payment" || k === "credit";

function signed(kind: EntryKind, amount: number): number {
  const abs = Math.abs(amount);
  return NEGATIVE_KINDS.includes(kind) ? -abs : abs;
}

export async function addLedgerEntry(fields: LedgerFields): Promise<ActionResult> {
  if (!fields.amount || fields.amount <= 0) return { ok: false, error: "Enter an amount greater than zero." };
  const db = await createClient();
  const role = await getRole();
  const collectedBy = isCashIn(fields.kind) ? fields.collectedBy ?? role : "owner";
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
      collected_by: collectedBy,
      tip: fields.kind === "payment" ? Math.max(0, Number(fields.tip ?? 0)) : 0,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  await logActivity(
    `recorded a ${fields.kind} for ${await customerName(fields.customerId)}`,
    [
      `${usd(Math.abs(fields.amount))}${fields.method ? ` ${fields.method}` : ""} · ${fields.occurredOn}`,
      isCashIn(fields.kind) && `Collected by ${collectedBy === "washer" ? "them" : "you"}`,
      Number(fields.tip ?? 0) > 0 && `Tip: ${usd(Number(fields.tip))}`,
      fields.memo?.trim() && `Memo: ${fields.memo.trim()}`,
    ],
    `/customers/${fields.customerId}`,
    { tags: ["moneybag"] }
  );
  refresh();
  return { ok: true, id: data.id };
}

export async function updateLedgerEntry(
  id: string,
  fields: Pick<LedgerFields, "kind" | "amount" | "method" | "occurredOn" | "memo" | "collectedBy" | "tip">
): Promise<ActionResult> {
  if (!fields.amount || fields.amount <= 0) return { ok: false, error: "Enter an amount greater than zero." };
  const db = await createClient();
  const { data: before } = await db.from("ledger_entries").select("*").eq("id", id).maybeSingle();
  const { error } = await db
    .from("ledger_entries")
    .update({
      kind: fields.kind,
      amount: signed(fields.kind, fields.amount),
      method: fields.kind === "payment" || fields.kind === "refund" ? fields.method ?? null : null,
      occurred_on: fields.occurredOn,
      memo: fields.memo?.trim() || null,
      tip: fields.kind === "payment" ? Math.max(0, Number(fields.tip ?? 0)) : 0,
      ...(isCashIn(fields.kind) && fields.collectedBy ? { collected_by: fields.collectedBy } : {}),
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  if (before) {
    await logActivity(
      `edited a ${before.kind} for ${await customerName(before.customer_id)}`,
      [
        change("Type", before.kind, fields.kind),
        change("Amount", Math.abs(Number(before.amount)), Math.abs(fields.amount), (v) => usd(v as number)),
        change("Method", before.method, fields.method ?? null),
        change("Date", before.occurred_on, fields.occurredOn),
        change("Memo", before.memo, fields.memo?.trim() || null),
        change("Tip", Number(before.tip ?? 0), Number(fields.tip ?? 0), (v) => usd(v as number)),
      ],
      `/customers/${before.customer_id}`,
      { tags: ["pencil2"], priority: 4 }
    );
  }
  refresh();
  return { ok: true, id };
}

// Owner-only: mark a payment squared-up with Gabe (or undo). ledger_entries RLS is still
// open to all authenticated users, so the role guard lives here, not the DB.
export async function setPaymentSettled(ledgerEntryId: string, settled: boolean): Promise<ActionResult> {
  // activity: owner-only (returns early for workers)
  if ((await getRole()) !== "owner") return { ok: false, error: "Only the owner can settle payouts." };
  const db = await createClient();
  const { error } = await db
    .from("ledger_entries")
    .update({ settled_on: settled ? todayYmd() : null })
    .eq("id", ledgerEntryId);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, id: ledgerEntryId };
}

/**
 * Owner-only: pick who gets the worker cut on a payment with no resolved payee. A job
 * payment re-attributes the job itself (the re-mirror trigger rebuilds the split); a
 * balance/prepay payment gets its own employee_id. null = the owner did it.
 */
export async function attributeLedgerEntry(ledgerEntryId: string, employeeId: string | null): Promise<ActionResult> {
  if ((await getRole()) !== "owner") return { ok: false, error: "Only the owner can attribute payments." };
  const db = await createClient();
  const { data: entry } = await db
    .from("ledger_entries")
    .select("id,amount,customer_id,appointment_id")
    .eq("id", ledgerEntryId)
    .maybeSingle();
  if (!entry) return { ok: false, error: "Payment not found." };
  const { data: emp } = employeeId ? await db.from("employees").select("name").eq("id", employeeId).maybeSingle() : { data: null };
  if (employeeId && !emp) return { ok: false, error: "That worker no longer exists." };
  if (!entry.appointment_id && !employeeId) return { ok: false, error: "A payment with no job needs a worker — or mark it settled to clear it." };

  const { error } = entry.appointment_id
    ? await db.from("appointments").update({ employee_id: employeeId, self_done: !employeeId }).eq("id", entry.appointment_id)
    : await db.from("ledger_entries").update({ employee_id: employeeId }).eq("id", ledgerEntryId);
  if (error) return { ok: false, error: error.message };
  await logActivity(
    "attributed a payment",
    [await customerName(entry.customer_id), usd(Number(entry.amount)), `Cut goes to ${emp?.name ?? "nobody — your job"}`],
    "/money/payouts",
    { tags: ["money_with_wings"] }
  );
  refresh();
  return { ok: true, id: ledgerEntryId };
}

export async function deleteLedgerEntry(id: string): Promise<ActionResult> {
  const db = await createClient();
  const { data: before } = await db.from("ledger_entries").select("*").eq("id", id).maybeSingle();
  const { error } = await db.from("ledger_entries").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  if (before) {
    await logActivity(
      `deleted a ${before.kind} from ${await customerName(before.customer_id)}`,
      [`${usd(Math.abs(Number(before.amount)))}${before.method ? ` ${before.method}` : ""} · ${before.occurred_on}`, before.memo && `Memo: ${before.memo}`],
      `/customers/${before.customer_id}`,
      { tags: ["wastebasket"], priority: 4 }
    );
  }
  refresh();
  return { ok: true };
}

export interface ExpenseFields {
  occurredOn: string;
  category: string;
  amount: number;
  memo?: string | null;
  recurringId?: string | null;
  /** The worker who paid out of pocket (null = the company / Tyler paid). undefined = leave as is. */
  paidByEmployeeId?: string | null;
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
    // undefined = leave who-paid alone on edits; switching back to the company clears the reimbursement
    ...(fields.paidByEmployeeId !== undefined && { paid_by_employee_id: fields.paidByEmployeeId, ...(fields.paidByEmployeeId ? {} : { reimbursed_on: null }) }),
  };
  const { error } = id ? await db.from("expenses").update(row).eq("id", id) : await db.from("expenses").insert(row);
  if (error) return { ok: false, error: error.message };
  const { data: payer } = fields.paidByEmployeeId ? await db.from("employees").select("name").eq("id", fields.paidByEmployeeId).maybeSingle() : { data: null };
  await logActivity(
    `${id ? "edited" : "logged"} an expense${payer ? ` ${payer.name} paid for` : ""}`,
    [`${usd(row.amount)} · ${row.category} · ${row.occurred_on}`, row.memo, payer && `You owe ${payer.name} ${usd(row.amount)} back — settle it on Payouts`],
    payer ? "/money/payouts" : "/money/expenses",
    { tags: ["receipt"] }
  );
  refresh();
  return { ok: true };
}

/** Owner-only: mark a worker-fronted expense paid back (or undo). */
export async function setExpenseReimbursed(expenseId: string, reimbursed: boolean): Promise<ActionResult> {
  // activity: owner-only (returns early for workers); settling pushes nothing, like setPaymentSettled
  if ((await getRole()) !== "owner") return { ok: false, error: "Only the owner can mark reimbursements." };
  const db = await createClient();
  const { error } = await db.from("expenses").update({ reimbursed_on: reimbursed ? todayYmd() : null }).eq("id", expenseId).not("paid_by_employee_id", "is", null);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, id: expenseId };
}

export async function deleteExpense(id: string): Promise<ActionResult> {
  const db = await createClient();
  const { data: before } = await db.from("expenses").select("*").eq("id", id).maybeSingle();
  const { error } = await db.from("expenses").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  await logActivity("deleted an expense", [before && `${usd(before.amount)} · ${before.category} · ${before.occurred_on}`, before?.memo], "/money/expenses", { tags: ["wastebasket"], priority: 4 });
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
  await logActivity("added company capital", [`${usd(fields.amount)} · ${fields.occurredOn}`, fields.memo?.trim()], "/money/capital", { tags: ["bank"] });
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
  await logActivity(`edited a company ${fields.kind} entry`, [`${usd(fields.amount)} · ${fields.occurredOn}`, fields.memo?.trim()], "/money/capital", { tags: ["pencil2"], priority: 4 });
  refresh();
  return { ok: true };
}

export async function deleteCompanyEntry(id: string): Promise<ActionResult> {
  const db = await createClient();
  const { data: before } = await db.from("company_ledger").select("*").eq("id", id).maybeSingle();
  const { error } = await db.from("company_ledger").delete().eq("id", id).in("kind", ["capital", "payout"]);
  if (error) return { ok: false, error: error.message };
  await logActivity("deleted a company ledger entry", [before && `${before.kind} · ${usd(Math.abs(Number(before.amount)))} · ${before.occurred_on}`, before?.memo], "/money/capital", { tags: ["wastebasket"], priority: 4 });
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
  await logActivity(`${id ? "edited" : "added"} recurring expense “${row.name}”`, [`~${usd(row.expected_amount)} ${row.cadence}, due day ${row.due_day}`, !row.active && "Paused"], "/money/expenses", { tags: ["receipt"] });
  refresh();
  return { ok: true };
}

export async function deleteRecurring(id: string): Promise<ActionResult> {
  const db = await createClient();
  const { data: before } = await db.from("recurring_expenses").select("name").eq("id", id).maybeSingle();
  const { error } = await db.from("recurring_expenses").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  await logActivity(`deleted recurring expense “${before?.name ?? "?"}”`, [], "/money/expenses", { tags: ["wastebasket"], priority: 4 });
  refresh();
  return { ok: true };
}
