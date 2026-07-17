import { NextResponse } from "next/server";
import { notify } from "@/lib/notify";
import { createServiceClient } from "@/lib/supabase/server";
import { minToLabel, todayYmd } from "@/lib/time";

// Daily Vercel cron at 11:00 UTC — 7am EDT / 6am EST (see vercel.json).
// Pushes both phones today's schedule; the owner also hears about waiting approvals.
// Guarded by CRON_SECRET, not a user session — the auth proxy matcher excludes /api/cron.
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const db = createServiceClient();
    const today = todayYmd();
    const [jobsQ, pendingQ] = await Promise.all([
      db
        .from("appointments")
        .select("start_min, service_name, price, address, contact_name, customers(name)")
        .eq("date", today)
        .eq("status", "scheduled")
        .order("start_min"),
      db.from("appointments").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ]);

    // supabase-js can't tell a to-one join from to-many without generated types; runtime shape is an object
    const jobs = (jobsQ.data ?? []) as unknown as {
      start_min: number;
      service_name: string;
      price: number;
      address: string | null;
      contact_name: string | null;
      customers: { name: string } | null;
    }[];

    if (jobs.length > 0) {
      const lines = jobs.map(
        (j) =>
          `${minToLabel(j.start_min)} — ${j.customers?.name ?? j.contact_name ?? "Unknown"} · ${j.service_name} · $${j.price}`
      );
      await notify("both", `Today: ${jobs.length} job${jobs.length === 1 ? "" : "s"}`, lines.join("\n"));
    }
    if (pendingQ.count) {
      await notify(
        "owner",
        "Web bookings waiting",
        `${pendingQ.count} booking${pendingQ.count === 1 ? "" : "s"} still need${pendingQ.count === 1 ? "s" : ""} your approval.`
      );
    }
    return NextResponse.json({ ok: true, jobs: jobs.length, pending: pendingQ.count ?? 0 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
