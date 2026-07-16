import type { Metadata } from "next";
import { EmptyState } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/format";
import { fmtDateShort, todayYmd } from "@/lib/time";
import type { CompanyLedgerEntry } from "@/lib/types";

export const metadata: Metadata = { title: "My Pay" };
export const dynamic = "force-dynamic";

export default async function MyPayPage() {
  const db = await createClient();
  const { data } = await db
    .from("company_ledger")
    .select("*")
    .in("kind", ["payout", "revenue"])
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(900);
  const entries = ((data ?? []) as CompanyLedgerEntry[]).map((e) => ({ ...e, amount: Number(e.amount) }));

  // Pair each of Gabe's payouts with the payment it came from (owners also see CEO
  // payout rows here — ignore them; this page is Gabe's slice only).
  const revenueByEntry = new Map(
    entries.filter((e) => e.kind === "revenue" && e.ledger_entry_id).map((e) => [e.ledger_entry_id as string, e.amount])
  );
  const rows = entries
    .filter((e) => e.kind === "payout" && e.party === "gabe")
    .map((e) => {
      const keep = -e.amount; // payouts are stored negative
      const collected = e.ledger_entry_id ? revenueByEntry.get(e.ledger_entry_id) ?? null : null;
      return { ...e, keep, collected, send: collected != null ? collected - keep : null };
    });

  const monthStart = `${todayYmd().slice(0, 7)}-01`;
  const thisMonth = rows.filter((r) => r.occurred_on >= monthStart);
  const keepTotal = thisMonth.reduce((s, r) => s + r.keep, 0);
  const sendTotal = thisMonth.reduce((s, r) => s + (r.send ?? 0), 0);

  return (
    <div className="px-4 md:px-8 py-5 md:py-7 max-w-3xl">
      <h1 className="text-xl md:text-2xl font-bold">My Pay</h1>
      <div className="mt-4 grid grid-cols-2 gap-px bg-line border border-line rounded-lg overflow-hidden">
        <div className="bg-card px-3.5 py-3">
          <p className="label">You keep — this month</p>
          <p className="mt-1 text-2xl font-bold num">{money(keepTotal)}</p>
        </div>
        <div className="bg-card px-3.5 py-3">
          <p className="label">Send to Tyler — this month</p>
          <p className="mt-1 text-2xl font-bold num text-ink-2">{money(sendTotal)}</p>
        </div>
      </div>
      <div className="mt-4 card overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState title="No pay recorded yet." hint="Your cut lands here automatically as payments come in." />
        ) : (
          <table className="tbl tbl-stack min-w-[440px]">
            <thead>
              <tr>
                <th>Date</th>
                <th>Job</th>
                <th className="text-right">Collected</th>
                <th className="text-right">You keep</th>
                <th className="text-right">To Tyler</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td data-label="Date" className="num whitespace-nowrap">
                    {fmtDateShort(r.occurred_on)}
                  </td>
                  <td data-label="Job" className="max-w-[200px] truncate">
                    {r.memo ?? "—"}
                  </td>
                  <td data-label="Collected" className="num text-right text-ink-2">
                    {r.collected != null ? money(r.collected) : "—"}
                  </td>
                  <td data-label="You keep" className={`num text-right font-medium ${r.keep < 0 ? "text-bad" : ""}`}>
                    {money(r.keep)}
                  </td>
                  <td data-label="To Tyler" className="num text-right text-ink-2">
                    {r.send != null ? money(r.send) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
