"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { JobSheet, type JobWithCustomer } from "@/components/job-sheet";
import { IconPhone, IconPin } from "@/components/icons";
import { EmptyState } from "@/components/ui";
import type { Catalog } from "@/lib/catalog";
import { fmtPhone, mapsHref, money, telHref } from "@/lib/format";
import { fmtDateShort, minToLabel, nowMinutes } from "@/lib/time";

export interface AttentionData {
  pending: JobWithCustomer[];
  unlinked: JobWithCustomer[];
  owed: { customer_id: string; name: string; balance: number }[];
  plansWithoutVisit: { id: string; customerName: string; cadence: string }[];
}

interface Stats {
  weekCollected: number;
  monthCollected: number;
  jobsCompleted: number;
  totalOwed: number;
  activePlans: number;
}

export function TodayClient({
  dateLabel,
  jobs,
  catalog,
  stats,
  attention,
}: {
  dateLabel: string;
  jobs: JobWithCustomer[];
  catalog: Catalog;
  stats: Stats | null; // null = washer view: schedule only
  attention: AttentionData | null;
}) {
  const [selected, setSelected] = useState<JobWithCustomer | null>(null);
  // "Now" marker — null on the server (hydration-safe), ticks every minute on the client.
  const now = useSyncExternalStore(
    (onTick) => {
      const t = setInterval(onTick, 60_000);
      return () => clearInterval(t);
    },
    () => nowMinutes(),
    () => null
  );

  const active = jobs.filter((j) => j.status === "scheduled" || j.status === "completed" || j.status === "no_show");
  const attentionCount = attention
    ? attention.pending.length + attention.unlinked.length + attention.owed.length + attention.plansWithoutVisit.length
    : 0;

  return (
    <div className="px-4 md:px-8 py-5 md:py-7 max-w-5xl">
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">Today</h1>
          <p className="text-sm text-ink-2 mt-0.5">{dateLabel}</p>
        </div>
        <Link href="/calendar" className="text-sm text-brand-deep font-medium hover:underline underline-offset-2 shrink-0">
          Calendar →
        </Link>
      </header>

      {/* Stat row (owners only) */}
      {stats && (
        <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-px bg-line border border-line rounded-[10px] overflow-hidden">
          <Stat label="Collected this week" value={money(stats.weekCollected)} />
          <Stat label="Collected this month" value={money(stats.monthCollected)} />
          <Stat label="Jobs done this month" value={String(stats.jobsCompleted)} />
          <Stat label="Owed to you" value={money(stats.totalOwed)} tone={stats.totalOwed > 0 ? "bad" : undefined} />
          <Stat label="Active plans" value={String(stats.activePlans)} className="col-span-2 md:col-span-1" />
        </div>
      )}

      {/* Timeline */}
      <section className="mt-6">
        <h2 className="label mb-2">Schedule — {active.length === 0 ? "clear" : `${active.length} job${active.length > 1 ? "s" : ""}`}</h2>
        {active.length === 0 ? (
          <EmptyState
            title="Nothing on the books today."
            hint="Book a job from the calendar, or use the time — the schedule fills itself from the website too."
            action={
              <Link href="/calendar?new=1" className="btn btn-primary">
                New appointment
              </Link>
            }
          />
        ) : (
          <div className="relative flex flex-col gap-2">
            {active.map((job, i) => {
              const showNowBefore =
                now != null &&
                now < job.start_min &&
                (i === 0 || active[i - 1].start_min <= now);
              const inProgress = now != null && now >= job.start_min && now < job.start_min + job.duration_min && job.status === "scheduled";
              return (
                <div key={job.id}>
                  {showNowBefore && <NowLine />}
                  <JobCard job={job} inProgress={inProgress} onOpen={() => setSelected(job)} />
                </div>
              );
            })}
            {now != null && active.length > 0 && now >= active[active.length - 1].start_min && now >= (active[active.length - 1].start_min + active[active.length - 1].duration_min) && <NowLine />}
          </div>
        )}
      </section>

      {/* Needs attention (owners only) */}
      {attention && attentionCount > 0 && (
        <section className="mt-8">
          <h2 className="label mb-2">Needs attention</h2>
          <div className="card divide-y divide-line">
            {attention.pending.map((a) => (
              <button
                key={a.id}
                onClick={() => setSelected(a)}
                className="w-full text-left px-4 py-3 flex items-center justify-between gap-3 hover:bg-[#f8fafd]"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {a.contact_name ?? a.customers?.name ?? "Unknown"}{" "}
                    <span className="text-faint font-normal">· web booking · {money(Number(a.price))}</span>
                  </p>
                  <p className="text-xs text-faint num">
                    {fmtDateShort(a.date)} at {minToLabel(a.start_min)} · {a.service_name}
                  </p>
                </div>
                <span className="chip bg-warn-wash text-warn shrink-0">approve</span>
              </button>
            ))}
            {attention.unlinked.map((a) => (
              <button
                key={a.id}
                onClick={() => setSelected(a)}
                className="w-full text-left px-4 py-3 flex items-center justify-between gap-3 hover:bg-[#f8fafd]"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {a.contact_name} <span className="text-faint font-normal">· web booking not linked</span>
                  </p>
                  <p className="text-xs text-faint num">
                    {fmtDateShort(a.date)} at {minToLabel(a.start_min)}
                  </p>
                </div>
                <span className="chip bg-warn-wash text-warn shrink-0">link</span>
              </button>
            ))}
            {attention.owed.map((b) => (
              <Link
                key={b.customer_id}
                href={`/customers/${b.customer_id}`}
                className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-[#f8fafd]"
              >
                <p className="text-sm font-medium truncate">{b.name}</p>
                <span className="text-sm font-medium text-bad num shrink-0">owes {money(Math.abs(b.balance))}</span>
              </Link>
            ))}
            {attention.plansWithoutVisit.map((p) => (
              <Link
                key={p.id}
                href={`/plans/${p.id}`}
                className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-[#f8fafd]"
              >
                <p className="text-sm font-medium truncate">
                  {p.customerName} <span className="text-faint font-normal">· {p.cadence} plan</span>
                </p>
                <span className="chip bg-warn-wash text-warn shrink-0">no visit scheduled</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {selected && <JobSheet job={selected} onClose={() => setSelected(null)} catalog={catalog} />}
    </div>
  );
}

function Stat({ label, value, tone, className = "" }: { label: string; value: string; tone?: "bad"; className?: string }) {
  return (
    <div className={`bg-card px-3.5 py-3 ${className}`}>
      <p className="label">{label}</p>
      <p className={`mt-1 text-lg font-semibold num leading-none ${tone === "bad" ? "text-bad" : ""}`}>{value}</p>
    </div>
  );
}

function NowLine() {
  return (
    <div className="flex items-center gap-2 py-1.5" aria-hidden>
      <span className="w-2 h-2 rounded-full bg-brand shrink-0" />
      <span className="grow border-t-2 border-brand" />
      <span className="text-[10px] font-bold uppercase tracking-wider text-brand">now</span>
    </div>
  );
}

function JobCard({ job, inProgress, onOpen }: { job: JobWithCustomer; inProgress: boolean; onOpen: () => void }) {
  const name = job.customers?.name ?? job.contact_name ?? "Unknown";
  const phone = job.customers?.phone ?? job.contact_phone;
  const done = job.status === "completed";
  const noShow = job.status === "no_show";
  return (
    <div
      className={`card flex overflow-hidden transition-colors duration-150 ${inProgress ? "border-brand" : ""} ${done || noShow ? "opacity-60" : ""}`}
    >
      <button onClick={onOpen} className="flex grow text-left min-w-0">
        {/* time rail */}
        <div className={`w-[74px] shrink-0 px-3 py-3 border-r border-line ${inProgress ? "bg-brand-wash" : "bg-[#fafbfd]"}`}>
          <p className="text-[15px] font-bold num leading-tight">{minToLabel(job.start_min).replace(" ", "")}</p>
          <p className="text-[11px] text-faint num mt-0.5">{job.duration_min}m</p>
          {done && <p className="text-[10px] font-bold uppercase tracking-wide text-ok mt-1">done</p>}
          {noShow && <p className="text-[10px] font-bold uppercase tracking-wide text-warn mt-1">no-show</p>}
        </div>
        <div className="px-3.5 py-3 min-w-0 grow">
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-[15px] font-semibold truncate">{name}</p>
            {job.plan_id && <span className="chip bg-brand-wash text-brand-deep shrink-0">plan</span>}
            {!job.customer_id && <span className="chip bg-warn-wash text-warn shrink-0">unlinked</span>}
          </div>
          <p className="text-[13px] text-ink-2 truncate mt-0.5">
            {job.size_label || job.service_name}
            {job.addons.length > 0 && ` · +${job.addons.map((a) => a.name).join(", ")}`}
          </p>
          <p className="text-[13px] text-ink-2 truncate">{job.address || "No address"}</p>
          {job.notes && <p className="text-[12px] text-warn truncate mt-0.5">⚑ {job.notes}</p>}
        </div>
        <div className="px-3.5 py-3 shrink-0 text-right">
          <p className="text-[15px] font-semibold num">{money(Number(job.price))}</p>
        </div>
      </button>
      {/* quick actions column */}
      <div className="flex flex-col border-l border-line shrink-0">
        <a
          href={phone ? telHref(phone) : undefined}
          aria-label={phone ? `Call ${fmtPhone(phone)}` : "No phone"}
          className={`flex items-center justify-center w-11 grow text-ink-2 hover:bg-[#f1f4f9] hover:text-brand-deep ${phone ? "" : "pointer-events-none opacity-30"}`}
        >
          <IconPhone width={16} height={16} />
        </a>
        <a
          href={job.address ? mapsHref(job.address) : undefined}
          target="_blank"
          rel="noreferrer"
          aria-label="Open in Maps"
          className={`flex items-center justify-center w-11 grow border-t border-line text-ink-2 hover:bg-[#f1f4f9] hover:text-brand-deep ${job.address ? "" : "pointer-events-none opacity-30"}`}
        >
          <IconPin width={16} height={16} />
        </a>
      </div>
    </div>
  );
}
