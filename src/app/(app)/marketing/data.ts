// One loader for every Marketing tab: raw rows in, the normalized shapes the pure math in
// src/lib/marketing.ts wants out. Period filtering happens client-side so the segmented
// control is instant.
import "server-only";
import { acquisition, economics, leadChannel, type CampaignRef, type Economics } from "@/lib/marketing";
import { getSettingsMap } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { dateOfInstant, todayYmd } from "@/lib/time";
import type { ChannelId, Lead, MarketingCampaign } from "@/lib/types";

export interface MkCustomer {
  id: string;
  name: string;
  channel: ChannelId | null;
  campaignId: string | null;
  /** true = worked out from a booking/referral, not set by hand */
  derived: boolean;
  acquiredOn: string;
  archived: boolean;
}

export interface MkSpend {
  id: string;
  on: string;
  amount: number;
  memo: string | null;
  campaignId: string | null;
  channel: ChannelId | null;
}

export interface MkLead extends Lead {
  /** resolved: picked > campaign's > website attribution */
  resolvedChannel: ChannelId | null;
  resolvedCampaignId: string | null;
}

export interface MarketingData {
  today: string;
  customers: MkCustomer[];
  /** customer id → [completed revenue, scheduled value] */
  revenue: [string, number, number][];
  spend: MkSpend[];
  campaigns: MarketingCampaign[];
  leads: MkLead[];
  econ: Economics;
  /** what a biweekly plan through a Nov–Apr season leaves the business */
  planSeasonValue: number;
  reviews: { left: number; asked: number };
  referrals: number;
  signups: { total: number; redeemed: number };
}

export async function loadMarketing(): Promise<MarketingData> {
  const db = await createClient({ realData: true }); // never demo numbers here
  const today = todayYmd();
  const [custQ, apptQ, spendQ, campQ, leadQ, settings, empQ, suppliesQ, planQ, signupQ] = await Promise.all([
    db.from("customers").select("id,name,created_at,archived,acquired_via,acquired_campaign_id,referred_by,review_asked_on,review_left_on"),
    db.from("appointments").select("customer_id,date,created_at,status,price,plan_id,attribution").neq("status", "cancelled").order("date").order("created_at"),
    db.from("expenses").select("id,occurred_on,amount,memo,campaign_id").eq("category", "marketing").order("occurred_on", { ascending: false }),
    db.from("marketing_campaigns").select("*").order("created_at"),
    db.from("leads").select("*").order("created_at", { ascending: false }).limit(2000),
    getSettingsMap(),
    db.from("employees").select("split_pct").eq("active", true),
    db.from("expenses").select("amount").eq("category", "supplies"),
    db.from("plan_pricing").select("price").eq("cadence", "biweekly").eq("size_id", "midsize").maybeSingle(),
    db.from("email_signups").select("redeemed_at"),
  ]);

  const campaigns = ((campQ.data ?? []) as MarketingCampaign[]).map((c) => ({
    ...c,
    monthly_budget: c.monthly_budget == null ? null : Number(c.monthly_budget),
    target_cpa: c.target_cpa == null ? null : Number(c.target_cpa),
  }));
  const refs: CampaignRef[] = campaigns;
  const channelOfCampaign = new Map(campaigns.map((c) => [c.id, c.channel]));

  type ApptRow = { customer_id: string; date: string; status: string; price: number; plan_id: string | null; attribution: unknown };
  const appts = (apptQ.data ?? []) as ApptRow[];
  const firstAttr = new Map<string, unknown>();
  const revenue = new Map<string, [number, number]>();
  const firstTickets: number[] = [];
  const seen = new Set<string>();
  let completed = 0;
  for (const a of appts) {
    if (a.attribution && !firstAttr.has(a.customer_id)) firstAttr.set(a.customer_id, a.attribution);
    const price = Number(a.price) || 0;
    const r = revenue.get(a.customer_id) ?? [0, 0];
    if (a.status === "completed") {
      r[0] += price;
      completed++;
      // a new customer's first one-off detail is what an ad buys
      if (!seen.has(a.customer_id) && !a.plan_id && price > 0) firstTickets.push(price);
      seen.add(a.customer_id);
    } else if (a.date >= today) r[1] += price;
    revenue.set(a.customer_id, r);
  }

  type CustRow = {
    id: string;
    name: string;
    created_at: string;
    archived: boolean;
    acquired_via: ChannelId | null;
    acquired_campaign_id: string | null;
    referred_by: string | null;
    review_asked_on: string | null;
    review_left_on: string | null;
  };
  const custRows = (custQ.data ?? []) as CustRow[];
  const customers: MkCustomer[] = custRows.map((c) => {
    const acq = acquisition(c, firstAttr.get(c.id), refs);
    return { id: c.id, name: c.name, channel: acq.channel, campaignId: acq.campaignId, derived: acq.derived, acquiredOn: dateOfInstant(c.created_at), archived: c.archived };
  });

  const spend: MkSpend[] = ((spendQ.data ?? []) as { id: string; occurred_on: string; amount: number; memo: string | null; campaign_id: string | null }[]).map((e) => ({
    id: e.id,
    on: e.occurred_on,
    amount: Number(e.amount),
    memo: e.memo,
    campaignId: e.campaign_id,
    channel: e.campaign_id ? channelOfCampaign.get(e.campaign_id) ?? null : null,
  }));

  const leads: MkLead[] = ((leadQ.data ?? []) as Lead[]).map((l) => {
    const r = leadChannel(l, refs);
    return { ...l, est_value: l.est_value == null ? null : Number(l.est_value), resolvedChannel: r.channel, resolvedCampaignId: r.campaignId };
  });

  // Unit economics from real data, with sane fallbacks while the books are thin.
  const avgTicket = firstTickets.length ? firstTickets.reduce((s, n) => s + n, 0) / firstTickets.length : 249;
  const splits = ((empQ.data ?? []) as { split_pct: number }[]).map((e) => Number(e.split_pct));
  const washerPct = splits.length ? Math.max(...splits) : Number(settings.split_washer_pct ?? 60);
  const suppliesTotal = ((suppliesQ.data ?? []) as { amount: number }[]).reduce((s, e) => s + Number(e.amount), 0);
  const suppliesPerJob = completed >= 5 ? Math.round(suppliesTotal / completed) : 10;
  const econ = economics({ avgTicket: Math.round(avgTicket), washerPct, suppliesPerJob, target: Number(settings.marketing_target_cpa ?? 60) || 60 });
  const biweekly = Number((planQ.data as { price?: number } | null)?.price ?? 125);
  const planSeasonValue = Math.round(biweekly * 13 * econ.keepPct); // ~26 weeks, every other week

  const live = custRows.filter((c) => !c.archived);
  const signups = (signupQ.data ?? []) as { redeemed_at: string | null }[];
  return {
    today,
    customers,
    revenue: [...revenue].map(([id, [done, booked]]) => [id, done, booked]),
    spend,
    campaigns,
    leads,
    econ,
    planSeasonValue,
    reviews: { left: live.filter((c) => c.review_left_on).length, asked: live.filter((c) => c.review_asked_on || c.review_left_on).length },
    referrals: live.filter((c) => c.referred_by).length,
    signups: { total: signups.length, redeemed: signups.filter((s) => s.redeemed_at).length },
  };
}
