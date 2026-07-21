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

export interface Catalog {
  /** The Standard Detail per size */
  detail: Record<SizeId, { price: number; minutes: number }>;
  addons: CatalogAddon[];
  planPricing: { cadence: PlanCadence; size_id: string; price: number }[];
}

export function computeQuote(
  catalog: Catalog,
  sizeId: SizeId,
  addonIds: string[]
): { price: number; minutes: number } {
  const base = catalog.detail[sizeId] ?? { price: 0, minutes: 120 };
  const extras = catalog.addons.filter((a) => addonIds.includes(a.id)).map((a) => addonQuote(a, sizeId));
  return {
    price: base.price + extras.reduce((s, a) => s + a.price, 0),
    minutes: base.minutes + extras.reduce((s, a) => s + a.minutes, 0),
  };
}

export function planPrice(catalog: Catalog, cadence: PlanCadence, sizeId: SizeId): number | null {
  return catalog.planPricing.find((p) => p.cadence === cadence && p.size_id === sizeId)?.price ?? null;
}
