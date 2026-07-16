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
    .eq("kind", "payout")
    .eq("party", "gabe")
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(300);
  // Payouts are stored negative (money out of the company) — pay = the flip side.
  const rows = ((data ?? []) as CompanyLedgerEntry[]).map((e) => ({ ...e, pay: -Number(e.amount) }));
  const monthStart = `${todayYmd().slice(0, 7)}-01`;
  const thisMonth = rows.filter((r) => r.occurred_on >= monthStart).reduce((s, r) => s + r.pay, 0);

  return (
    <div className="px-4 md:px-8 py-5 md:py-7 max-w-3xl">
      <h1 className="text-xl md:text-2xl font-bold">My Pay</h1>
      <div className="mt-4 card p-3.5">
        <p className="label">This month</p>
        <p className="mt-1 text-2xl font-bold num">{money(thisMonth)}</p>
      </div>
      <div className="mt-4 card overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState title="No pay recorded yet." hint="Your cut lands here automatically as payments come in." />
        ) : (
          <table className="tbl tbl-stack min-w-[360px]">
            <thead>
              <tr>
                <th>Date</th>
                <th>Job</th>
                <th className="text-right">Your cut</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td data-label="Date" className="num whitespace-nowrap">
                    {fmtDateShort(r.occurred_on)}
                  </td>
                  <td data-label="Job" className="max-w-[240px] truncate">
                    {r.memo ?? "—"}
                  </td>
                  <td data-label="Your cut" className={`num text-right font-medium ${r.pay < 0 ? "text-bad" : ""}`}>
                    {money(r.pay)}
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
