import type { Metadata } from "next";
import Link from "next/link";
import { getSettingsMap } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/format";
import { addMonths, fmtMonth, todayYmd, ymOf } from "@/lib/time";
import { RevenueChart, type MonthBar } from "./revenue-chart";

export const metadata: Metadata = { title: "Money" };
export const dynamic = "force-dynamic";

export default async function MoneyOverview() {
  const db = await createClient();
  const today = todayYmd();
  const thisYm = ymOf(today);
  const lastYm = addMonths(thisYm, -1);
  const chartStartYm = addMonths(thisYm, -11);

  const [ledgerQ, balancesQ, expensesQ, settings] = await Promise.all([
    db
      .from("ledger_entries")
      .select("kind,amount,occurred_on,plan_id")
      .gte("occurred_on", `${chartStartYm}-01`),
    db.from("customer_balances").select("balance").neq("balance", 0),
    db.from("expenses").select("amount,occurred_on").gte("occurred_on", `${lastYm}-01`),
    getSettingsMap(),
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

  const bars: MonthBar[] = Array.from({ length: 12 }, (_, i) => {
    const ym = addMonths(chartStartYm, i);
    const monthCharges = entries.filter((e) => e.kind === "charge" && ymOf(e.occurred_on) === ym);
    return {
      ym,
      plans: monthCharges.filter((e) => e.plan_id).reduce((s, e) => s + Math.abs(e.amount), 0),
      oneTime: monthCharges.filter((e) => !e.plan_id).reduce((s, e) => s + Math.abs(e.amount), 0),
    };
  });
  const hasChartData = bars.some((b) => b.plans + b.oneTime > 0);

  const washerPct = Number(settings.split_washer_pct ?? 60);

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
        <Stat
          label={`Split — Gabe ${washerPct}% / Tyler ${100 - washerPct}%`}
          value={`${money((collectedThis * washerPct) / 100)} / ${money((collectedThis * (100 - washerPct)) / 100)}`}
          sub="of collected this month · edit in Settings"
        />
      </div>

      {/* Revenue chart */}
      <section>
        <div className="flex items-baseline justify-between">
          <h2 className="label">Earned by month — last 12</h2>
          {/* legend */}
          <div className="flex items-center gap-3 text-[11px] text-ink-2">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#2563eb]" /> plans
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#0d9488]" /> one-time
            </span>
          </div>
        </div>
        <div className="card mt-1.5 p-4">
          {hasChartData ? (
            <RevenueChart bars={bars} />
          ) : (
            <p className="py-10 text-sm text-faint text-center">
              Revenue shows up here as you complete jobs — charges post to the ledger automatically.
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
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "bad";
  link?: string;
}) {
  const inner = (
    <>
      <p className="label">{label}</p>
      <p className={`mt-1 text-lg font-semibold num leading-none ${tone === "bad" ? "text-bad" : ""}`}>{value}</p>
      {sub && <p className="mt-1 text-[11px] text-faint num">{sub}</p>}
    </>
  );
  return link ? (
    <Link href={link} className="bg-card px-3.5 py-3 hover:bg-[#f8fafd] transition-colors duration-150">
      {inner}
    </Link>
  ) : (
    <div className="bg-card px-3.5 py-3">{inner}</div>
  );
}
