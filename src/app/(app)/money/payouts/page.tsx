import type { Metadata } from "next";
import { getSettingsMap } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import type { Employee } from "@/lib/types";
import { PayoutsClient, type PayoutEntry } from "./payouts-client";

export const metadata: Metadata = { title: "Payouts" };
export const dynamic = "force-dynamic";

export default async function PayoutsPage() {
  const db = await createClient();
  const [entriesQ, employeesQ, settings] = await Promise.all([
    db
      .from("ledger_entries")
      .select("id,amount,processor_fee,occurred_on,collected_by,settled_on,memo,customers(id,name),appointments(self_done,employee_id)")
      .in("kind", ["payment", "credit"])
      .order("occurred_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(500),
    db.from("employees").select("*").order("created_at"),
    getSettingsMap(),
  ]);

  // supabase-js types the to-one `customers` embed as an array; it's an object at runtime.
  const rows = ((entriesQ.data ?? []) as unknown as PayoutEntry[]).map((e) => ({
    ...e,
    amount: Number(e.amount),
    processor_fee: Number(e.processor_fee ?? 0),
  }));
  const employees = ((employeesQ.data ?? []) as Employee[]).map((e) => ({ ...e, split_pct: Number(e.split_pct) }));

  // Each payment settles with the worker who did its job; unlinked payments
  // (balance/prepay) fall to the default worker — same resolution as the DB mirror.
  const defaultId = settings.default_employee_id ?? employees[0]?.id;
  const sections = employees
    .map((emp) => ({
      employee: emp,
      rows: rows.filter((r) => (r.appointments?.employee_id ?? defaultId) === emp.id),
    }))
    .filter((s) => s.employee.active || s.rows.length > 0);

  return (
    <>
      {sections.map(({ employee, rows }) => (
        <PayoutsClient key={employee.id} rows={rows} washerPct={employee.split_pct} name={employee.name} />
      ))}
      {sections.length === 0 && (
        <p className="mt-4 text-sm text-faint">No workers yet — add one on the Team page and their split lands here.</p>
      )}
    </>
  );
}
