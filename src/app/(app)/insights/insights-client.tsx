"use client";

// How the business is doing, one period at a time. Every number comes from
// src/lib/insights.ts (checked); charts are the shared Bars primitive on the viz tokens.
// HIG charting-data.md: one question per chart, honest axes, text in text tokens.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Avatar, PageHeader, Segmented, Stat } from "@/components/ui";
import { Bars } from "@/components/bars";
import { IconChevronRight, IconEquals, IconTrendUp } from "@/components/icons";
import { workerColor } from "@/lib/crew";
import { money } from "@/lib/format";
import { INSIGHTS_PERIODS, type Insights, type InsightsPeriod } from "@/lib/insights";
import { prefersReducedMotion } from "@/lib/motion";

export interface MarketingSummary {
  spend: number;
  newCustomers: number;
  costPer: number | null;
  roas: number | null;
}

const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n * 100)}%`);
const fmtDur = (mins: number) => {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h ? `${h}h ${m}m` : `${m}m`;
};

/** Counts 0 → value once on first paint; later refreshes render the value directly. */
function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const ran = useRef(false);
  const [shown, setShown] = useState(0); // same on server and client; the effect settles it
  useEffect(() => {
    if (ran.current || prefersReducedMotion()) {
      setShown(value);
      return;
    }
    ran.current = true;
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 500);
      setShown(value * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally once; later values set directly below
  }, []);
  useEffect(() => {
    if (ran.current) setShown(value);
  }, [value]);
  return <>{format(shown)}</>;
}

/** "▲ 12% vs prior 4 weeks" — shape + sign + number, never color alone. */
function Delta({ now, prev, label }: { now: number | null; prev: number | null; label: string }) {
  if (now == null || prev == null) return <span className="text-faint">no prior period<span className="sr-only"> ({label})</span></span>;
  if (prev === 0 && now === 0) return <span className="inline-flex items-center gap-1 text-faint"><IconEquals width={12} height={12} aria-hidden /> flat</span>;
  if (prev === 0) return <span className="text-faint">new this period</span>;
  const d = (now - prev) / Math.abs(prev);
  const up = d > 0.005;
  const flat = Math.abs(d) <= 0.005;
  return (
    <span className={`inline-flex items-center gap-1 ${flat ? "text-faint" : up ? "text-ok" : "text-bad"}`}>
      {flat ? <IconEquals width={12} height={12} aria-hidden /> : <IconTrendUp width={12} height={12} aria-hidden style={up ? undefined : { transform: "scaleY(-1)" }} />}
      <span className="sr-only">{flat ? "flat" : up ? "up" : "down"}</span>
      {flat ? "flat" : `${up ? "+" : "−"}${Math.round(Math.abs(d) * 100)}%`} vs prior<span className="sr-only"> {label}</span>
    </span>
  );
}

function Card({ title, children, trailing }: { title: string; children: ReactNode; trailing?: ReactNode }) {
  return (
    <section className="card p-4 md:p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="h-card">{title}</h2>
        {trailing}
      </div>
      {children}
    </section>
  );
}

export function InsightsClient({ data, period, marketing }: { data: Insights; period: InsightsPeriod; marketing: MarketingSummary }) {
  const router = useRouter();
  const h = data.headline;
  const periodLabel = INSIGHTS_PERIODS.find((p) => p.value === period)?.label.toLowerCase() ?? period;
  const labels = data.buckets.map((b) => b.label);
  const noJobs = h.jobs === 0 && data.jobsSeries.every((b) => b.lost === 0);

  return (
    <div className="page max-w-4xl flex flex-col gap-5">
      <PageHeader
        title="Insights"
        sub={data.range.from ? `${data.range.from} → ${data.range.to}` : "All time"}
        actions={
          <Segmented
            label="Period"
            value={period}
            onChange={(v) => router.push(`/insights?p=${v}`)}
            options={INSIGHTS_PERIODS.map((p) => ({ value: p.value, label: p.label }))}
          />
        }
      />

      <div className="stat-grid grid-cols-2 md:grid-cols-5">
        <Stat label="Collected" value={<CountUp value={h.collected} format={money} />} hint={<Delta now={h.collected} prev={period === "all" ? null : h.prev.collected} label={periodLabel} />} />
        <Stat label="Jobs done" value={<CountUp value={h.jobs} format={(n) => String(Math.round(n))} />} hint={<Delta now={h.jobs} prev={period === "all" ? null : h.prev.jobs} label={periodLabel} />} />
        <Stat label="Avg ticket" value={h.avgTicket == null ? "—" : <CountUp value={h.avgTicket} format={money} />} hint={<Delta now={h.avgTicket} prev={period === "all" ? null : h.prev.avgTicket} label={periodLabel} />} />
        <Stat label="New customers" value={<CountUp value={h.newCustomers} format={(n) => String(Math.round(n))} />} hint={<Delta now={h.newCustomers} prev={period === "all" ? null : h.prev.newCustomers} label={periodLabel} />} />
        <Stat label="Repeat rate" value={pct(h.repeatRate)} hint={h.repeatRate == null ? "no jobs this period" : <Delta now={h.repeatRate} prev={period === "all" ? null : h.prev.repeatRate} label={periodLabel} />} className="col-span-2 md:col-span-1" />
      </div>

      <Card title="Revenue">
        {data.revenue.every((b) => b.collected + b.crewCut + b.expenses === 0) ? (
          <p className="text-sm text-faint">Nothing collected or spent in this period.</p>
        ) : (
          <Bars
            labels={labels}
            up={[{ key: "in", label: "Collected", color: "var(--color-viz-1)", values: data.revenue.map((b) => b.collected) }]}
            down={[
              { key: "cut", label: "Crew cut", color: "var(--color-viz-2)", values: data.revenue.map((b) => b.crewCut) },
              { key: "exp", label: "Expenses", color: "var(--color-viz-3)", values: data.revenue.map((b) => b.expenses) },
            ]}
            caption={(i) => {
              const b = data.revenue[i];
              return (
                <>
                  <span className="font-semibold text-ink">{labels[i]}: kept {money(b.collected - b.crewCut - b.expenses)}</span>
                  <span className="text-ink-2"> — {money(b.collected)} in · {money(b.crewCut)} crew · {money(b.expenses)} expenses</span>
                </>
              );
            }}
          />
        )}
      </Card>

      <Card title="Jobs">
        {noJobs ? (
          <p className="text-sm text-faint">No jobs in this period.</p>
        ) : (
          <Bars
            labels={labels}
            height={100}
            format={(n) => String(Math.round(n))}
            up={[
              { key: "done", label: "Completed", color: "var(--color-viz-1)", values: data.jobsSeries.map((b) => b.done) },
              { key: "lost", label: "Cancelled + no-show", color: "var(--color-viz-3)", values: data.jobsSeries.map((b) => b.lost) },
            ]}
            caption={(i) => (
              <>
                <span className="font-semibold text-ink">{labels[i]}: {data.jobsSeries[i].done} done</span>
                <span className="text-ink-2"> · {data.jobsSeries[i].lost} cancelled or no-show</span>
              </>
            )}
          />
        )}
      </Card>

      <Card title="Crew">
        <div className="card divide-y divide-line overflow-hidden -mx-1">
          {data.crew.map((c) => {
            const maxRev = Math.max(...data.crew.map((x) => x.revenue), 1);
            const row = (
              <>
                <span className="inline-flex rounded-full shrink-0" style={c.color ? { boxShadow: `0 0 0 2px ${workerColor(c.color)}` } : undefined}>
                  <Avatar name={c.name} size={30} />
                </span>
                <span className="min-w-0 grow">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{c.name}</span>
                    <span className="text-xs text-faint num">{c.jobs} job{c.jobs === 1 ? "" : "s"}</span>
                    {c.noShows > 0 && <span className="chip chip-warn">{c.noShows} no-show{c.noShows === 1 ? "" : "s"}</span>}
                  </span>
                  <span className="mt-1 block h-1.5 rounded-full bg-muted overflow-hidden" aria-hidden>
                    <span className="block h-full rounded-full" style={{ width: `${Math.round((c.revenue / maxRev) * 100)}%`, background: c.color ? workerColor(c.color) : "var(--color-brand)" }} />
                  </span>
                </span>
                <span className="text-right shrink-0">
                  <span className="block text-sm font-semibold num">{money(c.revenue)}</span>
                  <span className="block text-micro text-faint num">
                    {c.id ? `cut ${money(c.cut)}` : "your jobs"}
                    {c.avgMin != null && ` · ${fmtDur(c.avgMin)} avg`}
                  </span>
                </span>
              </>
            );
            return c.id ? (
              <Link key={c.id} href={`/team/${c.id}`} className="row row-link gap-3">
                {row}
                <IconChevronRight width={16} height={16} className="shrink-0 text-faint" aria-hidden />
              </Link>
            ) : (
              <div key="me" className="row gap-3">
                {row}
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        <Card title="Services">
          {data.services.length === 0 ? (
            <p className="text-sm text-faint">No completed jobs yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.services.map((s) => {
                const max = data.services[0].revenue || 1;
                return (
                  <li key={s.name} className="flex flex-col gap-1">
                    <span className="flex items-center justify-between text-sm">
                      <span className="truncate">{s.name}</span>
                      <span className="num text-ink-2 shrink-0">
                        {s.count} · {money(s.revenue)}
                      </span>
                    </span>
                    <span className="block h-1.5 rounded-full bg-muted overflow-hidden" aria-hidden>
                      <span className="block h-full rounded-full" style={{ width: `${Math.round((s.revenue / max) * 100)}%`, background: "var(--color-viz-1)" }} />
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {data.addons.length > 0 && (
            <p className="mt-3 text-xs text-ink-2">
              Add-ons: {data.addons.map((a) => `${a.name} ×${a.count}`).join(" · ")}
            </p>
          )}
        </Card>

        <Card title="Customers" trailing={<span className="text-xs text-faint num">{data.activePlans} active plans</span>}>
          {data.customers.every((b) => b.newCount + b.returning === 0) ? (
            <p className="text-sm text-faint">No customers served in this period.</p>
          ) : (
            <Bars
              labels={labels}
              height={90}
              format={(n) => String(Math.round(n))}
              up={[
                { key: "ret", label: "Returning", color: "var(--color-viz-1)", values: data.customers.map((b) => b.returning) },
                { key: "new", label: "First-timers", color: "var(--color-viz-2)", values: data.customers.map((b) => b.newCount) },
              ]}
              caption={(i) => (
                <span className="text-ink-2">
                  <span className="font-semibold text-ink">{labels[i]}:</span> {data.customers[i].returning} returning · {data.customers[i].newCount} first-timers
                </span>
              )}
            />
          )}
          {data.topCustomers.length > 0 && (
            <ul className="mt-3 flex flex-col divide-y divide-line">
              {data.topCustomers.map((c) => (
                <li key={c.id}>
                  <Link href={`/customers/${c.id}`} className="flex items-center justify-between py-1.5 text-sm hover:text-brand-deep">
                    <span className="truncate">{c.name}</span>
                    <span className="num text-ink-2 shrink-0">
                      {c.jobs} · {money(c.revenue)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Marketing" trailing={<Link href="/marketing" className="link text-dense">Open Marketing</Link>}>
        <div className="stat-grid grid-cols-2 md:grid-cols-4">
          <Stat label="Spend" value={money(marketing.spend)} />
          <Stat label="New customers" value={marketing.newCustomers} hint="attributed to a channel" />
          <Stat label="Cost per new customer" value={marketing.costPer == null ? "—" : money(marketing.costPer)} />
          <Stat label="Return on spend" value={marketing.roas == null ? "—" : `${marketing.roas.toFixed(1)}×`} />
        </div>
      </Card>
    </div>
  );
}
