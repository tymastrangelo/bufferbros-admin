"use client";

// Customer pieces fed by the Mac text sync (scripts/client-texts): the "What we know" card Claude
// writes after each sync (only for customers with new texts), the conversation itself, and the
// "Sync texts now" bar. Owner-only (RLS + page gate).
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { requestTextSync } from "@/lib/actions/texts";
import { dateOfInstant, fmtDateLong, fmtDateShort, todayYmd } from "@/lib/time";
import type { CustomerInsight, CustomerMessage, TextSyncRun } from "@/lib/types";
import { IconChats, IconCheckCircle, IconEquals, IconWarning, type IconComponent } from "./icons";
import { Busy, EmptyState, SectionLabel } from "./ui";

const MOOD: Record<NonNullable<CustomerInsight["sentiment"]>, { label: string; cls: string; Icon: IconComponent }> = {
  happy: { label: "Going well", cls: "chip-ok", Icon: IconCheckCircle },
  neutral: { label: "Steady", cls: "", Icon: IconEquals },
  at_risk: { label: "Needs attention", cls: "chip-bad", Icon: IconWarning },
};

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
/** "11:39 AM" today, "Mon, Oct 19 11:39 AM" otherwise. */
const whenOf = (iso: string) => (dateOfInstant(iso) === todayYmd() ? timeOf(iso) : `${fmtDateShort(dateOfInstant(iso))} ${timeOf(iso)}`);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Last run status + "Sync texts now". The listener on Tyler's Mac picks the request up in
 *  seconds; this re-renders live as the run row changes (LiveRefresh). */
export function TextSyncBar({ run }: { run: TextSyncRun | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const age = run ? now - Date.parse(run.requested_at) : Infinity;
  const inFlight = !!run && (run.status === "pending" || run.status === "running") && age < 30 * 60_000;
  let status: React.ReactNode;
  if (!run) status = "Texts haven't synced yet.";
  else if (run.status === "pending") status = age > 3 * 60_000 ? "Waiting for your Mac. It syncs as soon as it's on and awake." : "Waiting for your Mac…";
  else if (run.status === "running") status = "Syncing texts and updating cards…";
  else if (run.status === "error") status = <span className="text-bad">Last sync failed ({whenOf(run.finished_at ?? run.requested_at)}): {run.error}</span>;
  else
    status = (
      <>
        Synced {whenOf(run.finished_at ?? run.requested_at)} · {plural(run.texts_synced ?? 0, "new text")} · {plural(run.cards_updated ?? 0, "card")} updated
        {run.error && <span className="text-warn"> · {run.error}</span>}
      </>
    );

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <p className="text-xs text-faint" aria-live="polite">
        {error ? <span className="text-bad">{error}</span> : status}
      </p>
      <button
        className="btn btn-sm"
        disabled={busy || inFlight}
        onClick={async () => {
          setError(null);
          setBusy(true);
          const res = await requestTextSync();
          setBusy(false);
          if (!res.ok) return setError(res.error);
          router.refresh();
        }}
      >
        {busy || inFlight ? <Busy>Syncing…</Busy> : "Sync texts now"}
      </button>
    </div>
  );
}

export function InsightCard({ insight }: { insight: CustomerInsight }) {
  const mood = insight.sentiment ? MOOD[insight.sentiment] : null;
  return (
    <section>
      <SectionLabel trailing={`from ${insight.message_count} texts · ${fmtDateShort(dateOfInstant(insight.updated_at))}`}>What we know</SectionLabel>
      <div className="card divide-y divide-line">
        <div className="px-4 py-3 flex flex-col gap-2">
          {mood && (
            <span className={`chip ${mood.cls} self-start`}>
              <mood.Icon width={12} height={12} weight="bold" aria-hidden /> {mood.label}
            </span>
          )}
          {insight.summary && <p className="text-md">{insight.summary}</p>}
        </div>
        {insight.facts.length > 0 && (
          <dl className="px-4 py-3 grid grid-cols-[minmax(6rem,9rem)_1fr] gap-x-3 gap-y-1.5 text-sm">
            {insight.facts.map((f, i) => (
              <div key={i} className="contents">
                <dt className="text-faint">{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {insight.open_items.length > 0 && (
          <div className="px-4 py-3">
            <p className="label mb-1.5">Open asks</p>
            <ul className="flex flex-col gap-1.5 text-sm">
              {insight.open_items.map((o, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3">
                  <span>{o.text}</span>
                  {/^\d{4}-\d{2}-\d{2}$/.test(o.since) && <span className="text-xs text-faint num shrink-0">{fmtDateShort(o.since)}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {insight.next_step && (
          <div className="px-4 py-3">
            <p className="note note-brand text-sm">
              <span className="font-semibold">Next:</span> {insight.next_step}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

/** The thread, oldest at top, opening scrolled to the newest message. */
export function TextThread({ messages, hasPhone, run }: { messages: CustomerMessage[]; hasPhone: boolean; run: TextSyncRun | null }) {
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <TextSyncBar run={run} />
        <EmptyState
          icon={<IconChats width={20} height={20} />}
          title={hasPhone ? "No texts with this customer yet." : "No phone number on file."}
          hint={
            hasPhone
              ? "Their one-on-one texts with you show up here after the next sync. Only threads with CRM customers are copied from your Mac."
              : "Add their phone number and their text thread will sync here."
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <TextSyncBar run={run} />
      <div ref={scroller} className="card max-h-[70vh] overflow-y-auto overscroll-contain px-3 py-3 flex flex-col gap-1.5">
        {messages.map((m, i) => {
          const d = dateOfInstant(m.sent_at);
          const sep = i === 0 || dateOfInstant(messages[i - 1].sent_at) !== d;
          return (
            <div key={m.id} className="flex flex-col">
              {sep && <p className="label text-center my-2">{fmtDateLong(d)}</p>}
              <div className={`max-w-[80%] ${m.from_me ? "self-end items-end" : "self-start items-start"} flex flex-col`}>
                <p
                  className={`rounded-xl px-3 py-2 text-sm whitespace-pre-wrap wrap-break-word ${m.from_me ? "bg-brand text-white" : "bg-muted text-ink"}`}
                >
                  {m.body ?? <span className="italic">Photo or file</span>}
                  {m.body && m.has_attachment && <span className="block mt-1 text-xs italic opacity-80">+ photo or file</span>}
                </p>
                <span className="mt-0.5 text-xs text-faint num">{timeOf(m.sent_at)}</span>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-faint">
        {messages.length >= 300 ? "Latest 300 texts. " : ""}Syncs every night and whenever you tap Sync. The card above updates only when there are new texts.
      </p>
    </div>
  );
}
