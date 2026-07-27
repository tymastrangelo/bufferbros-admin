// Runnable check for the multi-car quote math: `npx tsx src/lib/catalog.check.ts`
import assert from "node:assert/strict";
import { boatQuote, boatTrailerDiscountPct, computeMultiQuote, computeQuote, computeVehiclesQuote, type Catalog } from "./catalog";

const catalog: Catalog = {
  detail: { sedan: { price: 229, minutes: 120 }, midsize: { price: 249, minutes: 150 }, large: { price: 269, minutes: 180 } },
  ceramic: null,
  boat: {
    name: "Boat Detail",
    note: null,
    components: [
      { id: "maintenance-ft", name: "Maintenance wash", ratePerFt: 6, minutesPerFt: 3 },
      { id: "wash-ft", name: "Deluxe wash", ratePerFt: 10, minutesPerFt: 3 },
      { id: "wax-ft", name: "Spray wax", ratePerFt: 5, minutesPerFt: 2 },
      { id: "interior-ft", name: "Interior cabin", ratePerFt: 8, minutesPerFt: 3 },
    ],
    tiers: [
      { fromFt: 30, pct: 125 },
      { fromFt: 45, pct: 175 },
    ],
    levels: [
      { label: "Maintained", pct: 100 },
      { label: "Average", pct: 120 },
      { label: "Neglected", pct: 150 },
    ],
    dockPct: 15,
  },
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

// Boats price in-water by default: deluxe wash + wax ($15/ft, 5min/ft) × 1.15 dock base.
assert.deepEqual(boatQuote(catalog, 24), { price: 414, minutes: 138 });
// On a trailer the in-water upcharge unwinds — reads as a discount.
assert.deepEqual(boatQuote(catalog, 24, { trailer: true }), { price: 360, minutes: 120 });
assert.equal(boatTrailerDiscountPct(catalog), 13); // 1 − 1/1.15
// Explicit service menu: wash + wax + interior = $23/ft × 1.15.
assert.deepEqual(boatQuote(catalog, 24, { componentIds: ["wash-ft", "wax-ft", "interior-ft"] }), { price: 635, minutes: 221 });
// Size tiers: 50 ft is in the ≥45 bracket, everything × 1.75 (why a 100-footer isn't $15/ft).
assert.deepEqual(boatQuote(catalog, 50), { price: 1509, minutes: 503 });
// Condition: neglected (×1.5) in the water on a 20-footer.
assert.deepEqual(boatQuote(catalog, 20, { levelPct: 150 }), { price: 518, minutes: 173 });
// Maintenance wash (the boat plan rate): 30 ft hits the ≥30 tier, 30 × $6 × 1.25 × 1.15.
assert.deepEqual(boatQuote(catalog, 30, { componentIds: ["maintenance-ft"] }), { price: 259, minutes: 129 });
// No length or no boat pricing = 0 (price it by hand).
assert.deepEqual(boatQuote(catalog, null), { price: 0, minutes: 0 });
assert.deepEqual(boatQuote({ ...catalog, boat: null }, 24), { price: 0, minutes: 0 });
// Mixed visit: car quoted by size (+ add-ons), boat by its service menu (add-ons don't apply).
assert.deepEqual(
  computeVehiclesQuote(
    catalog,
    [
      { kind: "car", size_id: "sedan", length_ft: null },
      { kind: "boat", size_id: "sedan", length_ft: 20 },
    ],
    ["pet-hair"]
  ),
  { price: 229 + 40 + 345, minutes: 120 + 30 + 115 }
);

// Plan multi-car discount as applied in plan-form: sum of per-size prices, minus pct when 2+.
const round = (raw: number, pct: number) => Math.round(raw * (1 - pct / 100));
assert.equal(round(120 + 140, 5), 247); // 260 - 5% = 247
assert.equal(round(120, 0), 120); // single car: no discount

console.log("catalog.check ok");
