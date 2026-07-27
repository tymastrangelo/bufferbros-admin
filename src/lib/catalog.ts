// Pricing catalog: pure types + math, safe to import from client components.
import type { PlanCadence, SizeId } from "./types";

export interface CatalogAddon {
  id: string;
  name: string;
  price: number;
  minutes: number;
  /** Set when the add-on is priced per vehicle size; price/minutes above are then a fallback. */
  bySize?: Partial<Record<SizeId, { price: number; minutes: number }>>;
}

/** Price/minutes for an add-on given the chosen vehicle size. */
export function addonQuote(a: CatalogAddon, sizeId: SizeId): { price: number; minutes: number } {
  return a.bySize?.[sizeId] ?? { price: a.price, minutes: a.minutes };
}

/** One per-foot slice of the boat detail (exterior wash / spray wax / interior). */
export interface BoatComponent {
  id: string;
  name: string;
  ratePerFt: number;
  minutesPerFt: number;
}

/** Base services a job can be quoted on. Ceramic already includes the full detail. */
export type BaseService = "standard" | "ceramic";

export interface Catalog {
  /** The Standard Detail per size */
  detail: Record<SizeId, { price: number; minutes: number }>;
  /** Ceramic Coating per size (includes a full detail) — null until priced/active. */
  ceramic: { name: string; note: string | null; bySize: Record<SizeId, { price: number; minutes: number }> } | null;
  /**
   * Boat detailing, priced per foot of boat and built from components (exterior wash,
   * spray wax, interior) so each rate edits independently — null until priced/active.
   */
  boat: { name: string; note: string | null; components: BoatComponent[] } | null;
  addons: CatalogAddon[];
  planPricing: { cadence: PlanCadence; size_id: string; price: number }[];
  /** Business rules from the settings table (with sane defaults). */
  rules: {
    ceramicLeadDays: number;
    ceramicDepositPct: number;
    planInitialDiscountPct: number;
    prepayDiscountPct: number;
    /** Off a plan's per-visit price when 2+ cars are cleaned in the same visit. */
    multiCarDiscountPct: number;
  };
}

export function computeQuote(
  catalog: Catalog,
  sizeId: SizeId,
  addonIds: string[],
  service: BaseService = "standard"
): { price: number; minutes: number } {
  const base =
    (service === "ceramic" ? catalog.ceramic?.bySize[sizeId] : catalog.detail[sizeId]) ?? { price: 0, minutes: 120 };
  const extras = catalog.addons.filter((a) => addonIds.includes(a.id)).map((a) => addonQuote(a, sizeId));
  return {
    price: base.price + extras.reduce((s, a) => s + a.price, 0),
    minutes: base.minutes + extras.reduce((s, a) => s + a.minutes, 0),
  };
}

/** Total per-foot rate across the boat's components (the everything-included rate). */
export function boatRatePerFt(catalog: Catalog): number {
  return catalog.boat?.components.reduce((s, c) => s + c.ratePerFt, 0) ?? 0;
}

/** Boat detail quote: length × summed component rates. Zero until a length is on file. */
export function boatQuote(catalog: Catalog, lengthFt: number | null): { price: number; minutes: number } {
  if (!catalog.boat || !lengthFt) return { price: 0, minutes: 0 };
  return {
    price: Math.round(lengthFt * boatRatePerFt(catalog)),
    minutes: Math.round(lengthFt * catalog.boat.components.reduce((s, c) => s + c.minutesPerFt, 0)),
  };
}

/** Mixed selection of cars + boats: cars by size (+ add-ons), boats by the foot. */
export function computeVehiclesQuote(
  catalog: Catalog,
  vehicles: { kind: "car" | "boat"; size_id: SizeId; length_ft: number | null }[],
  addonIds: string[],
  service: BaseService = "standard"
): { price: number; minutes: number } {
  const cars = vehicles.filter((v) => v.kind !== "boat");
  const boats = vehicles.filter((v) => v.kind === "boat");
  const carQ = cars.length ? computeMultiQuote(catalog, cars.map((v) => v.size_id), addonIds, service) : { price: 0, minutes: 0 };
  return boats.reduce((acc, b) => {
    const q = boatQuote(catalog, b.length_ft);
    return { price: acc.price + q.price, minutes: acc.minutes + q.minutes };
  }, carQ);
}

/** One visit covering several cars: each car quoted at its own size, summed. */
export function computeMultiQuote(
  catalog: Catalog,
  sizeIds: SizeId[],
  addonIds: string[],
  service: BaseService = "standard"
): { price: number; minutes: number } {
  return sizeIds.reduce(
    (acc, s) => {
      const q = computeQuote(catalog, s, addonIds, service);
      return { price: acc.price + q.price, minutes: acc.minutes + q.minutes };
    },
    { price: 0, minutes: 0 }
  );
}

export function planPrice(catalog: Catalog, cadence: PlanCadence, sizeId: SizeId): number | null {
  return catalog.planPricing.find((p) => p.cadence === cadence && p.size_id === sizeId)?.price ?? null;
}

/** Visits in ~a quarter (13 weeks) — the minimum block for the prepay discount. */
export function visitsPerQuarter(cadence: PlanCadence, intervalDays?: number | null): number {
  if (cadence === "weekly") return 13;
  if (cadence === "biweekly") return 6;
  if (cadence === "monthly") return 3;
  return Math.max(1, Math.round(91 / (intervalDays || 14)));
}

/** The required first visit before a maintenance plan: full detail minus the plan discount. */
export function initialDetailPrice(catalog: Catalog, sizeId: SizeId): number {
  const full = catalog.detail[sizeId]?.price ?? 0;
  return Math.round(full * (1 - catalog.rules.planInitialDiscountPct / 100));
}
