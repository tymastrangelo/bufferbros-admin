import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import type { LedgerEntry } from "@/lib/types";
import { PaymentsClient, type PaymentRow } from "./payments-client";

export const metadata: Metadata = { title: "Payments" };
export const dynamic = "force-dynamic";

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const params = await searchParams;
  const db = await createClient();
  const { data } = await db
    .from("ledger_entries")
    .select("*, customers(id,name)")
    .in("kind", ["payment", "credit", "refund", "discount"])
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);

  const rows = ((data ?? []) as (LedgerEntry & { customers: { id: string; name: string } | null })[]).map((e) => ({
    ...e,
    amount: Number(e.amount),
  })) as PaymentRow[];

  return <PaymentsClient rows={rows} openNew={params.new === "1"} />;
}
