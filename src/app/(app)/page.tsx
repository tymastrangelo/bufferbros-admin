import type { Metadata } from "next";
import { getRole } from "@/lib/auth";
import { netOwed, type PayoutRow } from "@/lib/payouts";
import { computeOutreachDue, computeReviewAsks, type OutreachCustomer } from "@/lib/outreach";
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

  const [jobsQ, weekPayQ, monthPayQ, doneQ, balancesQ, plansQ, unlinkedQ, planApptsQ, pendingQ, catalog, payoutQ, settings, employeesQ, remindersQ] = await Promise.all([
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
      .select("amount,processor_fee,collected_by,settled_on,appointments(self_done,employee_id)")
      .in("kind", ["payment", "credit"])
      .is("settled_on", null),
    getSettingsMap(),
    db.from("employees").select("id,name,split_pct,active").order("created_at"),
    db.from("reminders").select("*, customers(id,name)").is("done_at", null).order("due_on").limit(10),
  ]);

  // Client-relations queue: who's due for a reach-out / a review ask.
  const [outreachCustQ, lastDoneQ, nextVisitQ] = await Promise.all([
    db
      .from("customers")
      .select("id,name,phone,email,archived,outreach_status,resume_on,last_contacted_on,review_asked_on,review_left_on")
      .eq("archived", false),
    db.from("appointments").select("customer_id,date").eq("status", "completed").not("customer_id", "is", null).order("date", { ascending: false }),
    db.from("appointments").select("customer_id,date").eq("status", "scheduled").gte("date", today).not("customer_id", "is", null),
  ]);
  const lastDetail = new Map<string, string>();
  for (const r of (lastDoneQ.data ?? []) as { customer_id: string; date: string }[]) {
    if (!lastDetail.has(r.customer_id)) lastDetail.set(r.customer_id, r.date);
  }
  const nextVisit = new Map<string, string>();
  for (const r of (nextVisitQ.data ?? []) as { customer_id: string; date: string }[]) nextVisit.set(r.customer_id, r.date);
  const outreachCustomers = (outreachCustQ.data ?? []) as OutreachCustomer[];
  const outreach = {
    due: computeOutreachDue({
      customers: outreachCustomers,
      lastDetail,
      nextVisit,
      today,
      afterDays: Number(settings.outreach_after_days ?? 60),
    }),
    asks: computeReviewAsks({
      customers: outreachCustomers,
      lastDetail,
      today,
      windowDays: Number(settings.review_ask_window_days ?? 14),
    }),
  };

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
  // Net of the owner <-> workers split across unsettled payments: + = workers owe Tyler.
  // Each payment runs at its job's worker's cut; unlinked ones at the default worker's.
  const employees = ((employeesQ.data ?? []) as { id: string; name: string; split_pct: number; active: boolean }[]).map(
    (e) => ({ ...e, split_pct: Number(e.split_pct) })
  );
  const defaultEmp = employees.find((e) => e.id === settings.default_employee_id) ?? employees[0];
  const pctFor = (employeeId: string | null) =>
    (employees.find((e) => e.id === employeeId) ?? defaultEmp)?.split_pct ?? Number(settings.split_washer_pct ?? 60);
  const payoutRows: PayoutRow[] = (
    (payoutQ.data ?? []) as unknown as { amount: number; processor_fee: number; collected_by: "owner" | "washer"; settled_on: string | null; appointments: { self_done: boolean; employee_id: string | null } | null }[]
  ).map((r) => ({
    amount: Number(r.amount),
    fee: Number(r.processor_fee ?? 0),
    collectedBy: r.collected_by,
    settledOn: r.settled_on,
    selfDone: !!r.appointments?.self_done,
    pct: pctFor(r.appointments?.employee_id ?? null),
  }));
  const payoutNet = Math.round(netOwed(payoutRows, Number(settings.split_washer_pct ?? 60)).net);
  const activeWorkers = employees.filter((e) => e.active);
  const workerLabel = activeWorkers.length === 1 ? activeWorkers[0].name : "Workers";
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
              workerLabel,
              activePlans: plans.length,
            }
          : null
      }
      attention={owner ? attention : null}
      reminders={owner ? reminders : null}
      outreach={owner ? outreach : null}
    />
  );
}
