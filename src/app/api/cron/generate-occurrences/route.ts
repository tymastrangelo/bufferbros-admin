import { NextResponse } from "next/server";
import { generateOccurrences } from "@/lib/occurrences";
import { createServiceClient } from "@/lib/supabase/server";

// Weekly Vercel cron (see vercel.json). Guarded by CRON_SECRET, not a user session —
// the auth proxy matcher excludes /api/cron.
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await generateOccurrences(createServiceClient());
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
