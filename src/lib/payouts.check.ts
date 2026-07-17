// Runnable check for the split math: `npx tsx src/lib/payouts.check.ts`
import assert from "node:assert/strict";
import { netOwed, transfer } from "./payouts";

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

console.log("payouts.check ok");
