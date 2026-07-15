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
      const p = ((pricing ?? []) as ServicePricing[]).find((r) => r.service_id === s.id);
      return { id: s.id, name: s.name, price: Number(p?.price ?? 0), minutes: p?.minutes ?? 0 };
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
