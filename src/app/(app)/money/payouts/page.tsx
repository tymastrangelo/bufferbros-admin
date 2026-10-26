import type { Metadata } from "next";
import { payeeOf } from "@/lib/payouts";
import { createClient } from "@/lib/supabase/server";
import type { Employee } from "@/lib/types";
import { PayoutsClient, UnattributedPayouts, type FrontedRow, type PayoutEntry } from "./payouts-client";

export const metadata: Metadata = { title: "Payouts" };
export const dynamic = "force-dynamic";

export default async function PayoutsPage() {
  const db = await createClient();
  const [entriesQ, employeesQ, plansQ, frontedQ] = await Promise.all([
    db
      .from("ledger_entries")
      .select("id,amount,processor_fee,tip,occurred_on,collected_by,settled_on,memo,employee_id,plan_id,customers(id,name),appointments(self_done,employee_id,plan_id)")
      .in("kind", ["payment", "credit"])
      .order("occurred_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(500),
    db.from("employees").select("*").order("created_at"),
    db.from("plans").select("id,employee_id").not("employee_id", "is", null),
    db.from("expenses").select("id,occurred_on,amount,memo,category,paid_by_employee_id,reimbursed_on").not("paid_by_employee_id", "is", null).order("occurred_on", { ascending: false }).limit(300),
  ]);

  // supabase-js types the to-one `customers` embed as an array; it's an object at runtime.
  const rows = ((entriesQ.data ?? []) as unknown as PayoutEntry[]).map((e) => ({
    ...e,
    amount: Number(e.amount),
    processor_fee: Number(e.processor_fee ?? 0),
    tip: Number(e.tip ?? 0),
  }));
  const employees = ((employeesQ.data ?? []) as Employee[]).map((e) => ({ ...e, split_pct: Number(e.split_pct) }));

  // Each payment settles with its payee: the job's worker, else the payment's own worker,
  // else the plan's worker — same resolution as the DB mirror (0029). No payee = no cut,
  // and it shows up under "Unattributed" until Tyler picks someone.
  const planWorker = new Map(((plansQ.data ?? []) as { id: string; employee_id: string }[]).map((p) => [p.id, p.employee_id]));
  const payee = (r: PayoutEntry) => payeeOf(r, (id) => planWorker.get(id) ?? null);
  const fronted = ((frontedQ.data ?? []) as FrontedRow[]).map((f) => ({ ...f, amount: Number(f.amount) }));
  const sections = employees
    .map((emp) => ({
      employee: emp,
      rows: rows.filter((r) => payee(r) === emp.id),
      fronted: fronted.filter((f) => f.paid_by_employee_id === emp.id),
    }))
    .filter((s) => s.employee.active || s.rows.length > 0 || s.fronted.length > 0);
  // Owner's own jobs (self_done) are attributed to nobody on purpose; only the rest need a tap.
  const unattributed = rows.filter((r) => payee(r) === null && !r.appointments?.self_done && !r.settled_on);

  return (
    <>
      {unattributed.length > 0 && (
        <UnattributedPayouts rows={unattributed} employees={employees.filter((e) => e.active).map((e) => ({ id: e.id, name: e.name, active: e.active }))} />
      )}
      {sections.map(({ employee, rows, fronted }) => (
        <PayoutsClient key={employee.id} rows={rows} fronted={fronted} washerPct={employee.split_pct} name={employee.name} />
      ))}
      {sections.length === 0 && (
        <p className="mt-4 text-sm text-faint">No workers yet — add one on the Team page and their split lands here.</p>
      )}
    </>
  );
}
