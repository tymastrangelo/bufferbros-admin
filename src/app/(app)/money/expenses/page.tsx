import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import type { Expense } from "@/lib/types";
import { ExpensesClient } from "./expenses-client";

export const metadata: Metadata = { title: "Expenses" };
export const dynamic = "force-dynamic";

export default async function ExpensesPage() {
  const db = await createClient();
  const { data } = await db
    .from("expenses")
    .select("*")
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);
  const rows = ((data ?? []) as Expense[]).map((e) => ({ ...e, amount: Number(e.amount) }));
  return <ExpensesClient rows={rows} />;
}
