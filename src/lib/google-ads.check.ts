// Runnable check for the Google Ads client's pure parts: `npx tsx src/lib/google-ads.check.ts`
import assert from "node:assert/strict";
import { authUrl, metricsQuery, friendlyGadsError, micros, parseCampaignRows, parseMetricRows } from "./google-ads";
import { monthSpend } from "./ads-math";

// cost_micros → dollars, two decimals, never float garbage in the ledger
assert.equal(micros(1234567), 1.23);
assert.equal(micros("15000000"), 15);
assert.equal(micros("0"), 0);
assert.equal(micros(null), 0);
assert.equal(micros(undefined), 0);

// errors in plain English
assert.match(friendlyGadsError({ error: { details: [{ errors: [{ errorCode: { authorizationError: "DEVELOPER_TOKEN_NOT_APPROVED" } }] }] } }, 403), /approved/i);
assert.match(friendlyGadsError({ error: { details: [{ errors: [{ errorCode: { authorizationError: "USER_PERMISSION_DENIED" } }] }] } }, 403), /user on that Ads account/i);
assert.match(friendlyGadsError({ error: "invalid_grant" }, 400), /reconnect/i);
assert.match(friendlyGadsError({ error: { message: "Something odd", details: [] } }, 500), /Something odd/);
// streaming endpoints wrap the error in an array; the detail message beats the generic one
assert.match(friendlyGadsError([{ error: { message: "Request contains an invalid argument.", details: [{ errors: [{ errorCode: { queryError: "UNRECOGNIZED_FIELD" }, message: "Unrecognized field in the query: 'metrics.nope'." }] }] } }], 400), /Unrecognized field/);

// late-arriving conversions: an explicit 35-day window (Google's DURING literals stop at 30)
assert.match(metricsQuery("2026-10-26"), /segments\.date BETWEEN '2026-09-22' AND '2026-10-26'/);

// OAuth URL
const u = authUrl({ serviceAccount: null, oauth: { clientId: "cid", clientSecret: "s" }, loginCustomerId: "1234567890", developerToken: null }, "https://admin.bufferbros.org/api/google-ads/callback", "st4te");
assert.ok(u.startsWith("https://accounts.google.com/o/oauth2/v2/auth?"));
assert.match(u, /access_type=offline/);
assert.match(u, /prompt=consent/);
assert.match(u, /redirect_uri=https%3A%2F%2Fadmin\.bufferbros\.org%2Fapi%2Fgoogle-ads%2Fcallback/);
assert.match(u, /state=st4te/);
assert.match(u, /scope=https%3A%2F%2Fwww\.googleapis\.com%2Fauth%2Fadwords/);

// searchStream rows → our shapes
const campaignRows = [
  { campaign: { resourceName: "customers/1/campaigns/42", id: "42", name: "Search · Marco + Naples", status: "ENABLED", advertisingChannelType: "SEARCH", campaignBudget: "customers/1/campaignBudgets/7" }, campaignBudget: { amountMicros: "15000000" } },
  { campaign: { id: "43", name: "LSA", status: "PAUSED", advertisingChannelType: "LOCAL_SERVICES", campaignBudget: "customers/1/campaignBudgets/8" }, campaignBudget: {} },
];
assert.deepEqual(parseCampaignRows(campaignRows), [
  { google_id: "42", name: "Search · Marco + Naples", status: "ENABLED", channel: "SEARCH", daily_budget: 15, budget_resource: "customers/1/campaignBudgets/7" },
  { google_id: "43", name: "LSA", status: "PAUSED", channel: "LOCAL_SERVICES", daily_budget: null, budget_resource: "customers/1/campaignBudgets/8" },
]);
const metricRows = [
  { campaign: { id: "42" }, segments: { date: "2026-10-25" }, metrics: { costMicros: "4567890", clicks: "12", impressions: "340", conversions: 1.5, conversionsValue: 229, phoneCalls: "2" } },
  { campaign: { id: "42" }, segments: { date: "2026-10-26" }, metrics: { costMicros: "0", clicks: "0", impressions: "10", conversions: 0, conversionsValue: 0 } },
];
assert.deepEqual(parseMetricRows(metricRows), [
  { google_id: "42", date: "2026-10-25", cost: 4.57, clicks: 12, impressions: 340, conversions: 1.5, conv_value: 229, phone_calls: 2 },
  { google_id: "42", date: "2026-10-26", cost: 0, clicks: 0, impressions: 10, conversions: 0, conv_value: 0, phone_calls: 0 },
]);

// month spend: one row per campaign per month, 2dp, repeated dates never double-count
assert.deepEqual(
  monthSpend([
    { google_id: "42", date: "2026-10-25", cost: 4.57 },
    { google_id: "42", date: "2026-10-26", cost: 0.1 },
    { google_id: "42", date: "2026-10-26", cost: 0.1 },  // same day seen twice → counted once (last wins)
    { google_id: "42", date: "2026-09-30", cost: 2.005 },
    { google_id: "43", date: "2026-10-01", cost: 9 },
  ]),
  [
    { google_id: "42", month: "2026-09", amount: 2.01 },
    { google_id: "42", month: "2026-10", amount: 4.67 },
    { google_id: "43", month: "2026-10", amount: 9 },
  ]
);

console.log("google-ads.check ok");
