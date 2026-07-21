// Server-side data loaders shared across pages.
import "server-only";
import type { Catalog } from "./catalog";
import { createClient } from "./supabase/server";
import type { PlanCadence, ServicePricing, SizeId } from "./types";

export async function getCatalog(): Promise<Catalog> {
  const db = await createClient();
  const [{ data: pricing }, { data: services }, { data: planPricing }] = await Promise.all([
    db.from("service_pricing").select("*"),
    db.from("services").select("*").eq("active", true).order("sort"),
    db.from("plan_pricing").select("*"),
  ]);

  const detail = { sedan: { price: 229, minutes: 120 }, midsize: { price: 249, minutes: 150 }, large: { price: 269, minutes: 180 } } as Catalog["detail"];
  for (const p of (pricing ?? []) as ServicePricing[]) {
    if (p.service_id === "standard" && p.size_id !== "*") {
      detail[p.size_id as SizeId] = { price: Number(p.price), minutes: p.minutes };
    }
  }

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
    addons,
    planPricing: ((planPricing ?? []) as { cadence: PlanCadence; size_id: string; price: number }[]).map((p) => ({
      ...p,
      price: Number(p.price),
    })),
  };
}

export async function getSettingsMap(): Promise<Record<string, string>> {
  const db = await createClient();
  const { data } = await db.from("settings").select("*");
  return Object.fromEntries(((data ?? []) as { key: string; value: string }[]).map((r) => [r.key, r.value]));
}
