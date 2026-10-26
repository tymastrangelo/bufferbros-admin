"use server";

import { revalidatePath } from "next/cache";
import { getRole } from "@/lib/auth";
import { syncEmployeeCalendar } from "@/lib/ical";
import { normalizeEmail, phoneDigits } from "@/lib/format";
import { change, logActivity, usd } from "@/lib/notify";
import { payeeOf, transfer } from "@/lib/payouts";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { todayYmd } from "@/lib/time";
import type { EmployeeHours } from "@/lib/types";
import type { ActionResult } from "./appointments";

const refresh = () => revalidatePath("/", "layout");

/** Owner-only: create the worker's login + employee row in one shot. */
export async function addEmployee(input: {
  name: string;
  email: string;
  password: string;
  splitPct: number;
  phone?: string | null;
}): Promise<ActionResult> {
  // activity: owner-only (returns early for workers)
  if ((await getRole()) !== "owner") return { ok: false, error: "Owner only." };
  const name = input.name.trim();
  const email = normalizeEmail(input.email);
  const phone = input.phone?.trim() ? phoneDigits(input.phone) : null;
  if (phone && phone.length !== 10) return { ok: false, error: "Phone needs 10 digits." };
  if (!name) return { ok: false, error: "Give them a name." };
  if (!email) return { ok: false, error: "They need an email to sign in with." };
  if (input.password.length < 8) return { ok: false, error: "Temp password needs at least 8 characters." };
  if (!(input.splitPct >= 0 && input.splitPct <= 100)) return { ok: false, error: "Split must be 0–100%." };

  const admin = createServiceClient();
  const { data: created, error: authErr } = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    app_metadata: { role: "washer" },
  });
  if (authErr) return { ok: false, error: authErr.message };

  // Next unused lane color (1–6), so two workers never share a stripe until there are 7.
  const { data: used } = await admin.from("employees").select("color");
  const taken = new Set(((used ?? []) as { color: number }[]).map((r) => r.color));
  const color = [1, 2, 3, 4, 5, 6].find((c) => !taken.has(c)) ?? ((taken.size % 6) + 1);
  const { data: row, error } = await admin
    .from("employees")
    .insert({ user_id: created.user.id, name, email, split_pct: input.splitPct, phone, color })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, id: row.id };
}

const validHours = (h: unknown): h is EmployeeHours =>
  !!h &&
  typeof h === "object" &&
  Object.entries(h as Record<string, unknown>).every(
    ([k, v]) =>
      /^[0-6]$/.test(k) &&
      (v === null || v === false || (Array.isArray(v) && v.length === 2 && v.every((n) => Number.isInteger(n)) && v[0] >= 0 && v[0] < v[1] && v[1] <= 1440))
  );

export async function updateEmployee(
  id: string,
  fields: Partial<{
    name: string;
    split_pct: number;
    active: boolean;
    ical_url: string | null;
    phone: string | null;
    color: number;
    takes_web_bookings: boolean;
    hours: EmployeeHours | null;
  }>
): Promise<ActionResult> {
  if ((await getRole()) !== "owner") return { ok: false, error: "Owner only." };
  if (fields.split_pct != null && !(fields.split_pct >= 0 && fields.split_pct <= 100)) {
    return { ok: false, error: "Split must be 0–100%." };
  }
  if (fields.name != null && !fields.name.trim()) return { ok: false, error: "Name can't be blank." };
  if (fields.color != null && !(fields.color >= 1 && fields.color <= 6)) return { ok: false, error: "Pick one of the six colors." };
  if ("hours" in fields && fields.hours != null && !validHours(fields.hours)) return { ok: false, error: "Hours need an open time before the close time." };
  if ("phone" in fields && fields.phone?.trim() && phoneDigits(fields.phone).length !== 10) return { ok: false, error: "Phone needs 10 digits." };
  const db = await createClient();
  const { data: before } = await db.from("employees").select("*").eq("id", id).maybeSingle();
  if (!before) return { ok: false, error: "Worker not found." };
  const patch = { ...fields, ...("phone" in fields ? { phone: fields.phone?.trim() ? phoneDigits(fields.phone) : null } : {}) };
  const { error } = await db.from("employees").update(patch).eq("id", id);
  if (error) return { ok: false, error: error.message };
  if ("ical_url" in fields) await syncEmployeeCalendar(id); // new feed: blocks appear right away

  const facts = [
    fields.split_pct != null && fields.split_pct !== Number(before.split_pct) && change("Cut", `${Number(before.split_pct)}%`, `${fields.split_pct}%`),
    "active" in fields && fields.active !== before.active && (fields.active ? "Reactivated" : "Deactivated — no new jobs, pay history kept"),
    "takes_web_bookings" in fields && fields.takes_web_bookings !== before.takes_web_bookings && `Website bookings: ${fields.takes_web_bookings ? "on" : "off"}`,
    "hours" in fields && "Hours changed",
    "ical_url" in fields && (fields.ical_url ? "Calendar feed set" : "Calendar feed removed"),
  ].filter(Boolean) as string[];
  if (facts.length) await logActivity(`updated ${before.name}`, facts, `/team/${id}`, { tags: ["busts_in_silhouette"], priority: 3 });
  // activity: name/phone/color-only edits are cosmetic — not pushed
  refresh();
  return { ok: true };
}

/**
 * Owner-only: mark every unsettled payment that pays this worker as settled today.
 * Returns the ids so a toast can undo it in one go.
 */
export async function settleWorker(employeeId: string): Promise<ActionResult & { ids?: string[]; expenseIds?: string[]; net?: number }> {
  if ((await getRole()) !== "owner") return { ok: false, error: "Only the owner can settle up." };
  const db = await createClient();
  const [{ data: emp }, { data: rows }, { data: plans }, frontedQ] = await Promise.all([
    db.from("employees").select("id,name,split_pct").eq("id", employeeId).maybeSingle(),
    db
      .from("ledger_entries")
      .select("id,amount,processor_fee,tip,collected_by,settled_on,employee_id,plan_id,appointments(employee_id,self_done,plan_id)")
      .in("kind", ["payment", "credit"])
      .is("settled_on", null),
    db.from("plans").select("id,employee_id").not("employee_id", "is", null),
    db.from("expenses").select("id,amount").eq("paid_by_employee_id", employeeId).is("reimbursed_on", null),
  ]);
  if (!emp) return { ok: false, error: "Worker not found." };
  const fronted = ((frontedQ.data ?? []) as { id: string; amount: number }[]).map((f) => ({ ...f, amount: Number(f.amount) }));
  const planWorker = new Map(((plans ?? []) as { id: string; employee_id: string }[]).map((p) => [p.id, p.employee_id]));
  type Row = { id: string; amount: number; processor_fee: number; tip: number; collected_by: "owner" | "washer"; settled_on: string | null; employee_id: string | null; plan_id: string | null; appointments: { employee_id: string | null; self_done: boolean; plan_id: string | null } | null };
  const mine = ((rows ?? []) as unknown as Row[]).filter((r) => payeeOf(r, (id) => planWorker.get(id) ?? null) === employeeId);
  if (!mine.length && !fronted.length) return { ok: false, error: "Nothing unsettled for them." };
  let net = 0;
  for (const r of mine) {
    const t = transfer({ amount: Number(r.amount), fee: Number(r.processor_fee ?? 0), tip: Number(r.tip ?? 0), collectedBy: r.collected_by, settledOn: null, selfDone: !!r.appointments?.self_done }, Number(emp.split_pct));
    net += t.direction === "washer_to_owner" ? t.amount : -t.amount;
  }
  for (const f of fronted) net -= f.amount;
  const ids = mine.map((r) => r.id);
  const expenseIds = fronted.map((f) => f.id);
  const today = todayYmd();
  if (ids.length) {
    const { error } = await db.from("ledger_entries").update({ settled_on: today }).in("id", ids);
    if (error) return { ok: false, error: error.message };
  }
  if (expenseIds.length) {
    const { error } = await db.from("expenses").update({ reimbursed_on: today }).in("id", expenseIds);
    if (error) return { ok: false, error: error.message };
  }
  await logActivity(
    `settled up with ${emp.name}`,
    [
      `${ids.length} payment${ids.length === 1 ? "" : "s"}${expenseIds.length ? ` + ${expenseIds.length} out-of-pocket expense${expenseIds.length === 1 ? "" : "s"} paid back` : ""}`,
      net === 0 ? "Even" : net > 0 ? `${emp.name} paid you ${usd(net)}` : `You paid ${emp.name} ${usd(-net)}`,
    ],
    "/money/payouts",
    { tags: ["money_with_wings"] }
  );
  refresh();
  return { ok: true, ids, expenseIds, net };
}

/** Undo twin of settleWorker: those payments (and reimbursements) go back to unsettled. */
export async function unsettleEntries(ids: string[], expenseIds: string[] = []): Promise<ActionResult> {
  // activity: undo of settleWorker, which already pushed
  if ((await getRole()) !== "owner") return { ok: false, error: "Only the owner can settle up." };
  const db = await createClient();
  if (ids.length) {
    const { error } = await db.from("ledger_entries").update({ settled_on: null }).in("id", ids);
    if (error) return { ok: false, error: error.message };
  }
  if (expenseIds.length) {
    const { error } = await db.from("expenses").update({ reimbursed_on: null }).in("id", expenseIds);
    if (error) return { ok: false, error: error.message };
  }
  refresh();
  return { ok: true };
}

/** An employee saves their own calendar feed link (RLS blocks their direct writes). */
export async function saveMyCalendarFeed(url: string): Promise<ActionResult> {
  const me = await myEmployeeRow();
  if (!me) return { ok: false, error: "No employee profile on this account." };
  const trimmed = url.trim();
  if (trimmed && !/^https?:\/\//.test(trimmed)) return { ok: false, error: "Paste the full https:// iCal link." };
  const admin = createServiceClient();
  const { error } = await admin.from("employees").update({ ical_url: trimmed || null }).eq("id", me);
  if (error) return { ok: false, error: error.message };
  const res = await syncEmployeeCalendar(me);
  if (!res.ok) return res;
  await logActivity(trimmed ? "connected their other-job calendar" : "removed their other-job calendar", [trimmed && "Those shifts now block the schedule automatically"], "/calendar", { tags: ["calendar"] });
  refresh();
  return { ok: true };
}

/** Re-pull a feed on demand — owner for anyone, employees for themselves. */
export async function syncCalendarNow(employeeId?: string): Promise<ActionResult> {
  // activity: a re-sync changes nothing the worker chose — too noisy to push
  let target = employeeId ?? null;
  if ((await getRole()) !== "owner") {
    const me = await myEmployeeRow();
    if (!me || (target && target !== me)) return { ok: false, error: "You can only sync your own calendar." };
    target = me;
  }
  if (!target) return { ok: false, error: "No employee to sync." };
  const res = await syncEmployeeCalendar(target);
  if (!res.ok) return res;
  refresh();
  return { ok: true };
}

async function myEmployeeRow(): Promise<string | null> {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;
  const { data } = await db.from("employees").select("id").eq("user_id", user.id).maybeSingle();
  return data?.id ?? null;
}
