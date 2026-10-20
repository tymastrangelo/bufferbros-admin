import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { findDuplicates, pairKey, type DupCandidate } from "@/lib/duplicates";
import { todayYmd } from "@/lib/time";
import type { Customer, TextSyncRun } from "@/lib/types";
import { CustomersClient, type CustomerRow } from "./customers-client";

export const metadata: Metadata = { title: "Customers" };
export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; dupes?: string }>;
}) {
  await requireOwner();
  const params = await searchParams;
  const db = await createClient();
  const today = todayYmd();

  const [customersQ, balancesQ, lastQ, nextQ, unlinkedQ, apptCustQ, ledgerCustQ, dismissedQ, syncQ] = await Promise.all([
    db.from("customers").select("*").order("created_at", { ascending: false }),
    db.from("customer_balances").select("*"),
    db.from("appointments").select("customer_id,date").eq("status", "completed").not("customer_id", "is", null).order("date", { ascending: false }),
    db.from("appointments").select("customer_id,date").eq("status", "scheduled").gte("date", today).not("customer_id", "is", null).order("date"),
    db.from("appointments").select("id", { count: "exact", head: true }).is("customer_id", null).eq("status", "scheduled"),
    // activity per customer — picks the natural keeper when suggesting merges
    db.from("appointments").select("customer_id").not("customer_id", "is", null),
    db.from("ledger_entries").select("customer_id"),
    db.from("customer_not_duplicates").select("a,b"),
    db.from("text_sync_runs").select("*").order("requested_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const activity = new Map<string, number>();
  for (const r of [...(apptCustQ.data ?? []), ...(ledgerCustQ.data ?? [])] as { customer_id: string }[])
    activity.set(r.customer_id, (activity.get(r.customer_id) ?? 0) + 1);

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

  const candidates: DupCandidate[] = rows.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    addresses: c.addresses,
    tags: c.tags,
    created_at: c.created_at,
    archived: c.archived,
    activity: activity.get(c.id) ?? 0,
  }));
  const dismissed = ((dismissedQ.data ?? []) as { a: string; b: string }[]).map((d) => pairKey(d.a, d.b));
  const duplicates = findDuplicates(candidates, dismissed);

  return (
    <CustomersClient
      textSync={(syncQ.data as TextSyncRun | null) ?? null}
      rows={rows}
      unlinkedCount={unlinkedQ.count ?? 0}
      openNew={params.new === "1"}
      duplicates={duplicates}
      candidates={candidates.filter((c) => duplicates.some((g) => g.ids.includes(c.id)))}
      openDuplicates={params.dupes === "1"}
    />
  );
}
