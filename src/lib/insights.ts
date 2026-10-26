// The Insights page math: one pure function over raw rows so the page and its check
// agree. Dates are YMD strings in business time (lib/time); "collected" follows
// payment dates, "jobs" follow job dates. Keep in step with insights.check.ts.
import { addDays, addMonths, fmtDateShort, fmtMonth, ymOf } from "@/lib/time";

export type InsightsPeriod = "4w" | "3m" | "12m" | "all";
export const INSIGHTS_PERIODS: { value: InsightsPeriod; label: string }[] = [
  { value: "4w", label: "4 weeks" },
  { value: "3m", label: "3 months" },
  { value: "12m", label: "12 months" },
  { value: "all", label: "All time" },
];

export interface InsightsInput {
  today: string;
  period: InsightsPeriod;
  jobs: {
    id: string;
    date: string;
    status: string;
    price: number;
    service_name: string;
    addons: { name: string }[];
    employee_id: string | null;
    customer_id: string | null;
    size_label: string | null;
    started_at: string | null;
    completed_at: string | null;
    created_at: string;
  }[];
  payments: { occurred_on: string; kind: "payment" | "credit" | "refund"; amount: number; processor_fee: number; tip: number }[];
  /** company_ledger rows with kind = 'payout' (negative amounts). */
  payouts: { occurred_on: string; party: string | null; employee_id: string | null; amount: number; memo?: string | null }[];
  expenses: { occurred_on: string; amount: number; category: string }[];
  customers: { id: string; created_at: string; name: string }[];
  plans: { status: string }[];
  employees: { id: string; name: string; active: boolean; color: number }[];
}

export interface Bucket {
  key: string;
  label: string;
  from: string;
  /** exclusive */
  to: string;
}

interface Headline {
  collected: number;
  jobs: number;
  avgTicket: number | null;
  newCustomers: number;
  repeatRate: number | null;
}

export interface Insights {
  range: { from: string | null; to: string; prevFrom: string | null; prevTo: string | null };
  headline: Headline & { prev: Headline };
  buckets: Bucket[];
  revenue: { key: string; collected: number; crewCut: number; expenses: number }[];
  jobsSeries: { key: string; done: number; lost: number }[];
  crew: { id: string | null; name: string; color: number | null; jobs: number; revenue: number; cut: number; avgMin: number | null; noShows: number }[];
  services: { name: string; count: number; revenue: number }[];
  addons: { name: string; count: number }[];
  customers: { key: string; newCount: number; returning: number }[];
  topCustomers: { id: string; name: string; revenue: number; jobs: number }[];
  activePlans: number;
}

const DAYS: Record<Exclude<InsightsPeriod, "12m" | "all">, number> = { "4w": 28, "3m": 91 };

/** Inclusive [from, to]; prev is the same length immediately before. "all" has no prev. */
export function periodRange(period: InsightsPeriod, today: string, earliest?: string | null): Insights["range"] {
  if (period === "all") return { from: earliest ?? null, to: today, prevFrom: null, prevTo: null };
  if (period === "12m") {
    const from = `${addMonths(ymOf(today), -11)}-01`;
    const prevFrom = `${addMonths(ymOf(today), -23)}-01`;
    return { from, to: today, prevFrom, prevTo: addDays(from, -1) };
  }
  const n = DAYS[period];
  const from = addDays(today, -(n - 1));
  return { from, to: today, prevFrom: addDays(from, -n), prevTo: addDays(from, -1) };
}

/** Weekly buckets for 4w/3m, monthly for 12m/all. The last bucket ends the day after `to`. */
export function bucketsFor(range: Insights["range"], period: InsightsPeriod): Bucket[] {
  const to = addDays(range.to, 1);
  const out: Bucket[] = [];
  if (period === "4w" || period === "3m") {
    const from = range.from ?? range.to;
    for (let cur = from; cur < to; cur = addDays(cur, 7)) {
      const end = addDays(cur, 7) < to ? addDays(cur, 7) : to;
      out.push({ key: cur, label: fmtDateShort(cur).replace(/^\w+, /, ""), from: cur, to: end });
    }
    return out;
  }
  const startYm = range.from ? ymOf(range.from) : ymOf(range.to);
  for (let ym = startYm; `${ym}-01` < to; ym = addMonths(ym, 1)) {
    const from = `${ym}-01`;
    const next = `${addMonths(ym, 1)}-01`;
    out.push({ key: ym, label: fmtMonth(ym).split(" ")[0], from, to: next < to ? next : to });
  }
  return out;
}

const inRange = (d: string, from: string | null, to: string) => (from == null || d >= from) && d <= to;
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const safeDiv = (a: number, b: number) => (b > 0 ? a / b : null);

export function buildInsights(input: InsightsInput): Insights {
  const earliest = [...input.jobs.map((j) => j.date), ...input.payments.map((p) => p.occurred_on)].sort()[0] ?? null;
  const range = periodRange(input.period, input.today, earliest);
  const buckets = bucketsFor(range, input.period);
  const done = (from: string | null, to: string) => input.jobs.filter((j) => j.status === "completed" && inRange(j.date, from, to));
  const collectedIn = (from: string | null, to: string) => sum(input.payments.filter((p) => inRange(p.occurred_on, from, to)).map((p) => p.amount));
  const newIn = (from: string | null, to: string) => input.customers.filter((c) => inRange(c.created_at.slice(0, 10), from, to)).length;
  const repeatRate = (from: string | null, to: string) => {
    const active = new Set(done(from, to).map((j) => j.customer_id).filter(Boolean) as string[]);
    if (active.size === 0) return null;
    const everCount = new Map<string, number>();
    for (const j of input.jobs) if (j.status === "completed" && j.customer_id && j.date <= to) everCount.set(j.customer_id, (everCount.get(j.customer_id) ?? 0) + 1);
    const repeaters = [...active].filter((id) => (everCount.get(id) ?? 0) >= 2).length;
    return repeaters / active.size;
  };
  const headlineFor = (from: string | null, to: string): Headline => {
    const d = done(from, to);
    return { collected: collectedIn(from, to), jobs: d.length, avgTicket: safeDiv(sum(d.map((j) => j.price)), d.length), newCustomers: newIn(from, to), repeatRate: repeatRate(from, to) };
  };
  const headline = headlineFor(range.from, range.to);
  const prev: Headline = range.prevFrom ? headlineFor(range.prevFrom, range.prevTo!) : { collected: 0, jobs: 0, avgTicket: null, newCustomers: 0, repeatRate: null };

  const within = (b: Bucket, d: string) => d >= b.from && d < b.to;
  const revenue = buckets.map((b) => ({
    key: b.key,
    collected: sum(input.payments.filter((p) => within(b, p.occurred_on)).map((p) => p.amount)),
    crewCut: sum(input.payouts.filter((p) => p.party !== "ceo" && !p.memo?.startsWith("tip — ") && within(b, p.occurred_on)).map((p) => Math.abs(p.amount))),
    expenses: sum(input.expenses.filter((e) => within(b, e.occurred_on)).map((e) => e.amount)),
  }));
  const jobsSeries = buckets.map((b) => ({
    key: b.key,
    done: input.jobs.filter((j) => j.status === "completed" && within(b, j.date)).length,
    lost: input.jobs.filter((j) => (j.status === "cancelled" || j.status === "no_show") && within(b, j.date)).length,
  }));

  const periodJobs = input.jobs.filter((j) => inRange(j.date, range.from, range.to));
  const crewRow = (id: string | null, name: string, color: number | null) => {
    const mine = periodJobs.filter((j) => j.employee_id === id);
    const d = mine.filter((j) => j.status === "completed");
    const timed = d.filter((j) => j.started_at && j.completed_at);
    return {
      id,
      name,
      color,
      jobs: d.length,
      revenue: sum(d.map((j) => j.price)),
      cut: id ? sum(input.payouts.filter((p) => p.employee_id === id && !p.memo?.startsWith("tip — ") && inRange(p.occurred_on, range.from, range.to)).map((p) => Math.abs(p.amount))) : 0,
      avgMin: timed.length ? Math.round(sum(timed.map((j) => (new Date(j.completed_at!).getTime() - new Date(j.started_at!).getTime()) / 60000)) / timed.length) : null,
      noShows: mine.filter((j) => j.status === "no_show").length,
    };
  };
  const crew = [
    crewRow(null, "Tyler", null),
    ...input.employees.filter((e) => e.active || periodJobs.some((j) => j.employee_id === e.id)).map((e) => crewRow(e.id, e.name, e.color)),
  ];

  const doneJobs = periodJobs.filter((j) => j.status === "completed");
  const byName = new Map<string, { count: number; revenue: number }>();
  for (const j of doneJobs) {
    const cur = byName.get(j.service_name) ?? { count: 0, revenue: 0 };
    byName.set(j.service_name, { count: cur.count + 1, revenue: cur.revenue + j.price });
  }
  const services = [...byName].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  const addonCount = new Map<string, number>();
  for (const j of doneJobs) for (const a of j.addons ?? []) addonCount.set(a.name, (addonCount.get(a.name) ?? 0) + 1);
  const addons = [...addonCount].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 6);

  const firstJobDate = new Map<string, string>();
  for (const j of [...input.jobs].filter((j) => j.status === "completed" && j.customer_id).sort((a, b) => a.date.localeCompare(b.date))) {
    if (!firstJobDate.has(j.customer_id!)) firstJobDate.set(j.customer_id!, j.date);
  }
  const customers = buckets.map((b) => {
    const ids = new Set(input.jobs.filter((j) => j.status === "completed" && j.customer_id && within(b, j.date)).map((j) => j.customer_id!));
    let newCount = 0;
    let returning = 0;
    for (const id of ids) {
      if (within(b, firstJobDate.get(id)!)) newCount++;
      else returning++;
    }
    return { key: b.key, newCount, returning };
  });
  const byCustomer = new Map<string, { revenue: number; jobs: number }>();
  for (const j of doneJobs) {
    if (!j.customer_id) continue;
    const cur = byCustomer.get(j.customer_id) ?? { revenue: 0, jobs: 0 };
    byCustomer.set(j.customer_id, { revenue: cur.revenue + j.price, jobs: cur.jobs + 1 });
  }
  const nameOf = new Map(input.customers.map((c) => [c.id, c.name]));
  const topCustomers = [...byCustomer]
    .map(([id, v]) => ({ id, name: nameOf.get(id) ?? "Customer", ...v }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  return {
    range,
    headline: { ...headline, prev },
    buckets,
    revenue,
    jobsSeries,
    crew,
    services,
    addons,
    customers,
    topCustomers,
    activePlans: input.plans.filter((p) => p.status === "active").length,
  };
}
