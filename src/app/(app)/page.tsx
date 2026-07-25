import type { Metadata } from "next";
import { getRole } from "@/lib/auth";
import { netOwed, type PayoutRow } from "@/lib/payouts";
import { getCatalog, getSettingsMap } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { addDays, fmtDateLong, todayYmd, weekdayOf } from "@/lib/time";
import { vehicleLabel, type Plan, type Reminder, type Vehicle } from "@/lib/types";
import { TodayClient, type AttentionData } from "./today-client";
import type { JobWithCustomer } from "@/components/job-sheet";
import type { ReminderRow } from "@/components/reminders-card";

export const metadata: Metadata = { title: "Today" };
export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const db = await createClient();
  const owner = (await getRole()) === "owner";
  const today = todayYmd();
  const weekStart = addDays(today, -weekdayOf(today)); // Sunday
  const monthStart = `${today.slice(0, 7)}-01`;

  const [jobsQ, weekPayQ, monthPayQ, doneQ, balancesQ, plansQ, unlinkedQ, planApptsQ, pendingQ, catalog, payoutQ, settings, remindersQ] = await Promise.all([
    db
      .from("appointments")
      .select("*, customers(id,name,phone,email,stripe_payments)")
      .eq("date", today)
      .neq("status", "cancelled")
      .neq("status", "pending") // web bookings awaiting approval live in the owner's attention list
      .order("start_min"),
    db.from("ledger_entries").select("kind,amount").gte("occurred_on", weekStart).in("kind", ["payment", "credit", "refund"]),
    db.from("ledger_entries").select("kind,amount").gte("occurred_on", monthStart).in("kind", ["payment", "credit", "refund"]),
    db
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("status", "completed")
      .gte("date", monthStart),
    db.from("customer_balances").select("*").lt("balance", 0).order("balance"),
    db.from("plans").select("*, customers(name)").eq("status", "active"),
    db
      .from("appointments")
      .select("*, customers(id,name,phone,email,stripe_payments)")
      .is("customer_id", null)
      .eq("status", "scheduled")
      .order("date")
      .limit(8),
    db.from("appointments").select("plan_id").eq("status", "scheduled").gte("date", today).not("plan_id", "is", null),
    db
      .from("appointments")
      .select("*, customers(id,name,phone,email,stripe_payments)")
      .eq("status", "pending")
      .order("date")
      .order("start_min"),
    getCatalog(),
    db
      .from("ledger_entries")
      .select("amount,processor_fee,collected_by,settled_on,appointments(self_done)")
      .in("kind", ["payment", "credit"])
      .is("settled_on", null),
    getSettingsMap(),
    db.from("reminders").select("*, customers(id,name)").is("done_at", null).order("due_on").limit(10),
  ]);

  // Resolve vehicle_ids -> labels for the reminders card in one lookup.
  const reminderRows = (remindersQ.data ?? []) as unknown as (Reminder & { customers: { id: string; name: string } | null })[];
  const reminderVehIds = [...new Set(reminderRows.flatMap((r) => r.vehicle_ids))];
  const vehById = new Map<string, string>();
  if (reminderVehIds.length) {
    const { data: vehRows } = await db.from("vehicles").select("*").in("id", reminderVehIds);
    for (const v of (vehRows ?? []) as Vehicle[]) vehById.set(v.id, vehicleLabel(v));
  }
  const reminders: ReminderRow[] = reminderRows.map((r) => ({
    ...r,
    vehicleLabels: r.vehicle_ids.map((id) => vehById.get(id)).filter(Boolean) as string[],
  }));

  const sum = (rows: { amount: number }[] | null) => (rows ?? []).reduce((s, r) => s + Number(r.amount), 0);
  // Net of the Tyler <-> Gabe split across unsettled payments: + = Gabe owes Tyler.
  const payoutRows: PayoutRow[] = (
    (payoutQ.data ?? []) as unknown as { amount: number; processor_fee: number; collected_by: "owner" | "washer"; settled_on: string | null; appointments: { self_done: boolean } | null }[]
  ).map((r) => ({
    amount: Number(r.amount),
    fee: Number(r.processor_fee ?? 0),
    collectedBy: r.collected_by,
    settledOn: r.settled_on,
    selfDone: !!r.appointments?.self_done,
  }));
  const payoutNet = Math.round(netOwed(payoutRows, Number(settings.split_washer_pct ?? 60)).net);
  const scheduledPlanIds = new Set((planApptsQ.data ?? []).map((r) => r.plan_id));
  const plans = (plansQ.data ?? []) as (Plan & { customers: { name: string } | null })[];
  const plansWithoutVisit = plans
    .filter((p) => !scheduledPlanIds.has(p.id))
    .map((p) => ({ id: p.id, customerName: p.customers?.name ?? "Unknown", cadence: p.cadence }));

  const owed = ((balancesQ.data ?? []) as { customer_id: string; name: string; balance: number }[]).map((b) => ({
    ...b,
    balance: Number(b.balance),
  }));

  const attention: AttentionData = {
    pending: (pendingQ.data ?? []) as JobWithCustomer[],
    unlinked: (unlinkedQ.data ?? []) as JobWithCustomer[],
    owed: owed.slice(0, 6),
    plansWithoutVisit: plansWithoutVisit.slice(0, 6),
  };

  return (
    <TodayClient
      dateLabel={fmtDateLong(today)}
      jobs={(jobsQ.data ?? []) as JobWithCustomer[]}
      catalog={catalog}
      // Washers get the schedule only — company money and admin queues stay off their wire.
      stats={
        owner
          ? {
              weekCollected: sum(weekPayQ.data),
              monthCollected: sum(monthPayQ.data),
              jobsCompleted: doneQ.count ?? 0,
              payoutNet,
              activePlans: plans.length,
            }
          : null
      }
      attention={owner ? attention : null}
      reminders={owner ? reminders : null}
    />
  );
}
