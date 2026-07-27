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
   * Boat detailing: a per-foot service menu (maintenance wash, deluxe wash, spray wax,
   * interior, oxidation removal, sealant, ceramic) — jobs pick which apply. Rates then
   * scale by hull-size tier, condition level, and an in-water surcharge.
   * Null until priced/active.
   */
  boat: {
    name: string;
    note: string | null;
    components: BoatComponent[];
    /** Sorted ascending; a hull ≥ fromFt multiplies every per-foot rate by pct/100. */
    tiers: { fromFt: number; pct: number }[];
    /** Condition multipliers picked per job; index 0 is the 100% baseline. */
    levels: { label: string; pct: number }[];
    /** Surcharge % when the boat sits in the water instead of on a trailer. */
    dockPct: number;
  } | null;
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

/** The default boat job: the deluxe exterior (wash + spray wax). */
export const BOAT_DEFAULT_SERVICES = ["wash-ft", "wax-ft"];
/** The recurring-plan boat service. */
export const BOAT_MAINTENANCE_ID = "maintenance-ft";

export interface BoatQuoteOpts {
  /** Which per-foot services this job includes (default: deluxe wash + wax). */
  componentIds?: string[];
  /** Condition multiplier from catalog.boat.levels (default 100 = maintained). */
  levelPct?: number;
  /** Boat is on a trailer — knocks the built-in in-water upcharge back off. */
  trailer?: boolean;
}

/** The trailer discount %, as shown to customers (the in-water upcharge, unwound). */
export function boatTrailerDiscountPct(catalog: Catalog): number {
  const pct = catalog.boat?.dockPct ?? 0;
  return Math.round((1 - 1 / (1 + pct / 100)) * 100);
}

/**
 * Everything that scales a boat's per-foot rates: size tier × condition × access.
 * Quotes assume the boat sits in the water (the dockPct upcharge is baked into the
 * base price); a trailer reads as a discount instead of water reading as a surcharge.
 */
export function boatMultiplier(catalog: Catalog, lengthFt: number, opts?: BoatQuoteOpts): number {
  const b = catalog.boat;
  if (!b) return 1;
  const tier = b.tiers.filter((t) => lengthFt >= t.fromFt).at(-1)?.pct ?? 100;
  return (tier / 100) * ((opts?.levelPct ?? 100) / 100) * (opts?.trailer ? 1 : 1 + b.dockPct / 100);
}

/** Base per-foot rate for the selected services (before size/condition/dock scaling). */
export function boatRatePerFt(catalog: Catalog, componentIds: string[] = BOAT_DEFAULT_SERVICES): number {
  return catalog.boat?.components.filter((c) => componentIds.includes(c.id)).reduce((s, c) => s + c.ratePerFt, 0) ?? 0;
}

/** Boat quote: length × selected services × size/condition/dock scaling. Zero without a length. */
export function boatQuote(catalog: Catalog, lengthFt: number | null, opts?: BoatQuoteOpts): { price: number; minutes: number } {
  if (!catalog.boat || !lengthFt) return { price: 0, minutes: 0 };
  const ids = opts?.componentIds ?? BOAT_DEFAULT_SERVICES;
  const comps = catalog.boat.components.filter((c) => ids.includes(c.id));
  const mult = boatMultiplier(catalog, lengthFt, opts);
  return {
    price: Math.round(lengthFt * comps.reduce((s, c) => s + c.ratePerFt, 0) * mult),
    minutes: Math.round(lengthFt * comps.reduce((s, c) => s + c.minutesPerFt, 0) * mult),
  };
}

/** Mixed selection of cars + boats: cars by size (+ add-ons), boats by their service menu. */
export function computeVehiclesQuote(
  catalog: Catalog,
  vehicles: { kind: "car" | "boat"; size_id: SizeId; length_ft: number | null }[],
  addonIds: string[],
  service: BaseService = "standard",
  boatOpts?: BoatQuoteOpts
): { price: number; minutes: number } {
  const cars = vehicles.filter((v) => v.kind !== "boat");
  const boats = vehicles.filter((v) => v.kind === "boat");
  const carQ = cars.length ? computeMultiQuote(catalog, cars.map((v) => v.size_id), addonIds, service) : { price: 0, minutes: 0 };
  return boats.reduce((acc, b) => {
    const q = boatQuote(catalog, b.length_ft, boatOpts);
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
