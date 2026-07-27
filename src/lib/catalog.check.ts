// Runnable check for the multi-car quote math: `npx tsx src/lib/catalog.check.ts`
import assert from "node:assert/strict";
import { boatQuote, computeMultiQuote, computeQuote, computeVehiclesQuote, type Catalog } from "./catalog";

const catalog: Catalog = {
  detail: { sedan: { price: 229, minutes: 120 }, midsize: { price: 249, minutes: 150 }, large: { price: 269, minutes: 180 } },
  ceramic: null,
  boat: { name: "Boat Detail", note: null, ratePerFt: 12, minutesPerFt: 8 },
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

// Boats: length × per-foot rate; no length or no boat pricing = 0 (price it by hand).
assert.deepEqual(boatQuote(catalog, 24), { price: 288, minutes: 192 });
assert.deepEqual(boatQuote(catalog, null), { price: 0, minutes: 0 });
assert.deepEqual(boatQuote({ ...catalog, boat: null }, 24), { price: 0, minutes: 0 });
// Mixed visit: car quoted by size (+ add-ons), boat by the foot (add-ons don't apply).
assert.deepEqual(
  computeVehiclesQuote(
    catalog,
    [
      { kind: "car", size_id: "sedan", length_ft: null },
      { kind: "boat", size_id: "sedan", length_ft: 20 },
    ],
    ["pet-hair"]
  ),
  { price: 229 + 40 + 240, minutes: 120 + 30 + 160 }
);

// Plan multi-car discount as applied in plan-form: sum of per-size prices, minus pct when 2+.
const round = (raw: number, pct: number) => Math.round(raw * (1 - pct / 100));
assert.equal(round(120 + 140, 5), 247); // 260 - 5% = 247
assert.equal(round(120, 0), 120); // single car: no discount

console.log("catalog.check ok");
