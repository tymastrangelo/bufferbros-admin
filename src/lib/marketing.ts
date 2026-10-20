// Marketing math, pure so the Marketing pages and marketing.check.ts share it:
//  - channelFromAttribution(): a website visit's tags (utm, click ids, referrer) or the
//    booking's "How did you hear about us?" answer → one channel.
//  - acquisition(): where a customer came from: their saved source, else who referred
//    them, else their first booking's attribution.
//  - channelRows() + channelCall(): per channel spend → leads → new customers → revenue,
//    and the one weekly call per paid channel. Rules follow the ads / local-ppc playbooks:
//    judge on cost per NEW CUSTOMER (not clicks or leads), no verdict on tiny samples,
//    budgets move at most 20% a week, and nothing is spent past twice break-even blind.
// ponytail: first-touch acquisition only. Multi-touch attribution is noise at a few
// dozen customers a month; revisit past ~100 new customers/month.
import { addDays } from "./time";
import type { ChannelId, LeadKind, LeadStatus } from "./types";

export const CHANNELS: { id: ChannelId; label: string; hint: string }[] = [
  { id: "google_ads", label: "Google Ads", hint: "Search ads, pay per click" },
  { id: "google_lsa", label: "Local Services Ads", hint: "Google Verified, pay per lead" },
  { id: "google_organic", label: "Google and Maps", hint: "Business Profile and search, free" },
  { id: "meta_ads", label: "Meta ads", hint: "Paid Facebook and Instagram" },
  { id: "social", label: "Social posts", hint: "Our own Instagram and Facebook" },
  { id: "nextdoor", label: "Nextdoor", hint: "Posts, recommendations, ads" },
  { id: "print", label: "Print and truck", hint: "Door hangers, cards, the truck" },
  { id: "partnership", label: "Partners", hint: "Condos, HOAs, marinas, realtors" },
  { id: "referral", label: "Referrals", hint: "A customer sent them" },
  { id: "word_of_mouth", label: "People we know", hint: "Friends, family, our network" },
  { id: "other", label: "Other", hint: "Anything else" },
];

export const channelLabel = (id: ChannelId | null | undefined) => CHANNELS.find((c) => c.id === id)?.label ?? "Unknown";
export const isChannel = (v: unknown): v is ChannelId => CHANNELS.some((c) => c.id === v);

export const LEAD_STATUSES: { id: LeadStatus; label: string }[] = [
  { id: "new", label: "New" },
  { id: "contacted", label: "Contacted" },
  { id: "quoted", label: "Quoted" },
  { id: "booked", label: "Booked" },
  { id: "lost", label: "Lost" },
];
export const OPEN_LEAD: LeadStatus[] = ["new", "contacted", "quoted"];

export const LEAD_KINDS: { id: LeadKind; label: string }[] = [
  { id: "call", label: "Call" },
  { id: "text", label: "Text" },
  { id: "dm", label: "DM" },
  { id: "form", label: "Website form" },
  { id: "boat_inquiry", label: "Boat quote" },
  { id: "email_signup", label: "Email signup" },
  { id: "in_person", label: "In person" },
];
export const leadKindLabel = (k: LeadKind) => LEAD_KINDS.find((x) => x.id === k)?.label ?? k;

// ── Tracking links ───────────────────────────────────────────────────────────

/** utm_source / utm_medium we stamp per channel. channelFromAttribution() reads them back. */
const UTM: Record<ChannelId, [source: string, medium: string]> = {
  google_ads: ["google", "cpc"],
  google_lsa: ["google", "lsa"],
  google_organic: ["google", "organic"],
  meta_ads: ["meta", "paid"],
  social: ["instagram", "social"],
  nextdoor: ["nextdoor", "social"],
  print: ["print", "qr"],
  partnership: ["partner", "referral"],
  referral: ["referral", "word"],
  word_of_mouth: ["friend", "word"],
  other: ["other", "other"],
};

export const SITE = "https://bufferbros.org";

/** A website link that credits bookings to this campaign. */
export function trackingLink(channel: ChannelId, slug: string, path = "/booking"): string {
  const [source, medium] = UTM[channel];
  return `${SITE}${path}?utm_source=${source}&utm_medium=${medium}&utm_campaign=${encodeURIComponent(slug)}`;
}

/** "Search · Marco + Naples" → "search-marco-naples" */
export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

// ── Attribution → channel ────────────────────────────────────────────────────

export interface Touch {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  fbclid?: string;
  ref?: string;
  referrer?: string;
}
interface Attribution {
  first?: Touch | null;
  last?: Touch | null;
  heard?: string | null;
}

const lc = (s: unknown) => (typeof s === "string" ? s.trim().toLowerCase() : "");

/** A visit's channel from hard evidence only (utm tags, ad click ids, referral codes). */
function taggedChannel(t: Touch): ChannelId | null {
  const src = lc(t.utm_source);
  const med = lc(t.utm_medium);
  if (t.gclid || t.gbraid || t.wbraid) return "google_ads";
  if (src) {
    const ours = (Object.entries(UTM) as [ChannelId, [string, string]][]).find(([, [s, m]]) => s === src && m === med);
    if (ours) return ours[0];
    if (src.includes("google")) return med.includes("lsa") ? "google_lsa" : /cpc|ppc|paid|ads/.test(med) ? "google_ads" : "google_organic";
    if (/^(meta|facebook|fb|instagram|ig)$/.test(src)) return /cpc|ppc|paid|ads/.test(med) ? "meta_ads" : "social";
    if (src.includes("nextdoor")) return "nextdoor";
    if (/flyer|door|print|qr|card|truck|sign/.test(src) || /print|qr|offline/.test(med)) return "print";
    if (/partner|hoa|condo|marina|realtor/.test(src)) return "partnership";
    if (src.includes("referral")) return "referral";
    return "other";
  }
  if (t.ref) return "referral";
  if (t.fbclid) return "social"; // Facebook adds fbclid to organic link clicks too
  return null;
}

/** Untagged visit from another site. */
function referrerChannel(t: Touch): ChannelId | null {
  let host: string;
  try {
    host = new URL(t.referrer ?? "").hostname.toLowerCase();
  } catch {
    return null;
  }
  if (/(^|\.)google\.[a-z.]+$/.test(host) || host === "maps.app.goo.gl" || host.endsWith("g.page")) return "google_organic";
  if (/(^|\.)(facebook|instagram)\.com$|^fb\.me$|^l\.instagram\.com$/.test(host)) return "social";
  if (host.includes("nextdoor.")) return "nextdoor";
  return "other";
}

/** The booking form's "How did you hear about us?" chips (website BookingClient HEARD). */
const HEARD: Record<string, ChannelId> = {
  google: "google_organic",
  instagram: "social",
  facebook: "social",
  nextdoor: "nextdoor",
  "a friend or neighbor": "referral",
  "saw the truck": "print",
  other: "other",
};

/** Tagged visit (ads can't lie about a click id) > what they told us > plain referrer. */
export function channelFromAttribution(a: unknown): ChannelId | null {
  if (!a || typeof a !== "object") return null;
  const { first, last, heard } = a as Attribution;
  const tagged = (first && taggedChannel(first)) || (last && taggedChannel(last));
  if (tagged) return tagged;
  const said = HEARD[lc(heard)];
  if (said) return said;
  return (first && referrerChannel(first)) || (last && referrerChannel(last)) || null;
}

/** utm_campaign on the visit, for matching a campaign's tracking slug. */
export function campaignSlugOf(a: unknown): string | null {
  if (!a || typeof a !== "object") return null;
  const { first, last } = a as Attribution;
  return lc(first?.utm_campaign) || lc(last?.utm_campaign) || null;
}

export interface CampaignRef {
  id: string;
  channel: ChannelId;
  utm_campaign: string | null;
}

export interface Acquisition {
  channel: ChannelId | null;
  campaignId: string | null;
  /** true = worked out from data; false = someone set it on purpose */
  derived: boolean;
}

/** Where a customer came from: their saved source, else who referred them, else their first booking. */
export function acquisition(
  c: { acquired_via: ChannelId | null; acquired_campaign_id: string | null; referred_by: string | null },
  firstAttribution: unknown,
  campaigns: CampaignRef[]
): Acquisition {
  if (c.acquired_via) return { channel: c.acquired_via, campaignId: c.acquired_campaign_id, derived: false };
  if (c.acquired_campaign_id) {
    const camp = campaigns.find((x) => x.id === c.acquired_campaign_id);
    if (camp) return { channel: camp.channel, campaignId: camp.id, derived: false };
  }
  if (c.referred_by) return { channel: "referral", campaignId: null, derived: true };
  const slug = campaignSlugOf(firstAttribution);
  const camp = slug ? campaigns.find((x) => lc(x.utm_campaign) === slug) : undefined;
  if (camp) return { channel: camp.channel, campaignId: camp.id, derived: true };
  return { channel: channelFromAttribution(firstAttribution), campaignId: null, derived: true };
}

/** A lead's channel: what was picked, else its campaign's, else its website attribution. */
export function leadChannel(
  l: { channel: ChannelId | null; campaign_id: string | null; attribution: unknown },
  campaigns: CampaignRef[]
): { channel: ChannelId | null; campaignId: string | null } {
  if (l.channel) return { channel: l.channel, campaignId: l.campaign_id };
  const byId = l.campaign_id ? campaigns.find((x) => x.id === l.campaign_id) : undefined;
  if (byId) return { channel: byId.channel, campaignId: byId.id };
  const slug = campaignSlugOf(l.attribution);
  const camp = slug ? campaigns.find((x) => lc(x.utm_campaign) === slug) : undefined;
  if (camp) return { channel: camp.channel, campaignId: camp.id };
  return { channel: channelFromAttribution(l.attribution), campaignId: null };
}

// ── Unit economics ───────────────────────────────────────────────────────────

export interface Economics {
  avgTicket: number;
  /** share of a job the business keeps after the worker's split (0..1) */
  keepPct: number;
  suppliesPerJob: number;
  /** what one first job leaves the business: the most a new customer can cost before it loses money */
  breakEven: number;
  /** the cost per new customer to aim for */
  target: number;
}

export function economics(i: { avgTicket: number; washerPct: number; suppliesPerJob: number; target: number }): Economics {
  const keepPct = Math.min(100, Math.max(0, 100 - i.washerPct)) / 100;
  const breakEven = Math.max(0, Math.round(i.avgTicket * keepPct - i.suppliesPerJob));
  return { avgTicket: i.avgTicket, keepPct, suppliesPerJob: i.suppliesPerJob, breakEven, target: i.target };
}

// ── Channel performance ──────────────────────────────────────────────────────

export type Period = "30d" | "90d" | "ytd" | "all";
export const PERIODS: { value: Period; label: string }[] = [
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "ytd", label: "This year" },
  { value: "all", label: "All time" },
];

export function periodStart(p: Period, today: string): string | null {
  if (p === "30d") return addDays(today, -29);
  if (p === "90d") return addDays(today, -89);
  if (p === "ytd") return `${today.slice(0, 4)}-01-01`;
  return null;
}

export interface ChannelRow {
  /** null = customers we can't place yet */
  channel: ChannelId | null;
  spend: number;
  leads: number;
  customers: number;
  /** completed-job revenue from those new customers, to date */
  revenue: number;
  /** their scheduled, not-yet-done jobs */
  booked: number;
  /** cost per new customer */
  cac: number | null;
  /** cost per lead */
  cpl: number | null;
  /** revenue ÷ spend */
  roas: number | null;
}

export interface RowsInput {
  customers: { id: string; channel: ChannelId | null; acquiredOn: string }[];
  revenue: Map<string, { done: number; booked: number }>;
  spend: { channel: ChannelId | null; amount: number; on: string }[];
  leads: { channel: ChannelId | null; on: string; customerId: string | null }[];
  /** inclusive YYYY-MM-DD; null = all time */
  from: string | null;
}

/**
 * Per-channel funnel for the period. A new customer with no lead row (booked online,
 * or added by hand) still counts as one lead, so "booked rate" = customers ÷ leads holds.
 * Spend with no campaign lands on channel null ("not tagged").
 */
export function channelRows({ customers, revenue, spend, leads, from }: RowsInput): ChannelRow[] {
  const inPeriod = (d: string) => !from || d >= from;
  const rows = new Map<ChannelId | null, ChannelRow>();
  const row = (channel: ChannelId | null) => {
    let r = rows.get(channel);
    if (!r) rows.set(channel, (r = { channel, spend: 0, leads: 0, customers: 0, revenue: 0, booked: 0, cac: null, cpl: null, roas: null }));
    return r;
  };
  const leadCustomers = new Set(leads.map((l) => l.customerId).filter(Boolean));
  for (const l of leads) if (inPeriod(l.on)) row(l.channel).leads++;
  for (const c of customers) {
    if (!inPeriod(c.acquiredOn)) continue;
    const r = row(c.channel);
    r.customers++;
    if (!leadCustomers.has(c.id)) r.leads++;
    const money = revenue.get(c.id);
    r.revenue += money?.done ?? 0;
    r.booked += money?.booked ?? 0;
  }
  for (const s of spend) if (inPeriod(s.on)) row(s.channel).spend += s.amount;
  for (const r of rows.values()) {
    r.spend = Math.round(r.spend * 100) / 100;
    r.cac = r.spend > 0 && r.customers > 0 ? r.spend / r.customers : null;
    r.cpl = r.spend > 0 && r.leads > 0 ? r.spend / r.leads : null;
    r.roas = r.spend > 0 ? r.revenue / r.spend : null;
  }
  return [...rows.values()].sort((a, b) => b.spend - a.spend || b.customers - a.customers || b.leads - a.leads);
}

export interface Totals {
  spend: number;
  leads: number;
  customers: number;
  revenue: number;
  /** spend ÷ customers from channels that had spend: what paid growth costs */
  paidCac: number | null;
  /** revenue from paid-channel customers ÷ spend */
  roas: number | null;
  bookedRate: number | null;
}

export function totals(rows: ChannelRow[]): Totals {
  const sum = (f: (r: ChannelRow) => number, rs = rows) => rs.reduce((s, r) => s + f(r), 0);
  const paid = rows.filter((r) => r.spend > 0 && r.channel !== null);
  const spend = sum((r) => r.spend);
  const paidCustomers = sum((r) => r.customers, paid);
  const leads = sum((r) => r.leads);
  const customers = sum((r) => r.customers);
  return {
    spend,
    leads,
    customers,
    revenue: sum((r) => r.revenue),
    paidCac: spend > 0 && paidCustomers > 0 ? spend / paidCustomers : null,
    roas: spend > 0 ? sum((r) => r.revenue, paid) / spend : null,
    bookedRate: leads > 0 ? customers / leads : null,
  };
}

// ── The weekly call ──────────────────────────────────────────────────────────

export type Call = "scale" | "hold" | "fix" | "pause" | "learning" | "investigate";

export const CALLS: Record<Call, { label: string; tone: "ok" | "warn" | "bad" | "brand" | "" }> = {
  scale: { label: "Scale", tone: "ok" },
  hold: { label: "Hold", tone: "" },
  learning: { label: "Learning", tone: "brand" },
  fix: { label: "Fix", tone: "warn" },
  investigate: { label: "Check tracking", tone: "warn" },
  pause: { label: "Pause", tone: "bad" },
};

/** Customers a channel needs before its cost per customer means anything. */
export const MIN_CUSTOMERS = 3;

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** The one thing to do with a paid channel this week, and why. Free channels get no call. */
export function channelCall(row: ChannelRow, e: Pick<Economics, "target" | "breakEven">): { call: Call; why: string } | null {
  if (row.spend <= 0 || row.channel === null) return null;
  const ceiling = Math.max(e.breakEven, e.target);
  const cac = row.cac;
  if (row.spend >= 2 * ceiling && (cac === null || cac > 2 * ceiling)) {
    return {
      call: "pause",
      why: `${usd(row.spend)} spent for ${cac === null ? "no new customers" : `${usd(cac)} per customer`}, past twice your ${usd(ceiling)} break-even. Stop it and fix the offer, keywords or page before spending more.`,
    };
  }
  if (row.leads === 0 && row.spend >= e.target) {
    return { call: "investigate", why: `${usd(row.spend)} spent and not one lead. Check that tracking fires, then the search terms and the landing page.` };
  }
  if (row.customers < MIN_CUSTOMERS) {
    return {
      call: "learning",
      why: `${row.customers} new customer${row.customers === 1 ? "" : "s"} so far, too few to judge${cac === null ? "" : ` (${usd(cac)} each)`}. Keep the budget steady.`,
    };
  }
  if (cac! <= e.target) return { call: "scale", why: `${usd(cac!)} per customer, under your ${usd(e.target)} target. Raise the budget up to 20% this week.` };
  if (cac! <= ceiling) return { call: "hold", why: `${usd(cac!)} per customer: profitable on the first job but above target. Keep the budget, tighten keywords or creative.` };
  return { call: "fix", why: `${usd(cac!)} per customer, over your ${usd(ceiling)} break-even. Fix keywords, offer or landing page, or cut the budget.` };
}

// ── Speed to lead ────────────────────────────────────────────────────────────

export const minutesBetween = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60000));

/** 7 → "7 min", 95 → "2 hr", 3000 → "2 days" */
export function fmtMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  if (min < 60 * 24) return `${Math.round(min / 60)} hr`;
  const d = Math.round(min / 1440);
  return `${d} day${d === 1 ? "" : "s"}`;
}
