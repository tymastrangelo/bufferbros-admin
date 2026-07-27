import type { Metadata } from "next";
import Link from "next/link";
import { getSettingsMap } from "@/lib/queries";
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

  const [ledgerQ, balancesQ, expensesQ, capitalQ, settings, workersQ] = await Promise.all([
    db
      .from("ledger_entries")
      .select("kind,amount,occurred_on,plan_id")
      .gte("occurred_on", `${chartStartYm}-01`),
    db.from("customer_balances").select("balance").neq("balance", 0),
    db.from("expenses").select("amount,occurred_on").gte("occurred_on", `${chartStartYm}-01`),
    db.from("company_ledger").select("amount,kind,party,occurred_on"),
    getSettingsMap(),
    db.from("employees").select("id,name,split_pct").eq("active", true).order("created_at"),
  ]);
  const workers = (workersQ.data ?? []) as { id: string; name: string; split_pct: number }[];

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
  const defaultWorker = workers.find((w) => w.id === settings.default_employee_id) ?? workers[0];
  const washerPct = defaultWorker ? Number(defaultWorker.split_pct) : Number(settings.split_washer_pct ?? 60);
  const workerName = defaultWorker?.name ?? "Worker";
  const ceoPct = Number(settings.split_ceo_pct ?? 10);
  const coPct = 100 - washerPct - ceoPct;

  return (
    <div className="mt-4 flex flex-col gap-5">
      {/* Headline numbers */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-px bg-line border border-line rounded-[10px] overflow-hidden">
        <Stat
          label={`Collected — ${fmtMonth(thisYm)}`}
          value={money(collectedThis)}
          sub={`${fmtMonth(lastYm)}: ${money(collectedLast)}`}
        />
        <Stat label="Earned this month" value={money(earnedIn(thisYm))} sub={`last: ${money(earnedIn(lastYm))}`} />
        <Stat label="Net this month" value={money(collectedThis - expensesThisMonth)} sub={`after ${money(expensesThisMonth)} expenses`} />
        <Stat label="Outstanding owed" value={money(owed)} tone={owed > 0 ? "bad" : undefined} link="/money/balances" />
        <Stat label="Prepaid credit held" value={money(credit)} link="/money/balances" />
        <Stat label="Company capital" value={money(capital)} link="/money/capital" />
        {/* spans the row's leftover cells so the grid never shows empty gray */}
        <Stat
          label={`Split — ${workerName} ${washerPct}% / CEO ${ceoPct}% / Co ${coPct}%`}
          value={`${money((collectedThis * washerPct) / 100)} / ${money((collectedThis * ceoPct) / 100)} / ${money((collectedThis * coPct) / 100)}`}
          sub="of collected this month · worker cuts live on the Team page"
          className="col-span-2 md:col-span-3"
        />
      </div>

      {/* Cash-flow chart */}
      <section>
        <div className="flex items-baseline justify-between flex-wrap gap-x-3 gap-y-1">
          <h2 className="label">Cash flow — last 12 months</h2>
          {/* legend */}
          <div className="flex items-center gap-3 text-[11px] text-ink-2">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#2563eb]" /> collected
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#0d9488]" /> worker cut
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#d97706]" /> expenses
            </span>
          </div>
        </div>
        <div className="card mt-1.5 p-4">
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

function Stat({
  label,
  value,
  sub,
  tone,
  link,
  className = "",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "bad";
  link?: string;
  className?: string;
}) {
  const inner = (
    <>
      <p className="label">{label}</p>
      <p className={`mt-1 text-lg font-semibold num leading-none ${tone === "bad" ? "text-bad" : ""}`}>{value}</p>
      {sub && <p className="mt-1 text-[11px] text-faint num">{sub}</p>}
    </>
  );
  return link ? (
    <Link href={link} className={`bg-card px-3.5 py-3 hover:bg-[#f8fafd] transition-colors duration-150 ${className}`}>
      {inner}
    </Link>
  ) : (
    <div className={`bg-card px-3.5 py-3 ${className}`}>{inner}</div>
  );
}
