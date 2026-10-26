// Runnable check for the split math: `npx tsx src/lib/payouts.check.ts`
import assert from "node:assert/strict";
import { myPayRows, netOwed, payeeOf, transfer } from "./payouts";

// Owner collected $1380 at 60% -> Tyler owes Gabe $828.
assert.deepEqual(transfer({ amount: 1380, collectedBy: "owner", settledOn: null }, 60), {
  direction: "owner_to_washer",
  amount: 828,
});
// Washer collected $220 at 60% -> Gabe owes Tyler the other 40% = $88.
assert.deepEqual(transfer({ amount: 220, collectedBy: "washer", settledOn: null }, 60), {
  direction: "washer_to_owner",
  amount: 88,
});

// Self-done detail (Tyler washed it himself): Gabe's cut is 0 no matter the split.
// Tyler collected -> nothing moves either way.
assert.deepEqual(transfer({ amount: 300, collectedBy: "owner", settledOn: null, selfDone: true }, 60), {
  direction: "owner_to_washer",
  amount: 0,
});
// Gabe somehow collected the cash for Tyler's job -> he owes the full net back.
assert.deepEqual(transfer({ amount: 300, collectedBy: "washer", settledOn: null, selfDone: true }, 60), {
  direction: "washer_to_owner",
  amount: 300,
});

// Net of the two: -828 (Tyler owes) + 88 (Gabe owes) = -740 -> Tyler owes Gabe $740.
const { net, count } = netOwed(
  [
    { amount: 1380, collectedBy: "owner", settledOn: null },
    { amount: 220, collectedBy: "washer", settledOn: null },
    { amount: 999, collectedBy: "owner", settledOn: "2026-07-16" }, // settled -> ignored
  ],
  60
);
assert.equal(net, -740);
assert.equal(count, 2);

// Tips pass through to the worker: owner-collected → Tyler owes cut + tip; worker-collected → the
// tip never leaves their pocket, they still owe the rest of the net; self-done → no tip either way.
assert.deepEqual(transfer({ amount: 200, tip: 20, collectedBy: "owner", settledOn: null }, 60), { direction: "owner_to_washer", amount: 140 });
assert.deepEqual(transfer({ amount: 200, tip: 20, collectedBy: "washer", settledOn: null }, 60), { direction: "washer_to_owner", amount: 80 });
assert.deepEqual(transfer({ amount: 200, tip: 20, collectedBy: "owner", settledOn: null, selfDone: true }, 60), { direction: "owner_to_washer", amount: 0 });

// Payee resolution — the TS twin of mirror_cash_split (0029): the job's worker, else the
// payment's explicit worker, else the plan's worker, else nobody.
const plans = new Map([["p1", "emp-b"]]);
const pw = (id: string) => plans.get(id) ?? null;
assert.equal(payeeOf({ appointments: { employee_id: "emp-a", plan_id: "p1" }, employee_id: null, plan_id: null }, pw), "emp-a");
assert.equal(payeeOf({ appointments: null, employee_id: "emp-c", plan_id: "p1" }, pw), "emp-c");
assert.equal(payeeOf({ appointments: null, employee_id: null, plan_id: "p1" }, pw), "emp-b");
assert.equal(payeeOf({ appointments: { employee_id: null, plan_id: "p1" }, employee_id: null, plan_id: null }, pw), "emp-b");
assert.equal(payeeOf({ appointments: null, employee_id: null, plan_id: null }, pw), null);
assert.equal(payeeOf({ appointments: null, employee_id: null, plan_id: "unknown" }, pw), null);
// A self-done job (owner kept it all) pays nobody even when the plan has a worker — matches the trigger.
assert.equal(payeeOf({ appointments: { employee_id: null, plan_id: "p1", self_done: true }, employee_id: null, plan_id: null }, pw), null);

// My Pay (worker view) from mirrored company_ledger rows: a tipped, worker-collected $200 job at 60%
// → keep 120 + 20 tip, send Tyler 80 (the tip never enters the transfer).
const mine = myPayRows(
  [
    { id: "r1", kind: "revenue", ledger_entry_id: "e1", employee_id: null, amount: 200, memo: "Al", collected_by: "washer", settled_on: null, occurred_on: "2026-10-20" },
    { id: "r2", kind: "revenue", ledger_entry_id: "e1", employee_id: null, amount: 20, memo: "tip — Al", collected_by: "washer", settled_on: null, occurred_on: "2026-10-20" },
    { id: "p1", kind: "payout", ledger_entry_id: "e1", employee_id: "A", amount: -120, memo: "Al", collected_by: "washer", settled_on: null, occurred_on: "2026-10-20" },
    { id: "p2", kind: "payout", ledger_entry_id: "e1", employee_id: "A", amount: -20, memo: "tip — Al", collected_by: "washer", settled_on: null, occurred_on: "2026-10-20" },
    { id: "c1", kind: "payout", ledger_entry_id: "e1", employee_id: null, amount: -20, memo: "Al", collected_by: "washer", settled_on: null, occurred_on: "2026-10-20" },
  ],
  "A"
);
assert.deepEqual(mine.map((r) => [r.id, r.keep, r.send, r.isTip]), [
  ["p1", 120, 80, false],
  ["p2", 20, 0, true],
]);

console.log("payouts.check ok");

// Worker-fronted expenses: until reimbursed they add to what Tyler owes the worker.
const fronted = netOwed(
  [
    { amount: 200, collectedBy: "owner", settledOn: null },            // Tyler owes 120
    { amount: 100, collectedBy: "washer", settledOn: null },           // worker owes 40
  ],
  60,
  [
    { amount: 42, reimbursedOn: null },                                // Tyler owes 42 more
    { amount: 99, reimbursedOn: "2026-10-20" },                        // already paid back → ignored
  ]
);
assert.equal(fronted.net, -122);
assert.equal(fronted.count, 3);
