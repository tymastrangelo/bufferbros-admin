import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth";
import { netOwed, payeeOf, type PayoutRow } from "@/lib/payouts";
import { createClient } from "@/lib/supabase/server";
import { addDays, todayYmd, weekdayOf } from "@/lib/time";
import type { Employee } from "@/lib/types";
import { TeamClient, type WorkerStats } from "./team-client";

export const metadata: Metadata = { title: "Team" };
export const dynamic = "force-dynamic";

export default async function TeamPage() {
  await requireOwner();
  const db = await createClient();
  const today = todayYmd();
  const monthStart = `${today.slice(0, 7)}-01`;
  const weekStart = addDays(today, -weekdayOf(today));

  const [empQ, apptsQ, cutsQ, unsettledQ, plansQ, frontedQ] = await Promise.all([
    db.from("employees").select("*").order("created_at"),
    // This month's completed work + everything assigned ahead, per worker.
    db
      .from("appointments")
      .select("employee_id,status,date,start_min,price,started_at,completed_at,contact_name,customers(name)")
      .not("employee_id", "is", null)
      .or(`and(status.eq.completed,date.gte.${monthStart}),and(status.eq.scheduled,date.gte.${today})`)
      .order("date")
      .order("start_min"),
    db
      .from("company_ledger")
      .select("employee_id,amount")
      .eq("kind", "payout")
      .not("employee_id", "is", null)
      .gte("occurred_on", monthStart),
    db
      .from("ledger_entries")
      .select("amount,processor_fee,tip,collected_by,settled_on,employee_id,plan_id,appointments(employee_id,self_done,plan_id)")
      .in("kind", ["payment", "credit"])
      .is("settled_on", null),
    db.from("plans").select("id,employee_id").not("employee_id", "is", null),
    db.from("expenses").select("amount,paid_by_employee_id").not("paid_by_employee_id", "is", null).is("reimbursed_on", null),
  ]);
  const fronted = (frontedQ.data ?? []) as { amount: number; paid_by_employee_id: string }[];

  const employees = ((empQ.data ?? []) as Employee[]).map((e) => ({ ...e, split_pct: Number(e.split_pct) }));
  const appts = (apptsQ.data ?? []) as unknown as {
    employee_id: string;
    status: string;
    date: string;
    start_min: number;
    price: number;
    contact_name: string | null;
    customers: { name: string } | null;
    started_at: string | null;
    completed_at: string | null;
  }[];
  const cuts = (cutsQ.data ?? []) as { employee_id: string; amount: number }[];
  const unsettled = (unsettledQ.data ?? []) as unknown as {
    amount: number;
    processor_fee: number;
    tip: number;
    collected_by: "owner" | "washer";
    settled_on: string | null;
    employee_id: string | null;
    plan_id: string | null;
    appointments: { employee_id: string | null; self_done: boolean; plan_id: string | null } | null;
  }[];
  const planWorker = new Map(((plansQ.data ?? []) as { id: string; employee_id: string }[]).map((p) => [p.id, p.employee_id]));
  const payee = (r: (typeof unsettled)[number]) => payeeOf(r, (id) => planWorker.get(id) ?? null);

  const stats: Record<string, WorkerStats> = {};
  for (const e of employees) {
    const done = appts.filter((a) => a.employee_id === e.id && a.status === "completed");
    const timed = done.filter((a) => a.started_at && a.completed_at);
    const rows: PayoutRow[] = unsettled
      .filter((r) => payee(r) === e.id)
      .map((r) => ({
        amount: Number(r.amount),
        fee: Number(r.processor_fee ?? 0),
        tip: Number(r.tip ?? 0),
        collectedBy: r.collected_by,
        settledOn: r.settled_on,
        selfDone: !!r.appointments?.self_done,
      }));
    const doneWeek = done.filter((a) => a.date >= weekStart);
    const next = appts.find((a) => a.employee_id === e.id && a.status === "scheduled");
    stats[e.id] = {
      jobsWeek: doneWeek.length,
      revenueWeek: doneWeek.reduce((s, a) => s + Number(a.price), 0),
      nextJob: next ? { date: next.date, start_min: next.start_min, name: next.customers?.name ?? next.contact_name ?? "Job" } : null,
      jobsMonth: done.length,
      revenueMonth: done.reduce((s, a) => s + Number(a.price), 0),
      cutMonth: cuts.filter((c) => c.employee_id === e.id).reduce((s, c) => s + Math.abs(Number(c.amount)), 0),
      upcoming: appts.filter((a) => a.employee_id === e.id && a.status === "scheduled").length,
      avgMin: timed.length
        ? Math.round(
            timed.reduce((s, a) => s + (new Date(a.completed_at!).getTime() - new Date(a.started_at!).getTime()) / 60000, 0) /
              timed.length
          )
        : null,
      ...netOwed(rows, e.split_pct, fronted.filter((f) => f.paid_by_employee_id === e.id).map((f) => ({ amount: Number(f.amount), reimbursedOn: null }))),
    };
  }

  return <TeamClient employees={employees} stats={stats} />;
}
