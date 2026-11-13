"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconMail, IconMarketing, IconMessage, IconPhone, IconPlus } from "@/components/icons";
import { Busy, EmptyState, ErrorNote, Field, Segmented, Sheet, Stat } from "@/components/ui";
import { convertLead, deleteLead, saveLead, setLeadStatus } from "@/lib/actions/marketing";
import { fmtPhone, smsHref, telHref } from "@/lib/format";
import { LEAD_KINDS, LEAD_STATUSES, OPEN_LEAD, channelLabel, fmtMinutes, leadKindLabel, minutesBetween } from "@/lib/marketing";
import { dateOfInstant, fmtDateShort } from "@/lib/time";
import type { ChannelId, LeadKind, LeadStatus, MarketingCampaign } from "@/lib/types";
import { CampaignSelect, ChannelSelect, KindIcon } from "@/components/marketing-bits";
import type { MkLead } from "../data";

type Filter = "open" | "booked" | "lost" | "all";

const STATUS_TONE: Record<LeadStatus, string> = { new: "chip-warn", contacted: "chip-brand", quoted: "chip-brand", booked: "chip-ok", lost: "" };
const statusLabel = (s: LeadStatus) => LEAD_STATUSES.find((x) => x.id === s)!.label;
const leadTitle = (l: Pick<MkLead, "name" | "phone" | "email">) => l.name || fmtPhone(l.phone) || l.email || "Unnamed lead";

function median(ns: number[]) {
  if (!ns.length) return null;
  const s = [...ns].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export function LeadsClient({ leads, campaigns, openNew }: { leads: MkLead[]; campaigns: MarketingCampaign[]; openNew: boolean }) {
  const [filter, setFilter] = useState<Filter>("open");
  const [edit, setEdit] = useState<MkLead | "new" | null>(openNew ? "new" : null);
  // re-arm when the ＋New menu navigates here with ?new=1
  const [prevOpenNew, setPrevOpenNew] = useState(openNew);
  if (prevOpenNew !== openNew) {
    setPrevOpenNew(openNew);
    if (openNew) setEdit("new");
  }
  const close = () => {
    setEdit(null);
    if (openNew) window.history.replaceState(null, "", "/marketing/leads");
  };
  const now = new Date().toISOString();

  const open = leads.filter((l) => OPEN_LEAD.includes(l.status));
  const shown = [...(filter === "open" ? open : filter === "all" ? leads : leads.filter((l) => l.status === filter))].sort(
    (a, b) => (filter === "open" ? OPEN_LEAD.indexOf(a.status) - OPEN_LEAD.indexOf(b.status) : 0) || b.created_at.localeCompare(a.created_at)
  );
  const replies = leads.filter((l) => l.contacted_at && l.kind !== "email_signup").map((l) => minutesBetween(l.created_at, l.contacted_at!));
  const reply = median(replies);
  const booked = leads.filter((l) => l.status === "booked").length;
  const lost = leads.filter((l) => l.status === "lost").length;
  // Re-read the open lead from fresh props so the sheet shows its new status after a save.
  const current = edit && edit !== "new" ? leads.find((l) => l.id === edit.id) ?? edit : edit;

  return (
    <div className="mt-5 flex flex-col gap-5">
      <div className="stat-grid grid-cols-3">
        <Stat label="Open" value={open.length} hint={`${open.filter((l) => l.status === "new").length} unanswered`} tone={open.some((l) => l.status === "new") ? "warn" : undefined} />
        <Stat label="Reply time" value={reply == null ? "—" : fmtMinutes(reply)} hint="goal 15 min" tone={reply == null ? undefined : reply <= 15 ? "ok" : reply > 60 ? "bad" : "warn"} />
        <Stat label="Won" value={booked + lost ? `${Math.round((booked / (booked + lost)) * 100)}%` : "—"} hint={`${booked} of ${booked + lost} closed`} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "open", label: `Open${open.length ? ` ${open.length}` : ""}` },
            { value: "booked", label: "Booked" },
            { value: "lost", label: "Lost" },
            { value: "all", label: "All" },
          ]}
        />
        <button className="btn btn-primary" onClick={() => setEdit("new")}>
          <IconPlus width={16} height={16} /> Add lead
        </button>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon={<IconMarketing width={20} height={20} />}
          title={filter === "open" ? "No open leads." : "Nothing here yet."}
          hint="Every call, text, DM or quote request that isn't a customer yet goes here, so you can see how fast you answer and which channel sends people who book. Website email signups land here automatically."
          action={
            <button className="btn btn-primary" onClick={() => setEdit("new")}>
              Add a lead
            </button>
          }
        />
      ) : (
        <div className="card divide-y divide-line">
          {shown.map((l) => {
            const waited = l.status === "new" ? minutesBetween(l.created_at, now) : null;
            return (
              <button key={l.id} type="button" className="row row-link w-full text-left" onClick={() => setEdit(l)}>
                <KindIcon kind={l.kind} />
                <span className="min-w-0 grow">
                  <span className="block truncate text-md font-medium">{leadTitle(l)}</span>
                  <span className="block truncate text-dense text-ink-2">
                    {leadKindLabel(l.kind)} · {channelLabel(l.resolvedChannel)} · <span className="num">{fmtDateShort(dateOfInstant(l.created_at))}</span>
                  </span>
                </span>
                <span className="shrink-0 flex flex-col items-end gap-1">
                  <span className={`chip ${STATUS_TONE[l.status]}`}>{statusLabel(l.status)}</span>
                  {waited != null && l.kind !== "email_signup" && <span className="text-xs text-warn num">waiting {fmtMinutes(waited)}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {current && <LeadSheet lead={current === "new" ? null : current} campaigns={campaigns} onClose={close} />}
    </div>
  );
}

function LeadSheet({ lead, campaigns, onClose }: { lead: MkLead | null; campaigns: MarketingCampaign[]; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(lead?.name ?? "");
  const [phone, setPhone] = useState(fmtPhone(lead?.phone) || "");
  const [email, setEmail] = useState(lead?.email ?? "");
  const [kind, setKind] = useState<LeadKind>(lead?.kind ?? "call");
  const [channel, setChannel] = useState<ChannelId | null>(lead ? lead.channel ?? lead.resolvedChannel : null);
  const [campaignId, setCampaignId] = useState<string | null>(lead ? lead.campaign_id ?? lead.resolvedCampaignId : null);
  const [value, setValue] = useState(lead?.est_value != null ? String(lead.est_value) : "");
  const [notes, setNotes] = useState(lead?.notes ?? "");
  const [lostReason, setLostReason] = useState(lead?.lost_reason ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function run(label: string, fn: () => Promise<{ ok: boolean; error?: string; id?: string }>, after?: (id?: string) => void) {
    setError(null);
    setPending(label);
    const res = await fn();
    setPending(null);
    if (!res.ok) return setError(res.error ?? "Something went wrong. Try again.");
    router.refresh();
    after?.(res.id);
  }

  const fields = () => ({ name, phone, email, kind, channel, campaignId, estValue: value ? Number(value) : null, notes });

  return (
    <Sheet open onClose={onClose} title={lead ? leadTitle(lead) : "New lead"}>
      <div className="flex flex-col gap-5">
        {lead && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {lead.phone && (
                <>
                  <a className="btn btn-sm" href={telHref(lead.phone)}>
                    <IconPhone width={14} height={14} /> Call
                  </a>
                  <a className="btn btn-sm" href={smsHref(lead.phone)}>
                    <IconMessage width={14} height={14} /> Text
                  </a>
                </>
              )}
              {lead.email && (
                <a className="btn btn-sm" href={`mailto:${lead.email}`}>
                  <IconMail width={14} height={14} /> Email
                </a>
              )}
            </div>
            <div>
              <p className="label mb-1.5">Status</p>
              <div className="grid grid-cols-5 gap-1.5">
                {LEAD_STATUSES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="choice px-1 text-sm"
                    aria-pressed={lead.status === s.id}
                    disabled={!!pending}
                    onClick={() => run(`status-${s.id}`, () => setLeadStatus(lead.id, s.id, lostReason))}
                  >
                    {pending === `status-${s.id}` ? <Busy>{s.label}</Busy> : s.label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-faint num">
                Came in {fmtDateShort(dateOfInstant(lead.created_at))}
                {lead.contacted_at ? ` · first reply after ${fmtMinutes(minutesBetween(lead.created_at, lead.contacted_at))}` : " · not answered yet"}
              </p>
            </div>
            {lead.status === "lost" && (
              <Field label="Why they didn't book" hint="Price, timing, outside the area, went with someone else. These become better ads.">
                <input
                  className="input"
                  value={lostReason}
                  onChange={(e) => setLostReason(e.target.value)}
                  onBlur={() => lostReason !== (lead.lost_reason ?? "") && run("lost", () => setLeadStatus(lead.id, "lost", lostReason))}
                />
              </Field>
            )}
            {lead.customer_id ? (
              <Link href={`/customers/${lead.customer_id}`} className="btn">
                Open customer
              </Link>
            ) : (
              <button
                className="btn"
                disabled={!!pending}
                onClick={() => run("convert", () => convertLead(lead.id, channel, campaignId), (id) => id && router.push(`/customers/${id}`))}
              >
                {pending === "convert" ? <Busy>Adding…</Busy> : "Add as customer and book"}
              </button>
            )}
          </div>
        )}

        <div className="flex flex-col gap-4">
          <Field label="Name">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus={!lead} autoComplete="off" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone">
              <input className="input num" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" />
            </Field>
            <Field label="Email">
              <input className="input" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
            </Field>
          </div>
          <div>
            <p className="label mb-1.5">How they reached you</p>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
              {LEAD_KINDS.map((k) => (
                <button key={k.id} type="button" className="choice px-2 text-sm" aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>
                  {k.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="How they found you">
              <ChannelSelect
                value={channel}
                onChange={(v) => {
                  setChannel(v);
                  if (campaignId && campaigns.find((c) => c.id === campaignId)?.channel !== v) setCampaignId(null);
                }}
              />
            </Field>
            <Field label="Campaign">
              <CampaignSelect campaigns={campaigns} channel={channel} value={campaignId} onChange={setCampaignId} />
            </Field>
          </div>
          <Field label="Job value" hint="Rough quote, if you know it">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-faint">$</span>
              <input type="number" inputMode="decimal" min={0} className="input num pl-7" value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
          </Field>
          <Field label="Notes">
            <textarea className="textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Car, what they asked for, when they want it" />
          </Field>
        </div>

        <ErrorNote>{error}</ErrorNote>
        <button
          className="btn btn-primary h-11"
          disabled={!!pending}
          onClick={() => run("save", () => saveLead(fields(), lead?.id), () => !lead && onClose())}
        >
          {pending === "save" ? <Busy>Saving…</Busy> : lead ? "Save changes" : "Add lead"}
        </button>
        {lead && (
          <button
            className="btn btn-danger"
            disabled={!!pending}
            onClick={() => (confirmDelete ? run("delete", () => deleteLead(lead.id), onClose) : setConfirmDelete(true))}
          >
            {confirmDelete ? "Tap again to delete this lead" : "Delete lead"}
          </button>
        )}
      </div>
    </Sheet>
  );
}
