import type { Metadata } from "next";
import { EmptyState, PageHeader, Stat } from "@/components/ui";
import { getMyEmployee } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/format";
import { myPayRows } from "@/lib/payouts";
import { fmtDateShort, todayYmd } from "@/lib/time";
import type { CompanyLedgerEntry } from "@/lib/types";

export const metadata: Metadata = { title: "My Pay" };
export const dynamic = "force-dynamic";

export default async function MyPayPage() {
  const db = await createClient();
  const me = await getMyEmployee();
  const { data: frontedRows } = me
    ? await db.from("expenses").select("id,occurred_on,amount,memo,category,reimbursed_on").eq("paid_by_employee_id", me.id).order("occurred_on", { ascending: false }).limit(50)
    : { data: [] };
  const fronted = ((frontedRows ?? []) as { id: string; occurred_on: string; amount: number; memo: string | null; category: string; reimbursed_on: string | null }[]).map((f) => ({ ...f, amount: Number(f.amount) }));
  const owedBack = fronted.filter((f) => !f.reimbursed_on).reduce((s, f) => s + f.amount, 0);
  const { data } = await db
    .from("company_ledger")
    .select("*")
    .in("kind", ["payout", "revenue"])
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(900);
  const entries = ((data ?? []) as CompanyLedgerEntry[]).map((e) => ({ ...e, amount: Number(e.amount) }));

  // The worker's payout rows (RLS already scopes a real worker; the explicit filter keeps an
  // owner's "view as" honest). Tips are their own rows and never enter "send to Tyler".
  const rows = me ? myPayRows(entries, me.id) : [];

  const monthStart = `${todayYmd().slice(0, 7)}-01`;
  const thisMonth = rows.filter((r) => r.occurred_on >= monthStart);
  const keepTotal = thisMonth.reduce((s, r) => s + r.keep, 0);
  const tipTotal = thisMonth.filter((r) => r.isTip).reduce((s, r) => s + r.keep, 0);
  const sendTotal = thisMonth.reduce((s, r) => s + (r.send ?? 0), 0);
  const unsettledCount = rows.filter((r) => !r.settled).length;

  return (
    <div className="page max-w-3xl">
      <PageHeader title="My Pay" />
      <div className="stat-grid grid-cols-2">
        <Stat label="You keep — this month" value={<span className="text-2xl">{money(keepTotal)}</span>} hint={tipTotal > 0 ? `incl. ${money(tipTotal)} in tips` : undefined} tone="ok" />
        <Stat label="Send to Tyler — this month" value={<span className="text-2xl text-ink-2">{money(sendTotal)}</span>} />
      </div>
      {unsettledCount > 0 && (
        <p className="mt-4 text-dense text-ink-2">
          {unsettledCount} payment{unsettledCount === 1 ? "" : "s"} not squared up with Tyler yet.
        </p>
      )}
      {fronted.length > 0 && (
        <div className="mt-4 card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-line">
            <p className="label">Paid out of your pocket</p>
            <p className="text-xs text-ink-2">{owedBack > 0 ? `Tyler owes you ${money(owedBack)} back.` : "All paid back."} Text Tyler the receipt for anything new.</p>
          </div>
          <ul className="divide-y divide-line">
            {fronted.map((f) => (
              <li key={f.id} className="px-4 py-2 flex items-center gap-3 text-sm">
                <span className="num text-faint whitespace-nowrap">{fmtDateShort(f.occurred_on)}</span>
                <span className="min-w-0 grow truncate">{f.memo ?? f.category}</span>
                <span className="num font-medium">{money(f.amount)}</span>
                {f.reimbursed_on ? <span className="chip chip-ok">paid back</span> : <span className="chip">owed</span>}
              </li>
            ))}
          </ul>
        </div>
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
