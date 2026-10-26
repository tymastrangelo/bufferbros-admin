import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getRealRole } from "@/lib/auth";
import { exchangeCode, gadsEnv, listAccessibleCustomers } from "@/lib/google-ads";
import { logActivity } from "@/lib/notify";
import { createServiceClient } from "@/lib/supabase/server";

// Google sends the owner back here with a code; we trade it for a refresh token and
// find the serving account. The token goes into integration_secrets (service role only).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (msg?: string, extra = "") => NextResponse.redirect(new URL(`/marketing/ads${msg ? `?error=${encodeURIComponent(msg)}` : extra}`, request.url));
  if ((await getRealRole()) !== "owner") return back("Owner only");
  const jar = await cookies();
  const state = jar.get("gads_state")?.value;
  jar.delete("gads_state");
  if (!state || url.searchParams.get("state") !== state) return back("That sign-in link expired — try Connect again.");
  if (url.searchParams.get("error")) return back(`Google said: ${url.searchParams.get("error")}`);
  const code = url.searchParams.get("code");
  if (!code) return back("Google didn't send a code back.");
  const env = gadsEnv();
  if (!env.oauth) return back("Add GADS_CLIENT_ID and GADS_CLIENT_SECRET on Vercel first.");
  try {
    const redirectUri = new URL("/api/google-ads/callback", request.url).toString();
    const { refresh_token } = await exchangeCode(env, code, redirectUri);
    const db = createServiceClient();
    const { error } = await db.from("integration_secrets").upsert({ key: "gads_refresh_token", value: refresh_token, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) return back(error.message);
    await db.from("settings").upsert({ key: "gads_last_error", value: "" }, { onConflict: "key" });
    let picked = "";
    try {
      const ids = (await listAccessibleCustomers(env, { kind: "oauth", refreshToken: refresh_token })).filter((id) => id !== env.loginCustomerId);
      if (ids.length === 1) picked = ids[0];
      await db.from("settings").upsert({ key: "gads_accessible", value: ids.join(",") }, { onConflict: "key" });
    } catch (e) {
      // A pending developer token can't list accounts yet — the page explains; connection still counts.
      await db.from("settings").upsert({ key: "gads_last_error", value: e instanceof Error ? e.message : String(e) }, { onConflict: "key" });
    }
    if (picked) await db.from("settings").upsert({ key: "gads_customer_id", value: picked }, { onConflict: "key" });
    await logActivity("connected Google Ads", [picked ? `Account ${picked}` : "Pick the serving account on the Ads page"], "/marketing/ads", { tags: ["link"] });
    return back(undefined, picked ? "?connected=1" : "?pick=1");
  } catch (e) {
    return back(e instanceof Error ? e.message : String(e));
  }
}
