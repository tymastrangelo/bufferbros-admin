import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { todayYmd } from "@/lib/time";
import type { Customer } from "@/lib/types";
import { CustomersClient, type CustomerRow } from "./customers-client";

export const metadata: Metadata = { title: "Customers" };
export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  await requireOwner();
  const params = await searchParams;
  const db = await createClient();
  const today = todayYmd();

  const [customersQ, balancesQ, lastQ, nextQ, unlinkedQ] = await Promise.all([
    db.from("customers").select("*").order("created_at", { ascending: false }),
    db.from("customer_balances").select("*"),
    db.from("appointments").select("customer_id,date").eq("status", "completed").not("customer_id", "is", null).order("date", { ascending: false }),
    db.from("appointments").select("customer_id,date").eq("status", "scheduled").gte("date", today).not("customer_id", "is", null).order("date"),
    db.from("appointments").select("id", { count: "exact", head: true }).is("customer_id", null).eq("status", "scheduled"),
  ]);

  const balance = new Map(
    ((balancesQ.data ?? []) as { customer_id: string; balance: number }[]).map((b) => [b.customer_id, Number(b.balance)])
  );
  const lastVisit = new Map<string, string>();
  for (const r of (lastQ.data ?? []) as { customer_id: string; date: string }[]) {
    if (!lastVisit.has(r.customer_id)) lastVisit.set(r.customer_id, r.date);
  }
  const nextVisit = new Map<string, string>();
  for (const r of (nextQ.data ?? []) as { customer_id: string; date: string }[]) {
    if (!nextVisit.has(r.customer_id)) nextVisit.set(r.customer_id, r.date);
  }

  const rows: CustomerRow[] = ((customersQ.data ?? []) as Customer[]).map((c) => ({
    ...c,
    balance: balance.get(c.id) ?? 0,
    lastVisit: lastVisit.get(c.id) ?? null,
    nextVisit: nextVisit.get(c.id) ?? null,
  }));

  return <CustomersClient rows={rows} unlinkedCount={unlinkedQ.count ?? 0} openNew={params.new === "1"} />;
}
