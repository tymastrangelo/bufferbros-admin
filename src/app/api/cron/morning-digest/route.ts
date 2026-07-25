import { NextResponse } from "next/server";
import { notify } from "@/lib/notify";
import { createServiceClient } from "@/lib/supabase/server";
import { minToLabel, todayYmd } from "@/lib/time";
import { vehicleLabel, type Reminder, type Vehicle } from "@/lib/types";

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

    // Stripe links that were sent but never paid — nudge the owner so money doesn't rot.
    const { data: unpaidRows } = await db
      .from("payment_requests")
      .select("amount, created_at, customers(name)")
      .eq("status", "pending")
      .order("created_at");
    const unpaid = (unpaidRows ?? []) as unknown as { amount: number; created_at: string; customers: { name: string } | null }[];
    if (unpaid.length > 0) {
      const total = unpaid.reduce((s, r) => s + Number(r.amount), 0);
      const oldestDays = Math.floor((Date.now() - new Date(unpaid[0].created_at).getTime()) / 86400000);
      const names = unpaid.slice(0, 4).map((r) => `${r.customers?.name ?? "Unknown"} $${Number(r.amount)}`).join(", ");
      await notify(
        "owner",
        `Unpaid Stripe links: $${total}`,
        `${unpaid.length} link${unpaid.length === 1 ? "" : "s"} outstanding (oldest ${oldestDays}d): ${names}${unpaid.length > 4 ? "…" : ""}`,
        "/money/payments"
      );
    }
    // Manual reminders due today (or missed on a day the cron didn't run). Pushed
    // once — sent_at marks delivery; the row stays on Today until marked done.
    const { data: dueRows } = await db
      .from("reminders")
      .select("*, customers(id,name)")
      .lte("due_on", today)
      .is("sent_at", null)
      .is("done_at", null)
      .order("due_on");
    const due = (dueRows ?? []) as unknown as (Reminder & { customers: { id: string; name: string } | null })[];
    if (due.length > 0) {
      const vehIds = [...new Set(due.flatMap((r) => r.vehicle_ids))];
      const vehById = new Map<string, string>();
      if (vehIds.length) {
        const { data: vehRows } = await db.from("vehicles").select("*").in("id", vehIds);
        for (const v of (vehRows ?? []) as Vehicle[]) vehById.set(v.id, vehicleLabel(v));
      }
      for (const r of due) {
        const parts = [
          r.customers?.name,
          r.vehicle_ids.map((id) => vehById.get(id)).filter(Boolean).join(", ") || null,
          r.body,
        ].filter(Boolean);
        await notify(
          "owner",
          `Reminder: ${r.title}`,
          parts.join(" · ") || "You asked to be reminded today.",
          r.customers ? `/customers/${r.customers.id}` : "/"
        );
      }
      await db
        .from("reminders")
        .update({ sent_at: new Date().toISOString() })
        .in("id", due.map((r) => r.id));
    }

    return NextResponse.json({ ok: true, jobs: jobs.length, pending: pendingQ.count ?? 0, unpaidLinks: unpaid.length, reminders: due.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
