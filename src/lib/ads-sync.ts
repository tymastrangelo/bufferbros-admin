// Nightly (and on-demand) Google Ads sync: campaigns + 30 days of daily metrics into
// ad_campaigns / ad_metrics, Google campaigns auto-linked to CRM campaigns, and one
// synced `expenses` row per Google campaign per month so Marketing's spend math
// (expenses where category='marketing') keeps working untouched.
import "server-only";
import { CAMPAIGN_QUERY, gaql, metricsQuery, gadsEnv, parseCampaignRows, parseMetricRows, type GadsCredential, type GadsEnv } from "@/lib/google-ads";
import { monthSpend } from "@/lib/ads-math";
import { slugify } from "@/lib/marketing";
import { todayYmd } from "@/lib/time";
import { createServiceClient } from "@/lib/supabase/server";

export interface SyncResult {
  ok: boolean;
  error?: string;
  campaigns: number;
  days: number;
}

export async function getGadsSecret(key: "gads_refresh_token"): Promise<string | null> {
  const { data } = await createServiceClient().from("integration_secrets").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}

/** The credential we'll use: service account first, else the saved OAuth refresh token, else null. */
export async function gadsCredential(env: GadsEnv = gadsEnv()): Promise<GadsCredential | null> {
  if (env.serviceAccount) return { kind: "service_account", ...env.serviceAccount };
  const refresh = await getGadsSecret("gads_refresh_token");
  return refresh ? { kind: "oauth", refreshToken: refresh } : null;
}

async function setSetting(key: string, value: string) {
  await createServiceClient().from("settings").upsert({ key, value }, { onConflict: "key" });
}

export async function syncGoogleAds(): Promise<SyncResult> {
  const fail = async (error: string): Promise<SyncResult> => {
    await setSetting("gads_last_error", error);
    return { ok: false, error, campaigns: 0, days: 0 };
  };
  const env = gadsEnv();
  const cred = await gadsCredential(env);
  if (!cred) return fail("No way to sign in to Google Ads yet: add the service account keys on Vercel, or connect with Google.");
  const db = createServiceClient();
  const { data: cidRow } = await db.from("settings").select("value").eq("key", "gads_customer_id").maybeSingle();
  const customerId = (cidRow?.value ?? "").replace(/\D/g, "");
  if (!customerId) return fail("Pick which Google Ads account to sync.");

  try {
    const campaigns = parseCampaignRows(await gaql(env, cred, customerId, CAMPAIGN_QUERY));
    const metrics = parseMetricRows(await gaql(env, cred, customerId, metricsQuery(todayYmd()))).filter((m) => m.google_id && m.date);

    if (campaigns.length) {
      const { error } = await db.from("ad_campaigns").upsert(campaigns.map((c) => ({ ...c, synced_at: new Date().toISOString() })), { onConflict: "google_id" });
      if (error) throw new Error(error.message);
    }
    if (metrics.length) {
      const { error } = await db.from("ad_metrics").upsert(metrics, { onConflict: "google_id,date" });
      if (error) throw new Error(error.message);
    }

    // Link every Google campaign to a CRM campaign (by id, else slug/name), creating one if needed.
    const { data: crm } = await db.from("marketing_campaigns").select("id,name,utm_campaign,google_campaign_id,status");
    const rows = (crm ?? []) as { id: string; name: string; utm_campaign: string | null; google_campaign_id: string | null; status: string }[];
    const linkOf = new Map<string, string>();
    for (const c of campaigns) {
      let hit = rows.find((r) => r.google_campaign_id === c.google_id);
      if (!hit) {
        const slug = slugify(c.name);
        hit = rows.find((r) => !r.google_campaign_id && (r.utm_campaign === slug || r.name.trim().toLowerCase() === c.name.trim().toLowerCase()));
        if (hit) await db.from("marketing_campaigns").update({ google_campaign_id: c.google_id }).eq("id", hit.id);
      }
      if (!hit) {
        const { data: made } = await db
          .from("marketing_campaigns")
          .insert({
            channel: c.channel === "LOCAL_SERVICES" ? "google_lsa" : "google_ads",
            name: c.name,
            status: c.status === "ENABLED" ? "active" : "paused",
            utm_campaign: rows.some((r) => r.utm_campaign === slugify(c.name)) ? `${slugify(c.name)}-${c.google_id}` : slugify(c.name),
            google_campaign_id: c.google_id,
            notes: "Created by the Google Ads sync.",
          })
          .select("id,name,utm_campaign,google_campaign_id,status")
          .single();
        if (made) {
          hit = made as (typeof rows)[number];
          rows.push(hit);
        }
      }
      if (hit) linkOf.set(c.google_id, hit.id);
    }

    // Spend: one synced expense row per Google campaign per month. Month totals come from
    // everything stored for those months (not just this pull's window), so a sliding
    // 35-day window never shrinks an earlier month.
    const nameOf = new Map(campaigns.map((c) => [c.google_id, c.name]));
    const earliestMonth = metrics.map((m) => m.date.slice(0, 7)).sort()[0];
    const { data: stored, error: storedErr } = earliestMonth
      ? await db.from("ad_metrics").select("google_id,date,cost").gte("date", `${earliestMonth}-01`)
      : { data: [], error: null };
    if (storedErr) throw new Error(storedErr.message);
    for (const ms of monthSpend(((stored ?? []) as { google_id: string; date: string; cost: number }[]).map((m) => ({ ...m, cost: Number(m.cost) })))) {
      const campaignId = linkOf.get(ms.google_id) ?? null;
      const occurred_on = `${ms.month}-01`;
      const { data: existing, error: findErr } = await db
        .from("expenses")
        .select("id")
        .eq("source", "google_ads")
        .eq("google_campaign_id", ms.google_id)
        .eq("occurred_on", occurred_on)
        .maybeSingle();
      if (findErr) throw new Error(findErr.message);
      if (!existing && ms.amount === 0) continue; // nothing spent, nothing to show in Money
      const row = { occurred_on, category: "marketing", amount: ms.amount, memo: `Google Ads · ${ms.month} · ${nameOf.get(ms.google_id) ?? ms.google_id}`, campaign_id: campaignId, source: "google_ads", google_campaign_id: ms.google_id };
      const { error } = existing ? await db.from("expenses").update(row).eq("id", existing.id) : await db.from("expenses").insert(row);
      if (error) throw new Error(error.message);
    }

    await setSetting("gads_synced_at", new Date().toISOString());
    await setSetting("gads_last_error", "");
    await setSetting("gads_token_level", "ok");
    return { ok: true, campaigns: campaigns.length, days: new Set(metrics.map((m) => m.date)).size };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/approved/i.test(msg)) await setSetting("gads_token_level", "pending");
    return fail(msg);
  }
}
