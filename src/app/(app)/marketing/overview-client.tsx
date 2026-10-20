"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { IconMarketing } from "@/components/icons";
import { Busy, EmptyState, ErrorNote, SectionLabel, Segmented, Sheet, Stat } from "@/components/ui";
import { saveMarketingTarget, setCustomerSource } from "@/lib/actions/marketing";
import { money } from "@/lib/format";
import {
  PERIODS,
  channelCall,
  channelLabel,
  channelRows,
  fmtMinutes,
  minutesBetween,
  periodStart,
  totals,
  type ChannelRow,
  type Period,
} from "@/lib/marketing";
import { dateOfInstant, fmtDateShort } from "@/lib/time";
import { CallChip, ChannelSelect } from "@/components/marketing-bits";
import type { MarketingData, MkCustomer } from "./data";
import { SpendSheet } from "./spend-sheet";

const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n * 100)}%`);

export function OverviewClient({ data }: { data: MarketingData }) {
  const [period, setPeriod] = useState<Period>("90d");
  const [tagOpen, setTagOpen] = useState(false);
  const [spendOpen, setSpendOpen] = useState(false);
  const { econ } = data;

  const revenue = useMemo(() => new Map(data.revenue.map(([id, done, booked]) => [id, { done, booked }])), [data.revenue]);
  const leadRows = useMemo(
    () =>
      data.leads.map((l) => ({
        channel: l.resolvedChannel,
        on: dateOfInstant(l.created_at),
        customerId: l.customer_id,
      })),
    [data.leads],
  );
  const rows = useMemo(
    () =>
      channelRows({
        customers: data.customers,
        revenue,
        spend: data.spend,
        leads: leadRows,
        from: periodStart(period, data.today),
      }),
    [data.customers, data.spend, data.today, leadRows, period, revenue],
  );
  const t = totals(rows);
  const calls = rows.flatMap((r) => {
    const c = channelCall(r, econ);
    return c ? [{ row: r, ...c }] : [];
  });
  const untagged = data.customers.filter((c) => !c.channel && !c.archived);
  const waiting = data.leads.filter((l) => l.status === "new");
  const oldestWait = waiting.length ? Math.max(...waiting.map((l) => minutesBetween(l.created_at, new Date().toISOString()))) : 0;
  const periodLabel = PERIODS.find((p) => p.value === period)!.label.toLowerCase();
  const cacTone = t.paidCac == null ? undefined : t.paidCac <= econ.target ? "ok" : t.paidCac > econ.breakEven ? "bad" : "warn";

  return (
    <div className="mt-5 flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented label="Period" options={PERIODS} value={period} onChange={setPeriod} />
        <button className="btn btn-sm" onClick={() => setSpendOpen(true)}>
          Log ad spend
        </button>
      </div>

      {waiting.length > 0 && (
        <Link href="/marketing/leads" className="note note-warn flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            <span className="font-semibold">
              {waiting.length} new lead{waiting.length === 1 ? "" : "s"} waiting
            </span>
            , oldest {fmtMinutes(oldestWait)}. Most people book whoever answers first.
          </span>
          <span className="font-medium underline underline-offset-2">Open leads</span>
        </Link>
      )}

      <div className="stat-grid grid-cols-2 md:grid-cols-3">
        <Stat label="Ad spend" value={money(t.spend)} hint={periodLabel} />
        <Stat label="New customers" value={t.customers} hint={`from ${t.leads} lead${t.leads === 1 ? "" : "s"}`} />
        <Stat
          label="Per new customer"
          value={t.paidCac == null ? "—" : money(Math.round(t.paidCac))}
          tone={cacTone}
          hint={`target ${money(econ.target)}`}
        />
        <Stat label="Return on spend" value={t.roas == null ? "—" : `${t.roas.toFixed(1)}×`} hint="revenue ÷ spend" />
        <Stat label="Booked rate" value={pct(t.bookedRate)} hint="of leads booked" />
        <Stat label="Break-even" value={money(econ.breakEven)} hint="max per new customer" />
      </div>

      <section>
        <SectionLabel trailing="paid channels only">This week&apos;s calls</SectionLabel>
        {calls.length === 0 ? (
          <div className="card px-4 py-3.5 text-sm text-ink-2">
            No ad spend in this period. Log spend on a campaign and each paid channel gets a call here: scale, hold, fix or pause.
          </div>
        ) : (
          <div className="card divide-y divide-line">
            {calls.map(({ row, call, why }) => (
              <div key={row.channel} className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <CallChip call={call} />
                  <span className="text-md font-medium">{channelLabel(row.channel)}</span>
                </div>
                <p className="mt-1 text-sm text-ink-2">{why}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionLabel
          trailing={
            untagged.length > 0 && (
              <button className="link" onClick={() => setTagOpen(true)}>
                {untagged.length} with no source
              </button>
            )
          }
        >
          Channels
        </SectionLabel>
        <ChannelTable rows={rows} econ={econ} onTag={() => setTagOpen(true)} />
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <Economics data={data} />
        <section>
          <SectionLabel>Reputation and word of mouth</SectionLabel>
          <div className="stat-grid grid-cols-2">
            <Stat label="Google reviews" value={data.reviews.left} hint={`${data.reviews.asked} asked so far`} />
            <Stat label="Referred customers" value={data.referrals} hint="sent by a customer" />
            <Stat label="Email signups" value={data.signups.total} hint={`${data.signups.redeemed} used the 5% code`} />
            <Stat
              label="Open leads"
              value={data.leads.filter((l) => ["new", "contacted", "quoted"].includes(l.status)).length}
              hint="to follow up"
              href="/marketing/leads"
            />
          </div>
        </section>
      </div>

      {tagOpen && <TagSheet customers={untagged} onClose={() => setTagOpen(false)} />}
      {spendOpen && <SpendSheet campaigns={data.campaigns} onClose={() => setSpendOpen(false)} />}
    </div>
  );
}

function ChannelTable({ rows, econ, onTag }: { rows: ChannelRow[]; econ: MarketingData["econ"]; onTag: () => void }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<IconMarketing width={20} height={20} />}
        title="Nothing in this period yet."
        hint="New customers, leads and ad spend show up here by channel. Try a longer period, or tag where your customers came from."
      />
    );
  }
  const name = (r: ChannelRow) =>
    r.channel ? (
      channelLabel(r.channel)
    ) : (
      <span className="inline-flex items-center gap-2">
        Not tagged
        {r.customers > 0 && (
          <button className="link text-sm font-normal" onClick={onTag}>
            Tag them
          </button>
        )}
      </span>
    );
  return (
    <>
      {/* Phones: one scannable row per channel (lists-and-tables.md › Best practices) */}
      <div className="card divide-y divide-line sm:hidden">
        {rows.map((r) => {
          const c = channelCall(r, econ);
          return (
            <div key={r.channel ?? "none"} className="px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-md font-medium">{name(r)}</span>
                {c ? <CallChip call={c.call} /> : !r.spend && <span className="text-xs text-faint">free</span>}
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <Mini k="Spend" v={r.spend ? money(r.spend) : "—"} />
                <Mini k="Customers" v={String(r.customers)} />
                <Mini k="Per customer" v={r.cac == null ? "—" : money(Math.round(r.cac))} />
              </div>
              <p className="mt-1.5 text-xs text-faint num">
                {r.leads} lead{r.leads === 1 ? "" : "s"} · {money(r.revenue)} revenue{r.booked > 0 ? ` · +${money(r.booked)} booked` : ""}
              </p>
            </div>
          );
        })}
      </div>
      <div className="card overflow-x-auto hidden sm:block">
        <table className="tbl min-w-160">
          <thead>
            <tr>
              <th>Channel</th>
              <th className="text-right">Spend</th>
              <th className="text-right">Leads</th>
              <th className="text-right">Customers</th>
              <th className="text-right">Per customer</th>
              <th className="text-right">Revenue</th>
              <th>Call</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const c = channelCall(r, econ);
              return (
                <tr key={r.channel ?? "none"}>
                  <td className="font-medium">{name(r)}</td>
                  <td className="num text-right">{r.spend ? money(r.spend) : "—"}</td>
                  <td className="num text-right">{r.leads}</td>
                  <td className="num text-right">{r.customers}</td>
                  <td className="num text-right">{r.cac == null ? "—" : money(Math.round(r.cac))}</td>
                  <td className="num text-right">
                    {money(r.revenue)}
                    {r.booked > 0 && <span className="block text-xs text-faint">+{money(r.booked)} booked</span>}
                  </td>
                  <td>{c ? <CallChip call={c.call} /> : <span className="text-xs text-faint">{r.spend ? "—" : "free"}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Mini({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <p className="label">{k}</p>
      <p className="num text-sm font-semibold">{v}</p>
    </div>
  );
}

function Economics({ data }: { data: MarketingData }) {
  const router = useRouter();
  const { econ } = data;
  const [target, setTarget] = useState(String(econ.target));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const dirty = Number(target) !== econ.target;

  return (
    <section>
      <SectionLabel>What a customer is worth</SectionLabel>
      <div className="card divide-y divide-line text-sm">
        <KV k="Average first detail" v={money(econ.avgTicket)} />
        <KV
          k="Business keeps per first job"
          v={money(econ.breakEven)}
          sub={`${Math.round(econ.keepPct * 100)}% after the worker's split, minus about ${money(econ.suppliesPerJob)} in supplies. That's your break-even: pay more for a new customer and the first job loses money.`}
        />
        <KV k="Biweekly plan, Nov to Apr" v={money(data.planSeasonValue)} sub="to the business, so a plan signup is worth a higher cost" />
        <div className="px-4 py-3">
          <label className="flex flex-wrap items-center justify-between gap-3">
            <span>
              <span className="block font-medium">Target per new customer</span>
              <span className="block text-xs text-faint">Channels under this get a Scale call.</span>
            </span>
            <span className="flex items-center gap-2">
              <span className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-faint">$</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  className="input num w-24 pl-7"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                />
              </span>
              <button
                className="btn btn-sm"
                disabled={!dirty || pending || !(Number(target) > 0)}
                onClick={async () => {
                  setError(null);
                  setPending(true);
                  const res = await saveMarketingTarget(Number(target));
                  setPending(false);
                  if (!res.ok) return setError(res.error);
                  router.refresh();
                }}
              >
                {pending ? <Busy>Saving…</Busy> : "Save"}
              </button>
            </span>
          </label>
          {error && (
            <div className="mt-2">
              <ErrorNote>{error}</ErrorNote>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function KV({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="px-4 py-3 flex items-start justify-between gap-4">
      <span>
        <span className="block">{k}</span>
        {sub && <span className="block text-xs text-faint">{sub}</span>}
      </span>
      <span className="num font-semibold">{v}</span>
    </div>
  );
}

/** Customers we can't place yet. Picking a channel saves immediately and drops the row. */
function TagSheet({ customers, onClose }: { customers: MkCustomer[]; onClose: () => void }) {
  const router = useRouter();
  const [done, setDone] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const left = customers.filter((c) => !done.has(c.id));

  return (
    <Sheet open onClose={onClose} title="Where did they find you?">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink-2">Pick a channel for each customer. Cost per customer only works when sources are known.</p>
        <ErrorNote>{error}</ErrorNote>
        {left.length === 0 ? (
          <p className="note note-ok text-sm">Every customer has a source.</p>
        ) : (
          <div className="card divide-y divide-line">
            {left.map((c) => (
              <div key={c.id} className="row justify-between">
                <span className="min-w-0">
                  <Link href={`/customers/${c.id}`} className="block truncate text-sm font-medium hover:underline">
                    {c.name}
                  </Link>
                  <span className="block text-xs text-faint num">added {fmtDateShort(c.acquiredOn)}</span>
                </span>
                <ChannelSelect
                  className="select h-9! w-40 shrink-0 text-sm"
                  value={null}
                  unknownLabel="Pick one"
                  onChange={async (v) => {
                    if (!v) return;
                    setDone((s) => new Set(s).add(c.id));
                    const res = await setCustomerSource(c.id, v);
                    if (!res.ok) {
                      setError(res.error);
                      setDone((s) => {
                        const n = new Set(s);
                        n.delete(c.id);
                        return n;
                      });
                    }
                  }}
                />
              </div>
            ))}
          </div>
        )}
        <button
          className="btn"
          onClick={() => {
            onClose();
            router.refresh();
          }}
        >
          Done
        </button>
      </div>
    </Sheet>
  );
}
