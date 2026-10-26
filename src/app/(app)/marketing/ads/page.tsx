import type { Metadata } from "next";
import { gadsCredential } from "@/lib/ads-sync";
import { requireOwner } from "@/lib/auth";
import { gadsEnv } from "@/lib/google-ads";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { addDays, todayYmd } from "@/lib/time";
import type { AdCampaign, AdMetric } from "@/lib/types";
import { AdsClient, type AdsData } from "./ads-client";

export const metadata: Metadata = { title: "Ads" };
export const dynamic = "force-dynamic";

export default async function AdsPage({ searchParams }: { searchParams: Promise<{ error?: string; pick?: string; connected?: string }> }) {
  await requireOwner();
  const params = await searchParams;
  const db = await createClient({ realData: true }); // never demo numbers here
  const today = todayYmd();
  const since = addDays(today, -90);
  const [campQ, metQ, crmQ, settingsQ, handQ, secret] = await Promise.all([
    db.from("ad_campaigns").select("*").order("name"),
    db.from("ad_metrics").select("*").gte("date", since).order("date"),
    db.from("marketing_campaigns").select("id,name,channel,google_campaign_id").order("name"),
    db.from("settings").select("key,value").like("key", "gads_%"),
    // hand-logged Google spend that could double a synced month
    db.from("expenses").select("id,occurred_on,amount,memo,campaign_id").eq("category", "marketing").is("source", null).gte("occurred_on", addDays(today, -400)),
    gadsCredential(),
  ]);
  const settings = Object.fromEntries(((settingsQ.data ?? []) as { key: string; value: string }[]).map((r) => [r.key, r.value]));
  const env = gadsEnv();
  const synced = (campQ.data ?? []) as AdCampaign[];
  const syncedMonths = new Set<string>();
  const { data: syncedExp } = await createServiceClient().from("expenses").select("occurred_on").eq("source", "google_ads");
  for (const e of (syncedExp ?? []) as { occurred_on: string }[]) syncedMonths.add(e.occurred_on.slice(0, 7));
  const googleCampaignIds = new Set(((crmQ.data ?? []) as { id: string; google_campaign_id: string | null }[]).filter((c) => c.google_campaign_id).map((c) => c.id));
  const handLogged = ((handQ.data ?? []) as { id: string; occurred_on: string; amount: number; memo: string | null; campaign_id: string | null }[])
    .filter((e) => syncedMonths.has(e.occurred_on.slice(0, 7)) && ((e.campaign_id && googleCampaignIds.has(e.campaign_id)) || /google/i.test(e.memo ?? "")))
    .map((e) => ({ ...e, amount: Number(e.amount) }));

  const data: AdsData = {
    today,
    auth: secret ? secret.kind : null,
    saConfigured: !!env.serviceAccount,
    saEmail: env.serviceAccount?.email ?? null,
    oauthConfigured: !!env.oauth,
    connected: !!secret,
    customerId: settings.gads_customer_id ?? "",
    accessible: (settings.gads_accessible ?? "").split(",").filter(Boolean),
    tokenLevel: (settings.gads_token_level as AdsData["tokenLevel"]) || "unknown",
    syncedAt: settings.gads_synced_at || null,
    lastError: settings.gads_last_error || null,
    campaigns: synced.map((c) => ({ ...c, daily_budget: c.daily_budget == null ? null : Number(c.daily_budget) })),
    metrics: ((metQ.data ?? []) as AdMetric[]).map((m) => ({ ...m, cost: Number(m.cost), conversions: Number(m.conversions), conv_value: Number(m.conv_value) })),
    crm: (crmQ.data ?? []) as AdsData["crm"],
    handLogged,
    flash: { error: params.error ?? null, pick: params.pick === "1", connected: params.connected === "1" },
  };
  return <AdsClient data={data} />;
}
