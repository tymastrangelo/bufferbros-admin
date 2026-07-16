import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { getCatalog } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { todayYmd } from "@/lib/time";
import type { Customer, LedgerEntry, Plan, Vehicle } from "@/lib/types";
import type { JobWithCustomer } from "@/components/job-sheet";
import { CustomerProfile } from "./profile-client";

export const metadata: Metadata = { title: "Customer" };
export const dynamic = "force-dynamic";

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOwner();
  const { id } = await params;
  const db = await createClient();

  const [customerQ, vehiclesQ, plansQ, apptsQ, ledgerQ, catalog] = await Promise.all([
    db.from("customers").select("*").eq("id", id).single(),
    db.from("vehicles").select("*").eq("customer_id", id),
    db.from("plans").select("*").eq("customer_id", id).order("created_at", { ascending: false }),
    db
      .from("appointments")
      .select("*, customers(id,name,phone,email)")
      .eq("customer_id", id)
      .order("date", { ascending: false })
      .order("start_min"),
    db
      .from("ledger_entries")
      .select("*")
      .eq("customer_id", id)
      .order("occurred_on", { ascending: false })
      .order("created_at", { ascending: false }),
    getCatalog(),
  ]);

  if (!customerQ.data) notFound();

  return (
    <CustomerProfile
      customer={customerQ.data as Customer}
      vehicles={(vehiclesQ.data ?? []) as Vehicle[]}
      plans={(plansQ.data ?? []) as Plan[]}
      appointments={(apptsQ.data ?? []) as JobWithCustomer[]}
      ledger={((ledgerQ.data ?? []) as LedgerEntry[]).map((e) => ({ ...e, amount: Number(e.amount) }))}
      catalog={catalog}
      today={todayYmd()}
    />
  );
}
