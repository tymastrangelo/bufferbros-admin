// Stripe via fetch — same no-SDK idiom as email.ts/notify.ts. Server-side only.
// Needs STRIPE_SECRET_KEY (a restricted key works: checkout sessions + webhook reads).
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

const API = "https://api.stripe.com";
const VERSION = "2026-06-24.dahlia"; // pinned so payloads don't shift under us

export const stripeConfigured = () => !!process.env.STRIPE_SECRET_KEY;

async function stripeFetch(method: "GET" | "POST", path: string, params?: Record<string, string>) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  const body = params ? new URLSearchParams(params).toString() : undefined;
  const url = method === "GET" && body ? `${API}${path}?${body}` : `${API}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Stripe-Version": VERSION,
      ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: method === "POST" ? body : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message ?? `Stripe ${res.status}`);
  return json;
}

/** Hosted checkout link for a one-off payment request. Amount in dollars. */
export async function createCheckoutSession(input: {
  requestId: string;
  productName: string;
  amount: number;
  customerEmail: string;
  memo?: string | null;
}): Promise<{ id: string; url: string }> {
  const session = await stripeFetch("POST", "/v1/checkout/sessions", {
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(Math.round(input.amount * 100)),
    "line_items[0][price_data][product_data][name]": input.productName,
    ...(input.memo ? { "line_items[0][price_data][product_data][description]": input.memo } : {}),
    customer_email: input.customerEmail,
    "metadata[request_id]": input.requestId,
    client_reference_id: input.requestId,
    success_url: "https://bufferbros.org/thank-you.html?paid=1",
    cancel_url: "https://bufferbros.org",
    integration_identifier: "bufferbros-crm-kqzmwvxr",
  });
  return { id: session.id, url: session.url };
}

/** Void an unpaid checkout link. Best-effort — already-expired sessions just error. */
export async function expireCheckoutSession(sessionId: string): Promise<void> {
  await stripeFetch("POST", `/v1/checkout/sessions/${sessionId}/expire`);
}

/** What Stripe kept, in dollars, for a completed session (0 if not resolvable yet). */
export async function getSessionFee(sessionId: string): Promise<number> {
  const session = await stripeFetch("GET", `/v1/checkout/sessions/${sessionId}`, {
    "expand[]": "payment_intent.latest_charge.balance_transaction",
  });
  const fee = session?.payment_intent?.latest_charge?.balance_transaction?.fee;
  return typeof fee === "number" ? fee / 100 : 0;
}

/** Verify a Stripe-Signature header against the raw request body. */
export function verifyStripeSignature(payload: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2) as [string, string]));
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false; // 5-min replay window
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  return a.length === b.length && timingSafeEqual(a, b);
}
