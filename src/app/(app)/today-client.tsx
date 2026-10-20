"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { JobSheet, type JobWithCustomer } from "@/components/job-sheet";
import { IconCalendar, IconFlag, IconPhone, IconPin } from "@/components/icons";
import { TextsToSendCard, TextSyncBar } from "@/components/client-texts";
import type { Suggestion } from "@/lib/suggestions";
import { RemindersCard, type ReminderRow } from "@/components/reminders-card";
import { EmptyState, PageHeader, SectionLabel, Stat } from "@/components/ui";
import type { Catalog } from "@/lib/catalog";
import type { TextSyncRun } from "@/lib/types";
import { fmtPhone, mapsHref, money, telHref } from "@/lib/format";
import { fmtDateShort, minToLabel, nowMinutes } from "@/lib/time";

export interface AttentionData {
  pending: JobWithCustomer[];
  unlinked: JobWithCustomer[];
  owed: { customer_id: string; name: string; balance: number }[];
  plansWithoutVisit: { id: string; customerName: string; cadence: string }[];
  duplicates: { name: string; count: number }[];
}

interface Stats {
  weekCollected: number;
  monthCollected: number;
  jobsCompleted: number;
  /** Owner <-> workers settlement net: positive = they owe Tyler, negative = Tyler owes them. */
  payoutNet: number;
  /** "Gabe" with one worker, "Workers" with more. */
  workerLabel: string;
  activePlans: number;
}

export function TodayClient({
  dateLabel,
  jobs,
  catalog,
  stats,
  attention,
  reminders,
  suggestions,
  textSyncRun,
}: {
  dateLabel: string;
  jobs: JobWithCustomer[];
  catalog: Catalog;
  stats: Stats | null; // null = washer view: schedule only
  attention: AttentionData | null;
  reminders: ReminderRow[] | null; // null = washer view
  /** drafted follow-ups that fit today (owner only; empty for workers) */
  suggestions: Suggestion[];
  /** latest text-sync run for the home Sync button (null for workers or before the first run) */
  textSyncRun: TextSyncRun | null;
}) {
  // Store the tapped job, render the fresh copy from server props so an open
  // sheet updates in place after any action refreshes the route.
  const [selected, setSelected] = useState<JobWithCustomer | null>(null);
  const selectedJob = selected
    ? ([...jobs, ...(attention?.pending ?? []), ...(attention?.unlinked ?? [])].find((j) => j.id === selected.id) ??
      selected)
    : null;
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
    ? attention.pending.length +
      attention.unlinked.length +
      attention.owed.length +
      attention.plansWithoutVisit.length +
      (attention.duplicates.length ? 1 : 0)
    : 0;

  return (
    <div className="page max-w-5xl">
      <PageHeader
        title="Today"
        sub={dateLabel}
        actions={
          <Link href="/calendar" className="btn btn-sm">
            <IconCalendar width={14} height={14} /> Calendar
          </Link>
        }
      />

      {/* Stat row (owners only) */}
      {stats && (
        <div className="stat-grid grid-cols-2 md:grid-cols-5">
          <Stat label="Collected this week" value={money(stats.weekCollected)} />
          <Stat label="Collected this month" value={money(stats.monthCollected)} />
          <Stat label="Jobs done this month" value={String(stats.jobsCompleted)} />
          <Stat
            label={stats.payoutNet > 0 ? `${stats.workerLabel} owes you` : stats.payoutNet < 0 ? `You owe ${stats.workerLabel}` : "Payouts"}
            value={stats.payoutNet === 0 ? "Even" : money(Math.abs(stats.payoutNet))}
            tone={stats.payoutNet < 0 ? "bad" : undefined}
            href="/money/payouts"
          />
          <Stat label="Active plans" value={String(stats.activePlans)} className="col-span-2 md:col-span-1" />
        </div>
      )}

      {/* Timeline */}
      <section className={stats ? "mt-7" : ""}>
        <SectionLabel trailing={active.length > 0 ? `${active.length} job${active.length > 1 ? "s" : ""}` : undefined}>
          Schedule
        </SectionLabel>
        {active.length === 0 ? (
          <EmptyState
            icon={<IconCalendar width={18} height={18} />}
            title="Nothing on the books today."
            hint="Book a job from the calendar, or use the time — the schedule fills itself from the website too."
            action={
              <Link href="/calendar?new=1" className="btn btn-primary">
                New appointment
              </Link>
            }
          />
        ) : (
          <div className="stagger relative flex flex-col gap-2">
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
          <SectionLabel trailing={attentionCount}>Needs attention</SectionLabel>
          <div className="card divide-y divide-line overflow-hidden">
            {attention.pending.map((a) => (
              <button
                key={a.id}
                onClick={() => setSelected(a)}
                className="row row-link justify-between"
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
                <span className="chip chip-warn shrink-0">approve</span>
              </button>
            ))}
            {attention.unlinked.map((a) => (
              <button
                key={a.id}
                onClick={() => setSelected(a)}
                className="row row-link justify-between"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {a.contact_name} <span className="text-faint font-normal">· web booking not linked</span>
                  </p>
                  <p className="text-xs text-faint num">
                    {fmtDateShort(a.date)} at {minToLabel(a.start_min)}
                  </p>
                </div>
                <span className="chip chip-warn shrink-0">link</span>
              </button>
            ))}
            {attention.owed.map((b) => (
              <Link
                key={b.customer_id}
                href={`/customers/${b.customer_id}`}
                className="row row-link justify-between"
              >
                <p className="text-sm font-medium truncate">{b.name}</p>
                <span className="text-sm font-medium text-bad num shrink-0">owes {money(Math.abs(b.balance))}</span>
              </Link>
            ))}
            {attention.duplicates.length > 0 && (
              <Link href="/customers?dupes=1" className="row row-link justify-between">
                <p className="text-sm font-medium truncate">
                  {attention.duplicates.length === 1
                    ? `${attention.duplicates[0].name} is in your customers ${attention.duplicates[0].count} times`
                    : `${attention.duplicates.length} customers have duplicate records`}
                </p>
                <span className="chip chip-brand shrink-0">merge</span>
              </Link>
            )}
            {attention.plansWithoutVisit.map((p) => (
              <Link
                key={p.id}
                href={`/plans/${p.id}`}
                className="row row-link justify-between"
              >
                <p className="text-sm font-medium truncate">
                  {p.customerName} <span className="text-faint font-normal">· {p.cadence} plan</span>
                </p>
                <span className="chip chip-warn shrink-0">no visit scheduled</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {reminders !== null && (
        <div className="mt-8">
          <TextSyncBar run={textSyncRun} />
        </div>
      )}
      {suggestions.length > 0 && <TextsToSendCard suggestions={suggestions} />}

      {reminders && <RemindersCard reminders={reminders} />}

      {selectedJob && <JobSheet job={selectedJob} onClose={() => setSelected(null)} catalog={catalog} />}
    </div>
  );
}

function NowLine() {
  return (
    <div className="flex items-center gap-2 py-1.5" aria-hidden>
      <span className="w-2 h-2 rounded-full bg-brand shrink-0" />
      <span className="grow border-t-2 border-brand" />
      <span className="text-micro font-bold uppercase tracking-wider text-brand">now</span>
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
      className={`card card-link flex overflow-hidden ${inProgress ? "border-brand! ring-2 ring-brand/15" : ""} ${done || noShow ? "opacity-60" : ""}`}
    >
      <button onClick={onOpen} className="flex grow text-left min-w-0">
        {/* time rail — meridiem rides small so "12:00PM" can't overflow the rail */}
        <div className={`w-[78px] shrink-0 px-2.5 py-3 border-r border-line ${inProgress ? "bg-brand-wash" : "bg-subtle"}`}>
          <p className="text-md font-bold num leading-tight whitespace-nowrap">
            {minToLabel(job.start_min).split(" ")[0]}
            <span className="text-label font-semibold">{minToLabel(job.start_min).split(" ")[1]}</span>
          </p>
          <p className="text-label text-faint num mt-0.5">{job.duration_min}m</p>
          {done && <p className="text-micro font-bold uppercase tracking-wide text-ok mt-1">done</p>}
          {noShow && <p className="text-micro font-bold uppercase tracking-wide text-warn mt-1">no-show</p>}
        </div>
        <div className="px-3.5 py-3 min-w-0 grow">
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-md font-semibold truncate">{name}</p>
            {job.plan_id && <span className="chip chip-brand shrink-0">plan</span>}
            {!job.customer_id && <span className="chip chip-warn shrink-0">unlinked</span>}
          </div>
          <p className="text-dense text-ink-2 truncate mt-0.5">
            {job.size_label || job.service_name}
            {job.addons.length > 0 && ` · +${job.addons.map((a) => a.name).join(", ")}`}
          </p>
          <p className="text-dense text-ink-2 truncate">{job.address || "No address"}</p>
          {job.notes && <p className="flex items-center gap-1 text-xs text-warn mt-0.5 min-w-0">
              <IconFlag width={12} height={12} weight="fill" className="shrink-0" />
              <span className="truncate">{job.notes}</span>
            </p>}
        </div>
        <div className="px-3.5 py-3 shrink-0 text-right">
          <p className="text-md font-semibold num">{money(Number(job.price))}</p>
        </div>
      </button>
      {/* quick actions column */}
      <div className="flex flex-col border-l border-line shrink-0">
        <a
          href={phone ? telHref(phone) : undefined}
          aria-label={phone ? `Call ${fmtPhone(phone)}` : "No phone"}
          className={`flex items-center justify-center w-11 grow text-ink-2 transition-colors hover:bg-muted hover:text-brand-deep active:bg-line ${phone ? "" : "pointer-events-none opacity-30"}`}
        >
          <IconPhone width={16} height={16} />
        </a>
        <a
          href={job.address ? mapsHref(job.address) : undefined}
          target="_blank"
          rel="noreferrer"
          aria-label="Open in Maps"
          className={`flex items-center justify-center w-11 grow border-t border-line text-ink-2 transition-colors hover:bg-muted hover:text-brand-deep active:bg-line ${job.address ? "" : "pointer-events-none opacity-30"}`}
        >
          <IconPin width={16} height={16} />
        </a>
      </div>
    </div>
  );
}
