import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import type { CompanyLedgerEntry } from "@/lib/types";
import { CapitalClient } from "./capital-client";

export const metadata: Metadata = { title: "Capital" };
export const dynamic = "force-dynamic";

export default async function CapitalPage() {
  const db = await createClient();
  const [entriesQ, balanceQ] = await Promise.all([
    db
      .from("company_ledger")
      .select("*")
      .order("occurred_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(500),
    // ponytail: sums every row client-side — swap for a DB view if the statement ever gets huge
    db.from("company_ledger").select("amount"),
  ]);
  const rows = ((entriesQ.data ?? []) as CompanyLedgerEntry[]).map((e) => ({ ...e, amount: Number(e.amount) }));
  const balance = ((balanceQ.data ?? []) as { amount: number }[]).reduce((s, r) => s + Number(r.amount), 0);
  return <CapitalClient rows={rows} balance={balance} />;
}
