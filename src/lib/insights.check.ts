// Runnable check for the Insights math: `npx tsx src/lib/insights.check.ts`
import assert from "node:assert/strict";
import { buildInsights, bucketsFor, periodRange, type InsightsInput } from "./insights";

const today = "2026-10-26";
const job = (id: string, date: string, status: string, price: number, employee_id: string | null, customer_id: string, extra: Partial<InsightsInput["jobs"][number]> = {}) => ({
  id, date, status, price, service_name: "The Standard Detail", addons: [], employee_id, customer_id, size_label: null,
  started_at: status === "completed" ? `${date}T13:00:00Z` : null, completed_at: status === "completed" ? `${date}T15:00:00Z` : null, created_at: `${date}T00:00:00Z`, ...extra,
});
const input: InsightsInput = {
  today,
  period: "4w",
  jobs: [
    job("j1", "2026-09-29", "completed", 200, "A", "c3"),                       // first day of the period — counts
    job("j2", "2026-09-28", "completed", 100, "A", "c3"),                       // day before — previous period
    job("j3", "2026-10-10", "completed", 300, null, "c1"),                      // Tyler's own
    job("j4", "2026-10-20", "completed", 250, "B", "c1", { addons: [{ name: "Pet Hair Removal" }] }),
    job("j5", "2026-10-15", "cancelled", 200, "A", "c2"),
    job("j6", "2026-10-16", "no_show", 150, "B", "c2"),
    job("j7", "2026-10-22", "completed", 180, null, "c2", { service_name: "Boat Detail" }),
    job("j8", "2026-06-01", "completed", 400, "A", "c1"),                       // old — all-time only
  ],
  payments: [
    { occurred_on: "2026-09-29", kind: "payment", amount: 200, processor_fee: 0, tip: 0 },
    { occurred_on: "2026-10-10", kind: "payment", amount: 300, processor_fee: 0, tip: 20 },
    { occurred_on: "2026-10-11", kind: "refund", amount: -50, processor_fee: 0, tip: 0 },
    { occurred_on: "2026-09-28", kind: "payment", amount: 100, processor_fee: 0, tip: 0 },
  ],
  payouts: [
    { occurred_on: "2026-09-29", party: "employee", employee_id: "A", amount: -120 },
    { occurred_on: "2026-09-29", party: "ceo", employee_id: null, amount: -20 },
    { occurred_on: "2026-10-20", party: "employee", employee_id: "B", amount: -150 },
    { occurred_on: "2026-10-20", party: "employee", employee_id: "B", amount: -20, memo: "tip — Ann" }, // pass-through, not a cut
  ],
  expenses: [{ occurred_on: "2026-10-05", amount: 40, category: "supplies" }],
  customers: [
    { id: "c1", created_at: "2026-01-01T00:00:00Z", name: "Ann" },
    { id: "c2", created_at: "2026-10-21T00:00:00Z", name: "Bo" },
    { id: "c3", created_at: "2026-09-20T00:00:00Z", name: "Cy" },
  ],
  plans: [{ status: "active" }, { status: "active" }, { status: "paused" }],
  employees: [
    { id: "A", name: "Gabe", active: true, color: 1 },
    { id: "B", name: "Max", active: true, color: 2 },
  ],
};

// Ranges + buckets
assert.deepEqual(periodRange("4w", today), { from: "2026-09-29", to: today, prevFrom: "2026-09-01", prevTo: "2026-09-28" });
assert.equal(bucketsFor(periodRange("4w", today), "4w").length, 4);
assert.equal(bucketsFor(periodRange("12m", today), "12m").length, 12);
assert.equal(periodRange("12m", today).from, "2025-11-01");

const r = buildInsights(input);
// Headline (period edges: j1 in, j2 out)
assert.equal(r.headline.collected, 450);
assert.equal(r.headline.jobs, 4);
assert.equal(r.headline.avgTicket, 232.5);
assert.equal(r.headline.newCustomers, 1);
assert.equal(r.headline.repeatRate, 2 / 3); // c1 (3 jobs ever) and c3 (j2 + j1) repeat; c2 is new
assert.deepEqual(r.headline.prev, { collected: 100, jobs: 1, avgTicket: 100, newCustomers: 1, repeatRate: 0 });
// Lost jobs count in the jobs chart only
assert.equal(r.jobsSeries.reduce((s, b) => s + b.done, 0), 4);
assert.equal(r.jobsSeries.reduce((s, b) => s + b.lost, 0), 2);
// Revenue series totals
assert.equal(r.revenue.reduce((s, b) => s + b.collected, 0), 450);
assert.equal(r.revenue.reduce((s, b) => s + b.crewCut, 0), 270); // tip payout rows are not crew cut
assert.equal(r.revenue.reduce((s, b) => s + b.expenses, 0), 40);
// Crew: Tyler's row exists; workers carry their cut
const tyler = r.crew.find((c) => c.id === null)!;
assert.deepEqual([tyler.jobs, tyler.revenue, tyler.cut], [2, 480, 0]);
assert.deepEqual(r.crew.find((c) => c.id === "A")!.cut, 120);
assert.deepEqual(r.crew.find((c) => c.id === "B")!.cut, 150);
assert.equal(tyler.avgMin, 120);
// Services + customers
assert.equal(r.services[0].name, "The Standard Detail");
assert.equal(r.services.find((s) => s.name === "Boat Detail")!.revenue, 180);
assert.deepEqual(r.addons[0], { name: "Pet Hair Removal", count: 1 });
assert.deepEqual(r.topCustomers[0], { id: "c1", name: "Ann", revenue: 550, jobs: 2 });
assert.equal(r.activePlans, 2);
assert.equal(r.customers.reduce((s, b) => s + b.newCount, 0), 1);

// All time: no previous period; everything counts
const all = buildInsights({ ...input, period: "all" });
assert.equal(all.range.prevFrom, null);
assert.equal(all.headline.jobs, 6);
assert.equal(all.range.from, "2026-06-01");

// Empty period: honest nulls, nothing NaN
const empty = buildInsights({ ...input, today: "2020-01-31" });
assert.equal(empty.headline.jobs, 0);
assert.equal(empty.headline.avgTicket, null);
assert.equal(empty.headline.repeatRate, null);
const sweep = (v: unknown): void => {
  if (typeof v === "number") assert.ok(Number.isFinite(v), `non-finite number in insights: ${v}`);
  else if (Array.isArray(v)) v.forEach(sweep);
  else if (v && typeof v === "object") Object.values(v).forEach(sweep);
};
sweep(empty);

console.log("insights.check ok");
