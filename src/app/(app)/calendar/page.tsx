import type { Metadata } from "next";
import { getCatalog } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { addDays, monthGridStart, todayYmd, weekdayOf, ymOf } from "@/lib/time";
import type { Block, WeeklyHours } from "@/lib/types";
import type { JobWithCustomer } from "@/components/job-sheet";
import { CalendarClient, type CalView } from "./calendar-client";

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
  const [apptsQ, blocksQ, hoursQ, catalog] = await Promise.all([
    db
      .from("appointments")
      .select("*, customers(id,name,phone,email)")
      .gte("date", rangeStart)
      .lt("date", rangeEnd)
      .neq("status", "cancelled")
      .order("start_min"),
    db.from("blocks").select("*").gte("date", rangeStart).lt("date", rangeEnd).order("start_min"),
    db.from("weekly_hours").select("*").order("weekday"),
    getCatalog(),
  ]);

  return (
    <CalendarClient
      view={view}
      anchor={anchor}
      today={todayYmd()}
      jobs={(apptsQ.data ?? []) as JobWithCustomer[]}
      blocks={(blocksQ.data ?? []) as Block[]}
      hours={(hoursQ.data ?? []) as WeeklyHours[]}
      catalog={catalog}
      openNew={params.new === "1"}
      openBlock={params.block === "1"}
    />
  );
}
