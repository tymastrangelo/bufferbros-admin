import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getRealRole } from "@/lib/auth";
import { authUrl, gadsEnv } from "@/lib/google-ads";

// Owner taps "Connect Google Ads": off to Google's consent screen with a one-shot state.
export async function GET(request: Request) {
  if ((await getRealRole()) !== "owner") return NextResponse.redirect(new URL("/marketing/ads?error=Owner+only", request.url));
  const env = gadsEnv();
  if (!env.oauth) return NextResponse.redirect(new URL(`/marketing/ads?error=${encodeURIComponent("Add GADS_CLIENT_ID and GADS_CLIENT_SECRET on Vercel first (or use the service account instead).")}`, request.url));
  const state = randomBytes(16).toString("hex");
  // secure only over https (localhost testing is http; NODE_ENV is "production" on Tyler's Mac)
  (await cookies()).set("gads_state", state, { httpOnly: true, sameSite: "lax", secure: new URL(request.url).protocol === "https:", maxAge: 600, path: "/" });
  const redirectUri = new URL("/api/google-ads/callback", request.url).toString();
  return NextResponse.redirect(authUrl(env, redirectUri, state));
}
