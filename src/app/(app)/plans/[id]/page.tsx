import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { getCatalog } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { todayYmd } from "@/lib/time";
import type { Customer, LedgerEntry, Plan } from "@/lib/types";
import type { JobWithCustomer } from "@/components/job-sheet";
import { PlanDetail } from "./plan-detail";

export const metadata: Metadata = { title: "Plan" };
export const dynamic = "force-dynamic";

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOwner();
  const { id } = await params;
  const db = await createClient();

  const { data: planData } = await db.from("plans").select("*, customers(*)").eq("id", id).single();
  if (!planData) notFound();
  const plan = planData as Plan & { customers: Customer };

  const [apptsQ, ledgerQ, catalog] = await Promise.all([
    db
      .from("appointments")
      .select("*, customers(id,name,phone,email)")
      .eq("plan_id", id)
      .order("date", { ascending: false })
      .order("start_min"),
    db.from("ledger_entries").select("*").eq("customer_id", plan.customer_id),
    getCatalog(),
  ]);

  return (
    <PlanDetail
      plan={{ ...plan, per_visit_price: Number(plan.per_visit_price) }}
      appointments={(apptsQ.data ?? []) as JobWithCustomer[]}
      ledger={((ledgerQ.data ?? []) as LedgerEntry[]).map((e) => ({ ...e, amount: Number(e.amount) }))}
      catalog={catalog}
      today={todayYmd()}
    />
  );
}
