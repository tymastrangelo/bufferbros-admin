// Server-side data loaders shared across pages.
import "server-only";
import type { Catalog } from "./catalog";
import { createClient } from "./supabase/server";
import type { Employee, PlanCadence, ServicePricing, SizeId } from "./types";

/** service_pricing size_id → display name for the boat detail's per-foot service menu. */
export const BOAT_COMPONENT_NAMES: Record<string, string> = {
  "maintenance-ft": "Maintenance wash",
  "wash-ft": "Deluxe wash",
  "wax-ft": "Spray wax",
  "interior-ft": "Interior cabin",
  "oxidation-ft": "Hull / oxidation removal",
  "sealant-ft": "Polymer sealant",
  "ceramic-ft": "Ceramic coating",
};

export async function getCatalog(): Promise<Catalog> {
  const db = await createClient();
  const [{ data: pricing }, { data: services }, { data: planPricing }, { data: settingRows }] = await Promise.all([
    db.from("service_pricing").select("*"),
    db.from("services").select("*").eq("active", true).order("sort"),
    db.from("plan_pricing").select("*"),
    db.from("settings").select("*"),
  ]);
  const settings = Object.fromEntries(((settingRows ?? []) as { key: string; value: string }[]).map((r) => [r.key, r.value]));
  const num = (key: string, fallback: number) => {
    const n = Number(settings[key]);
    return Number.isFinite(n) ? n : fallback;
  };

  const detail = { sedan: { price: 229, minutes: 120 }, midsize: { price: 249, minutes: 150 }, large: { price: 269, minutes: 180 } } as Catalog["detail"];
  for (const p of (pricing ?? []) as ServicePricing[]) {
    if (p.service_id === "standard" && p.size_id !== "*") {
      detail[p.size_id as SizeId] = { price: Number(p.price), minutes: p.minutes };
    }
  }

  const ceramicSvc = ((services ?? []) as { id: string; kind: string; name: string; note: string | null }[]).find(
    (s) => s.id === "ceramic-coating" && s.kind === "detail"
  );
  let ceramic: Catalog["ceramic"] = null;
  if (ceramicSvc) {
    const bySize = {} as NonNullable<Catalog["ceramic"]>["bySize"];
    for (const p of (pricing ?? []) as ServicePricing[]) {
      if (p.service_id === "ceramic-coating" && p.size_id !== "*") {
        bySize[p.size_id as SizeId] = { price: Number(p.price), minutes: p.minutes };
      }
    }
    if (Object.keys(bySize).length === 3) ceramic = { name: ceramicSvc.name, note: ceramicSvc.note, bySize };
  }

  const boatSvc = ((services ?? []) as { id: string; kind: string; name: string; note: string | null }[]).find(
    (s) => s.id === "boat-detail" && s.kind === "detail"
  );
  // Per-foot service menu keyed by size_id; a quote sums the services a job picks.
  const boatComponents = Object.entries(BOAT_COMPONENT_NAMES).flatMap(([id, name]) => {
    const r = ((pricing ?? []) as ServicePricing[]).find((p) => p.service_id === "boat-detail" && p.size_id === id);
    return r ? [{ id, name, ratePerFt: Number(r.price), minutesPerFt: r.minutes }] : [];
  });
  const boat: Catalog["boat"] =
    boatSvc && boatComponents.length
      ? {
          name: boatSvc.name,
          note: boatSvc.note,
          components: boatComponents,
          tiers: [
            { fromFt: num("boat_tier2_from_ft", 30), pct: num("boat_tier2_pct", 125) },
            { fromFt: num("boat_tier3_from_ft", 45), pct: num("boat_tier3_pct", 175) },
          ].sort((a, b) => a.fromFt - b.fromFt),
          levels: [
            { label: "Maintained", pct: 100 },
            { label: "Average", pct: num("boat_level2_pct", 120) },
            { label: "Neglected", pct: num("boat_level3_pct", 150) },
          ],
          dockPct: num("boat_dock_pct", 15),
        }
      : null;

  const addons = ((services ?? []) as { id: string; kind: string; name: string }[])
    .filter((s) => s.kind === "addon")
    .map((s) => {
      const rows = ((pricing ?? []) as ServicePricing[]).filter((r) => r.service_id === s.id);
      const flat = rows.find((r) => r.size_id === "*") ?? rows[0];
      const sized = rows.filter((r) => r.size_id !== "*");
      const bySize = sized.length
        ? Object.fromEntries(sized.map((r) => [r.size_id, { price: Number(r.price), minutes: r.minutes }]))
        : undefined;
      return { id: s.id, name: s.name, price: Number(flat?.price ?? 0), minutes: flat?.minutes ?? 0, bySize };
    });

  return {
    detail,
    ceramic,
    boat,
    addons,
    rules: {
      ceramicLeadDays: num("ceramic_lead_days", 7),
      ceramicDepositPct: num("ceramic_deposit_pct", 50),
      planInitialDiscountPct: num("plan_initial_discount_pct", 10),
      prepayDiscountPct: num("prepay_discount_pct", 5),
      multiCarDiscountPct: num("multi_car_discount_pct", 5),
    },
    planPricing: ((planPricing ?? []) as { cadence: PlanCadence; size_id: string; price: number }[]).map((p) => ({
      ...p,
      price: Number(p.price),
    })),
  };
}

export async function getActiveEmployees(): Promise<Employee[]> {
  const db = await createClient();
  const { data } = await db.from("employees").select("*").eq("active", true).order("created_at");
  return ((data ?? []) as Employee[]).map((e) => ({ ...e, split_pct: Number(e.split_pct) }));
}

/** The signed-in user's employee row, or null for the owner / unlinked accounts. */
export async function getMyEmployee(): Promise<Employee | null> {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;
  const { data } = await db.from("employees").select("*").eq("user_id", user.id).maybeSingle();
  return data ? ({ ...(data as Employee), split_pct: Number((data as Employee).split_pct) } as Employee) : null;
}

export async function getSettingsMap(): Promise<Record<string, string>> {
  const db = await createClient();
  const { data } = await db.from("settings").select("*");
  return Object.fromEntries(((data ?? []) as { key: string; value: string }[]).map((r) => [r.key, r.value]));
}
