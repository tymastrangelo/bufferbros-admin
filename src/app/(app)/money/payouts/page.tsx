import type { Metadata } from "next";
import { getSettingsMap } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { PayoutsClient, type PayoutEntry } from "./payouts-client";

export const metadata: Metadata = { title: "Payouts" };
export const dynamic = "force-dynamic";

export default async function PayoutsPage() {
  const db = await createClient();
  const [entriesQ, settings] = await Promise.all([
    db
      .from("ledger_entries")
      .select("id,amount,occurred_on,collected_by,settled_on,memo,customers(id,name)")
      .in("kind", ["payment", "credit"])
      .order("occurred_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(500),
    getSettingsMap(),
  ]);

  // supabase-js types the to-one `customers` embed as an array; it's an object at runtime.
  const rows = ((entriesQ.data ?? []) as unknown as PayoutEntry[]).map((e) => ({
    ...e,
    amount: Number(e.amount),
  }));

  const washerPct = Number(settings.split_washer_pct ?? 60);
  return <PayoutsClient rows={rows} washerPct={washerPct} />;
}
