import type { Metadata } from "next";
import { after } from "next/server";
import { getRole } from "@/lib/auth";
import { syncEmployeeCalendar } from "@/lib/ical";
import { projectPlanDates, type ProjectedVisit } from "@/lib/plan-projection";
import { getCatalog, getMyEmployee } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { addDays, monthGridStart, todayYmd, weekdayOf, ymOf } from "@/lib/time";
import type { Block, Employee, Plan, WeeklyHours } from "@/lib/types";
import type { JobWithCustomer } from "@/components/job-sheet";
import { CalendarClient, type CalView } from "./calendar-client";

const STALE_MS = 6 * 60 * 60 * 1000; // refresh feeds older than 6h when someone looks at the calendar

export const metadata: Metadata = { title: "Calendar" };
export const dynamic = "force-dynamic";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; d?: string; new?: string; block?: string }>;
}) {
  const params = await searchParams;
  const view: CalView = params.view === "week" || params.view === "day" ? params.view : "month";
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(params.d ?? "") ? params.d! : todayYmd();

  let rangeStart: string;
  let rangeEnd: string; // exclusive
  if (view === "month") {
    rangeStart = monthGridStart(ymOf(anchor));
    rangeEnd = addDays(rangeStart, 42);
  } else if (view === "week") {
    rangeStart = addDays(anchor, -weekdayOf(anchor));
    rangeEnd = addDays(rangeStart, 7);
  } else {
    rangeStart = anchor;
    rangeEnd = addDays(anchor, 1);
  }

  const db = await createClient();
  const owner = (await getRole()) === "owner";
  const apptsQuery = db
    .from("appointments")
    .select("*, customers(id,name,phone,email,stripe_payments)")
    .gte("date", rangeStart)
    .lt("date", rangeEnd)
    .neq("status", "cancelled")
    .order("start_min");
  const [apptsQ, blocksQ, hoursQ, catalog, myEmployee, employeesQ, plansQ] = await Promise.all([
    // Pending web bookings stay off the washer's calendar until the owner approves.
    owner ? apptsQuery : apptsQuery.neq("status", "pending"),
    db.from("blocks").select("*").gte("date", rangeStart).lt("date", rangeEnd).order("start_min"),
    db.from("weekly_hours").select("*").order("weekday"),
    getCatalog(),
    getMyEmployee(),
    db.from("employees").select("id,name,ical_url,ical_synced_at").eq("active", true),
    // Active plans + every visit date on file — projects standing slots past the materialized horizon.
    db.from("plans").select("*, customers(name), appointments(date,status)").eq("status", "active").not("preferred_min", "is", null),
  ]);

  const today = todayYmd();
  const projected: ProjectedVisit[] = (
    (plansQ.data ?? []) as unknown as (Plan & { customers: { name: string } | null; appointments: { date: string; status: string }[] })[]
  ).flatMap((p) =>
    projectPlanDates(p, p.appointments, today, rangeStart, rangeEnd).map((date) => ({
      plan_id: p.id,
      customer_name: p.customers?.name ?? "Plan",
      date,
      start_min: p.preferred_min!,
      duration_min: p.duration_min,
      price: Number(p.per_visit_price),
    }))
  );

  // Opportunistic freshness between cron runs: re-pull any feed older than 6h.
  // (Staleness check runs inside after() — render must stay pure.)
  const employees = (employeesQ.data ?? []) as Pick<Employee, "id" | "name" | "ical_url" | "ical_synced_at">[];
  after(() => {
    const stale = employees.filter(
      (e) => e.ical_url && (!e.ical_synced_at || Date.now() - new Date(e.ical_synced_at).getTime() > STALE_MS)
    );
    return Promise.all(stale.map((e) => syncEmployeeCalendar(e.id)));
  });

  return (
    <CalendarClient
      myEmployee={myEmployee}
      employeeNames={Object.fromEntries(employees.map((e) => [e.id, e.name]))}
      view={view}
      anchor={anchor}
      today={today}
      jobs={(apptsQ.data ?? []) as JobWithCustomer[]}
      projected={projected}
      owner={owner}
      blocks={(blocksQ.data ?? []) as Block[]}
      hours={(hoursQ.data ?? []) as WeeklyHours[]}
      catalog={catalog}
      openNew={params.new === "1" || params.new === "boat"}
      newKind={params.new === "boat" ? "boat" : "car"}
      openBlock={params.block === "1"}
    />
  );
}
