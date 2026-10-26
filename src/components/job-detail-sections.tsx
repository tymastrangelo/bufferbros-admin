"use client";

// The detail a crew needs on a job, as sections of the job sheet: the vehicles, where and
// how to get in, what's included (tick on site), the money trail, and the timeline.
// Each is props-driven; Money and Timeline load their own rows from the browser client
// (same pattern as the old PaymentStatus) so page loaders stay small.
import { useEffect, useState } from "react";
import { setChecklistItem, setSiteNotes } from "@/lib/actions/appointments";
import { checklistProgress } from "@/lib/checklist";
import { fmtDateShort, minToLabel, whenLabel } from "@/lib/time";
import { money, mapsHref } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { vehicleLabel, type AppointmentEvent, type ChecklistItem, type Vehicle } from "@/lib/types";
import { IconCheck, IconCheckCircle, IconCircle, IconPin } from "./icons";
import { Busy, SuccessButton } from "./ui";

const SIZE_SHORT: Record<string, string> = { sedan: "Sedan", midsize: "Midsize", large: "Large" };

export function VehiclesSection({ vehicles, sizeLabel }: { vehicles: Vehicle[]; sizeLabel: string | null }) {
  if (vehicles.length === 0) return sizeLabel ? <p className="text-sm text-ink-2">{sizeLabel}</p> : null;
  return (
    <ul className="flex flex-col gap-1" aria-label="Vehicles on this job">
      {vehicles.map((v) => (
        <li key={v.id} className="flex items-center gap-2 text-sm">
          <span className="font-medium">{vehicleLabel(v)}</span>
          {v.color && <span className="text-ink-2">{v.color}</span>}
          {v.plate && <span className="chip num">{v.plate}</span>}
          <span className="ml-auto text-xs text-faint shrink-0">
            {v.kind === "boat" ? (v.length_ft ? `${v.length_ft} ft boat` : "Boat") : SIZE_SHORT[v.size_id] ?? v.size_id}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Address + the customer's standing "getting in" notes, editable in place by anyone. */
export function WhereSection({ address, customerId, siteNotes }: { address: string | null; customerId: string | null; siteNotes: string | null }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(siteNotes ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | string>("idle");
  async function save() {
    if (!customerId) return;
    setState("saving");
    const res = await setSiteNotes(customerId, draft);
    if (!res.ok) return setState(res.error ?? "Couldn't save.");
    setState("saved");
    setTimeout(() => {
      setState("idle");
      setEditing(false);
    }, 900);
  }
  return (
    <div className="flex flex-col gap-2">
      {address && (
        <a className="flex items-start gap-2 text-sm text-ink hover:text-brand-deep" href={mapsHref(address)} target="_blank" rel="noreferrer">
          <IconPin width={16} height={16} className="shrink-0 mt-0.5 text-faint" aria-hidden />
          <span>{address}</span>
        </a>
      )}
      {!editing ? (
        siteNotes ? (
          <button type="button" className="note note-brand text-sm text-left" onClick={() => customerId && setEditing(true)} aria-label="Edit getting-in notes">
            {siteNotes}
          </button>
        ) : customerId ? (
          <button type="button" className="add-link self-start" onClick={() => setEditing(true)}>
            Add gate code, parking, water…
          </button>
        ) : null
      ) : (
        <div className="well p-3 flex flex-col gap-2">
          <textarea className="textarea" rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Gate 4412 · park on the street · hose on the left side" autoFocus />
          <p className="text-xs text-faint">Saved on the customer — shows on every one of their jobs.</p>
          <div className="flex items-center gap-2">
            <button type="button" className="btn btn-sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <SuccessButton state={state} onClick={save}>
              Save notes
            </SuccessButton>
          </div>
        </div>
      )}
    </div>
  );
}

/** Tap to tick. Workers use this on site; the Complete panel shows what's left. */
export function ChecklistSection({ appointmentId, items, readOnly }: { appointmentId: string; items: ChecklistItem[]; readOnly?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [local, setLocal] = useState(items);
  const [prev, setPrev] = useState(items);
  if (prev !== items) {
    setPrev(items);
    setLocal(items);
  }
  if (local.length === 0) return null;
  const p = checklistProgress(local);
  async function toggle(item: ChecklistItem) {
    if (readOnly) return;
    setBusy(item.id);
    setLocal((cur) => cur.map((i) => (i.id === item.id ? { ...i, done: !item.done } : i)));
    const res = await setChecklistItem(appointmentId, item.id, !item.done);
    if (!res.ok) setLocal((cur) => cur.map((i) => (i.id === item.id ? { ...i, done: item.done } : i)));
    setBusy(null);
  }
  return (
    <div className="flex flex-col gap-1.5">
      <p className="label">
        To do <span className="num">· {p.done} of {p.total}</span>
      </p>
      <div className="flex flex-col gap-1">
        {local.map((i) => (
          <button
            key={i.id}
            type="button"
            className="choice min-h-[38px] px-3 py-1.5 text-sm text-left justify-start gap-2.5"
            aria-pressed={i.done}
            disabled={readOnly || busy === i.id}
            onClick={() => toggle(i)}
          >
            {i.done ? <IconCheckCircle width={18} height={18} weight="fill" className="shrink-0 text-ok" aria-hidden /> : <IconCircle width={18} height={18} className="shrink-0 text-faint" aria-hidden />}
            <span className={i.done ? "line-through text-ink-2" : ""}>{i.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

interface MoneyRow {
  id: string;
  kind: string;
  amount: number;
  tip: number;
  method: string | null;
  occurred_on: string;
  collected_by: string;
  settled_on: string | null;
}

/** Charge, payments (with tips), Stripe link state — the job's money trail. */
export function MoneySection({ appointmentId, customerId, price }: { appointmentId: string; customerId: string | null; price: number }) {
  const [rows, setRows] = useState<MoneyRow[] | null>(null);
  const [link, setLink] = useState<string | null>(null);
  useEffect(() => {
    let stale = false;
    (async () => {
      const db = createClient();
      const [entQ, reqQ] = await Promise.all([
        db.from("ledger_entries").select("id,kind,amount,tip,method,occurred_on,collected_by,settled_on").eq("appointment_id", appointmentId).order("created_at"),
        db.from("payment_requests").select("status").eq("appointment_id", appointmentId).order("created_at", { ascending: false }).limit(1),
      ]);
      if (stale) return;
      setRows(((entQ.data ?? []) as MoneyRow[]).map((r) => ({ ...r, amount: Number(r.amount), tip: Number(r.tip ?? 0) })));
      setLink(reqQ.data?.[0]?.status ?? null);
    })();
    return () => {
      stale = true;
    };
  }, [appointmentId]);
  if (!customerId) return <p className="note text-dense">Not linked to a customer — nothing on the ledger yet.</p>;
  if (!rows) return <Busy>Loading…</Busy>;
  const charged = rows.filter((r) => r.kind === "charge").reduce((s, r) => s + Math.abs(r.amount), 0);
  const paid = rows.filter((r) => r.kind === "payment" || r.kind === "credit").reduce((s, r) => s + r.amount, 0);
  const tips = rows.reduce((s, r) => s + r.tip, 0);
  const refunded = rows.filter((r) => r.kind === "refund").reduce((s, r) => s + Math.abs(r.amount), 0);
  const owed = charged - paid + refunded;
  return (
    <div className="card divide-y divide-line overflow-hidden">
      {rows.length === 0 && <p className="px-3 py-2 text-sm text-faint">Quoted {money(price)} — nothing charged yet.</p>}
      {rows.map((r) => (
        <div key={r.id} className="px-3 py-2 flex items-center gap-2 text-sm">
          <span className="capitalize font-medium">{r.kind}</span>
          <span className="text-xs text-faint num">
            {fmtDateShort(r.occurred_on)}
            {r.method ? ` · ${r.method}` : ""}
            {(r.kind === "payment" || r.kind === "credit") && ` · collected by ${r.collected_by === "washer" ? "worker" : "you"}`}
            {r.settled_on && " · settled"}
          </span>
          <span className="ml-auto num font-medium">
            {money(Math.abs(r.amount))}
            {r.tip > 0 && <span className="block text-micro text-ok text-right">+ {money(r.tip)} tip</span>}
          </span>
        </div>
      ))}
      {rows.length > 0 && (
        <div className={`px-3 py-2 text-dense font-medium num ${owed > 0 ? "text-bad" : "text-ok"}`}>
          {owed > 0 ? `${money(owed)} still owed` : owed < 0 ? `${money(-owed)} credit` : "Paid in full"}
          {tips > 0 && ` · ${money(tips)} in tips`}
          {link === "pending" && " · Stripe link sent, not paid yet"}
        </div>
      )}
    </div>
  );
}

const EVENT_LABEL: Record<string, string> = {
  booked: "Booked",
  started: "Started",
  completed: "Done",
  cancelled: "Cancelled",
  no_show: "No-show",
  reopened: "Back on the schedule",
  rescheduled: "Rescheduled",
  assigned: "Assigned",
  price_changed: "Price changed",
  edited: "Edited",
};

const fmtAt = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

/** Collapsed by default: what happened and when, written by the DB trigger. */
export function TimelineSection({ appointmentId, names }: { appointmentId: string; names: Record<string, string> }) {
  const [events, setEvents] = useState<AppointmentEvent[] | null>(null);
  useEffect(() => {
    let stale = false;
    createClient()
      .from("appointment_events")
      .select("*")
      .eq("appointment_id", appointmentId)
      .order("at")
      .then(({ data }) => {
        if (!stale) setEvents((data as AppointmentEvent[]) ?? []);
      });
    return () => {
      stale = true;
    };
  }, [appointmentId]);
  if (!events || events.length === 0) return null;
  const detailOf = (e: AppointmentEvent) => {
    const d = e.detail as Record<string, unknown>;
    if (e.kind === "rescheduled") {
      const to = d.to as { date: string; start_min: number } | undefined;
      return to ? `to ${whenLabel(to.date, to.start_min)}` : "";
    }
    if (e.kind === "assigned") return `to ${d.to ? names[String(d.to)] ?? "a worker" : "Me"}`;
    if (e.kind === "price_changed") return `${money(Number(d.from))} → ${money(Number(d.to))}`;
    if (e.kind === "booked") return d.source === "web" ? "on the website" : d.source === "recurring" ? "from a plan" : "";
    return "";
  };
  return (
    <details className="disclose">
      <summary className="text-dense text-ink-2 cursor-pointer">Timeline · {events.length}</summary>
      <ol className="mt-1.5 flex flex-col gap-1 text-xs">
        {events.map((e) => (
          <li key={e.id} className="flex items-baseline gap-2">
            <span className="num text-faint shrink-0 w-28">{fmtAt(e.at)}</span>
            <span className="font-medium">{EVENT_LABEL[e.kind] ?? e.kind}</span>
            <span className="text-ink-2 truncate">{detailOf(e)}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

export const minuteLabel = minToLabel;
export const CheckGlyph = IconCheck;
