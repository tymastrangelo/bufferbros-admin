"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconInbox, IconMail, IconMessage, IconPhone, IconPlus } from "@/components/icons";
import { Busy, EmptyState, ErrorNote, Field, PageHeader, SectionLabel, Segmented, Sheet, Stat } from "@/components/ui";
import { convertLead, deleteLead, saveLead, setLeadFollowUp, setLeadStatus } from "@/lib/actions/marketing";
import { fmtPhone, money, phoneDigits, smsHref, telHref } from "@/lib/format";
import { LEAD_KINDS, LEAD_STATUSES, channelLabel, fmtMinutes, leadKindLabel, leadQueue, minutesBetween, type LeadQueue } from "@/lib/marketing";
import { addDays, dateOfInstant, diffDays, fmtDateShort } from "@/lib/time";
import type { ChannelId, LeadKind, LeadStatus, MarketingCampaign } from "@/lib/types";
import { CampaignSelect, ChannelSelect, KindIcon } from "@/components/marketing-bits";
import type { MkLead } from "../marketing/data";

type Filter = "inbox" | "booked" | "lost" | "all";

const STATUS_TONE: Record<LeadStatus, string> = { new: "chip-warn", contacted: "chip-brand", quoted: "chip-brand", booked: "chip-ok", lost: "" };
const statusLabel = (s: LeadStatus) => LEAD_STATUSES.find((x) => x.id === s)!.label;
const leadTitle = (l: Pick<MkLead, "name" | "phone" | "email">) => l.name || fmtPhone(l.phone) || l.email || "Unnamed lead";

/** The inbox, most urgent group first. Closed leads live under the Booked / Lost filters. */
const GROUPS: { queue: LeadQueue; title: string; hint: string }[] = [
  { queue: "reply", title: "Reply now", hint: "Most people book whoever answers first" },
  { queue: "follow_up", title: "Follow up", hint: "You answered; time to check back in" },
  { queue: "waiting", title: "Waiting on them", hint: "Comes back up on its follow-up date" },
  { queue: "signup", title: "Email signups", hint: "Took the 5% code, haven't asked for anything" },
];

function median(ns: number[]) {
  if (!ns.length) return null;
  const s = [...ns].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** "today", "tomorrow", "2 days overdue", else the date. */
function followUpLabel(on: string, today: string): string {
  const d = diffDays(today, on);
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d < 0) return `${-d} day${d === -1 ? "" : "s"} overdue`;
  return fmtDateShort(on);
}

export function LeadsClient({ today, leads, campaigns, openNew }: { today: string; leads: MkLead[]; campaigns: MarketingCampaign[]; openNew: boolean }) {
  const [filter, setFilter] = useState<Filter>("inbox");
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<MkLead | "new" | null>(openNew ? "new" : null);
  // re-arm when the ＋New menu navigates here with ?new=1
  const [prevOpenNew, setPrevOpenNew] = useState(openNew);
  if (prevOpenNew !== openNew) {
    setPrevOpenNew(openNew);
    if (openNew) setEdit("new");
  }
  const close = () => {
    setEdit(null);
    if (openNew) window.history.replaceState(null, "", "/leads");
  };
  const now = new Date().toISOString();

  const queued = leads.map((l) => ({ l, queue: leadQueue(l, today) }));
  const inQueue = (queue: LeadQueue) => queued.filter((x) => x.queue === queue).map((x) => x.l);
  const reply = inQueue("reply");
  const due = inQueue("follow_up");
  const open = queued.filter((x) => x.queue !== "closed" && x.queue !== "signup").map((x) => x.l);
  const openValue = open.reduce((s, l) => s + (l.est_value ?? 0), 0);
  const replyTime = median(leads.filter((l) => l.contacted_at && l.kind !== "email_signup").map((l) => minutesBetween(l.created_at, l.contacted_at!)));
  const booked = leads.filter((l) => l.status === "booked").length;
  const lost = leads.filter((l) => l.status === "lost").length;

  // Search looks across every lead, whatever the filter, so an old one is still findable.
  const term = q.trim().toLowerCase();
  const digits = phoneDigits(term);
  const matches = (l: MkLead) =>
    [l.name, l.email, l.notes].some((v) => v?.toLowerCase().includes(term)) || (digits.length >= 3 && phoneDigits(l.phone).includes(digits));
  const flat = term ? leads.filter(matches) : filter === "all" ? leads : filter === "inbox" ? null : leads.filter((l) => l.status === filter);
  // Longest wait first for replies, soonest date first for follow-ups; the rest newest first.
  const groups = GROUPS.map((g) => ({
    ...g,
    rows: inQueue(g.queue).sort((a, b) =>
      g.queue === "reply"
        ? a.created_at.localeCompare(b.created_at)
        : g.queue === "signup"
          ? 0
          : (a.follow_up_on ?? "9999").localeCompare(b.follow_up_on ?? "9999")
    ),
  })).filter((g) => g.rows.length > 0);

  // Re-read the open lead from fresh props so the sheet shows its new status after a save.
  const current = edit && edit !== "new" ? leads.find((l) => l.id === edit.id) ?? edit : edit;

  const row = (l: MkLead) => {
    const queue = leadQueue(l, today);
    return (
      <button key={l.id} type="button" className="row row-link w-full text-left" onClick={() => setEdit(l)}>
        <KindIcon kind={l.kind} />
        <span className="min-w-0 grow">
          <span className="block truncate text-md font-medium">{leadTitle(l)}</span>
          <span className="block truncate text-dense text-ink-2">
            {leadKindLabel(l.kind)} · {channelLabel(l.resolvedChannel)} · <span className="num">{fmtDateShort(dateOfInstant(l.created_at))}</span>
            {l.est_value ? (
              <>
                {" · "}
                <span className="num">{money(l.est_value)}</span>
              </>
            ) : null}
          </span>
        </span>
        <span className="shrink-0 flex flex-col items-end gap-1">
          <span className={`chip ${STATUS_TONE[l.status]}`}>{statusLabel(l.status)}</span>
          {queue === "reply" && <span className="text-xs text-warn num">waiting {fmtMinutes(minutesBetween(l.created_at, now))}</span>}
          {queue === "follow_up" && <span className="text-xs text-warn num">follow up {followUpLabel(l.follow_up_on!, today)}</span>}
          {queue === "waiting" && l.follow_up_on && <span className="text-xs text-faint num">follow up {followUpLabel(l.follow_up_on, today)}</span>}
        </span>
      </button>
    );
  };

  return (
    <>
      <PageHeader
        title="Leads"
        sub="Everyone who asked about a detail and hasn't booked yet."
        actions={
          <button className="btn btn-primary" onClick={() => setEdit("new")}>
            <IconPlus width={16} height={16} /> Add lead
          </button>
        }
      />
      <div className="flex flex-col gap-5">
        <div className="stat-grid grid-cols-2 sm:grid-cols-4">
          <Stat
            label="Need a reply"
            value={reply.length}
            hint={replyTime == null ? "goal: answer in 15 min" : `you usually answer in ${fmtMinutes(replyTime)}`}
            tone={reply.length ? "warn" : undefined}
          />
          <Stat label="Follow-ups due" value={due.length} hint={due.length ? "check back in today" : "nothing due"} tone={due.length ? "warn" : undefined} />
          <Stat label="Open value" value={money(openValue)} hint={`${open.length} open lead${open.length === 1 ? "" : "s"}`} />
          <Stat label="Won" value={booked + lost ? `${Math.round((booked / (booked + lost)) * 100)}%` : "—"} hint={`${booked} of ${booked + lost} closed`} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented
            label="Show"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "inbox", label: "Inbox" },
              { value: "booked", label: "Booked" },
              { value: "lost", label: "Lost" },
              { value: "all", label: "All" },
            ]}
          />
          <input
            type="search"
            className="input w-full sm:w-64"
            placeholder="Search name, phone, email or notes"
            aria-label="Search leads"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        {flat ? (
          flat.length === 0 ? (
            <EmptyState
              icon={<IconInbox width={20} height={20} />}
              title={term ? `No lead matches “${q.trim()}”.` : "Nothing here yet."}
              hint={term ? "Search looks at names, phone numbers, emails and notes across every lead." : "Leads you mark booked or lost show up here."}
              action={
                term ? (
                  <button className="btn" onClick={() => setQ("")}>
                    Clear search
                  </button>
                ) : undefined
              }
            />
          ) : (
            <div className="card divide-y divide-line">{flat.map(row)}</div>
          )
        ) : groups.length === 0 ? (
          <EmptyState
            icon={<IconInbox width={20} height={20} />}
            title="Inbox clear."
            hint="Every call, text, DM or quote request that isn't a customer yet goes here. Website boat quotes and email signups land on their own; add the rest so nothing gets forgotten."
            action={
              <button className="btn" onClick={() => setEdit("new")}>
                Add a lead
              </button>
            }
          />
        ) : (
          groups.map((g) => (
            <section key={g.queue}>
              <SectionLabel trailing={g.hint}>
                {g.title} <span className="num">{g.rows.length}</span>
              </SectionLabel>
              <div className="card divide-y divide-line">{g.rows.map(row)}</div>
            </section>
          ))
        )}
      </div>

      {current && <LeadSheet lead={current === "new" ? null : current} today={today} campaigns={campaigns} onClose={close} />}
    </>
  );
}

function LeadSheet({ lead, today, campaigns, onClose }: { lead: MkLead | null; today: string; campaigns: MarketingCampaign[]; onClose: () => void }) {
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

  const landing = (lead?.attribution as { first?: { landing?: string } | null } | null)?.first?.landing;
  const chasing = lead?.status === "contacted" || lead?.status === "quoted";
  const followUps = [
    { label: "Tomorrow", on: addDays(today, 1) },
    { label: "In 3 days", on: addDays(today, 3) },
    { label: "Next week", on: addDays(today, 7) },
  ];

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
                {landing ? ` · came in on ${landing}` : ""}
              </p>
            </div>
            {chasing && (
              <div>
                <p className="label mb-1.5">Follow up</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {followUps.map((f) => (
                    <button
                      key={f.on}
                      type="button"
                      className="choice px-1 text-sm"
                      aria-pressed={lead.follow_up_on === f.on}
                      disabled={!!pending}
                      onClick={() => run(`follow-${f.on}`, () => setLeadFollowUp(lead.id, lead.follow_up_on === f.on ? null : f.on))}
                    >
                      {pending === `follow-${f.on}` ? <Busy>{f.label}</Busy> : f.label}
                    </button>
                  ))}
                </div>
                <input
                  type="date"
                  className="input num mt-1.5"
                  aria-label="Follow-up date"
                  min={today}
                  value={lead.follow_up_on ?? ""}
                  disabled={!!pending}
                  onChange={(e) => run("follow-date", () => setLeadFollowUp(lead.id, e.target.value || null))}
                />
                <p className="mt-1.5 text-xs text-faint">
                  {lead.follow_up_on
                    ? `Comes back to the top of your inbox ${followUpLabel(lead.follow_up_on, today)}. Tap the same choice again to turn the reminder off.`
                    : "No reminder set. This lead stays under Waiting on them until you close it."}
                </p>
              </div>
            )}
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
