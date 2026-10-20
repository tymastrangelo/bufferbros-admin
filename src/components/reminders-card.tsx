"use client";

// Owner-only "Reminders" section on Today: schedule a future nudge (optionally
// pinned to a client + their cars). The morning digest pushes it via ntfy on the
// due date; rows stay here until marked done. Tapping one opens the full reminder;
// a body written as "Text: <message>" is a message to send that client, so the
// sheet offers it pre-filled in Messages.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { completeReminder, createReminder, deleteReminder } from "@/lib/actions/reminders";
import { logOutreach } from "@/lib/actions/relations";
import { smsHref, telHref } from "@/lib/format";
import { fmtDateLong, fmtDateShort, todayYmd } from "@/lib/time";
import type { Reminder } from "@/lib/types";
import { CustomerPicker, type PickedCustomer } from "./customer-picker";
import { IconMessage, IconPhone, IconPlus } from "./icons";
import { VehiclePicker } from "./vehicle-picker";
import { Busy, CopyButton, ErrorNote, Field, Sheet } from "./ui";

/** "Text: <message>" → the message to send; anything else is a plain note. */
const messageOf = (body: string | null) => (body && /^text:/i.test(body) ? body.replace(/^text:\s*/i, "") : null);
/** Review-ask reminders carry the Google review link. */
const isReviewAsk = (body: string | null) => !!body?.includes("g.page/r/");

export type ReminderRow = Reminder & {
  customers: { id: string; name: string; phone: string | null } | null;
  /** resolved labels for vehicle_ids, e.g. ["2021 Tesla Model 3"] */
  vehicleLabels: string[];
};

export function RemindersCard({ reminders }: { reminders: ReminderRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // read the open reminder from fresh props so it closes itself once done/deleted
  const viewing = reminders.find((r) => r.id === viewId) ?? null;
  const today = todayYmd();

  async function act(id: string, fn: () => Promise<{ ok: boolean }>) {
    setBusy(id);
    await fn();
    setBusy(null);
    router.refresh();
  }

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between mb-2">
        <h2 className="label">Reminders</h2>
        <button className="btn btn-ghost btn-sm text-brand-deep" onClick={() => setOpen(true)}>
          <IconPlus width={14} height={14} /> New reminder
        </button>
      </div>
      {reminders.length === 0 ? (
        <p className="text-sm text-faint">Nothing scheduled — add one and it&apos;ll hit your phone that morning.</p>
      ) : (
        <div className="stagger card divide-y divide-line overflow-hidden">
          {reminders.map((r) => (
            <div key={r.id} className="row row-link">
              <button type="button" className="min-w-0 grow -my-3 py-3 text-left" onClick={() => setViewId(r.id)}>
                <span className="block text-sm font-medium truncate">{r.title}</span>
                <span className="block text-xs text-faint truncate">
                  <span className={`num ${r.due_on <= today ? "text-warn font-semibold" : ""}`}>
                    {r.due_on <= today ? "due now" : fmtDateShort(r.due_on)}
                  </span>
                  {r.customers && ` · ${r.customers.name}`}
                  {r.vehicleLabels.length > 0 && ` · ${r.vehicleLabels.join(", ")}`}
                  {r.body && ` · ${messageOf(r.body) ?? r.body}`}
                </span>
              </button>
              <button className="btn btn-sm shrink-0" disabled={busy === r.id} onClick={() => act(r.id, () => completeReminder(r.id))}>
                Done
              </button>
            </div>
          ))}
        </div>
      )}
      {open && <NewReminderSheet onClose={() => setOpen(false)} />}
      {viewing && <ReminderSheet r={viewing} onClose={() => setViewId(null)} />}
    </section>
  );
}

/** The whole reminder, with the next step one tap away. */
function ReminderSheet({ r, onClose }: { r: ReminderRow; onClose: () => void }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const today = todayYmd();
  const msg = messageOf(r.body);
  const phone = r.customers?.phone ?? null;
  const first = r.customers?.name.split(/\s+/)[0] ?? "them";
  const reviewAsk = isReviewAsk(r.body) && r.customers;
  const textFirst = !!(msg && phone); // the text is the main action; finishing up is secondary

  async function run(label: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    setPending(label);
    const res = await fn();
    setPending(null);
    if (!res.ok) return setError(res.error ?? "That didn't save. Try again.");
    onClose();
    router.refresh();
  }

  return (
    <Sheet open onClose={onClose} title={r.title}>
      <div className="flex flex-col gap-5">
        <p className="text-sm text-ink-2">
          <span className={r.due_on <= today ? "text-warn font-semibold" : ""}>{r.due_on <= today ? "Due now" : `Due ${fmtDateLong(r.due_on)}`}</span>
          {r.customers && (
            <>
              {" · "}
              <Link href={`/customers/${r.customers.id}`} className="link">
                {r.customers.name}
              </Link>
            </>
          )}
          {r.vehicleLabels.length > 0 && ` · ${r.vehicleLabels.join(", ")}`}
        </p>

        {msg ? (
          <section className="flex flex-col gap-2">
            <p className="label">Message to send</p>
            <p className="well px-3.5 py-3 text-md whitespace-pre-wrap select-text">{msg}</p>
            <div className="flex flex-wrap gap-2">
              {phone && (
                <a className="btn btn-primary" href={`${smsHref(phone)}&body=${encodeURIComponent(msg)}`}>
                  <IconMessage width={16} height={16} /> Text {first}
                </a>
              )}
              <CopyButton text={msg} label="Copy message" className="btn" />
              {phone && (
                <a className="btn" href={telHref(phone)}>
                  <IconPhone width={16} height={16} /> Call
                </a>
              )}
            </div>
          </section>
        ) : (
          <>
            {r.body && (
              <section>
                <p className="label mb-1.5">Note</p>
                <p className="text-md whitespace-pre-wrap select-text">{r.body}</p>
              </section>
            )}
            {phone && (
              <div className="flex flex-wrap gap-2">
                <a className="btn" href={telHref(phone)}>
                  <IconPhone width={16} height={16} /> Call {first}
                </a>
                <a className="btn" href={smsHref(phone)}>
                  <IconMessage width={16} height={16} /> Text {first}
                </a>
              </div>
            )}
          </>
        )}

        <ErrorNote>{error}</ErrorNote>
        <div className="flex flex-col gap-2">
          {reviewAsk ? (
            <button
              className={`btn h-11 ${textFirst ? "" : "btn-primary"}`}
              disabled={!!pending}
              onClick={() =>
                run("done", async () => {
                  const logged = await logOutreach({ customerId: r.customers!.id, outcome: "asked_review" });
                  return logged.ok ? completeReminder(r.id) : logged;
                })
              }
            >
              {pending === "done" ? <Busy>Saving…</Busy> : "Sent, mark asked"}
            </button>
          ) : (
            <button className={`btn h-11 ${textFirst ? "" : "btn-primary"}`} disabled={!!pending} onClick={() => run("done", () => completeReminder(r.id))}>
              {pending === "done" ? <Busy>Saving…</Busy> : "Mark done"}
            </button>
          )}
          <button
            className="btn btn-danger"
            disabled={!!pending}
            onClick={() => (confirmDelete ? run("delete", () => deleteReminder(r.id)) : setConfirmDelete(true))}
          >
            {confirmDelete ? "Tap again to delete this reminder" : "Delete reminder"}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function NewReminderSheet({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [body, setBody] = useState("");
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [vehicles, setVehicles] = useState(customer?.vehicles ?? []);
  const [vehicleIds, setVehicleIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function pickCustomer(c: PickedCustomer | null) {
    setCustomer(c);
    setVehicles(c?.vehicles ?? []);
    setVehicleIds([]);
  }

  async function submit() {
    setError(null);
    setPending(true);
    const res = await createReminder({
      title,
      dueOn,
      body,
      customerId: customer?.id ?? null,
      vehicleIds,
    });
    setPending(false);
    if (!res.ok) return setError(res.error);
    onClose();
    router.refresh();
  }

  return (
    <Sheet open onClose={onClose} title="New reminder">
      <div className="flex flex-col gap-4">
        <Field label="Remind me to…">
          <input className="input" placeholder="Reach out to Katy — she's back for the season" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </Field>
        <Field label="On" hint="Lands on your phone with the morning digest that day">
          <input type="date" className="input num" value={dueOn} min={todayYmd()} onChange={(e) => setDueOn(e.target.value)} />
        </Field>
        <Field label="Client (optional)">
          <CustomerPicker value={customer} onChange={pickCustomer} />
        </Field>
        {customer && vehicles.length > 0 && (
          <Field label="Their vehicles (optional)">
            <VehiclePicker
              customerId={customer.id}
              vehicles={vehicles}
              selected={vehicleIds}
              onChange={setVehicleIds}
              onVehiclesChange={setVehicles}
              allowAdd={false}
            />
          </Field>
        )}
        <Field label="Note (optional)">
          <textarea className="textarea" rows={2} placeholder="Wants the SUV done before Thanksgiving…" value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <button className="btn btn-primary h-11" disabled={pending || !title.trim() || !dueOn} onClick={submit}>
          {pending ? <Busy>Saving…</Busy> : "Save reminder"}
        </button>
      </div>
    </Sheet>
  );
}
