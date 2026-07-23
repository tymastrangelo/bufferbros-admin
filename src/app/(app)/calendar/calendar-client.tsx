"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { AppointmentSheet } from "@/components/appointment-sheet";
import { BlockSheet } from "@/components/block-sheet";
import { IconChevronLeft, IconChevronRight, IconPlus } from "@/components/icons";
import { JobSheet, type JobWithCustomer } from "@/components/job-sheet";
import { Sheet } from "@/components/ui";
import { deleteBlock } from "@/lib/actions/settings";
import type { Catalog } from "@/lib/catalog";
import { money } from "@/lib/format";
import { addDays, addMonths, fmtDateLong, fmtDateShort, fmtMonth, minToLabel, monthGridStart, weekdayOf, WEEKDAYS_SHORT, ymOf } from "@/lib/time";
import type { Block, WeeklyHours } from "@/lib/types";

export type CalView = "month" | "week" | "day";

const HOUR_PX = 56;

export function CalendarClient({
  view,
  anchor,
  today,
  jobs,
  blocks,
  hours,
  catalog,
  openNew,
  openBlock,
  owner,
}: {
  view: CalView;
  anchor: string;
  today: string;
  jobs: JobWithCustomer[];
  blocks: Block[];
  hours: WeeklyHours[];
  catalog: Catalog;
  openNew: boolean;
  openBlock: boolean;
  owner: boolean;
}) {
  const router = useRouter();
  // Store the tapped job, but always render the fresh copy from server props —
  // after an action refreshes the route, the open sheet updates in place.
  const [selected, setSelected] = useState<JobWithCustomer | null>(null);
  const selectedJob = selected ? (jobs.find((j) => j.id === selected.id) ?? selected) : null;
  const [newSheet, setNewSheet] = useState<{ date: string; startMin?: number } | null>(
    openNew ? { date: anchor } : null
  );
  const [blockSheet, setBlockSheet] = useState(openBlock);
  const [blockDetail, setBlockDetail] = useState<Block | null>(null);

  // re-arm when the ＋New menu navigates here with ?new=1 / ?block=1
  const [prevOpenNew, setPrevOpenNew] = useState(openNew);
  if (prevOpenNew !== openNew) {
    setPrevOpenNew(openNew);
    if (openNew) setNewSheet({ date: anchor });
  }
  const [prevOpenBlock, setPrevOpenBlock] = useState(openBlock);
  if (prevOpenBlock !== openBlock) {
    setPrevOpenBlock(openBlock);
    if (openBlock) setBlockSheet(true);
  }
  const stripParams = useCallback(() => {
    window.history.replaceState(null, "", `/calendar?view=${view}&d=${anchor}`);
  }, [view, anchor]);

  const nav = useCallback(
    (v: CalView, d: string) => router.push(`/calendar?view=${v}&d=${d}`),
    [router]
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
  const jobsByDate = useMemo(() => groupBy(jobs, (j) => j.date), [jobs]);
  const blocksByDate = useMemo(() => groupBy(blocks, (b) => b.date), [blocks]);

  return (
    <div className="px-3 md:px-8 py-5 md:py-7 max-w-6xl">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl md:text-2xl font-bold mr-auto">{label}</h1>
        <div className="flex items-center gap-1">
          <button className="btn btn-sm" onClick={() => step(-1)} aria-label="Previous">
            <IconChevronLeft width={15} height={15} />
          </button>
          <button className="btn btn-sm" onClick={() => nav(view, today)}>
            Today
          </button>
          <button className="btn btn-sm" onClick={() => step(1)} aria-label="Next">
            <IconChevronRight width={15} height={15} />
          </button>
        </div>
        <div className="flex rounded-md border border-line-2 overflow-hidden" role="tablist" aria-label="Calendar view">
          {(["month", "week", "day"] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => nav(v, anchor)}
              className={`h-[30px] px-3 text-[13px] font-medium capitalize ${
                view === v ? "bg-ink text-white" : "bg-card text-ink-2 hover:bg-[#f1f4f9]"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          <button className="btn btn-sm" onClick={() => setBlockSheet(true)}>
            Block time
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setNewSheet({ date: view === "month" ? today : anchor })}>
            <IconPlus width={13} height={13} /> New
          </button>
        </div>
      </header>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-faint">
        <LegendDot className="bg-brand" label="scheduled" />
        <LegendDot className="bg-ok" label="completed" />
        <LegendDot className="bg-brand-wash border border-brand" label="recurring" />
        <LegendDot className="bg-line-2" label="blocked" />
        <LegendDot className="bg-[repeating-linear-gradient(45deg,#e5e7eb_0_3px,#f6f8fb_3px_6px)]" label="closed" />
      </div>

      <div className="mt-3">
        {view === "month" && (
          <MonthGrid
            anchor={anchor}
            today={today}
            jobsByDate={jobsByDate}
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
            blocksByDate={blocksByDate}
            hoursByDow={hoursByDow}
            onJob={setSelected}
            onBlock={setBlockDetail}
            onEmpty={(date, min) => setNewSheet({ date, startMin: min })}
            onDayHeader={view === "week" ? (d) => nav("day", d) : undefined}
            owner={owner}
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
      {blockDetail && <BlockDetailSheet block={blockDetail} onClose={() => setBlockDetail(null)} />}
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
  blocksByDate,
  hoursByDow,
  onDay,
}: {
  anchor: string;
  today: string;
  jobsByDate: Map<string, JobWithCustomer[]>;
  blocksByDate: Map<string, Block[]>;
  hoursByDow: Map<number, WeeklyHours>;
  onDay: (d: string) => void;
}) {
  const ym = ymOf(anchor);
  const start = monthGridStart(ym);
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));

  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-7 border-b border-line bg-[#fafbfd]">
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
          const dayBlocks = blocksByDate.get(d) ?? [];
          return (
            <button
              key={d}
              onClick={() => onDay(d)}
              className={`relative text-left align-top min-h-[72px] md:min-h-[96px] p-1 md:p-1.5 border-line ${i % 7 !== 0 ? "border-l" : ""} ${i >= 7 ? "border-t" : ""} ${
                closed ? "bg-[repeating-linear-gradient(45deg,#eef1f6_0_3px,#f6f8fb_3px_6px)]" : inMonth ? "bg-card" : "bg-[#fafbfd]"
              } hover:bg-brand-wash/40 transition-colors duration-150`}
            >
              <span
                className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[12px] num font-medium ${
                  isToday ? "bg-brand text-white font-bold" : inMonth ? "text-ink" : "text-faint"
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
                {dayJobs.length > 3 && <span className="text-[10px] text-faint pl-1">+{dayJobs.length - 3} more</span>}
              </span>
              <span className="md:hidden flex flex-wrap gap-0.5 mt-1">
                {dayBlocks.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-line-2" />}
                {dayJobs.slice(0, 4).map((j) => (
                  <span
                    key={j.id}
                    className={`w-1.5 h-1.5 rounded-full ${j.status === "completed" ? "bg-ok" : "bg-brand"}`}
                  />
                ))}
                {dayJobs.length > 4 && <span className="text-[9px] text-faint leading-none">+{dayJobs.length - 4}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- Week / Day time grid ---------------- */

function TimeGrid({
  dates,
  today,
  jobsByDate,
  blocksByDate,
  hoursByDow,
  onJob,
  onBlock,
  onEmpty,
  onDayHeader,
  owner,
}: {
  dates: string[];
  today: string;
  jobsByDate: Map<string, JobWithCustomer[]>;
  blocksByDate: Map<string, Block[]>;
  hoursByDow: Map<number, WeeklyHours>;
  onJob: (j: JobWithCustomer) => void;
  onBlock: (b: Block) => void;
  onEmpty: (date: string, startMin: number) => void;
  onDayHeader?: (d: string) => void;
  owner: boolean;
}) {
  // Window: business hours padded, expanded to fit anything scheduled outside them.
  let start = 7 * 60;
  let end = 19 * 60;
  for (const d of dates) {
    const h = hoursByDow.get(weekdayOf(d));
    if (h?.enabled) {
      start = Math.min(start, h.open_min);
      end = Math.max(end, h.close_min);
    }
    for (const j of jobsByDate.get(d) ?? []) {
      start = Math.min(start, j.start_min);
      end = Math.max(end, j.start_min + j.duration_min);
    }
    for (const b of blocksByDate.get(d) ?? []) {
      if (!(b.start_min === 0 && b.end_min === 1440)) {
        start = Math.min(start, b.start_min);
        end = Math.max(end, b.end_min);
      }
    }
  }
  start = Math.floor(start / 60) * 60;
  end = Math.ceil(end / 60) * 60;
  const totalH = ((end - start) / 60) * HOUR_PX;
  const y = (min: number) => ((min - start) / 60) * HOUR_PX;

  return (
    <div className="card overflow-x-auto">
      <div className="min-w-full" style={{ minWidth: dates.length > 1 ? 640 : undefined }}>
        {/* headers */}
        {dates.length > 1 && (
          <div className="grid border-b border-line bg-[#fafbfd]" style={{ gridTemplateColumns: `48px repeat(${dates.length}, 1fr)` }}>
            <div />
            {dates.map((d) => (
              <button
                key={d}
                onClick={() => onDayHeader?.(d)}
                className={`py-1.5 text-center border-l border-line ${d === today ? "text-brand-deep" : "text-ink-2"}`}
              >
                <span className="label block">{WEEKDAYS_SHORT[weekdayOf(d)]}</span>
                <span className={`text-[15px] font-semibold num ${d === today ? "text-brand-deep" : ""}`}>
                  {parseInt(d.slice(8), 10)}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="grid" style={{ gridTemplateColumns: `48px repeat(${dates.length}, 1fr)` }}>
          {/* hour rail */}
          <div className="relative" style={{ height: totalH }}>
            {Array.from({ length: (end - start) / 60 }, (_, i) => (
              <span
                key={i}
                className="absolute right-1.5 text-[10px] text-faint num -translate-y-1/2"
                style={{ top: i * HOUR_PX }}
              >
                {i === 0 ? "" : minToLabel(start + i * 60).replace(":00 ", "").toLowerCase()}
              </span>
            ))}
          </div>
          {dates.map((d) => {
            const h = hoursByDow.get(weekdayOf(d));
            const closed = !(h?.enabled ?? true);
            const dayJobs = jobsByDate.get(d) ?? [];
            const dayBlocks = blocksByDate.get(d) ?? [];
            return (
              <div
                key={d}
                className={`relative border-l border-line ${closed ? "bg-[repeating-linear-gradient(45deg,#eef1f6_0_3px,#f6f8fb_3px_6px)]" : ""}`}
                style={{ height: totalH }}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("[data-item]")) return;
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const min = start + Math.floor(((e.clientY - rect.top) / HOUR_PX) * 60);
                  onEmpty(d, Math.round(min / 30) * 30);
                }}
              >
                {/* hour lines + off-hours shading */}
                {Array.from({ length: (end - start) / 60 }, (_, i) => (
                  <span key={i} className="absolute inset-x-0 border-t border-line/70" style={{ top: i * HOUR_PX }} />
                ))}
                {!closed && h && (
                  <>
                    {h.open_min > start && (
                      <span className="absolute inset-x-0 bg-[#fafbfd]" style={{ top: 0, height: y(h.open_min) }} />
                    )}
                    {h.close_min < end && (
                      <span className="absolute inset-x-0 bg-[#fafbfd]" style={{ top: y(h.close_min), height: totalH - y(h.close_min) }} />
                    )}
                  </>
                )}
                {dayBlocks.map((b) => {
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
                      <span className="text-[11px] font-medium text-ink-2 truncate block">
                        ⃠ {b.reason || "Blocked"}
                      </span>
                    </button>
                  );
                })}
                {dayJobs.map((j) => (
                  <button
                    key={j.id}
                    data-item
                    onClick={() => onJob(j)}
                    className={`absolute rounded-md border px-1.5 py-1 text-left overflow-hidden transition-colors duration-150 ${
                      j.status === "completed"
                        ? "bg-ok-wash border-ok/40"
                        : j.status === "no_show"
                          ? "bg-warn-wash border-warn/40"
                          : j.plan_id
                            ? "bg-brand-wash border-brand/50"
                            : "bg-brand/95 border-brand text-white"
                    }`}
                    style={{ top: y(j.start_min) + 1, height: Math.max((j.duration_min / 60) * HOUR_PX - 2, 22), left: 2, right: 2 }}
                  >
                    <span className="text-[11px] font-semibold truncate block leading-tight">
                      {(j.customers?.name ?? j.contact_name ?? "?").split(" ")[0]}
                      {owner ? ` · ${money(Number(j.price))}` : ""}
                    </span>
                    <span className={`text-[10px] num block leading-tight ${j.status === "scheduled" && !j.plan_id ? "text-white/80" : "text-ink-2"}`}>
                      {minToLabel(j.start_min)} · {j.duration_min}m
                    </span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Blocks ---------------- */

function BlockDetailSheet({ block, onClose }: { block: Block; onClose: () => void }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Sheet open onClose={onClose} title="Blocked time">
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-[15px] font-semibold">{fmtDateLong(block.date)}</p>
          <p className="text-sm text-ink-2 num">
            {block.start_min === 0 && block.end_min === 1440
              ? "All day"
              : `${minToLabel(block.start_min)} – ${minToLabel(block.end_min)}`}
          </p>
          {block.reason && <p className="text-sm mt-1">{block.reason}</p>}
        </div>
        <button
          className="btn btn-danger"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            await deleteBlock(block.id);
            onClose();
            router.refresh();
          }}
        >
          {pending ? "Removing…" : "Remove block"}
        </button>
      </div>
    </Sheet>
  );
}
