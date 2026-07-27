import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth";
import { netOwed, type PayoutRow } from "@/lib/payouts";
import { getSettingsMap } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { todayYmd } from "@/lib/time";
import type { Employee } from "@/lib/types";
import { TeamClient, type WorkerStats } from "./team-client";

export const metadata: Metadata = { title: "Team" };
export const dynamic = "force-dynamic";

export default async function TeamPage() {
  await requireOwner();
  const db = await createClient();
  const today = todayYmd();
  const monthStart = `${today.slice(0, 7)}-01`;

  const [empQ, apptsQ, cutsQ, unsettledQ, settings] = await Promise.all([
    db.from("employees").select("*").order("created_at"),
    // This month's completed work + everything assigned ahead, per worker.
    db
      .from("appointments")
      .select("employee_id,status,date,price,started_at,completed_at")
      .not("employee_id", "is", null)
      .or(`and(status.eq.completed,date.gte.${monthStart}),and(status.eq.scheduled,date.gte.${today})`),
    db
      .from("company_ledger")
      .select("employee_id,amount")
      .eq("kind", "payout")
      .not("employee_id", "is", null)
      .gte("occurred_on", monthStart),
    db
      .from("ledger_entries")
      .select("amount,processor_fee,collected_by,settled_on,appointments(employee_id,self_done)")
      .in("kind", ["payment", "credit"])
      .is("settled_on", null),
    getSettingsMap(),
  ]);

  const employees = ((empQ.data ?? []) as Employee[]).map((e) => ({ ...e, split_pct: Number(e.split_pct) }));
  const appts = (apptsQ.data ?? []) as {
    employee_id: string;
    status: string;
    date: string;
    price: number;
    started_at: string | null;
    completed_at: string | null;
  }[];
  const cuts = (cutsQ.data ?? []) as { employee_id: string; amount: number }[];
  const unsettled = (unsettledQ.data ?? []) as unknown as {
    amount: number;
    processor_fee: number;
    collected_by: "owner" | "washer";
    settled_on: string | null;
    appointments: { employee_id: string | null; self_done: boolean } | null;
  }[];
  const defaultId = settings.default_employee_id ?? employees[0]?.id;

  const stats: Record<string, WorkerStats> = {};
  for (const e of employees) {
    const done = appts.filter((a) => a.employee_id === e.id && a.status === "completed");
    const timed = done.filter((a) => a.started_at && a.completed_at);
    const rows: PayoutRow[] = unsettled
      .filter((r) => (r.appointments?.employee_id ?? defaultId) === e.id)
      .map((r) => ({
        amount: Number(r.amount),
        fee: Number(r.processor_fee ?? 0),
        collectedBy: r.collected_by,
        settledOn: r.settled_on,
        selfDone: !!r.appointments?.self_done,
      }));
    stats[e.id] = {
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
      ...netOwed(rows, e.split_pct),
    };
  }

  return <TeamClient employees={employees} stats={stats} />;
}
