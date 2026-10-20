"use client";

// Customer profile pieces fed by the Mac text sync (scripts/client-texts): the "What we know"
// card Claude writes nightly, and the conversation itself. Owner-only (RLS + page gate).
import { useLayoutEffect, useRef } from "react";
import { dateOfInstant, fmtDateLong, fmtDateShort } from "@/lib/time";
import type { CustomerInsight, CustomerMessage } from "@/lib/types";
import { IconChats, IconCheckCircle, IconEquals, IconWarning, type IconComponent } from "./icons";
import { EmptyState, SectionLabel } from "./ui";

const MOOD: Record<NonNullable<CustomerInsight["sentiment"]>, { label: string; cls: string; Icon: IconComponent }> = {
  happy: { label: "Going well", cls: "chip-ok", Icon: IconCheckCircle },
  neutral: { label: "Steady", cls: "", Icon: IconEquals },
  at_risk: { label: "Needs attention", cls: "chip-bad", Icon: IconWarning },
};

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });

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
export function TextThread({ messages, hasPhone, insightPending }: { messages: CustomerMessage[]; hasPhone: boolean; insightPending: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <EmptyState
        icon={<IconChats width={20} height={20} />}
        title={hasPhone ? "No texts synced yet." : "No phone number on file."}
        hint={
          hasPhone
            ? "Texts with this customer show up here once the Mac sync is running (scripts/client-texts/install.sh). Only threads with CRM customers are copied."
            : "Add their phone number and their text thread will sync here."
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
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
        {messages.length >= 300 ? "Latest 300 texts. " : ""}Synced from your Mac every 15 minutes.
        {insightPending ? " Claude reads new texts each morning." : ""}
      </p>
    </div>
  );
}
