// Google Ads API, the thin way: plain fetch + GAQL. One API version constant; re-check
// the release notes when bumping: https://developers.google.com/google-ads/api/docs/release-notes
//
// Auth (2026 model): developer tokens were sunset on 2026-09-09 — access levels live on the
// Google Cloud project (console.cloud.google.com/google/ads-apis/overview). Two ways in:
//   1. Service account (default): the calendar sync's service account, added as a user on
//      the Ads account. No consent screen, no refresh token, nothing new on Vercel.
//   2. OAuth refresh token (fallback): "Connect Google Ads" on the Ads page, for a GCP
//      OAuth web client (GADS_CLIENT_ID / GADS_CLIENT_SECRET).
// Not marked server-only so the pure parsers can run in google-ads.check.ts; nothing
// here is imported by a client component (secrets are passed in by server code).
import { createSign } from "node:crypto";

export const GADS_API_VERSION = "v26";
const API = `https://googleads.googleapis.com/${GADS_API_VERSION}`;
const SCOPE = "https://www.googleapis.com/auth/adwords";

export interface GadsEnv {
  /** Service account (preferred): GADS_SA_EMAIL/KEY, else the calendar sync's GCAL_SA_EMAIL/KEY. */
  serviceAccount: { email: string; key: string } | null;
  /** OAuth web client for the "Connect Google Ads" fallback. */
  oauth: { clientId: string; clientSecret: string } | null;
  /** Manager (MCC) id, 10 digits — only needed when reaching the account through a manager. */
  loginCustomerId: string | null;
  /** Legacy; ignored by Google since 2026-09-09 but sent when present. */
  developerToken: string | null;
}

/** What's configured. Never fails outright: the Ads page explains what's missing. */
export function gadsEnv(): GadsEnv {
  const saEmail = (process.env.GADS_SA_EMAIL ?? process.env.GCAL_SA_EMAIL)?.trim();
  const saKey = (process.env.GADS_SA_KEY ?? process.env.GCAL_SA_KEY)?.replace(/\\n/g, "\n");
  const clientId = process.env.GADS_CLIENT_ID?.trim();
  const clientSecret = process.env.GADS_CLIENT_SECRET?.trim();
  return {
    serviceAccount: saEmail && saKey ? { email: saEmail, key: saKey } : null,
    oauth: clientId && clientSecret ? { clientId, clientSecret } : null,
    loginCustomerId: process.env.GADS_LOGIN_CUSTOMER_ID?.replace(/\D/g, "") || null,
    developerToken: process.env.GADS_DEVELOPER_TOKEN?.trim() || null,
  };
}

/** How we'll authenticate: the service account when configured, else a saved OAuth refresh token. */
export type GadsCredential = { kind: "service_account"; email: string; key: string } | { kind: "oauth"; refreshToken: string };

/** cost_micros → dollars, two decimals. */
export const micros = (m: number | string | null | undefined) => Math.round((Number(m ?? 0) || 0) / 10_000) / 100;

/** Google's error JSON → one sentence Tyler can act on. */
export function friendlyGadsError(body: unknown, status: number): string {
  // searchStream errors arrive as a one-element array
  if (Array.isArray(body)) body = body[0] ?? null;
  const b = body as { error?: { message?: string; details?: { errors?: { errorCode?: Record<string, string>; message?: string }[]; requestId?: string }[] } | string } | null;
  const err = b?.error;
  if (typeof err === "string") {
    if (err === "invalid_grant") return "Google no longer accepts the saved sign-in — reconnect Google Ads.";
    return `Google said: ${err}`;
  }
  const codes = (err?.details ?? []).flatMap((d) => (d.errors ?? []).map((e) => Object.values(e.errorCode ?? {})[0] ?? ""));
  const firstDetail = (err?.details ?? []).flatMap((d) => d.errors ?? []).map((e) => e.message).find(Boolean);
  const requestId = (err?.details ?? []).map((d) => d.requestId).find(Boolean);
  if (codes.includes("DEVELOPER_TOKEN_NOT_APPROVED") || codes.includes("DEVELOPER_TOKEN_PROHIBITED")) return "Google hasn't approved API access for this project yet (access level still Test — apply for Explorer in the Cloud console).";
  if (codes.includes("USER_PERMISSION_DENIED")) return "This login isn't a user on that Ads account — add the service account under Admin › Access and security, or check GADS_LOGIN_CUSTOMER_ID.";
  if (codes.includes("DEVELOPER_TOKEN_INVALID")) return "The developer token is wrong — remove GADS_DEVELOPER_TOKEN; Google no longer uses them.";
  if (codes.includes("CUSTOMER_NOT_FOUND")) return "That customer id doesn't exist — pick the serving account again.";
  const msg = firstDetail ?? err?.message ?? `HTTP ${status}`;
  return `Google Ads: ${msg}${requestId ? ` (request ${requestId})` : ""}`;
}

export function authUrl(env: GadsEnv, redirectUri: string, state: string): string {
  if (!env.oauth) throw new Error("GADS_CLIENT_ID / GADS_CLIENT_SECRET aren't set.");
  const q = new URLSearchParams({
    client_id: env.oauth.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export async function exchangeCode(env: GadsEnv, code: string, redirectUri: string): Promise<{ refresh_token: string }> {
  if (!env.oauth) throw new Error("GADS_CLIENT_ID / GADS_CLIENT_SECRET aren't set.");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: env.oauth.clientId, client_secret: env.oauth.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  const body = (await res.json()) as { refresh_token?: string; error?: string };
  if (!res.ok) throw new Error(friendlyGadsError(body, res.status));
  if (!body.refresh_token) throw new Error("Google didn't return a refresh token — remove the app's access at myaccount.google.com/permissions and connect again.");
  return { refresh_token: body.refresh_token };
}

let cached: { token: string; expires: number; key: string } | null = null;

/** Short-lived access token for either credential; cached until a minute before expiry. */
export async function accessToken(env: GadsEnv, cred: GadsCredential): Promise<string> {
  const key = cred.kind === "oauth" ? `oauth:${cred.refreshToken.slice(-8)}` : `sa:${cred.email}`;
  if (cached && cached.key === key && Date.now() < cached.expires) return cached.token;
  let body: URLSearchParams;
  if (cred.kind === "oauth") {
    if (!env.oauth) throw new Error("GADS_CLIENT_ID / GADS_CLIENT_SECRET aren't set.");
    body = new URLSearchParams({ client_id: env.oauth.clientId, client_secret: env.oauth.clientSecret, refresh_token: cred.refreshToken, grant_type: "refresh_token" });
  } else {
    const now = Math.floor(Date.now() / 1000);
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: cred.email, scope: SCOPE, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
    const assertion = `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(cred.key, "base64url")}`;
    body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion });
  }
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !json.access_token) throw new Error(friendlyGadsError(json, res.status));
  cached = { token: json.access_token, expires: Date.now() + ((json.expires_in ?? 3600) - 60) * 1000, key };
  return json.access_token;
}

function headers(env: GadsEnv, token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    ...(env.developerToken ? { "developer-token": env.developerToken } : {}),
    ...(env.loginCustomerId ? { "login-customer-id": env.loginCustomerId } : {}),
  };
}

async function call<T>(env: GadsEnv, cred: GadsCredential, path: string, payload: unknown): Promise<T> {
  const token = await accessToken(env, cred);
  const res = await fetch(`${API}/${path}`, { method: "POST", headers: headers(env, token), body: JSON.stringify(payload) });
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    console.error("google-ads", path, res.status, JSON.stringify(body).slice(0, 800));
    throw new Error(friendlyGadsError(body, res.status));
  }
  return body as T;
}

/** searchStream → flat rows. */
export async function gaql<T = Record<string, unknown>>(env: GadsEnv, cred: GadsCredential, customerId: string, query: string): Promise<T[]> {
  const chunks = await call<{ results?: T[] }[]>(env, cred, `customers/${customerId}/googleAds:searchStream`, { query });
  return (Array.isArray(chunks) ? chunks : []).flatMap((c) => c.results ?? []);
}

export async function listAccessibleCustomers(env: GadsEnv, cred: GadsCredential): Promise<string[]> {
  const token = await accessToken(env, cred);
  const res = await fetch(`${API}/customers:listAccessibleCustomers`, { headers: headers(env, token) });
  const body = (await res.json().catch(() => null)) as { resourceNames?: string[] } | null;
  if (!res.ok) throw new Error(friendlyGadsError(body, res.status));
  return (body?.resourceNames ?? []).map((r) => r.replace("customers/", ""));
}

export async function mutateCampaignStatus(env: GadsEnv, cred: GadsCredential, customerId: string, campaignId: string, status: "ENABLED" | "PAUSED"): Promise<void> {
  await call(env, cred, `customers/${customerId}/campaigns:mutate`, {
    operations: [{ update: { resourceName: `customers/${customerId}/campaigns/${campaignId}`, status }, updateMask: "status" }],
  });
}

export async function mutateCampaignBudget(env: GadsEnv, cred: GadsCredential, customerId: string, budgetResource: string, dailyDollars: number): Promise<void> {
  await call(env, cred, `customers/${customerId}/campaignBudgets:mutate`, {
    operations: [{ update: { resourceName: budgetResource, amountMicros: String(Math.round(dailyDollars * 1_000_000)) }, updateMask: "amount_micros" }],
  });
}

export const CAMPAIGN_QUERY =
  "SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.campaign_budget, campaign_budget.amount_micros FROM campaign WHERE campaign.status != 'REMOVED' ORDER BY campaign.id";
/** Daily metrics for the 35 days ending `today` (YYYY-MM-DD) — late conversions keep landing for weeks. */
export function metricsQuery(today: string): string {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 34);
  const from = d.toISOString().slice(0, 10);
  return `SELECT campaign.id, segments.date, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value, metrics.phone_calls FROM campaign WHERE segments.date BETWEEN '${from}' AND '${today}' AND campaign.status != 'REMOVED'`;
}

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));
const num = (v: unknown) => Number(v ?? 0) || 0;

export function parseCampaignRows(rows: unknown[]) {
  return (rows as Row[]).map((r) => {
    const c = (r.campaign ?? {}) as Row;
    const b = (r.campaignBudget ?? {}) as Row;
    return {
      google_id: str(c.id),
      name: str(c.name),
      status: str(c.status),
      channel: str(c.advertisingChannelType),
      daily_budget: b.amountMicros != null ? micros(b.amountMicros as string) : null,
      budget_resource: c.campaignBudget ? str(c.campaignBudget) : null,
    };
  });
}

export function parseMetricRows(rows: unknown[]) {
  return (rows as Row[]).map((r) => {
    const c = (r.campaign ?? {}) as Row;
    const s = (r.segments ?? {}) as Row;
    const m = (r.metrics ?? {}) as Row;
    return {
      google_id: str(c.id),
      date: str(s.date),
      cost: micros(m.costMicros as string),
      clicks: Math.round(num(m.clicks)),
      impressions: Math.round(num(m.impressions)),
      conversions: num(m.conversions),
      conv_value: Math.round(num(m.conversionsValue) * 100) / 100,
      phone_calls: Math.round(num(m.phoneCalls)),
    };
  });
}
