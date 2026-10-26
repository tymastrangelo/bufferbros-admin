import type { Metadata } from "next";
import { Stat } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/format";
import { addMonths, fmtMonth, todayYmd, ymOf } from "@/lib/time";
import { CashflowChart, type CashflowBar } from "./revenue-chart";

export const metadata: Metadata = { title: "Money" };
export const dynamic = "force-dynamic";

export default async function MoneyOverview() {
  const db = await createClient();
  const today = todayYmd();
  const thisYm = ymOf(today);
  const lastYm = addMonths(thisYm, -1);
  const chartStartYm = addMonths(thisYm, -11);

  const [ledgerQ, balancesQ, expensesQ, capitalQ] = await Promise.all([
    db
      .from("ledger_entries")
      .select("kind,amount,occurred_on,plan_id")
      .gte("occurred_on", `${chartStartYm}-01`),
    db.from("customer_balances").select("balance").neq("balance", 0),
    db.from("expenses").select("amount,occurred_on").gte("occurred_on", `${chartStartYm}-01`),
    db.from("company_ledger").select("amount,kind,party,occurred_on"),
  ]);

  const entries = ((ledgerQ.data ?? []) as { kind: string; amount: number; occurred_on: string; plan_id: string | null }[]).map(
    (e) => ({ ...e, amount: Number(e.amount) })
  );

  // collected = cash in hand (payments + prepaid credit − refunds); earned = charges posted
  const isCash = (k: string) => k === "payment" || k === "credit" || k === "refund";
  const collectedIn = (ym: string) =>
    entries.filter((e) => isCash(e.kind) && ymOf(e.occurred_on) === ym).reduce((s, e) => s + e.amount, 0);
  const earnedIn = (ym: string) =>
    entries.filter((e) => e.kind === "charge" && ymOf(e.occurred_on) === ym).reduce((s, e) => s + Math.abs(e.amount), 0);

  const balances = ((balancesQ.data ?? []) as { balance: number }[]).map((b) => Number(b.balance));
  const owed = balances.filter((b) => b < 0).reduce((s, b) => s + Math.abs(b), 0);
  const credit = balances.filter((b) => b > 0).reduce((s, b) => s + b, 0);

  const expenses = ((expensesQ.data ?? []) as { amount: number; occurred_on: string }[]).map((e) => ({
    ...e,
    amount: Number(e.amount),
  }));
  const expensesThisMonth = expenses.filter((e) => ymOf(e.occurred_on) === thisYm).reduce((s, e) => s + e.amount, 0);

  const collectedThis = collectedIn(thisYm);
  const collectedLast = collectedIn(lastYm);

  // Cash flow per month: what came in, what left to worker cuts + expenses. Worker
  // cuts come off the mirrored payout rows (CEO draw stays in "kept" — it's Tyler's).
  const companyRows = ((capitalQ.data ?? []) as { amount: number; kind: string; party: string | null; occurred_on: string }[]).map(
    (r) => ({ ...r, amount: Number(r.amount) })
  );
  const bars: CashflowBar[] = Array.from({ length: 12 }, (_, i) => {
    const ym = addMonths(chartStartYm, i);
    return {
      ym,
      collected: collectedIn(ym),
      workerCut: companyRows
        .filter((r) => r.kind === "payout" && r.party !== "ceo" && ymOf(r.occurred_on) === ym)
        .reduce((s, r) => s + Math.abs(r.amount), 0),
      expenses: expenses.filter((e) => ymOf(e.occurred_on) === ym).reduce((s, e) => s + e.amount, 0),
    };
  });
  const hasChartData = bars.some((b) => b.collected + b.workerCut + b.expenses > 0);

  const capital = companyRows.reduce((s, r) => s + r.amount, 0);
  // Real splits this month, from the mirrored company_ledger rows (each payment at its own payee's cut).
  const payoutsThis = companyRows.filter((r) => r.kind === "payout" && ymOf(r.occurred_on) === thisYm);
  const crewCutThis = payoutsThis.filter((r) => r.party !== "ceo").reduce((s, r) => s + Math.abs(r.amount), 0);
  const ceoCutThis = payoutsThis.filter((r) => r.party === "ceo").reduce((s, r) => s + Math.abs(r.amount), 0);
  const coThis = collectedThis - crewCutThis - ceoCutThis;

  return (
    <div className="mt-5 flex flex-col gap-6">
      {/* Headline numbers */}
      <div className="stat-grid grid-cols-2 md:grid-cols-3">
        <Stat
          label={`Collected — ${fmtMonth(thisYm)}`}
          value={money(collectedThis)}
          hint={`${fmtMonth(lastYm)}: ${money(collectedLast)}`}
        />
        <Stat label="Earned this month" value={money(earnedIn(thisYm))} hint={`last: ${money(earnedIn(lastYm))}`} />
        <Stat label="Net this month" value={money(collectedThis - expensesThisMonth)} hint={`after ${money(expensesThisMonth)} expenses`} />
        <Stat label="Outstanding owed" value={money(owed)} tone={owed > 0 ? "bad" : undefined} href="/money/balances" />
        <Stat label="Prepaid credit held" value={money(credit)} href="/money/balances" />
        <Stat label="Company capital" value={money(capital)} href="/money/capital" />
        {/* spans the row's leftover cells so the grid never shows empty gray */}
        <Stat
          label="Split this month — crew / CEO / company"
          value={`${money(crewCutThis)} / ${money(ceoCutThis)} / ${money(coThis)}`}
          hint="from the payments collected this month · each worker's cut lives on their Team page"
          className="col-span-2 md:col-span-3"
        />
      </div>

      {/* Cash-flow chart */}
      <section>
        <div className="flex items-baseline justify-between flex-wrap gap-x-3 gap-y-1">
          <h2 className="label">Cash flow — last 12 months</h2>
          {/* legend */}
          <div className="flex items-center gap-3 text-label text-ink-2">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-viz-1" /> collected
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-viz-2" /> worker cut
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-viz-3" /> expenses
            </span>
          </div>
        </div>
        <div className="card mt-2 p-4 md:p-5">
          {hasChartData ? (
            <CashflowChart bars={bars} />
          ) : (
            <p className="py-10 text-sm text-faint text-center">
              Cash flow shows up here as payments and expenses come in.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
