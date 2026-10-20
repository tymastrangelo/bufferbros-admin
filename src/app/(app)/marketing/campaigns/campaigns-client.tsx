"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { IconLink, IconMarketing, IconPlus } from "@/components/icons";
import { Busy, CopyButton, EmptyState, ErrorNote, Field, SectionLabel, Sheet, Stat } from "@/components/ui";
import { deleteCampaign, saveCampaign } from "@/lib/actions/marketing";
import { money } from "@/lib/format";
import { channelCall, channelLabel, channelRows, slugify, trackingLink, type ChannelRow } from "@/lib/marketing";
import { dateOfInstant, fmtDateShort } from "@/lib/time";
import type { CampaignStatus, ChannelId, MarketingCampaign } from "@/lib/types";
import { CallChip, ChannelSelect } from "@/components/marketing-bits";
import type { MarketingData } from "../data";
import { SpendSheet } from "../spend-sheet";

const STATUSES: { id: CampaignStatus; label: string; section: string }[] = [
  { id: "active", label: "Active", section: "Running" },
  { id: "planned", label: "Planned", section: "Planned" },
  { id: "paused", label: "Paused", section: "Paused" },
  { id: "ended", label: "Ended", section: "Ended" },
];

interface Result {
  row: ChannelRow;
  monthSpend: number;
  call: ReturnType<typeof channelCall>;
}

export function CampaignsClient({ data }: { data: MarketingData }) {
  const [edit, setEdit] = useState<MarketingCampaign | "new" | null>(null);
  const { econ, today } = data;

  const results = useMemo(() => {
    const revenue = new Map(data.revenue.map(([id, done, booked]) => [id, { done, booked }]));
    const monthStart = `${today.slice(0, 7)}-01`;
    return new Map<string, Result>(
      data.campaigns.map((c) => {
        const spend = data.spend.filter((s) => s.campaignId === c.id);
        const row = channelRows({
          customers: data.customers.filter((x) => x.campaignId === c.id).map((x) => ({ ...x, channel: c.channel })),
          revenue,
          spend: spend.map((s) => ({ ...s, channel: c.channel })),
          leads: data.leads.filter((l) => l.resolvedCampaignId === c.id).map((l) => ({ channel: c.channel, on: dateOfInstant(l.created_at), customerId: l.customer_id })),
          from: null,
        })[0] ?? { channel: c.channel, spend: 0, leads: 0, customers: 0, revenue: 0, booked: 0, cac: null, cpl: null, roas: null };
        const monthSpend = spend.filter((s) => s.on >= monthStart).reduce((s, x) => s + x.amount, 0);
        return [c.id, { row, monthSpend, call: channelCall(row, { target: c.target_cpa ?? econ.target, breakEven: econ.breakEven }) }];
      })
    );
  }, [data, econ, today]);

  const active = data.campaigns.filter((c) => c.status === "active");
  const budget = active.reduce((s, c) => s + (c.monthly_budget ?? 0), 0);
  const current = edit && edit !== "new" ? data.campaigns.find((c) => c.id === edit.id) ?? null : edit;

  return (
    <div className="mt-5 flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-2">
          {active.length} running · <span className="num font-medium text-ink">{money(budget)}</span> a month budgeted
        </p>
        <button className="btn btn-primary" onClick={() => setEdit("new")}>
          <IconPlus width={16} height={16} /> New campaign
        </button>
      </div>

      {data.campaigns.length === 0 && (
        <EmptyState
          icon={<IconMarketing width={20} height={20} />}
          title="No campaigns yet."
          hint="A campaign is anything you put money or effort into: a Google Ads campaign, door hangers, a condo detail day. Each one gets a tracking link so bookings get credited to it."
          action={
            <button className="btn btn-primary" onClick={() => setEdit("new")}>
              New campaign
            </button>
          }
        />
      )}

      {STATUSES.map((s) => {
        const list = data.campaigns.filter((c) => c.status === s.id);
        if (!list.length) return null;
        return (
          <section key={s.id}>
            <SectionLabel trailing={list.length}>{s.section}</SectionLabel>
            <div className="grid gap-3 md:grid-cols-2">
              {list.map((c) => {
                const r = results.get(c.id)!;
                return (
                  <button key={c.id} type="button" className="card card-link p-4 text-left" onClick={() => setEdit(c)}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-md font-medium truncate">{c.name}</p>
                        <p className="text-dense text-ink-2 truncate">
                          {channelLabel(c.channel)} · {c.monthly_budget ? `${money(c.monthly_budget)} a month` : "no ad budget"}
                        </p>
                      </div>
                      {r.call && <CallChip call={r.call.call} />}
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <Mini k="Spent" v={money(r.row.spend)} />
                      <Mini k="Customers" v={String(r.row.customers)} />
                      <Mini k="Per customer" v={r.row.cac == null ? "—" : money(Math.round(r.row.cac))} />
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      {current && (
        <CampaignSheet
          campaign={current === "new" ? null : current}
          result={current === "new" ? null : results.get(current.id) ?? null}
          data={data}
          onClose={() => setEdit(null)}
        />
      )}
    </div>
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

function CampaignSheet({
  campaign,
  result,
  data,
  onClose,
}: {
  campaign: MarketingCampaign | null;
  result: Result | null;
  data: MarketingData;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(campaign?.name ?? "");
  const [channel, setChannel] = useState<ChannelId | null>(campaign?.channel ?? null);
  const [status, setStatus] = useState<CampaignStatus>(campaign?.status ?? "planned");
  const [startOn, setStartOn] = useState(campaign?.start_on ?? "");
  const [endOn, setEndOn] = useState(campaign?.end_on ?? "");
  const [budget, setBudget] = useState(campaign?.monthly_budget != null ? String(campaign.monthly_budget) : "");
  const [target, setTarget] = useState(campaign?.target_cpa != null ? String(campaign.target_cpa) : "");
  const [slug, setSlug] = useState(campaign?.utm_campaign ?? "");
  const [notes, setNotes] = useState(campaign?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"save" | "delete" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [spendOpen, setSpendOpen] = useState(false);

  const history = campaign ? data.spend.filter((s) => s.campaignId === campaign.id) : [];
  const liveSlug = slugify(slug || name);

  async function save() {
    if (!channel) return setError("Pick the channel this campaign runs on.");
    setError(null);
    setPending("save");
    const res = await saveCampaign(
      {
        name,
        channel,
        status,
        startOn: startOn || null,
        endOn: endOn || null,
        monthlyBudget: budget === "" ? null : Number(budget),
        targetCpa: target === "" ? null : Number(target),
        utmCampaign: slug || null,
        notes,
      },
      campaign?.id
    );
    setPending(null);
    if (!res.ok) return setError(res.error);
    router.refresh();
    if (!campaign) onClose();
  }

  return (
    <Sheet open onClose={onClose} title={campaign?.name ?? "New campaign"} wide>
      <div className="flex flex-col gap-6">
        {campaign && result && (
          <section className="flex flex-col gap-3">
            <div className="stat-grid grid-cols-2 sm:grid-cols-4">
              <Stat label="Spent" value={money(result.row.spend)} hint={`${money(result.monthSpend)} this month`} />
              <Stat label="Leads" value={result.row.leads} />
              <Stat label="Customers" value={result.row.customers} hint={result.row.revenue ? `${money(result.row.revenue)} revenue` : undefined} />
              <Stat label="Per customer" value={result.row.cac == null ? "—" : money(Math.round(result.row.cac))} hint={`target ${money(campaign.target_cpa ?? data.econ.target)}`} />
            </div>
            {result.call && (
              <div className="note flex items-start gap-2 text-sm text-ink">
                <CallChip call={result.call.call} />
                <span>{result.call.why}</span>
              </div>
            )}
          </section>
        )}

        {campaign && channel && liveSlug && (
          <section>
            <SectionLabel trailing="bookings from these links get credited here">Tracking links</SectionLabel>
            <div className="card divide-y divide-line">
              {[
                { label: "Booking page", url: trackingLink(channel, liveSlug) },
                { label: "Home page", url: trackingLink(channel, liveSlug, "/") },
              ].map((l) => (
                <div key={l.label} className="row">
                  <IconLink width={16} height={16} className="shrink-0 text-faint" aria-hidden />
                  <span className="min-w-0 grow">
                    <span className="block text-sm font-medium">{l.label}</span>
                    <span className="block truncate text-xs text-faint">{l.url}</span>
                  </span>
                  <CopyButton text={l.url} />
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-faint">For print, paste the link into any QR code maker. For Google Ads, the booking link goes in the ad&apos;s final URL.</p>
          </section>
        )}

        {campaign && (
          <section>
            <SectionLabel
              trailing={
                <button className="add-link" onClick={() => setSpendOpen(true)}>
                  <IconPlus width={13} height={13} /> Log spend
                </button>
              }
            >
              Spend
            </SectionLabel>
            {history.length === 0 ? (
              <p className="card px-4 py-3 text-sm text-faint">Nothing logged yet. Log what the platform charged each week so the cost per customer stays honest.</p>
            ) : (
              <div className="card divide-y divide-line">
                {history.slice(0, 8).map((s) => (
                  <div key={s.id} className="row justify-between text-sm">
                    <span className="min-w-0 truncate">
                      <span className="num text-faint">{fmtDateShort(s.on)}</span> · {s.memo || "Ad spend"}
                    </span>
                    <span className="num font-medium">{money(s.amount)}</span>
                  </div>
                ))}
                {history.length > 8 && <p className="row-more text-faint">Older spend lives in Money → Expenses</p>}
              </div>
            )}
          </section>
        )}

        <section className="flex flex-col gap-4">
          {campaign && <SectionLabel>Details</SectionLabel>}
          <Field label="Name">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Search · Marco + Naples" autoFocus={!campaign} />
          </Field>
          <Field label="Channel">
            <ChannelSelect value={channel} onChange={setChannel} unknownLabel="Pick a channel" />
          </Field>
          <div>
            <p className="label mb-1.5">Status</p>
            <div className="grid grid-cols-4 gap-1.5">
              {STATUSES.map((s) => (
                <button key={s.id} type="button" className="choice px-1 text-sm" aria-pressed={status === s.id} onClick={() => setStatus(s.id)}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts">
              <input type="date" className="input num" value={startOn} onChange={(e) => setStartOn(e.target.value)} />
            </Field>
            <Field label="Ends">
              <input type="date" className="input num" value={endOn} onChange={(e) => setEndOn(e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Monthly budget">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-faint">$</span>
                <input type="number" inputMode="decimal" min={0} className="input num pl-7" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="0" />
              </div>
            </Field>
            <Field label="Target per customer">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-faint">$</span>
                <input type="number" inputMode="decimal" min={0} className="input num pl-7" value={target} onChange={(e) => setTarget(e.target.value)} placeholder={String(data.econ.target)} />
              </div>
            </Field>
          </div>
          <Field label="Tracking name" hint={`Goes in the links as utm_campaign=${liveSlug || "…"}. Changing it breaks links already printed.`}>
            <input className="input" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder={slugify(name) || "search-marco-naples"} autoCapitalize="off" autoCorrect="off" />
          </Field>
          <Field label="Notes">
            <textarea className="textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <ErrorNote>{error}</ErrorNote>
          <button className="btn btn-primary h-11" disabled={!!pending || !name.trim()} onClick={save}>
            {pending === "save" ? <Busy>Saving…</Busy> : campaign ? "Save changes" : "Create campaign"}
          </button>
          {campaign && (
            <button
              className="btn btn-danger"
              disabled={!!pending}
              onClick={async () => {
                if (!confirmDelete) return setConfirmDelete(true);
                setPending("delete");
                const res = await deleteCampaign(campaign.id);
                setPending(null);
                if (!res.ok) return setError(res.error);
                onClose();
                router.refresh();
              }}
            >
              {confirmDelete ? "Tap again. Its spend stays in Money, untagged." : "Delete campaign"}
            </button>
          )}
        </section>
      </div>
      {spendOpen && campaign && <SpendSheet campaigns={data.campaigns} campaignId={campaign.id} onClose={() => setSpendOpen(false)} />}
    </Sheet>
  );
}
