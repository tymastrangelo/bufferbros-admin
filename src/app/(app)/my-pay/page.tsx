import type { Metadata } from "next";
import { EmptyState, PageHeader, Stat } from "@/components/ui";
import { getMyEmployee } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/format";
import { fmtDateShort, todayYmd } from "@/lib/time";
import type { CompanyLedgerEntry } from "@/lib/types";

export const metadata: Metadata = { title: "My Pay" };
export const dynamic = "force-dynamic";

export default async function MyPayPage() {
  const db = await createClient();
  const me = await getMyEmployee();
  const { data } = await db
    .from("company_ledger")
    .select("*")
    .in("kind", ["payout", "revenue"])
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(900);
  const entries = ((data ?? []) as CompanyLedgerEntry[]).map((e) => ({ ...e, amount: Number(e.amount) }));

  // Pair each of the worker's payouts with the payment it came from. RLS scopes a
  // washer to their own rows already; the employee_id filter drops CEO payout rows.
  const revenueByEntry = new Map(
    entries.filter((e) => e.kind === "revenue" && e.ledger_entry_id).map((e) => [e.ledger_entry_id as string, e.amount])
  );
  const rows = entries
    // RLS already scopes a real worker; the explicit filter keeps an owner's "view as" honest.
    .filter((e) => e.kind === "payout" && e.employee_id != null && (!me || e.employee_id === me.id))
    .map((e) => {
      const keep = -e.amount; // payouts are stored negative
      // Gabe only owes Tyler on cash he physically collected. On Tyler-collected jobs he
      // just gets his cut — the client's total is none of his business (RLS also hides it).
      const collected = e.ledger_entry_id ? revenueByEntry.get(e.ledger_entry_id) ?? null : null;
      const send = e.collected_by === "washer" && collected != null ? collected - keep : null;
      return { ...e, keep, send, settled: !!e.settled_on };
    });

  const monthStart = `${todayYmd().slice(0, 7)}-01`;
  const thisMonth = rows.filter((r) => r.occurred_on >= monthStart);
  const keepTotal = thisMonth.reduce((s, r) => s + r.keep, 0);
  const sendTotal = thisMonth.reduce((s, r) => s + (r.send ?? 0), 0);
  const unsettledCount = rows.filter((r) => !r.settled).length;

  return (
    <div className="page max-w-3xl">
      <PageHeader title="My Pay" />
      <div className="stat-grid grid-cols-2">
        <Stat label="You keep — this month" value={<span className="text-2xl">{money(keepTotal)}</span>} tone="ok" />
        <Stat label="Send to Tyler — this month" value={<span className="text-2xl text-ink-2">{money(sendTotal)}</span>} />
      </div>
      {unsettledCount > 0 && (
        <p className="mt-4 text-dense text-ink-2">
          {unsettledCount} payment{unsettledCount === 1 ? "" : "s"} not squared up with Tyler yet.
        </p>
      )}
      <div className="mt-2 card overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState title="No pay recorded yet." hint="Your cut lands here automatically as payments come in." />
        ) : (
          <table className="tbl tbl-stack min-w-[520px]">
            <thead>
              <tr>
                <th>Date</th>
                <th>Job</th>
                <th className="text-right">You keep</th>
                <th className="text-right">To Tyler</th>
                <th className="text-right">Status</th>
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
                  <td data-label="You keep" className={`num text-right font-medium ${r.keep < 0 ? "text-bad" : ""}`}>
                    {money(r.keep)}
                  </td>
                  <td data-label="To Tyler" className="num text-right text-ink-2">
                    {r.send != null ? money(r.send) : "—"}
                  </td>
                  <td data-label="Status" className="text-right whitespace-nowrap">
                    {r.settled ? (
                      <span className="chip chip-ok">paid</span>
                    ) : (
                      <span className="chip">pending</span>
                    )}
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
