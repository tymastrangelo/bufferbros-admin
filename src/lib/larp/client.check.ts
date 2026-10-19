// Runnable check for the LARP query engine: `npx tsx src/lib/larp/client.check.ts`
import assert from "node:assert/strict";
import { fakeQuery } from "./client";
import { larpDataset } from "./data";
import { addDays, todayYmd } from "../time";

const data = larpDataset([{ id: "emp-1", split_pct: 60 }]);
const get = async () => data;
const today = todayYmd();
type R = { data: unknown; error: { message: string } | null; count: number | null };
const run = (q: unknown) => Promise.resolve(q as PromiseLike<R>) as Promise<R>;

(async () => {
  // Deterministic: same input, same ids.
  assert.equal(larpDataset([{ id: "emp-1", split_pct: 60 }]), data);
  assert.ok((data.customers as unknown[]).length >= 600);

  // Today's jobs with the customer embed, ordered (Today page query).
  const jobs = await run(fakeQuery(get, "appointments").select("*, customers(id,name,phone,email,stripe_payments)").eq("date", today).neq("status", "cancelled").order("start_min"));
  const rows = jobs.data as { start_min: number; customers: { name: string } | null }[];
  assert.ok(rows.length > 0 || new Date().getDay() === 0, "weekday has jobs");
  rows.forEach((r, i) => i && assert.ok(r.start_min >= rows[i - 1].start_min));
  if (rows[0]) assert.equal(typeof rows[0].customers?.name, "string");

  // One-to-many then many-to-one embed (plan detail query).
  const plan = await run(fakeQuery(get, "plans").select("*, plan_vehicles(vehicles(*))").eq("status", "active").limit(1).single());
  const pv = (plan.data as { plan_vehicles: { vehicles: { make: string } }[] }).plan_vehicles;
  assert.ok(Array.isArray(pv) && typeof pv[0].vehicles.make === "string");

  // count + head, is null.
  const c = await run(fakeQuery(get, "appointments").select("id", { count: "exact", head: true }).eq("status", "completed").gte("date", addDays(today, -30)));
  assert.equal(c.data, null);
  assert.ok((c.count ?? 0) > 100, "a month of completed jobs");

  // or() with nested and(), ilike search (employee stats + customer search).
  const or = await run(fakeQuery(get, "appointments").select("id,status,date").or(`and(status.eq.completed,date.gte.${addDays(today, -7)}),and(status.eq.scheduled,date.gte.${today})`));
  for (const r of or.data as { status: string; date: string }[])
    assert.ok((r.status === "completed" && r.date >= addDays(today, -7)) || (r.status === "scheduled" && r.date >= today));
  const name = (data.customers[0] as { name: string }).name.split(" ")[0];
  const search = await run(fakeQuery(get, "customers").select("*").or(`name.ilike.%${name.toLowerCase()}%,email.ilike.%zzz%`).limit(8));
  assert.ok((search.data as unknown[]).length >= 1);

  // Revenue is "hella": last 30 days of payments well into six figures/yr pace.
  const pays = await run(fakeQuery(get, "ledger_entries").select("amount").eq("kind", "payment").gte("occurred_on", addDays(today, -30)));
  const month = (pays.data as { amount: number }[]).reduce((s, r) => s + r.amount, 0);
  assert.ok(month > 60000, `30-day revenue ${month}`);

  // Writes are refused, whatever the chain.
  const w = await run((fakeQuery(get, "customers") as unknown as { insert: (r: object) => { select: (s: string) => { single: () => unknown } } }).insert({ name: "x" }).select("id").single());
  assert.ok(w.error && /Demo data/.test(w.error.message));

  console.log(`larp client.check: ok (30-day revenue $${Math.round(month).toLocaleString()})`);
})();
