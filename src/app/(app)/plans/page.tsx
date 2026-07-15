import type { Metadata } from "next";
import { getCatalog } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { todayYmd } from "@/lib/time";
import type { Customer, Plan, Vehicle } from "@/lib/types";
import type { PickedCustomer } from "@/components/customer-picker";
import { PlansClient, type PlanRow } from "./plans-client";

export const metadata: Metadata = { title: "Plans" };
export const dynamic = "force-dynamic";

export default async function PlansPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; customer?: string }>;
}) {
  const params = await searchParams;
  const db = await createClient();
  const today = todayYmd();

  const [plansQ, nextQ, catalog] = await Promise.all([
    db.from("plans").select("*, customers(id,name)").order("created_at", { ascending: false }),
    db
      .from("appointments")
      .select("plan_id,date")
      .eq("status", "scheduled")
      .gte("date", today)
      .not("plan_id", "is", null)
      .order("date"),
    getCatalog(),
  ]);

  const nextVisit = new Map<string, string>();
  for (const r of (nextQ.data ?? []) as { plan_id: string; date: string }[]) {
    if (!nextVisit.has(r.plan_id)) nextVisit.set(r.plan_id, r.date);
  }

  const rows: PlanRow[] = ((plansQ.data ?? []) as (Plan & { customers: { id: string; name: string } | null })[]).map(
    (p) => ({ ...p, per_visit_price: Number(p.per_visit_price), nextVisit: nextVisit.get(p.id) ?? null })
  );

  let defaultCustomer: PickedCustomer | null = null;
  if (params.new === "1" && params.customer) {
    const { data } = await db.from("customers").select("*, vehicles(*)").eq("id", params.customer).single();
    if (data) defaultCustomer = data as Customer & { vehicles: Vehicle[] };
  }

  return <PlansClient rows={rows} catalog={catalog} openNew={params.new === "1"} defaultCustomer={defaultCustomer} />;
}
