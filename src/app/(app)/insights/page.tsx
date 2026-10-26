import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth";
import { buildInsights, periodRange, type InsightsInput, type InsightsPeriod } from "@/lib/insights";
import { channelRows, totals } from "@/lib/marketing";
import { createClient } from "@/lib/supabase/server";
import { dateOfInstant, todayYmd } from "@/lib/time";
import { loadMarketing } from "../marketing/data";
import { InsightsClient, type MarketingSummary } from "./insights-client";

export const metadata: Metadata = { title: "Insights" };
export const dynamic = "force-dynamic";

const PERIODS: InsightsPeriod[] = ["4w", "3m", "12m", "all"];

export default async function InsightsPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  await requireOwner();
  const { p } = await searchParams;
  const period: InsightsPeriod = PERIODS.includes(p as InsightsPeriod) ? (p as InsightsPeriod) : "4w";
  const today = todayYmd();
  const range = periodRange(period, today);
  // Rows from the start of the previous period (all time when there is none).
  const since = range.prevFrom ?? range.from;
  const db = await createClient();
  const gte = <T extends { gte: (c: string, v: string) => T }>(q: T, col: string) => (since ? q.gte(col, since) : q);

  const [jobsQ, payQ, payoutQ, expQ, custQ, plansQ, empQ, marketing] = await Promise.all([
    // Full job history (small table): repeat rate and first-timers need "ever", not the window.
    db.from("appointments").select("id,date,status,price,service_name,addons,employee_id,customer_id,size_label,started_at,completed_at,created_at").neq("status", "pending"),
    gte(db.from("ledger_entries").select("occurred_on,kind,amount,processor_fee,tip").in("kind", ["payment", "credit", "refund"]), "occurred_on"),
    gte(db.from("company_ledger").select("occurred_on,party,employee_id,amount,memo").eq("kind", "payout"), "occurred_on"),
    gte(db.from("expenses").select("occurred_on,amount,category"), "occurred_on"),
    db.from("customers").select("id,created_at,name").eq("archived", false),
    db.from("plans").select("status"),
    db.from("employees").select("id,name,active,color").order("created_at"),
    loadMarketing(),
  ]);

  const input: InsightsInput = {
    today,
    period,
    jobs: ((jobsQ.data ?? []) as InsightsInput["jobs"]).map((j) => ({ ...j, price: Number(j.price), addons: j.addons ?? [] })),
    payments: ((payQ.data ?? []) as InsightsInput["payments"]).map((r) => ({ ...r, amount: Number(r.amount), processor_fee: Number(r.processor_fee ?? 0), tip: Number(r.tip ?? 0) })),
    payouts: ((payoutQ.data ?? []) as InsightsInput["payouts"]).map((r) => ({ ...r, amount: Number(r.amount) })),
    expenses: ((expQ.data ?? []) as InsightsInput["expenses"]).map((r) => ({ ...r, amount: Number(r.amount) })),
    customers: (custQ.data ?? []) as InsightsInput["customers"],
    plans: (plansQ.data ?? []) as InsightsInput["plans"],
    employees: (empQ.data ?? []) as InsightsInput["employees"],
  };
  const data = buildInsights(input);

  // Marketing: the same numbers Marketing shows, over this page's window.
  const rows = channelRows({
    customers: marketing.customers,
    revenue: new Map(marketing.revenue.map(([id, done, booked]) => [id, { done, booked }])),
    spend: marketing.spend,
    leads: marketing.leads.map((l) => ({ channel: l.resolvedChannel, on: dateOfInstant(l.created_at), customerId: l.customer_id })),
    from: data.range.from,
  });
  const t = totals(rows);
  const mk: MarketingSummary = { spend: t.spend, newCustomers: t.customers, costPer: t.paidCac, roas: t.roas };

  return <InsightsClient data={data} period={period} marketing={mk} />;
}
