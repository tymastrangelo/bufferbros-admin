"use client";

// Everything you do to an existing job: complete (finalize price + take payment),
// reschedule, edit details, cancel, no-show, and linking web bookings to customers.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  approveAppointment,
  cancelAppointment,
  completeAppointment,
  createCustomerFromAppointment,
  linkAppointmentToCustomer,
  rescheduleAppointment,
  setAppointmentStatus,
  updateAppointment,
} from "@/lib/actions/appointments";
import { Wheel } from "@/components/brand";
import { computeQuote, type Catalog } from "@/lib/catalog";
import { fmtPhone, mapsHref, money, smsHref, telHref } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { fmtDateShort, minToLabel, whenLabel } from "@/lib/time";
import { PAYMENT_METHODS, SIZES, sizeLabel, type Appointment, type Customer, type PaymentMethod, type SizeId } from "@/lib/types";
import { IconMail, IconMessage, IconPhone, IconPin } from "./icons";
import { CustomerPicker, type PickedCustomer } from "./customer-picker";
import { SlotPicker } from "./slot-picker";
import { ErrorNote, Field, Sheet, StatusChip } from "./ui";

export type JobWithCustomer = Appointment & { customers: Pick<Customer, "id" | "name" | "phone" | "email"> | null };

type Panel = "none" | "approve" | "complete" | "reschedule" | "edit" | "cancel" | "link";

export function JobSheet({
  job,
  onClose,
  catalog,
}: {
  job: JobWithCustomer | null;
  onClose: () => void;
  catalog: Catalog;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>("none");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Reset panels when a different job opens (state adjustment during render).
  const [prevJobId, setPrevJobId] = useState(job?.id);
  if (prevJobId !== job?.id) {
    setPrevJobId(job?.id);
    setPanel("none");
    setError(null);
  }

  if (!job) return null;

  const displayName = job.customers?.name ?? job.contact_name ?? "Unknown";
  const phone = job.customers?.phone ?? job.contact_phone;
  const email = job.customers?.email ?? job.contact_email;
  const unlinked = !job.customer_id;

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    setPending(true);
    const res = await fn();
    setPending(false);
    if (!res.ok) {
      setError(res.error ?? "Something went wrong.");
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <Sheet open onClose={onClose} title={displayName}>
      <div className="flex flex-col gap-4">
        {/* Summary */}
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <StatusChip status={job.status} />
            {job.plan_id && <span className="chip bg-brand-wash text-brand-deep">plan</span>}
            {job.source === "web" && <span className="chip bg-[#f1f4f9] text-ink-2">web booking</span>}
            {unlinked && <span className="chip bg-warn-wash text-warn">not linked</span>}
          </div>
          <p className="mt-2 text-[15px] font-semibold num">{whenLabel(job.date, job.start_min)}</p>
          <p className="text-sm text-ink-2">
            {job.service_name}
            {job.size_id ? ` · ${sizeLabel(job.size_id)}` : ""} · {job.duration_min} min ·{" "}
            <span className="num font-medium text-ink">{money(Number(job.price))}</span>
          </p>
          {job.addons.length > 0 && (
            <p className="text-sm text-ink-2 mt-0.5">+ {job.addons.map((a) => a.name).join(", ")}</p>
          )}
          {job.notes && <p className="mt-2 text-sm bg-warn-wash border border-[#fde68a] rounded-md px-3 py-2">{job.notes}</p>}
        </div>

        {/* Contact links */}
        <div className="grid grid-cols-4 gap-1.5">
          <a className={`btn btn-sm flex-col h-14! gap-1 ${phone ? "" : "pointer-events-none opacity-40"}`} href={phone ? telHref(phone) : undefined}>
            <IconPhone width={16} height={16} />
            <span className="text-[11px]">Call</span>
          </a>
          <a className={`btn btn-sm flex-col h-14! gap-1 ${phone ? "" : "pointer-events-none opacity-40"}`} href={phone ? smsHref(phone) : undefined}>
            <IconMessage width={16} height={16} />
            <span className="text-[11px]">Text</span>
          </a>
          <a
            className={`btn btn-sm flex-col h-14! gap-1 ${job.address ? "" : "pointer-events-none opacity-40"}`}
            href={job.address ? mapsHref(job.address) : undefined}
            target="_blank"
            rel="noreferrer"
          >
            <IconPin width={16} height={16} />
            <span className="text-[11px]">Maps</span>
          </a>
          <a className={`btn btn-sm flex-col h-14! gap-1 ${email ? "" : "pointer-events-none opacity-40"}`} href={email ? `mailto:${email}` : undefined}>
            <IconMail width={16} height={16} />
            <span className="text-[11px]">Email</span>
          </a>
        </div>
        {(phone || job.address) && (
          <p className="text-[13px] text-ink-2 -mt-2">
            {phone && <span className="num">{fmtPhone(phone)}</span>}
            {phone && job.address && " · "}
            {job.address}
          </p>
        )}

        {unlinked && panel !== "link" && (
          <button className="btn btn-sm self-start" onClick={() => setPanel("link")}>
            Link to a customer
          </button>
        )}
        {job.customers && (
          <a href={`/customers/${job.customers.id}`} className="text-[13px] text-brand-deep underline underline-offset-2 self-start">
            Open customer profile →
          </a>
        )}

        <ErrorNote>{error}</ErrorNote>

        {/* Primary actions */}
        {job.status === "pending" && panel === "none" && (
          <div className="flex flex-col gap-2">
            <button className="btn btn-primary h-11" onClick={() => setPanel("approve")}>
              Review &amp; approve…
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button className="btn" onClick={() => setPanel("edit")}>
                Edit details
              </button>
              <button className="btn btn-danger" onClick={() => setPanel("cancel")}>
                Decline…
              </button>
            </div>
          </div>
        )}
        {job.status === "scheduled" && panel === "none" && (
          <div className="flex flex-col gap-2">
            <button className="btn btn-primary h-11" onClick={() => setPanel("complete")}>
              Complete job
            </button>
            <div className="grid grid-cols-3 gap-2">
              <button className="btn" onClick={() => setPanel("reschedule")}>
                Reschedule
              </button>
              <button className="btn" onClick={() => setPanel("edit")}>
                Edit
              </button>
              <button className="btn btn-danger" onClick={() => setPanel("cancel")}>
                Cancel…
              </button>
            </div>
            <button
              className="btn btn-ghost btn-sm self-center text-ink-2"
              disabled={pending}
              onClick={() => run(() => setAppointmentStatus(job.id, "no_show")).then((ok) => ok && onClose())}
            >
              Mark as no-show
            </button>
          </div>
        )}
        {(job.status === "no_show" || job.status === "cancelled") && panel === "none" && (
          <button
            className="btn"
            disabled={pending}
            onClick={() => run(() => setAppointmentStatus(job.id, "scheduled"))}
          >
            Put back on the schedule
          </button>
        )}
        {job.status === "completed" && panel === "none" && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-ink-2">
              Completed {job.completed_at ? `· charged ${money(Number(job.price))}` : ""}. Adjust money on the
              customer&apos;s ledger if needed.
            </p>
            {job.completion_note && (
              <p className="text-sm bg-surface border border-line rounded-md px-3 py-2">
                <span className="label block mb-0.5">Completion note</span>
                {job.completion_note}
              </p>
            )}
          </div>
        )}

        {panel === "approve" && (
          <ApprovePanel
            job={job}
            hasEmail={!!email}
            pending={pending}
            onCancel={() => setPanel("none")}
            onSubmit={(next, notify) =>
              run(() => approveAppointment(job.id, next, notify)).then((ok) => ok && onClose())
            }
          />
        )}
        {panel === "complete" && (
          <CompletePanel
            job={job}
            pending={pending}
            onCancel={() => setPanel("none")}
            onSubmit={(finalPrice, payment, note) =>
              run(() => completeAppointment(job.id, finalPrice, payment, note)).then((ok) => ok && onClose())
            }
          />
        )}
        {panel === "reschedule" && (
          <ReschedulePanel
            job={job}
            hasEmail={!!email}
            pending={pending}
            onCancel={() => setPanel("none")}
            onSubmit={(next, notify) =>
              run(() => rescheduleAppointment(job.id, next, notify)).then((ok) => ok && onClose())
            }
          />
        )}
        {panel === "edit" && (
          <EditPanel
            job={job}
            catalog={catalog}
            pending={pending}
            onCancel={() => setPanel("none")}
            onSubmit={(fields) => run(() => updateAppointment(job.id, fields)).then((ok) => ok && setPanel("none"))}
          />
        )}
        {panel === "cancel" && (
          <CancelPanel
            hasEmail={!!email}
            decline={job.status === "pending"}
            pending={pending}
            onBack={() => setPanel("none")}
            onSubmit={(notify) => run(() => cancelAppointment(job.id, notify)).then((ok) => ok && onClose())}
          />
        )}
        {panel === "link" && (
          <LinkPanel
            job={job}
            pending={pending}
            onCancel={() => setPanel("none")}
            onLink={(customerId) =>
              run(() => linkAppointmentToCustomer(job.id, customerId)).then((ok) => ok && setPanel("none"))
            }
            onCreate={() => run(() => createCustomerFromAppointment(job.id)).then((ok) => ok && setPanel("none"))}
          />
        )}
      </div>
    </Sheet>
  );
}

function CompletePanel({
  job,
  pending,
  onCancel,
  onSubmit,
}: {
  job: JobWithCustomer;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (
    finalPrice: number,
    payment: { amount: number; method: PaymentMethod; memo?: string } | null,
    note: string
  ) => void;
}) {
  const [finalPrice, setFinalPrice] = useState(String(job.price));
  const [collect, setCollect] = useState(!!job.customer_id && !job.plan_id);
  const [amount, setAmount] = useState(String(job.price));
  const [method, setMethod] = useState<PaymentMethod>("zelle");
  const [memo, setMemo] = useState("");
  const [note, setNote] = useState("");

  return (
    <div className="card p-4 flex flex-col gap-3 bg-surface">
      <p className="label">Finalize job</p>
      <Field label="Final price" hint={Number(finalPrice) !== Number(job.price) ? `Quoted ${money(Number(job.price))}` : undefined}>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-faint">$</span>
          <input
            type="number"
            className="input num pl-7"
            value={finalPrice}
            min={0}
            onChange={(e) => {
              setFinalPrice(e.target.value);
              if (collect) setAmount(e.target.value);
            }}
          />
        </div>
      </Field>
      {job.customer_id ? (
        <>
          <label className="flex items-center gap-2.5 text-sm">
            <input type="checkbox" checked={collect} onChange={(e) => setCollect(e.target.checked)} />
            Record a payment now
          </label>
          {!collect && (
            <p className="text-[13px] text-ink-2 -mt-1">
              The charge goes on the ledger; the balance shows what they owe.
            </p>
          )}
          {collect && (
            <div className="grid grid-cols-2 gap-2">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-faint">$</span>
                <input type="number" className="input num pl-7" value={amount} min={0} onChange={(e) => setAmount(e.target.value)} aria-label="Payment amount" />
              </div>
              <select className="select" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} aria-label="Payment method">
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m[0].toUpperCase() + m.slice(1)}
                  </option>
                ))}
              </select>
              <input
                className="input col-span-2"
                placeholder="Memo (add “tip” if it includes one)"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
              />
            </div>
          )}
        </>
      ) : (
        <p className="text-[13px] text-warn bg-warn-wash border border-[#fde68a] rounded-md px-3 py-2">
          Not linked to a customer — completing won&apos;t touch any ledger. Link first to track the money.
        </p>
      )}
      <Field label="Anything to note? (optional)">
        <textarea
          className="textarea"
          rows={2}
          placeholder="Condition, extras done, anything worth flagging…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <button className="btn" onClick={onCancel}>
          Back
        </button>
        <button
          className="btn btn-primary"
          disabled={pending}
          onClick={() =>
            onSubmit(
              Number(finalPrice),
              collect && job.customer_id ? { amount: Number(amount), method, memo } : null,
              note.trim()
            )
          }
        >
          {pending ? (
            <>
              <Wheel size={16} /> Saving…
            </>
          ) : collect ? (
            `Complete + ${money(Number(amount || 0))}`
          ) : (
            "Complete"
          )}
        </button>
      </div>
    </div>
  );
}

function ApprovePanel({
  job,
  hasEmail,
  pending,
  onCancel,
  onSubmit,
}: {
  job: JobWithCustomer;
  hasEmail: boolean;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (next: { date: string; startMin: number; durationMin: number; price: number }, notify: boolean) => void;
}) {
  const [date, setDate] = useState(job.date);
  const [startMin, setStartMin] = useState<number | null>(job.start_min);
  const [duration, setDuration] = useState(job.duration_min);
  const [price, setPrice] = useState(String(job.price));
  const [notify, setNotify] = useState(hasEmail);

  return (
    <div className="card p-4 flex flex-col gap-3 bg-surface">
      <p className="label">
        Approve — requested {fmtDateShort(job.date)} at {minToLabel(job.start_min)}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Date">
          <input type="date" className="input num" value={date} onChange={(e) => { setDate(e.target.value); setStartMin(null); }} />
        </Field>
        <Field label="Duration (min)">
          <input type="number" className="input num" step={15} min={15} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
        </Field>
      </div>
      <Field label="Time">
        <SlotPicker date={date} durationMin={duration} value={startMin} onChange={(m) => setStartMin(m)} excludeAppointmentId={job.id} />
      </Field>
      <Field label="Price">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-faint">$</span>
          <input type="number" className="input num pl-7" value={price} min={0} onChange={(e) => setPrice(e.target.value)} />
        </div>
      </Field>
      {hasEmail && (
        <label className="flex items-center gap-2.5 text-sm">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          Email the customer their confirmation
        </label>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button className="btn" onClick={onCancel}>
          Back
        </button>
        <button
          className="btn btn-primary"
          disabled={pending || startMin == null}
          onClick={() => startMin != null && onSubmit({ date, startMin, durationMin: duration, price: Number(price) }, notify)}
        >
          {pending ? "Confirming…" : "Approve & confirm"}
        </button>
      </div>
    </div>
  );
}

function ReschedulePanel({
  job,
  hasEmail,
  pending,
  onCancel,
  onSubmit,
}: {
  job: JobWithCustomer;
  hasEmail: boolean;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (next: { date: string; startMin: number; durationMin: number }, notify: boolean) => void;
}) {
  const [date, setDate] = useState(job.date);
  const [startMin, setStartMin] = useState<number | null>(null);
  const [duration, setDuration] = useState(job.duration_min);
  const [notify, setNotify] = useState(hasEmail);

  return (
    <div className="card p-4 flex flex-col gap-3 bg-surface">
      <p className="label">Reschedule — currently {fmtDateShort(job.date)} at {minToLabel(job.start_min)}</p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Date">
          <input type="date" className="input num" value={date} onChange={(e) => { setDate(e.target.value); setStartMin(null); }} />
        </Field>
        <Field label="Duration (min)">
          <input type="number" className="input num" step={15} min={15} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
        </Field>
      </div>
      <Field label="New time">
        <SlotPicker date={date} durationMin={duration} value={startMin} onChange={(m) => setStartMin(m)} excludeAppointmentId={job.id} />
      </Field>
      {hasEmail && (
        <label className="flex items-center gap-2.5 text-sm">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          Email the customer the new time
        </label>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button className="btn" onClick={onCancel}>
          Back
        </button>
        <button
          className="btn btn-primary"
          disabled={pending || startMin == null}
          onClick={() => startMin != null && onSubmit({ date, startMin, durationMin: duration }, notify)}
        >
          {pending ? "Saving…" : "Reschedule"}
        </button>
      </div>
    </div>
  );
}

function EditPanel({
  job,
  catalog,
  pending,
  onCancel,
  onSubmit,
}: {
  job: JobWithCustomer;
  catalog: Catalog;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (fields: Parameters<typeof updateAppointment>[1]) => void;
}) {
  const [sizeId, setSizeId] = useState<SizeId>((job.size_id as SizeId) || "sedan");
  const [addonIds, setAddonIds] = useState<string[]>(job.addons.map((a) => a.id));
  const [price, setPrice] = useState(String(job.price));
  const [address, setAddress] = useState(job.address ?? "");
  const [notes, setNotes] = useState(job.notes ?? "");

  return (
    <div className="card p-4 flex flex-col gap-3 bg-surface">
      <p className="label">Edit details</p>
      <Field label="Vehicle size">
        <select
          className="select"
          value={sizeId}
          onChange={(e) => {
            const next = e.target.value as SizeId;
            setSizeId(next);
            setPrice(String(computeQuote(catalog, next, addonIds).price));
          }}
        >
          {SIZES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Add-ons">
        <div className="flex flex-col gap-1">
          {catalog.addons.map((a) => (
            <label key={a.id} className="flex items-center gap-2.5 text-sm py-0.5">
              <input
                type="checkbox"
                checked={addonIds.includes(a.id)}
                onChange={(e) => {
                  const next = e.target.checked ? [...addonIds, a.id] : addonIds.filter((i) => i !== a.id);
                  setAddonIds(next);
                  setPrice(String(computeQuote(catalog, sizeId, next).price));
                }}
              />
              <span className="grow">{a.name}</span>
              <span className="text-xs text-faint num">{money(a.price)}</span>
            </label>
          ))}
        </div>
      </Field>
      <Field label="Price">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-faint">$</span>
          <input type="number" className="input num pl-7" value={price} min={0} onChange={(e) => setPrice(e.target.value)} />
        </div>
      </Field>
      <Field label="Address">
        <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
      </Field>
      <Field label="Notes">
        <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <button className="btn" onClick={onCancel}>
          Back
        </button>
        <button
          className="btn btn-primary"
          disabled={pending}
          onClick={() =>
            onSubmit({
              size_id: sizeId,
              size_label: sizeLabel(sizeId),
              addons: catalog.addons.filter((a) => addonIds.includes(a.id)).map(({ id, name, price }) => ({ id, name, price })),
              price: Number(price),
              duration_min: computeQuote(catalog, sizeId, addonIds).minutes,
              address: address || null,
              notes: notes || null,
            })
          }
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

function CancelPanel({
  hasEmail,
  decline = false,
  pending,
  onBack,
  onSubmit,
}: {
  hasEmail: boolean;
  decline?: boolean;
  pending: boolean;
  onBack: () => void;
  onSubmit: (notify: boolean) => void;
}) {
  const [notify, setNotify] = useState(hasEmail);
  return (
    <div className="card p-4 flex flex-col gap-3 bg-surface">
      <p className="text-sm">{decline ? "Decline this booking request?" : "Cancel this appointment?"}</p>
      {hasEmail && (
        <label className="flex items-center gap-2.5 text-sm">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          Send the cancellation email
        </label>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button className="btn" onClick={onBack}>
          Keep it
        </button>
        <button className="btn btn-danger" disabled={pending} onClick={() => onSubmit(notify)}>
          {pending ? (decline ? "Declining…" : "Cancelling…") : decline ? "Decline booking" : "Cancel appointment"}
        </button>
      </div>
    </div>
  );
}

function LinkPanel({
  job,
  pending,
  onCancel,
  onLink,
  onCreate,
}: {
  job: JobWithCustomer;
  pending: boolean;
  onCancel: () => void;
  onLink: (customerId: string) => void;
  onCreate: () => void;
}) {
  const [picked, setPicked] = useState<PickedCustomer | null>(null);
  const [suggestions, setSuggestions] = useState<Customer[]>([]);
  const supabase = createClient();

  useEffect(() => {
    (async () => {
      const digits = (job.contact_phone ?? "").replace(/\D/g, "").slice(-10);
      const parts: string[] = [];
      if (digits) parts.push(`phone.ilike.%${digits}%`);
      if (job.contact_email) parts.push(`email.ilike.${job.contact_email}`);
      if (!parts.length) return;
      const { data } = await supabase.from("customers").select("*").or(parts.join(",")).limit(3);
      setSuggestions((data as Customer[]) ?? []);
    })();
  }, [job.id, job.contact_phone, job.contact_email, supabase]);

  return (
    <div className="card p-4 flex flex-col gap-3 bg-surface">
      <p className="label">Link booking to a customer</p>
      {suggestions.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {suggestions.map((c) => (
            <button key={c.id} className="btn justify-between" disabled={pending} onClick={() => onLink(c.id)}>
              <span>{c.name}</span>
              <span className="text-xs text-faint num">{fmtPhone(c.phone) || c.email} — matches</span>
            </button>
          ))}
        </div>
      )}
      <CustomerPicker value={picked} onChange={setPicked} />
      {picked && (
        <button className="btn btn-primary" disabled={pending} onClick={() => onLink(picked.id)}>
          Link to {picked.name}
        </button>
      )}
      <button className="btn" disabled={pending || !job.contact_name} onClick={onCreate}>
        Create “{job.contact_name}” as a new customer
      </button>
      <button className="btn btn-ghost btn-sm" onClick={onCancel}>
        Back
      </button>
    </div>
  );
}
