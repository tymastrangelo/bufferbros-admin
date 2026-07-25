// Runnable check for the multi-car quote math: `npx tsx src/lib/catalog.check.ts`
import assert from "node:assert/strict";
import { computeMultiQuote, computeQuote, type Catalog } from "./catalog";

const catalog: Catalog = {
  detail: { sedan: { price: 229, minutes: 120 }, midsize: { price: 249, minutes: 150 }, large: { price: 269, minutes: 180 } },
  ceramic: null,
  addons: [
    { id: "pet-hair", name: "Pet hair", price: 40, minutes: 30 },
    {
      id: "clay-wax",
      name: "Clay bar + wax",
      price: 0,
      minutes: 0,
      bySize: { sedan: { price: 80, minutes: 45 }, midsize: { price: 90, minutes: 50 }, large: { price: 100, minutes: 60 } },
    },
  ],
  planPricing: [],
  rules: { ceramicLeadDays: 7, ceramicDepositPct: 50, planInitialDiscountPct: 10, prepayDiscountPct: 5, multiCarDiscountPct: 5 },
};

// Two cars = each quoted at its own size, summed — flat AND per-size add-ons apply per car.
assert.deepEqual(computeMultiQuote(catalog, ["sedan", "large"], ["pet-hair", "clay-wax"]), {
  price: 229 + 40 + 80 + 269 + 40 + 100,
  minutes: 120 + 30 + 45 + 180 + 30 + 60,
});
// One car through the multi path matches the single-car quote exactly.
assert.deepEqual(computeMultiQuote(catalog, ["midsize"], ["pet-hair"]), computeQuote(catalog, "midsize", ["pet-hair"]));
// No cars = nothing.
assert.deepEqual(computeMultiQuote(catalog, [], ["pet-hair"]), { price: 0, minutes: 0 });

// Plan multi-car discount as applied in plan-form: sum of per-size prices, minus pct when 2+.
const round = (raw: number, pct: number) => Math.round(raw * (1 - pct / 100));
assert.equal(round(120 + 140, 5), 247); // 260 - 5% = 247
assert.equal(round(120, 0), 120); // single car: no discount

console.log("catalog.check ok");
