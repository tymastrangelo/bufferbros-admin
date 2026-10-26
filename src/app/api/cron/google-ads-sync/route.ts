import { NextResponse } from "next/server";
import { syncGoogleAds } from "@/lib/ads-sync";

// Nightly Vercel cron (see vercel.json): pull Google Ads campaigns + spend into the
// dashboard. Errors are recorded on the Ads page's status card, never thrown here.
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const result = await syncGoogleAds();
  return NextResponse.json(result);
}
