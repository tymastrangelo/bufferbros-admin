// Runnable check for the marketing math: `npx tsx src/lib/marketing.check.ts`
import assert from "node:assert/strict";
import {
  CHANNELS,
  acquisition,
  channelCall,
  channelFromAttribution,
  channelRows,
  economics,
  leadChannel,
  slugify,
  totals,
  trackingLink,
  type ChannelRow,
} from "./marketing";

// Every tracking link we hand out reads back as its own channel.
for (const { id } of CHANNELS) {
  const q = Object.fromEntries(new URL(trackingLink(id, "x")).searchParams);
  assert.equal(channelFromAttribution({ first: q }), id, `round trip ${id}`);
}

// Ad click ids beat everything; organic fbclid is social, not paid.
assert.equal(channelFromAttribution({ first: { gclid: "abc" }, heard: "A friend or neighbor" }), "google_ads");
assert.equal(channelFromAttribution({ first: { fbclid: "x" } }), "social");
assert.equal(channelFromAttribution({ first: { utm_source: "facebook", utm_medium: "paid_social" } }), "meta_ads");
// What they told us beats a bare referrer; a bare Google referrer is organic.
assert.equal(channelFromAttribution({ first: { referrer: "https://www.google.com/" }, heard: "Nextdoor" }), "nextdoor");
assert.equal(channelFromAttribution({ first: { referrer: "https://www.google.com/" } }), "google_organic");
assert.equal(channelFromAttribution({ first: { landing: "/" } as never }), null);
assert.equal(channelFromAttribution(null), null);
// Last touch fills in when the first visit was direct.
assert.equal(channelFromAttribution({ first: {}, last: { utm_source: "print", utm_medium: "qr" } }), "print");

const campaigns = [{ id: "c1", channel: "google_lsa" as const, utm_campaign: "lsa" }];
// Saved source wins; referral next; then the campaign slug on the first booking.
assert.deepEqual(acquisition({ acquired_via: "partnership", acquired_campaign_id: null, referred_by: "r" }, null, campaigns), {
  channel: "partnership",
  campaignId: null,
  derived: false,
});
assert.equal(acquisition({ acquired_via: null, acquired_campaign_id: null, referred_by: "r" }, { first: { gclid: "1" } }, campaigns).channel, "referral");
assert.deepEqual(
  acquisition({ acquired_via: null, acquired_campaign_id: null, referred_by: null }, { first: { utm_source: "google", utm_medium: "lsa", utm_campaign: "LSA" } }, campaigns),
  { channel: "google_lsa", campaignId: "c1", derived: true }
);
assert.deepEqual(leadChannel({ channel: null, campaign_id: "c1", attribution: null }, campaigns), { channel: "google_lsa", campaignId: "c1" });

assert.equal(slugify("Search · Marco + Naples!"), "search-marco-naples");

// Break-even: $250 ticket, worker keeps 60%, $10 supplies → the business keeps $90.
const e = economics({ avgTicket: 250, washerPct: 60, suppliesPerJob: 10, target: 60 });
assert.equal(e.breakEven, 90);
assert.equal(e.keepPct, 0.4);

// Funnel: a customer with a lead row isn't double-counted as a lead; untagged spend is its own row.
const rows = channelRows({
  customers: [
    { id: "a", channel: "google_ads", acquiredOn: "2026-11-02" },
    { id: "b", channel: "google_ads", acquiredOn: "2026-11-03" },
    { id: "old", channel: "google_ads", acquiredOn: "2026-01-01" },
  ],
  revenue: new Map([["a", { done: 249, booked: 0 }], ["b", { done: 0, booked: 289 }]]),
  spend: [
    { channel: "google_ads", amount: 150, on: "2026-11-05" },
    { channel: null, amount: 20, on: "2026-11-05" },
  ],
  leads: [
    { channel: "google_ads", on: "2026-11-01", customerId: "a" },
    { channel: "google_ads", on: "2026-11-01", customerId: null },
  ],
  from: "2026-10-15",
});
const g = rows.find((r) => r.channel === "google_ads")!;
assert.equal(g.customers, 2);
assert.equal(g.leads, 3); // two lead rows + b, who booked without one
assert.equal(g.cac, 75);
assert.equal(g.revenue, 249);
assert.equal(g.booked, 289);
assert.equal(rows.find((r) => r.channel === null)?.spend, 20);
const t = totals(rows);
assert.equal(t.spend, 170);
assert.equal(t.paidCac, 85);

// The weekly call.
const r = (o: Partial<ChannelRow>): ChannelRow => ({ channel: "google_ads", spend: 0, leads: 0, customers: 0, revenue: 0, booked: 0, cac: null, cpl: null, roas: null, ...o });
const call = (o: Partial<ChannelRow>) => channelCall(r(o), e)?.call ?? null;
assert.equal(call({ spend: 0 }), null); //                                  free channel
assert.equal(call({ spend: 50, channel: null }), null); //                  untagged spend
assert.equal(call({ spend: 200, leads: 6, customers: 0 }), "pause"); //     past 2× break-even, nothing
assert.equal(call({ spend: 400, leads: 9, customers: 2, cac: 200 }), "pause");
assert.equal(call({ spend: 70, leads: 0 }), "investigate"); //               money out, no leads at all
assert.equal(call({ spend: 40, leads: 0 }), "learning"); //                  too early even for that
assert.equal(call({ spend: 120, leads: 5, customers: 2, cac: 60 }), "learning");
assert.equal(call({ spend: 150, leads: 8, customers: 3, cac: 50 }), "scale");
assert.equal(call({ spend: 240, leads: 8, customers: 3, cac: 80 }), "hold");
assert.equal(call({ spend: 330, leads: 8, customers: 3, cac: 110 }), "fix");

console.log("marketing.check: ok");
