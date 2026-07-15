// Pricing catalog: pure types + math, safe to import from client components.
import type { PlanCadence, SizeId } from "./types";

export interface CatalogAddon {
  id: string;
  name: string;
  price: number;
  minutes: number;
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
  const extras = catalog.addons.filter((a) => addonIds.includes(a.id));
  return {
    price: base.price + extras.reduce((s, a) => s + a.price, 0),
    minutes: base.minutes + extras.reduce((s, a) => s + a.minutes, 0),
  };
}

export function planPrice(catalog: Catalog, cadence: PlanCadence, sizeId: SizeId): number | null {
  return catalog.planPricing.find((p) => p.cadence === cadence && p.size_id === sizeId)?.price ?? null;
}
