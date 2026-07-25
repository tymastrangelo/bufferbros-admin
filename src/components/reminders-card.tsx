"use client";

// Owner-only "Reminders" section on Today: schedule a future nudge (optionally
// pinned to a client + their cars). The morning digest pushes it via ntfy on the
// due date; rows stay here until marked done.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { completeReminder, createReminder, deleteReminder } from "@/lib/actions/reminders";
import { fmtDateShort, todayYmd } from "@/lib/time";
import type { Reminder } from "@/lib/types";
import { CustomerPicker, type PickedCustomer } from "./customer-picker";
import { VehiclePicker } from "./vehicle-picker";
import { ErrorNote, Field, Sheet } from "./ui";

export type ReminderRow = Reminder & {
  customers: { id: string; name: string } | null;
  /** resolved labels for vehicle_ids, e.g. ["2021 Tesla Model 3"] */
  vehicleLabels: string[];
};

export function RemindersCard({ reminders }: { reminders: ReminderRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
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
        <button className="btn btn-sm" onClick={() => setOpen(true)}>
          + New reminder
        </button>
      </div>
      {reminders.length === 0 ? (
        <p className="text-sm text-faint">Nothing scheduled — add one and it&apos;ll hit your phone that morning.</p>
      ) : (
        <div className="card divide-y divide-line">
          {reminders.map((r) => (
            <div key={r.id} className="px-4 py-3 flex items-center gap-3">
              <div className="min-w-0 grow">
                <p className="text-sm font-medium truncate">
                  {r.title}
                  {r.customers && (
                    <>
                      {" "}
                      <Link href={`/customers/${r.customers.id}`} className="text-brand-deep font-normal hover:underline underline-offset-2">
                        · {r.customers.name}
                      </Link>
                    </>
                  )}
                </p>
                <p className="text-xs text-faint truncate">
                  <span className={`num ${r.due_on <= today ? "text-warn font-semibold" : ""}`}>
                    {r.due_on <= today ? "due now" : fmtDateShort(r.due_on)}
                  </span>
                  {r.vehicleLabels.length > 0 && ` · ${r.vehicleLabels.join(", ")}`}
                  {r.body && ` · ${r.body}`}
                </p>
              </div>
              <button className="btn btn-sm shrink-0" disabled={busy === r.id} onClick={() => act(r.id, () => completeReminder(r.id))}>
                Done
              </button>
              <button
                className="btn btn-ghost btn-sm shrink-0 text-faint"
                aria-label="Delete reminder"
                disabled={busy === r.id}
                onClick={() => act(r.id, () => deleteReminder(r.id))}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      {open && <NewReminderSheet onClose={() => setOpen(false)} />}
    </section>
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
          {pending ? "Saving…" : "Save reminder"}
        </button>
      </div>
    </Sheet>
  );
}
