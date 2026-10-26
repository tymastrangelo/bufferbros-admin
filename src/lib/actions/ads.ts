"use server";

// Google Ads from the dashboard — owner only, always real data. Every mutation is
// confirmed in the UI first and pushed to Tyler's phone here.
import { revalidatePath } from "next/cache";
import { gadsCredential, syncGoogleAds, type SyncResult } from "@/lib/ads-sync";
import { getRealRole } from "@/lib/auth";
import { gadsEnv, listAccessibleCustomers, mutateCampaignBudget, mutateCampaignStatus } from "@/lib/google-ads";
import { slugify } from "@/lib/marketing";
import { change, logActivity, usd } from "@/lib/notify";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { ActionResult } from "./appointments";

const refresh = () => revalidatePath("/marketing", "layout");
const ownerOnly = async () => (await getRealRole()) === "owner";

export async function syncGoogleAdsNow(): Promise<ActionResult & { result?: SyncResult }> {
  // activity: a sync changes nothing Tyler chose — the Ads page shows the result
  if (!(await ownerOnly())) return { ok: false, error: "Owner only." };
  const result = await syncGoogleAds();
  refresh();
  return result.ok ? { ok: true, result } : { ok: false, error: result.error ?? "Sync failed.", result };
}

export async function disconnectGoogleAds(): Promise<ActionResult> {
  if (!(await ownerOnly())) return { ok: false, error: "Owner only." };
  const db = createServiceClient();
  await db.from("integration_secrets").delete().eq("key", "gads_refresh_token");
  for (const key of ["gads_customer_id", "gads_accessible", "gads_synced_at", "gads_last_error"]) {
    await db.from("settings").upsert({ key, value: "" }, { onConflict: "key" });
  }
  await db.from("settings").upsert({ key: "gads_token_level", value: "unknown" }, { onConflict: "key" });
  await logActivity("disconnected Google Ads", ["Synced campaigns and spend stay; nothing new comes in until you reconnect"], "/marketing/ads", { tags: ["link"] });
  refresh();
  return { ok: true };
}

export async function pickGoogleAdsCustomer(customerId: string): Promise<ActionResult> {
  if (!(await ownerOnly())) return { ok: false, error: "Owner only." };
  const id = customerId.replace(/\D/g, "");
  if (id.length !== 10) return { ok: false, error: "A Google Ads customer id is 10 digits." };
  await createServiceClient().from("settings").upsert({ key: "gads_customer_id", value: id }, { onConflict: "key" });
  await logActivity("picked the Google Ads account to sync", [`Account ${id}`], "/marketing/ads", { tags: ["link"] });
  refresh();
  return { ok: true };
}

async function live() {
  const env = gadsEnv();
  const token = await gadsCredential(env);
  if (!token) return { ok: false as const, error: "No way to sign in to Google Ads yet — add the service account keys on Vercel or connect with Google." };
  const db = createServiceClient();
  const { data } = await db.from("settings").select("value").eq("key", "gads_customer_id").maybeSingle();
  const customerId = (data?.value ?? "").replace(/\D/g, "");
  if (!customerId) return { ok: false as const, error: "Pick the serving account first." };
  return { ok: true as const, env, token, customerId, db };
}

/** Which Ads accounts this login can see — fills the account picker (service-account mode). */
export async function listGoogleAdsAccounts(): Promise<ActionResult & { ids?: string[] }> {
  // activity: read
  if (!(await ownerOnly())) return { ok: false, error: "Owner only." };
  const env = gadsEnv();
  const cred = await gadsCredential(env);
  if (!cred) return { ok: false, error: "No way to sign in to Google Ads yet." };
  try {
    const ids = (await listAccessibleCustomers(env, cred)).filter((id) => id !== env.loginCustomerId);
    await createServiceClient().from("settings").upsert({ key: "gads_accessible", value: ids.join(",") }, { onConflict: "key" });
    if (ids.length === 1) await createServiceClient().from("settings").upsert({ key: "gads_customer_id", value: ids[0] }, { onConflict: "key" });
    refresh();
    return { ok: true, ids };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await noteApproval(createServiceClient(), msg);
    refresh();
    return { ok: false, error: msg };
  }
}

async function noteApproval(db: ReturnType<typeof createServiceClient>, msg: string) {
  if (/approved/i.test(msg)) await db.from("settings").upsert({ key: "gads_token_level", value: "pending" }, { onConflict: "key" });
}

export async function setCampaignStatus(googleId: string, status: "ENABLED" | "PAUSED"): Promise<ActionResult> {
  if (!(await ownerOnly())) return { ok: false, error: "Owner only." };
  const l = await live();
  if (!l.ok) return l;
  const { data: c } = await l.db.from("ad_campaigns").select("name,status").eq("google_id", googleId).maybeSingle();
  if (!c) return { ok: false, error: "Campaign not found — sync first." };
  try {
    await mutateCampaignStatus(l.env, l.token, l.customerId, googleId, status);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await noteApproval(l.db, msg);
    return { ok: false, error: msg };
  }
  await l.db.from("ad_campaigns").update({ status }).eq("google_id", googleId);
  await l.db.from("marketing_campaigns").update({ status: status === "ENABLED" ? "active" : "paused" }).eq("google_campaign_id", googleId);
  await logActivity(`${status === "PAUSED" ? "paused" : "resumed"} the Google Ads campaign “${c.name}”`, [change("Status", c.status, status)], "/marketing/ads", { tags: ["megaphone"] });
  refresh();
  return { ok: true };
}

export async function setDailyBudget(googleId: string, dollars: number): Promise<ActionResult> {
  if (!(await ownerOnly())) return { ok: false, error: "Owner only." };
  if (!(dollars >= 1 && dollars <= 1000)) return { ok: false, error: "Daily budget should be between $1 and $1,000." };
  const l = await live();
  if (!l.ok) return l;
  const { data: c } = await l.db.from("ad_campaigns").select("name,daily_budget,budget_resource").eq("google_id", googleId).maybeSingle();
  if (!c?.budget_resource) return { ok: false, error: "No budget on this campaign yet — sync first." };
  try {
    await mutateCampaignBudget(l.env, l.token, l.customerId, c.budget_resource, dollars);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await noteApproval(l.db, msg);
    return { ok: false, error: msg };
  }
  await l.db.from("ad_campaigns").update({ daily_budget: dollars }).eq("google_id", googleId);
  await logActivity(`changed the daily budget on “${c.name}”`, [change("Per day", Number(c.daily_budget ?? 0), dollars, (v) => usd(v as number)), `≈ ${usd(dollars * 30.4)} a month`], "/marketing/ads", { tags: ["megaphone"] });
  refresh();
  return { ok: true };
}

/** Point a Google campaign at a different CRM campaign ("new" creates one); synced spend rows follow. */
export async function linkGoogleCampaign(googleId: string, marketingCampaignId: string | "new"): Promise<ActionResult> {
  if (!(await ownerOnly())) return { ok: false, error: "Owner only." };
  const db = await createClient({ realData: true });
  const { data: g } = await db.from("ad_campaigns").select("name,channel,status").eq("google_id", googleId).maybeSingle();
  if (!g) return { ok: false, error: "Campaign not found — sync first." };
  let targetId = marketingCampaignId;
  if (marketingCampaignId === "new") {
    const { data: made, error } = await db
      .from("marketing_campaigns")
      .insert({ channel: g.channel === "LOCAL_SERVICES" ? "google_lsa" : "google_ads", name: g.name, status: g.status === "ENABLED" ? "active" : "paused", utm_campaign: `${slugify(g.name)}-${googleId}`, notes: "Created from the Ads page." })
      .select("id")
      .single();
    if (error || !made) return { ok: false, error: error?.message ?? "Couldn't create the campaign." };
    targetId = made.id;
  }
  await db.from("marketing_campaigns").update({ google_campaign_id: null }).eq("google_campaign_id", googleId);
  const { error } = await db.from("marketing_campaigns").update({ google_campaign_id: googleId }).eq("id", targetId);
  if (error) return { ok: false, error: error.message };
  await db.from("expenses").update({ campaign_id: targetId }).eq("source", "google_ads").eq("google_campaign_id", googleId);
  const { data: t } = await db.from("marketing_campaigns").select("name").eq("id", targetId).maybeSingle();
  await logActivity(`linked the Google campaign “${g.name}”`, [`Now counts under “${t?.name ?? "campaign"}” in Marketing`], "/marketing/campaigns", { tags: ["link"] });
  refresh();
  return { ok: true, id: targetId };
}
