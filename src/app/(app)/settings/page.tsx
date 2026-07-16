import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSettingsMap } from "@/lib/queries";
import { todayYmd } from "@/lib/time";
import type { Block, PlanPricing, Service, ServicePricing, WeeklyHours } from "@/lib/types";
import { SettingsClient } from "./settings-client";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireOwner();
  const db = await createClient();
  const [servicesQ, pricingQ, planPricingQ, hoursQ, blocksQ, settings, userQ] = await Promise.all([
    db.from("services").select("*").order("sort"),
    db.from("service_pricing").select("*"),
    db.from("plan_pricing").select("*"),
    db.from("weekly_hours").select("*").order("weekday"),
    db.from("blocks").select("*").gte("date", todayYmd()).order("date").limit(50),
    getSettingsMap(),
    db.auth.getUser(),
  ]);

  return (
    <SettingsClient
      services={(servicesQ.data ?? []) as Service[]}
      pricing={((pricingQ.data ?? []) as ServicePricing[]).map((p) => ({ ...p, price: Number(p.price) }))}
      planPricing={((planPricingQ.data ?? []) as PlanPricing[]).map((p) => ({ ...p, price: Number(p.price) }))}
      hours={(hoursQ.data ?? []) as WeeklyHours[]}
      blocks={(blocksQ.data ?? []) as Block[]}
      settings={settings}
      emailFrom={process.env.EMAIL_FROM ?? "not configured"}
      userEmail={userQ.data.user?.email ?? ""}
    />
  );
}
