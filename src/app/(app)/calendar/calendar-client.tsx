"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { AppointmentSheet } from "@/components/appointment-sheet";
import { BlockSheet } from "@/components/block-sheet";
import { IconBlock, IconChevronLeft, IconChevronRight, IconPlus } from "@/components/icons";
import { JobSheet, type JobWithCustomer } from "@/components/job-sheet";
import { Avatar, Busy, Segmented, Sheet } from "@/components/ui";
import { addBlock, deleteBlock } from "@/lib/actions/settings";
import { useToast } from "@/components/toast";
import { saveMyCalendarFeed, syncCalendarNow } from "@/lib/actions/employees";
import type { Catalog } from "@/lib/catalog";
import { hoursFor, lanesOf, workerColor, workerWash } from "@/lib/crew";
import { money } from "@/lib/format";
import type { ProjectedVisit } from "@/lib/plan-projection";
import { addDays, addMonths, fmtDateLong, fmtDateShort, fmtMonth, minToLabel, monthGridStart, nowMinutes, weekdayOf, WEEKDAYS_SHORT, ymOf } from "@/lib/time";
import type { Block, Employee, WeeklyHours } from "@/lib/types";

export type CalView = "month" | "week" | "day";

const HOUR_PX = 56;

/** A worker as the calendar needs them: lane color + their own hours. */
export type CrewLane = Pick<Employee, "id" | "name" | "color" | "hours">;

const assigneesOf = (j: JobWithCustomer) => j.appointment_employees?.map((a) => a.employee_id) ?? (j.employee_id ? [j.employee_id] : []);

export function CalendarClient({
  view,
  anchor,
  today,
  jobs,
  projected,
  blocks,
  hours,
  catalog,
  openNew,
  newKind = "car",
  openBlock,
  owner,
  myEmployee,
  employeeNames,
  crew,
  who,
  lanes,
}: {
  view: CalView;
  anchor: string;
  today: string;
  jobs: JobWithCustomer[];
  /** Standing plan slots beyond the materialized visits — held, not booked yet. */
  projected: ProjectedVisit[];
  blocks: Block[];
  hours: WeeklyHours[];
  catalog: Catalog;
  openNew: boolean;
  /** What the ?new= sheet books — "boat" preloads the boat-detail flow. */
  newKind?: "car" | "boat";
  openBlock: boolean;
  owner: boolean;
  /** The signed-in worker's employee row (null for the owner) — powers "My other job". */
  myEmployee: Employee | null;
  employeeNames: Record<string, string>;
  /** Active workers (owner only; workers get []). */
  crew: CrewLane[];
  /** Crew filter from the URL: "all" | "me" | employee id. */
  who: string;
  /** Day view split into one column per worker. */
  lanes: boolean;
}) {
  const router = useRouter();
  // Store the tapped job, but always render the fresh copy from server props —
  // after an action refreshes the route, the open sheet updates in place.
  const [selected, setSelected] = useState<JobWithCustomer | null>(null);
  const selectedJob = selected ? (jobs.find((j) => j.id === selected.id) ?? selected) : null;
  const [newSheet, setNewSheet] = useState<{ date: string; startMin?: number; kind?: "car" | "boat"; assignees?: string[] } | null>(
    openNew ? { date: anchor, kind: newKind } : null
  );
  const [blockSheet, setBlockSheet] = useState(openBlock);
  const [blockDetail, setBlockDetail] = useState<Block | null>(null);
  const [feedSheet, setFeedSheet] = useState(false);
  const [showProjected, setShowProjected] = useState(true);

  // re-arm when the ＋New menu navigates here with ?new=1 / ?block=1
  const [prevOpenNew, setPrevOpenNew] = useState(openNew);
  if (prevOpenNew !== openNew) {
    setPrevOpenNew(openNew);
    if (openNew) setNewSheet({ date: anchor, kind: newKind });
  }
  const [prevOpenBlock, setPrevOpenBlock] = useState(openBlock);
  if (prevOpenBlock !== openBlock) {
    setPrevOpenBlock(openBlock);
    if (openBlock) setBlockSheet(true);
  }
  const crewQuery = useCallback(
    (v: CalView, w: string = who, l: boolean = lanes) => `${w !== "all" ? `&who=${w}` : ""}${l && v === "day" ? "&lanes=1" : ""}`,
    [who, lanes]
  );
  const stripParams = useCallback(() => {
    window.history.replaceState(null, "", `/calendar?view=${view}&d=${anchor}${crewQuery(view)}`);
  }, [view, anchor, crewQuery]);

  const nav = useCallback(
    (v: CalView, d: string, w?: string, l?: boolean) => router.push(`/calendar?view=${v}&d=${d}${crewQuery(v, w, l)}`),
    [router, crewQuery]
  );

  const step = (dir: 1 | -1) => {
    if (view === "month") nav(view, `${addMonths(ymOf(anchor), dir)}-01`);
    else nav(view, addDays(anchor, dir * (view === "week" ? 7 : 1)));
  };

  const label =
    view === "month"
      ? fmtMonth(ymOf(anchor))
      : view === "week"
        ? `Week of ${fmtDateShort(addDays(anchor, -weekdayOf(anchor)))}`
        : fmtDateLong(anchor);

  const hoursByDow = useMemo(() => new Map(hours.map((h) => [h.weekday, h])), [hours]);
  // Crew filter: "me" = jobs nobody's assigned to (the owner's), a worker = jobs they're on.
  const visibleJobs = useMemo(() => (who === "all" ? jobs : jobs.filter((j) => lanesOf(assigneesOf(j)).includes(who))), [jobs, who]);
  const visibleBlocks = useMemo(
    () => (who === "all" ? blocks : blocks.filter((b) => b.employee_id == null || b.employee_id === who)),
    [blocks, who]
  );
  const jobsByDate = useMemo(() => groupBy(visibleJobs, (j) => j.date), [visibleJobs]);
  const blocksByDate = useMemo(() => groupBy(visibleBlocks, (b) => b.date), [visibleBlocks]);
  const crewById = useMemo(() => new Map(crew.map((c) => [c.id, c])), [crew]);
  const showCrew = owner && crew.length > 0 && view !== "month";
  const laneMode = showCrew && view === "day" && lanes;
  // One column per worker + the owner; each gets the jobs they're on and their own hours.
  const dayLanes = useMemo<Lane[] | undefined>(() => {
    if (!laneMode) return undefined;
    const d = anchor;
    const dayJobs = jobs.filter((j) => j.date === d);
    const dayBlocks = blocks.filter((b) => b.date === d);
    const biz = hoursByDow.get(weekdayOf(d));
    const mk = (key: string, label: string, color: number | null, h: CrewLane["hours"]): Lane => ({
      key,
      label,
      color,
      hours: hoursFor(h, weekdayOf(d), biz),
      jobs: dayJobs.filter((j) => lanesOf(assigneesOf(j)).includes(key)),
      blocks: dayBlocks.filter((b) => b.employee_id == null || b.employee_id === key),
    });
    return [mk("me", "Me", null, null), ...crew.map((c) => mk(c.id, c.name, c.color, c.hours))];
  }, [laneMode, anchor, jobs, blocks, crew, hoursByDow]);
  const projectedByDate = useMemo(
    () => groupBy(showProjected ? projected : [], (p) => p.date),
    [projected, showProjected]
  );

  return (
    <div className="page page-wide">
      <header className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-3">
        <div className="flex items-center gap-1 mr-auto min-w-0">
          <button className="btn btn-ghost btn-sm btn-icon" onClick={() => step(-1)} aria-label="Previous">
            <IconChevronLeft width={16} height={16} />
          </button>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={() => step(1)} aria-label="Next">
            <IconChevronRight width={16} height={16} />
          </button>
          <h1 key={label} className="h-page truncate ml-1 page-in">{label}</h1>
        </div>
        <button className="btn btn-sm" onClick={() => nav(view, today)} disabled={anchor === today && view !== "month"}>
          Today
        </button>
        <Segmented
          label="Calendar view"
          value={view}
          onChange={(v) => nav(v, anchor)}
          options={[
            { value: "month", label: "Month" },
            { value: "week", label: "Week" },
            { value: "day", label: "Day" },
          ]}
        />
        <div className="flex flex-wrap gap-1.5">
          {projected.length > 0 && (
            <button
              className="choice h-[30px] text-dense"
              aria-pressed={showProjected}
              onClick={() => setShowProjected((v) => !v)}
              title="Standing plan slots that aren't booked as visits yet"
            >
              Plans ahead
            </button>
          )}
          {myEmployee && (
            <button className="btn btn-sm" onClick={() => setFeedSheet(true)}>
              My other job
            </button>
          )}
          <button className="btn btn-sm" onClick={() => setBlockSheet(true)}>
            Block time
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setNewSheet({ date: view === "month" ? today : anchor })}>
            <IconPlus width={14} height={14} /> New
          </button>
        </div>
      </header>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-label text-faint">
        <LegendDot className="bg-brand" label="scheduled" />
        <LegendDot className="bg-ok" label="completed" />
        <LegendDot className="bg-brand-wash border border-brand" label="recurring" />
        {showProjected && projected.length > 0 && (
          <LegendDot className="bg-card border border-dashed border-brand" label="plan slot (held, not booked)" />
        )}
        <LegendDot className="bg-line-2" label="blocked" />
        <LegendDot className="hatch border border-line-2" label="closed" />
      </div>

      {showCrew && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show jobs for">
            {[{ id: "all", name: "All" }, { id: "me", name: "Me" }, ...crew].map((c) => (
              <button key={c.id} type="button" className="chip px-3 text-dense" aria-pressed={who === c.id} onClick={() => nav(view, anchor, c.id)}>
                {"color" in c && <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: workerColor(c.color) }} aria-hidden />}
                {c.name}
              </button>
            ))}
          </div>
          {view === "day" && (
            <Segmented
              label="Day layout"
              className="ml-auto"
              value={lanes ? "lanes" : "timeline"}
              onChange={(v) => nav(view, anchor, who, v === "lanes")}
              options={[
                { value: "timeline", label: "Timeline" },
                { value: "lanes", label: "By worker" },
              ]}
            />
          )}
        </div>
      )}

      <div key={view} className="mt-3 page-in">
        {view === "month" && (
          <MonthGrid
            anchor={anchor}
            today={today}
            jobsByDate={jobsByDate}
            projectedByDate={projectedByDate}
            blocksByDate={blocksByDate}
            hoursByDow={hoursByDow}
            onDay={(d) => nav("day", d)}
          />
        )}
        {view !== "month" && (
          <TimeGrid
            dates={view === "week" ? Array.from({ length: 7 }, (_, i) => addDays(addDays(anchor, -weekdayOf(anchor)), i)) : [anchor]}
            today={today}
            jobsByDate={jobsByDate}
            projectedByDate={projectedByDate}
            blocksByDate={blocksByDate}
            hoursByDow={hoursByDow}
            onJob={setSelected}
            onProjected={(p) => router.push(`/plans/${p.plan_id}`)}
            onBlock={setBlockDetail}
            onEmpty={(date, min, lane) => setNewSheet({ date, startMin: min, assignees: lane ? (lane === "me" ? [] : [lane]) : undefined })}
            onDayHeader={view === "week" ? (d) => nav("day", d) : undefined}
            owner={owner}
            crewById={crewById}
            lanes={dayLanes}
          />
        )}
      </div>

      {selectedJob && <JobSheet job={selectedJob} onClose={() => setSelected(null)} catalog={catalog} />}
      {newSheet && (
        <AppointmentSheet
          open
          onClose={() => {
            setNewSheet(null);
            stripParams();
          }}
          catalog={catalog}
          defaultDate={newSheet.date}
          defaultStartMin={newSheet.startMin}
          defaultKind={newSheet.kind}
          defaultAssignees={newSheet.assignees}
        />
      )}
      <BlockSheet
        open={blockSheet}
        onClose={() => {
          setBlockSheet(false);
          stripParams();
        }}
        defaultDate={view === "month" ? today : anchor}
      />
      {blockDetail && <BlockDetailSheet block={blockDetail} employeeNames={employeeNames} onClose={() => setBlockDetail(null)} />}
      {myEmployee && feedSheet && <FeedSheet employee={myEmployee} onClose={() => setFeedSheet(false)} />}
    </div>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-2.5 h-2.5 rounded-sm ${className}`} />
      {label}
    </span>
  );
}

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  return m;
}

/* ---------------- Month ---------------- */

function MonthGrid({
  anchor,
  today,
  jobsByDate,
  projectedByDate,
  blocksByDate,
  hoursByDow,
  onDay,
}: {
  anchor: string;
  today: string;
  jobsByDate: Map<string, JobWithCustomer[]>;
  projectedByDate: Map<string, ProjectedVisit[]>;
  blocksByDate: Map<string, Block[]>;
  hoursByDow: Map<number, WeeklyHours>;
  onDay: (d: string) => void;
}) {
  const ym = ymOf(anchor);
  const start = monthGridStart(ym);
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));

  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-7 border-b border-line bg-subtle">
        {WEEKDAYS_SHORT.map((d) => (
          <div key={d} className="label text-center py-1.5">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d, i) => {
          const inMonth = ymOf(d) === ym;
          const isToday = d === today;
          const closed = !(hoursByDow.get(weekdayOf(d))?.enabled ?? true);
          const dayJobs = jobsByDate.get(d) ?? [];
          const dayProj = projectedByDate.get(d) ?? [];
          const dayBlocks = blocksByDate.get(d) ?? [];
          return (
            <button
              key={d}
              onClick={() => onDay(d)}
              className={`relative text-left align-top min-h-[72px] md:min-h-[96px] p-1 md:p-1.5 border-line ${i % 7 !== 0 ? "border-l" : ""} ${i >= 7 ? "border-t" : ""} ${
                closed ? "hatch" : inMonth ? "bg-card" : "bg-subtle"
              } hover:bg-brand-wash/40 transition-colors duration-150`}
            >
              <span
                className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs num font-medium ${
                  isToday ? "bg-brand text-white font-bold shadow-sm shadow-brand/30" : inMonth ? "text-ink" : "text-faint"
                }`}
              >
                {parseInt(d.slice(8), 10)}
              </span>
              {/* chips on md+, dots on mobile */}
              <span className="hidden md:flex flex-col gap-0.5 mt-0.5">
                {dayBlocks.length > 0 && (
                  <span className="chip h-[18px]! bg-line-2 text-ink-2 truncate max-w-full">
                    {dayBlocks[0].start_min === 0 && dayBlocks[0].end_min === 1440 ? "blocked" : "partial block"}
                  </span>
                )}
                {dayJobs.slice(0, 3).map((j) => (
                  <span
                    key={j.id}
                    className={`chip h-[18px]! truncate max-w-full num ${
                      j.status === "completed"
                        ? "bg-ok-wash text-ok"
                        : j.plan_id
                          ? "bg-brand-wash text-brand-deep border border-brand/30"
                          : "bg-brand text-white"
                    }`}
                  >
                    {minToLabel(j.start_min).replace(":00", "").replace(" ", "").toLowerCase()}·{(j.customers?.name ?? j.contact_name ?? "?").split(" ")[0]}
                  </span>
                ))}
                {dayProj.slice(0, Math.max(0, 3 - dayJobs.length)).map((p, i) => (
                  <span
                    key={`${p.plan_id}-${i}`}
                    className="chip h-[18px]! truncate max-w-full num bg-card text-brand-deep border border-dashed border-brand/50"
                  >
                    {minToLabel(p.start_min).replace(":00", "").replace(" ", "").toLowerCase()}·{p.customer_name.split(" ")[0]}
                  </span>
                ))}
                {dayJobs.length > 3 && <span className="text-micro text-faint pl-1">+{dayJobs.length - 3} more</span>}
              </span>
              <span className="md:hidden flex flex-wrap gap-0.5 mt-1">
                {dayBlocks.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-line-2" />}
                {dayJobs.slice(0, 4).map((j) => (
                  <span
                    key={j.id}
                    className={`w-1.5 h-1.5 rounded-full ${j.status === "completed" ? "bg-ok" : "bg-brand"}`}
                  />
                ))}
                {dayProj.slice(0, Math.max(0, 4 - dayJobs.length)).map((p, i) => (
                  <span key={`${p.plan_id}-${i}`} className="w-1.5 h-1.5 rounded-full border border-brand bg-transparent" />
                ))}
                {dayJobs.length > 4 && <span className="text-micro text-faint leading-none">+{dayJobs.length - 4}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- Week / Day time grid ---------------- */

/** One column in "By worker" mode: a person, their hours, and only their items. */
interface Lane {
  key: string; // "me" or an employee id
  label: string;
  color: number | null;
  hours: [number, number] | null;
  jobs: JobWithCustomer[];
  blocks: Block[];
}

interface Col {
  key: string;
  date: string;
  lane?: Lane;
  hours: [number, number] | null;
  jobs: JobWithCustomer[];
  proj: ProjectedVisit[];
  blocks: Block[];
}

function TimeGrid({
  dates,
  today,
  jobsByDate,
  projectedByDate,
  blocksByDate,
  hoursByDow,
  onJob,
  onProjected,
  onBlock,
  onEmpty,
  onDayHeader,
  owner,
  crewById,
  lanes,
}: {
  dates: string[];
  today: string;
  jobsByDate: Map<string, JobWithCustomer[]>;
  projectedByDate: Map<string, ProjectedVisit[]>;
  blocksByDate: Map<string, Block[]>;
  hoursByDow: Map<number, WeeklyHours>;
  onJob: (j: JobWithCustomer) => void;
  onProjected: (p: ProjectedVisit) => void;
  onBlock: (b: Block) => void;
  onEmpty: (date: string, startMin: number, lane?: string) => void;
  onDayHeader?: (d: string) => void;
  owner: boolean;
  crewById: Map<string, CrewLane>;
  /** Day view split per worker; columns become people instead of dates. */
  lanes?: Lane[];
}) {
  const cols: Col[] = lanes
    ? lanes.map((l) => ({ key: l.key, date: dates[0], lane: l, hours: l.hours, jobs: l.jobs, proj: l.key === "me" ? projectedByDate.get(dates[0]) ?? [] : [], blocks: l.blocks }))
    : dates.map((d) => {
        const h = hoursByDow.get(weekdayOf(d));
        return { key: d, date: d, hours: h?.enabled ? [h.open_min, h.close_min] : null, jobs: jobsByDate.get(d) ?? [], proj: projectedByDate.get(d) ?? [], blocks: blocksByDate.get(d) ?? [] };
      });

  // Window: business hours padded, expanded to fit anything scheduled outside them.
  let start = 7 * 60;
  let end = 19 * 60;
  for (const c of cols) {
    if (c.hours) {
      start = Math.min(start, c.hours[0]);
      end = Math.max(end, c.hours[1]);
    }
    for (const j of c.jobs) {
      start = Math.min(start, j.start_min);
      end = Math.max(end, j.start_min + j.duration_min);
    }
    for (const p of c.proj) {
      start = Math.min(start, p.start_min);
      end = Math.max(end, p.start_min + p.duration_min);
    }
    for (const b of c.blocks) {
      if (!(b.start_min === 0 && b.end_min === 1440)) {
        start = Math.min(start, b.start_min);
        end = Math.max(end, b.end_min);
      }
    }
  }
  start = Math.floor(start / 60) * 60;
  end = Math.ceil(end / 60) * 60;
  const totalH = ((end - start) / 60) * HOUR_PX;
  // "Now" line — null on the server (hydration-safe), ticks every minute on the client.
  const now = useSyncExternalStore(
    (onTick) => {
      const t = setInterval(onTick, 60_000);
      return () => clearInterval(t);
    },
    () => nowMinutes(),
    () => null
  );
  const y = (min: number) => ((min - start) / 60) * HOUR_PX;
  const stripeOf = (j: JobWithCustomer) => {
    const first = crewById.get(assigneesOf(j)[0] ?? "");
    return first ? workerColor(first.color) : "var(--color-brand)";
  };

  return (
    <div className="card overflow-x-auto">
      <div className="min-w-full" style={{ minWidth: cols.length > 1 ? Math.max(640, cols.length * 160) : undefined }}>
        {/* headers */}
        {cols.length > 1 && (
          <div className="grid border-b border-line bg-subtle" style={{ gridTemplateColumns: `48px repeat(${cols.length}, 1fr)` }}>
            <div />
            {cols.map((c) =>
              c.lane ? (
                <div
                  key={c.key}
                  className="py-1.5 px-1 border-l border-line flex items-center justify-center gap-1.5 min-w-0"
                  style={c.lane.color ? { background: workerWash(c.lane.color) } : undefined}
                >
                  <Avatar name={c.lane.label} size={20} className="ring-2 ring-card" />
                  <span className="text-dense font-semibold truncate">{c.lane.label}</span>
                  {!c.hours && <span className="text-micro text-faint">off</span>}
                </div>
              ) : (
                <button
                  key={c.key}
                  onClick={() => onDayHeader?.(c.date)}
                  className={`py-1.5 text-center border-l border-line ${c.date === today ? "text-brand-deep" : "text-ink-2"}`}
                >
                  <span className="label block">{WEEKDAYS_SHORT[weekdayOf(c.date)]}</span>
                  <span className={`text-md font-semibold num ${c.date === today ? "text-brand-deep" : ""}`}>
                    {parseInt(c.date.slice(8), 10)}
                  </span>
                </button>
              )
            )}
          </div>
        )}
        <div className="grid" style={{ gridTemplateColumns: `48px repeat(${cols.length}, 1fr)` }}>
          {/* hour rail */}
          <div className="relative" style={{ height: totalH }}>
            {Array.from({ length: (end - start) / 60 }, (_, i) => (
              <span
                key={i}
                className="absolute right-1.5 text-micro text-faint num -translate-y-1/2"
                style={{ top: i * HOUR_PX }}
              >
                {i === 0 ? "" : minToLabel(start + i * 60).replace(":00 ", "").toLowerCase()}
              </span>
            ))}
          </div>
          {cols.map((c) => {
            const d = c.date;
            const closed = !c.hours;
            return (
              <div
                key={c.key}
                className={`relative border-l border-line ${closed ? "hatch" : ""}`}
                style={{ height: totalH }}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("[data-item]")) return;
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const min = start + Math.floor(((e.clientY - rect.top) / HOUR_PX) * 60);
                  onEmpty(d, Math.round(min / 30) * 30, c.lane?.key);
                }}
              >
                {d === today && now != null && now >= start && now <= end && (
                  <span className="pointer-events-none absolute inset-x-0 z-20 flex items-center" style={{ top: y(now) }} aria-hidden>
                    <span className="-ml-1 h-2 w-2 rounded-full bg-bad" />
                    <span className="grow h-px bg-bad" />
                  </span>
                )}
                {/* hour lines + off-hours shading */}
                {Array.from({ length: (end - start) / 60 }, (_, i) => (
                  <span key={i} className="absolute inset-x-0 border-t border-line/70" style={{ top: i * HOUR_PX }} />
                ))}
                {c.hours && (
                  <>
                    {c.hours[0] > start && (
                      <span className="absolute inset-x-0 bg-subtle" style={{ top: 0, height: y(c.hours[0]) }} />
                    )}
                    {c.hours[1] < end && (
                      <span className="absolute inset-x-0 bg-subtle" style={{ top: y(c.hours[1]), height: totalH - y(c.hours[1]) }} />
                    )}
                  </>
                )}
                {c.blocks.map((b) => {
                  const bs = b.start_min === 0 && b.end_min === 1440 ? start : Math.max(b.start_min, start);
                  const be = b.start_min === 0 && b.end_min === 1440 ? end : Math.min(b.end_min, end);
                  return (
                    <button
                      key={b.id}
                      data-item
                      onClick={() => onBlock(b)}
                      className="absolute inset-x-0.5 rounded-sm bg-line-2/80 border border-line-2 px-1.5 py-0.5 text-left overflow-hidden"
                      style={{ top: y(bs), height: Math.max(y(be) - y(bs), 18) }}
                    >
                      <span className="flex items-center gap-1 text-label font-medium text-ink-2 min-w-0">
                        <IconBlock width={11} height={11} className="shrink-0" />
                        <span className="truncate">{b.reason || "Blocked"}</span>
                      </span>
                    </button>
                  );
                })}
                {c.proj.map((p, i) => (
                  <button
                    key={`${p.plan_id}-${i}`}
                    data-item
                    onClick={() => onProjected(p)}
                    title="Standing plan slot — not booked yet; opens the plan"
                    className="absolute rounded-md border border-dashed border-brand/60 bg-brand-wash/40 px-1.5 py-1 text-left overflow-hidden hover:bg-brand-wash transition-colors duration-150"
                    style={{ top: y(p.start_min) + 1, height: Math.max((p.duration_min / 60) * HOUR_PX - 2, 22), left: 2, right: 2 }}
                  >
                    <span className="text-label font-semibold truncate block leading-tight text-brand-deep">
                      {p.customer_name.split(" ")[0]}
                      {owner ? ` · ${money(p.price)}` : ""}
                    </span>
                    <span className="text-micro num block leading-tight text-ink-2">{minToLabel(p.start_min)} · plan slot</span>
                  </button>
                ))}
                {c.jobs.map((j) => {
                  const ids = assigneesOf(j);
                  const people = ids.map((id) => crewById.get(id)).filter(Boolean) as CrewLane[];
                  return (
                    <button
                      key={j.id}
                      data-item
                      onClick={() => onJob(j)}
                      className={`absolute rounded-md border px-1.5 py-1 text-left overflow-hidden transition-[box-shadow,transform] duration-150 hover:z-10 hover:shadow-[var(--shadow-raise)] active:scale-[0.98] ${
                        j.status === "completed"
                          ? "bg-ok-wash border-ok/40"
                          : j.status === "no_show"
                            ? "bg-warn-wash border-warn/40"
                            : j.plan_id
                              ? "bg-brand-wash border-brand/50"
                              : "bg-brand/95 border-brand text-white"
                      }`}
                      style={{
                        top: y(j.start_min) + 1,
                        height: Math.max((j.duration_min / 60) * HOUR_PX - 2, 22),
                        left: 2,
                        right: 2,
                        borderLeft: crewById.size ? `3px solid ${stripeOf(j)}` : undefined,
                      }}
                    >
                      {people.length > 0 && !c.lane && (
                        <span className="absolute top-1 right-1 hidden md:flex -space-x-1" aria-hidden>
                          {people.slice(0, 2).map((p) => (
                            <Avatar key={p.id} name={p.name} size={16} className="ring-1 ring-card" />
                          ))}
                          {people.length > 2 && <span className="text-micro num font-semibold pl-1.5">+{people.length - 2}</span>}
                        </span>
                      )}
                      <span className="text-label font-semibold truncate block leading-tight pr-8">
                        {(j.customers?.name ?? j.contact_name ?? "?").split(" ")[0]}
                        {owner ? ` · ${money(Number(j.price))}` : ""}
                      </span>
                      <span className={`text-micro num block leading-tight ${j.status === "scheduled" && !j.plan_id ? "text-white/80" : "text-ink-2"}`}>
                        {minToLabel(j.start_min)} · {j.duration_min}m
                        {people.length > 0 && <span className="sr-only"> · {people.map((p) => p.name).join(", ")}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function BlockDetailSheet({
  block,
  employeeNames,
  onClose,
}: {
  block: Block;
  employeeNames: Record<string, string>;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const who = block.employee_id ? employeeNames[block.employee_id] : null;
  return (
    <Sheet open onClose={onClose} title="Blocked time">
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-md font-semibold">{fmtDateLong(block.date)}</p>
          <p className="text-sm text-ink-2 num">
            {block.start_min === 0 && block.end_min === 1440
              ? "All day"
              : `${minToLabel(block.start_min)} – ${minToLabel(block.end_min)}`}
          </p>
          {block.reason && <p className="text-sm mt-1">{block.reason}</p>}
          {who && (
            <p className="text-dense text-faint mt-1">
              {block.source === "ical" ? `Synced from ${who}'s calendar` : `${who}'s time off`}
            </p>
          )}
        </div>
        {block.source === "ical" ? (
          <p className="note text-dense">
            This comes from a synced calendar — deleting it here would just bring it back on the next sync. Remove the
            event on that calendar instead.
          </p>
        ) : (
          <button
            className="btn btn-danger"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              const res = await deleteBlock(block.id);
              setPending(false);
              if (!res.ok) return toast({ title: "Couldn't remove the block", detail: res.error, tone: "bad" });
              onClose();
              router.refresh();
              const allDay = block.start_min === 0 && block.end_min === 1440;
              toast({
                title: "Block removed",
                detail: `${fmtDateShort(block.date)} · ${allDay ? "all day" : `${minToLabel(block.start_min)} – ${minToLabel(block.end_min)}`}`,
                undo: async () => {
                  const back = await addBlock({ dateFrom: block.date, allDay, startMin: block.start_min, endMin: block.end_min, reason: block.reason });
                  if (back.ok) router.refresh();
                  return back;
                },
              });
            }}
          >
            {pending ? <Busy>Removing…</Busy> : "Remove block"}
          </button>
        )}
      </div>
    </Sheet>
  );
}

/**
 * A worker's other-job calendar feed: paste the Google Calendar secret iCal link
 * once and shifts keep blocking the schedule on their own.
 */
function FeedSheet({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const router = useRouter();
  const [url, setUrl] = useState(employee.ical_url ?? "");
  const [state, setState] = useState<"idle" | "busy" | string>("idle");

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setState("busy");
    const res = await fn();
    if (!res.ok) return setState(res.error ?? "Failed.");
    setState("idle");
    onClose();
    router.refresh();
  }

  return (
    <Sheet open onClose={onClose} title="My other job">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-2">
          Paste your other job&apos;s calendar link and those shifts block this schedule automatically — no more typing
          them in. In Google Calendar: Settings → your calendar → <span className="font-medium">Secret address in iCal
          format</span>, copy the link ending in .ics.
        </p>
        <input
          className="input"
          placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        {employee.ical_synced_at && (
          <p className="text-xs text-faint -mt-2">
            Last synced{" "}
            {new Date(employee.ical_synced_at).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              timeZone: "America/New_York",
            })}
            . Re-syncs daily and whenever the calendar page is opened.
          </p>
        )}
        {state !== "idle" && state !== "busy" && <p className="text-sm text-bad">{state}</p>}
        <button className="btn btn-primary h-11" disabled={state === "busy"} onClick={() => run(() => saveMyCalendarFeed(url))}>
          {state === "busy" ? "Syncing…" : url.trim() ? "Save & sync" : "Remove feed"}
        </button>
        {employee.ical_url && url === employee.ical_url && (
          <button className="btn" disabled={state === "busy"} onClick={() => run(() => syncCalendarNow())}>
            Sync now
          </button>
        )}
      </div>
    </Sheet>
  );
}
