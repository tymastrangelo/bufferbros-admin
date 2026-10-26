import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { netOwed, payeeOf, type PayoutRow } from "@/lib/payouts";
import { createClient } from "@/lib/supabase/server";
import { addDays, todayYmd } from "@/lib/time";
import type { Block, Employee, WeeklyHours } from "@/lib/types";
import type { FrontedRow, PayoutEntry } from "../../money/payouts/payouts-client";
import { WorkerClient, type WorkerJob } from "./worker-client";

export const metadata: Metadata = { title: "Worker" };
export const dynamic = "force-dynamic";

export default async function WorkerPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOwner();
  const { id } = await params;
  const db = await createClient();
  const today = todayYmd();
  const since = addDays(today, -30);

  const [empQ, doneQ, upcomingQ, payQ, plansQ, hoursQ, blocksQ, frontedQ] = await Promise.all([
    db.from("employees").select("*").eq("id", id).maybeSingle(),
    db
      .from("appointments")
      .select("id,date,start_min,duration_min,status,price,service_name,started_at,completed_at,contact_name,customers(name)")
      .eq("employee_id", id)
      .in("status", ["completed", "no_show"])
      .gte("date", since)
      .order("date", { ascending: false })
      .order("start_min", { ascending: false })
      .limit(60),
    db
      .from("appointments")
      .select("id,date,start_min,duration_min,status,price,service_name,started_at,completed_at,contact_name,customers(name),appointment_employees!inner(employee_id)")
      .eq("appointment_employees.employee_id", id)
      .eq("status", "scheduled")
      .gte("date", today)
      .order("date")
      .order("start_min")
      .limit(30),
    db
      .from("ledger_entries")
      .select("id,amount,processor_fee,tip,occurred_on,collected_by,settled_on,memo,employee_id,plan_id,customers(id,name),appointments(self_done,employee_id,plan_id)")
      .in("kind", ["payment", "credit"])
      .order("occurred_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(500),
    db.from("plans").select("id,employee_id").not("employee_id", "is", null),
    db.from("weekly_hours").select("*").order("weekday"),
    db.from("blocks").select("*").eq("employee_id", id).gte("date", today).order("date").order("start_min").limit(12),
    db.from("expenses").select("id,occurred_on,amount,memo,category,paid_by_employee_id,reimbursed_on").eq("paid_by_employee_id", id).order("occurred_on", { ascending: false }).limit(100),
  ]);
  if (!empQ.data) notFound();
  const employee = { ...(empQ.data as Employee), split_pct: Number((empQ.data as Employee).split_pct) };

  const planWorker = new Map(((plansQ.data ?? []) as { id: string; employee_id: string }[]).map((p) => [p.id, p.employee_id]));
  const payRows = ((payQ.data ?? []) as unknown as PayoutEntry[])
    .map((e) => ({ ...e, amount: Number(e.amount), processor_fee: Number(e.processor_fee ?? 0), tip: Number(e.tip ?? 0) }))
    .filter((r) => payeeOf(r, (pid) => planWorker.get(pid) ?? null) === id);
  const fronted = ((frontedQ.data ?? []) as FrontedRow[]).map((f) => ({ ...f, amount: Number(f.amount) }));
  const unsettled: PayoutRow[] = payRows.map((r) => ({
    amount: r.amount,
    fee: r.processor_fee,
    tip: r.tip,
    collectedBy: r.collected_by,
    settledOn: r.settled_on,
    selfDone: !!r.appointments?.self_done,
  }));

  const toJob = (a: Record<string, unknown>): WorkerJob => ({
    id: a.id as string,
    date: a.date as string,
    start_min: a.start_min as number,
    duration_min: a.duration_min as number,
    status: a.status as string,
    price: Number(a.price),
    service_name: a.service_name as string,
    started_at: (a.started_at as string | null) ?? null,
    completed_at: (a.completed_at as string | null) ?? null,
    name: ((a.customers as { name: string } | null)?.name ?? (a.contact_name as string | null) ?? "Job") as string,
  });
  const recent = ((doneQ.data ?? []) as Record<string, unknown>[]).map(toJob);
  const upcoming = ((upcomingQ.data ?? []) as Record<string, unknown>[]).map(toJob);
  const done = recent.filter((j) => j.status === "completed");
  const timed = done.filter((j) => j.started_at && j.completed_at);

  return (
    <WorkerClient
      employee={employee}
      stats={{
        jobs30: done.length,
        revenue30: done.reduce((s, j) => s + j.price, 0),
        cut30: done.reduce((s, j) => s + (j.price * employee.split_pct) / 100, 0),
        avgMin: timed.length
          ? Math.round(timed.reduce((s, j) => s + (new Date(j.completed_at!).getTime() - new Date(j.started_at!).getTime()) / 60000, 0) / timed.length)
          : null,
        noShows: recent.filter((j) => j.status === "no_show").length,
        ...netOwed(unsettled, employee.split_pct, fronted.map((f) => ({ amount: f.amount, reimbursedOn: f.reimbursed_on }))),
      }}
      upcoming={upcoming}
      recent={recent.slice(0, 12)}
      payRows={payRows}
      fronted={fronted}
      business={(hoursQ.data ?? []) as WeeklyHours[]}
      blocks={(blocksQ.data ?? []) as Block[]}
    />
  );
}
