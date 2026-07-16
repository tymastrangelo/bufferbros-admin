import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { todayYmd } from "@/lib/time";
import type { Expense, RecurringExpense } from "@/lib/types";
import { ExpensesClient } from "./expenses-client";

export const metadata: Metadata = { title: "Expenses" };
export const dynamic = "force-dynamic";

export default async function ExpensesPage() {
  const db = await createClient();
  const today = todayYmd();
  const [expQ, recQ, postedQ] = await Promise.all([
    db.from("expenses").select("*").order("occurred_on", { ascending: false }).order("created_at", { ascending: false }).limit(500),
    db.from("recurring_expenses").select("*").order("name"),
    db
      .from("expenses")
      .select("recurring_id,occurred_on")
      .not("recurring_id", "is", null)
      .gte("occurred_on", `${today.slice(0, 4)}-01-01`),
  ]);
  const rows = ((expQ.data ?? []) as Expense[]).map((e) => ({ ...e, amount: Number(e.amount) }));
  const recurring = ((recQ.data ?? []) as RecurringExpense[]).map((r) => ({ ...r, expected_amount: Number(r.expected_amount) }));
  const posted = (postedQ.data ?? []) as { recurring_id: string; occurred_on: string }[];

  const ym = today.slice(0, 7);
  const month = Number(today.slice(5, 7));
  const due = recurring.filter((r) => {
    if (!r.active) return false;
    if (r.cadence === "monthly") return !posted.some((p) => p.recurring_id === r.id && p.occurred_on.slice(0, 7) === ym);
    return r.due_month === month && !posted.some((p) => p.recurring_id === r.id); // yearly: postedQ is already this-year
  });

  return <ExpensesClient rows={rows} recurring={recurring} due={due} />;
}
