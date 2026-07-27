import { NextResponse } from "next/server";
import { syncAllCalendars } from "@/lib/ical";

// Daily Vercel cron (see vercel.json): refresh every employee's iCal feed into
// blocks. Saves + a stale check on the calendar page keep things fresher between
// runs. Guarded by CRON_SECRET like the other crons.
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  await syncAllCalendars();
  return NextResponse.json({ ok: true });
}
