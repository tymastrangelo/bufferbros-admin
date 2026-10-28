"use client";

// Everything you do to an existing job: complete (finalize price + take payment),
// reschedule, edit details, cancel, no-show, and linking web bookings to customers.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  adjustJobTimes,
  cancelAppointment,
  completeAppointment,
  createCustomerFromAppointment,
  linkAppointmentToCustomer,
  rescheduleAppointment,
  setAppointmentStatus,
  setAssignees,
  startAppointment,
  updateAppointment,
} from "@/lib/actions/appointments";
import { useOwner } from "@/lib/use-owner";
import { useToast } from "./toast";
import { Wheel } from "@/components/brand";
import { addonQuote, computeQuote, computeVehiclesQuote, type Catalog } from "@/lib/catalog";
import { fmtPhone, mapsHref, money, smsHref, telHref } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { fmtDateShort, minToLabel, whenLabel } from "@/lib/time";
import { setJobAttribution } from "@/lib/actions/appointments";
import { PAYMENT_METHODS, SIZES, sizeLabel, vehicleLabel, type Appointment, type Customer, type PaymentMethod, type SizeId, type Vehicle } from "@/lib/types";
import { IconMail, IconMessage, IconPhone, IconPin, IconPlay } from "./icons";
import { CustomerPicker, type PickedCustomer } from "./customer-picker";
import { WhoPicker, type EmployeeLite } from "./who-picker";
import { ChecklistSection, MoneySection, TimelineSection, VehiclesSection, WhereSection } from "./job-detail-sections";
import { JobPhotos } from "./job-photos";
import { checklistProgress } from "@/lib/checklist";
import { VehiclePicker } from "./vehicle-picker";
import { SlotPicker } from "./slot-picker";
import { Busy, ConfirmPanel, ErrorNote, Field, Sheet, StatusChip } from "./ui";

export type JobWithCustomer = Appointment & {
  customers: (Pick<Customer, "id" | "name" | "phone" | "email" | "stripe_payments"> & { site_notes?: string | null }) | null;
  /** The cars/boats on the visit (pages that select appointment_vehicles(vehicles(*))). */
  appointment_vehicles?: { vehicles: Vehicle | null }[];
  /** Who's on the job (scheduling side). Pages that don't select it fall back to employee_id. */
  appointment_employees?: { employee_id: string }[];
};

type Panel = "none" | "complete" | "reschedule" | "edit" | "cancel" | "link" | "times" | "who";


const fmtDur = (mins: number) => {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
};

const fmtClock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

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
  const owner = useOwner();
  const toast = useToast();
  const [panel, setPanel] = useState<Panel>("none");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Who-did-it chips (owner only; RLS gives washers just their own row anyway).
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [myEmployeeId, setMyEmployeeId] = useState<string | null>(null);
  useEffect(() => {
    if (owner) return;
    let stale = false;
    const db = createClient();
    db.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      db.from("employees").select("id").eq("user_id", user.id).maybeSingle().then(({ data }) => {
        if (!stale) setMyEmployeeId(data?.id ?? null);
      });
    });
    return () => {
      stale = true;
    };
  }, [owner]);
  useEffect(() => {
    if (!owner) return;
    let stale = false;
    createClient()
      .from("employees")
      .select("id,name,active")
      .order("created_at")
      .then(({ data }) => {
        if (!stale) setEmployees((data as EmployeeLite[]) ?? []);
      });
    return () => {
      stale = true;
    };
  }, [owner]);

  // Reset panels when a different job opens (state adjustment during render).
  const [prevJobId, setPrevJobId] = useState(job?.id);
  if (prevJobId !== job?.id) {
    setPrevJobId(job?.id);
    setPanel("none");
    setError(null);
  }

  if (!job) return null;

  const displayName = job.customers?.name ?? job.contact_name ?? "Unknown";
  const assigneeIds = job.appointment_employees?.map((a) => a.employee_id) ?? (job.employee_id ? [job.employee_id] : []);
  const vehicles = (job.appointment_vehicles ?? []).map((r) => r.vehicles).filter(Boolean) as Vehicle[];
  const phone = job.customers?.phone ?? job.contact_phone;
  const email = job.customers?.email ?? job.contact_email;
  const unlinked = !job.customer_id;

  /** Undo for cancel / no-show: back on the schedule, then re-render the route. */
  async function putBack(id: string) {
    const res = await setAppointmentStatus(id, "scheduled");
    if (res.ok) router.refresh();
    return res;
  }

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
            {assigneeIds
              .map((id) => employees.find((e) => e.id === id))
              .filter(Boolean)
              .map((e) => (
                <span key={e!.id} className="chip">
                  {e!.name}
                </span>
              ))}
            {owner && job.self_done && <span className="chip chip-ok">Your job — kept in full</span>}
            {job.plan_id && <span className="chip chip-brand">plan</span>}
            {job.source === "web" && <span className="chip">web booking</span>}
            {unlinked && <span className="chip chip-warn">not linked</span>}
          </div>
          <p className="mt-2 text-md font-semibold num">{whenLabel(job.date, job.start_min)}</p>
          <p className="text-sm text-ink-2">
            {job.service_name}
            {job.size_label ? ` · ${job.size_label}` : job.size_id ? ` · ${sizeLabel(job.size_id)}` : ""} · {job.duration_min} min ·{" "}
            <span className="num font-medium text-ink">{money(Number(job.price))}</span>
          </p>
          {job.addons.length > 0 && (
            <p className="text-sm text-ink-2 mt-0.5">+ {job.addons.map((a) => a.name).join(", ")}</p>
          )}
          {job.notes && <p className="mt-2 text-sm note note-warn">{job.notes}</p>}
          <div className="mt-2">
            <VehiclesSection vehicles={vehicles} sizeLabel={job.size_label ?? (job.size_id ? sizeLabel(job.size_id) : null)} />
          </div>
        </div>

        {/* Contact links */}
        <div className="grid grid-cols-4 gap-1.5">
          <a className={`btn btn-sm flex-col h-14! gap-1 text-ink-2 hover:text-brand-deep ${phone ? "" : "pointer-events-none opacity-40"}`} href={phone ? telHref(phone) : undefined}>
            <IconPhone width={16} height={16} />
            <span className="text-label">Call</span>
          </a>
          <a className={`btn btn-sm flex-col h-14! gap-1 text-ink-2 hover:text-brand-deep ${phone ? "" : "pointer-events-none opacity-40"}`} href={phone ? smsHref(phone) : undefined}>
            <IconMessage width={16} height={16} />
            <span className="text-label">Text</span>
          </a>
          <a
            className={`btn btn-sm flex-col h-14! gap-1 text-ink-2 hover:text-brand-deep ${job.address ? "" : "pointer-events-none opacity-40"}`}
            href={job.address ? mapsHref(job.address) : undefined}
            target="_blank"
            rel="noreferrer"
          >
            <IconPin width={16} height={16} />
            <span className="text-label">Maps</span>
          </a>
          <a className={`btn btn-sm flex-col h-14! gap-1 text-ink-2 hover:text-brand-deep ${email ? "" : "pointer-events-none opacity-40"}`} href={email ? `mailto:${email}` : undefined}>
            <IconMail width={16} height={16} />
            <span className="text-label">Email</span>
          </a>
        </div>
        {phone && <p className="text-dense text-ink-2 -mt-2 num">{fmtPhone(phone)}</p>}
        <WhereSection address={job.address} customerId={job.customer_id} siteNotes={job.customers?.site_notes ?? null} />

        {unlinked && panel !== "link" && (
          <button className="btn btn-sm self-start" onClick={() => setPanel("link")}>
            Link to a customer
          </button>
        )}
        {job.customers && (
          <Link href={`/customers/${job.customers.id}`} className="link text-dense self-start">
            Open customer profile
          </Link>
        )}

        <ChecklistSection appointmentId={job.id} items={job.checklist ?? []} readOnly={job.status === "cancelled"} />
        <div className="flex flex-col gap-1.5">
          <p className="label">Photos</p>
          <JobPhotos appointmentId={job.id} owner={owner} customerPhone={phone ?? null} />
        </div>
        {(owner || (myEmployeeId && job.employee_id === myEmployeeId)) && job.customer_id && (
          <div className="flex flex-col gap-1.5">
            <p className="label">Money</p>
            <MoneySection appointmentId={job.id} customerId={job.customer_id} price={Number(job.price)} />
          </div>
        )}
        <TimelineSection appointmentId={job.id} names={Object.fromEntries(employees.map((e) => [e.id, e.name]))} />

        <ErrorNote>{error}</ErrorNote>

        {/* Primary actions */}
        {job.status === "scheduled" && panel === "none" && (
          <div className="flex flex-col gap-2">
            {!job.started_at ? (
              // Workers punch in so Tyler sees real detail times; the boss doesn't clock himself.
              !owner && (
                <button className="btn h-11" disabled={pending} onClick={() => run(() => startAppointment(job.id))}>
                  <IconPlay width={14} height={14} weight="fill" /> Start job — starts the clock
                </button>
              )
            ) : (
              <p className="text-dense font-medium note note-ok">
                On the clock since <span className="num">{fmtClock(job.started_at)}</span>
              </p>
            )}
            <button className="btn btn-primary h-11" onClick={() => setPanel("complete")}>
              Complete job
            </button>
            <div className={`grid gap-2 ${owner ? "grid-cols-2" : "grid-cols-3"}`}>
              <button className="btn" onClick={() => setPanel("reschedule")}>
                Reschedule
              </button>
              <button className="btn" onClick={() => setPanel("edit")}>
                Edit
              </button>
              {owner && (
                <button className="btn" onClick={() => setPanel("who")}>
                  Assign
                </button>
              )}
              <button className="btn btn-danger" onClick={() => setPanel("cancel")}>
                Cancel…
              </button>
            </div>
            <button
              className="btn btn-ghost btn-sm self-center text-ink-2"
              disabled={pending}
              onClick={() =>
                run(() => setAppointmentStatus(job.id, "no_show")).then((ok) => {
                  if (!ok) return;
                  onClose();
                  toast({ title: `${displayName} marked no-show`, tone: "warn", undo: () => putBack(job.id) });
                })
              }
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
              Completed {job.completed_at ? `· charged ${money(Number(job.price))}` : ""}.
              {owner ? " Edit the job to change the price — the charge follows. Payments live on the customer's ledger." : ""}
            </p>
            {job.completed_at && (
              <p className="note text-dense num">
                {job.started_at ? (
                  <>
                    Took{" "}
                    <span className="font-semibold">
                      {fmtDur((new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()) / 60000)}
                    </span>{" "}
                    · {fmtClock(job.started_at)} → {fmtClock(job.completed_at)}
                  </>
                ) : (
                  <>Finished {fmtClock(job.completed_at)} · no start time recorded</>
                )}
              </p>
            )}
            {job.completion_note && (
              <p className="note text-sm">
                <span className="label block mb-0.5">Completion note</span>
                {job.completion_note}
              </p>
            )}
            {owner && (
              <>
                <p className="note text-dense">
                  <span className="label block mb-0.5">Done by</span>
                  {job.employee_id
                    ? employees.find((e) => e.id === job.employee_id)?.name ?? "a worker"
                    : job.self_done
                      ? "You — kept in full, no worker split"
                      : "You — split still applies"}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button className="btn btn-sm" onClick={() => setPanel("edit")}>
                    Edit
                  </button>
                  <button className="btn btn-sm" onClick={() => setPanel("who")}>
                    Who did it
                  </button>
                  <button className="btn btn-sm" onClick={() => setPanel("times")}>
                    Adjust times
                  </button>
                  <button
                    className="btn btn-sm"
                    disabled={pending}
                    onClick={() => run(() => setAppointmentStatus(job.id, "scheduled"))}
                  >
                    Mark incomplete
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {panel === "complete" && (
          <CompletePanel
            job={job}
            owner={owner}
            employees={employees}
            pending={pending}
            onCancel={() => setPanel("none")}
            onSubmit={(finalPrice, payment, note, stripeLink, keepAll, employeeId) =>
              run(() => completeAppointment(job.id, finalPrice, payment, note, stripeLink, keepAll, employeeId)).then((ok) => ok && onClose())
            }
          />
        )}
        {panel === "who" && job.status === "completed" && (
          <WhoPanel
            job={job}
            employees={employees}
            pending={pending}
            onCancel={() => setPanel("none")}
            onSubmit={(employeeId, keepAll) =>
              run(() => setJobAttribution(job.id, employeeId, keepAll)).then((ok) => ok && setPanel("none"))
            }
          />
        )}
        {panel === "who" && job.status !== "completed" && (
          <AssignPanel
            initial={assigneeIds}
            employees={employees}
            pending={pending}
            onCancel={() => setPanel("none")}
            onSubmit={(ids) => run(() => setAssignees(job.id, ids)).then((ok) => ok && setPanel("none"))}
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
            onSubmit={(fields, vehicleIds) =>
              run(() => updateAppointment(job.id, fields, vehicleIds)).then((ok) => ok && setPanel("none"))
            }
          />
        )}
        {panel === "cancel" && (
          <CancelPanel
            hasEmail={!!email}
            pending={pending}
            onBack={() => setPanel("none")}
            onSubmit={(notify) =>
              run(() => cancelAppointment(job.id, notify)).then((ok) => {
                if (!ok) return;
                onClose();
                toast({ title: `${displayName}'s job cancelled`, detail: whenLabel(job.date, job.start_min), undo: () => putBack(job.id) });
              })
            }
          />
        )}
        {panel === "times" && (
          <TimesPanel
            job={job}
            pending={pending}
            onCancel={() => setPanel("none")}
            onSubmit={(times) => run(() => adjustJobTimes(job.id, times)).then((ok) => ok && setPanel("none"))}
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

type PayMode = "now" | "stripe" | "balance";

function CompletePanel({
  job,
  owner,
  employees,
  pending,
  onCancel,
  onSubmit,
}: {
  job: JobWithCustomer;
  owner: boolean;
  employees: EmployeeLite[];
  pending: boolean;
  onCancel: () => void;
  onSubmit: (
    finalPrice: number,
    payment: { amount: number; method: PaymentMethod; memo?: string; tip?: number } | null,
    note: string,
    stripeLink: boolean,
    keepAll: boolean,
    employeeId: string | null
  ) => void;
}) {
  const email = job.customers?.email ?? null;
  const canStripe = !!job.customer_id && !!email;
  // undefined = untouched: default to the job's assignee, else the first active worker.
  const [who, setWho] = useState<{ employeeId: string | null; keepAll: boolean } | undefined>(undefined);
  const employeeId = who ? who.employeeId : job.employee_id ?? employees.find((e) => e.active)?.id ?? null;
  const keepAll = who ? who.keepAll : job.self_done || (!job.employee_id && !employees.some((e) => e.active));
  const [finalPrice, setFinalPrice] = useState(String(job.price));
  const [payMode, setPayMode] = useState<PayMode>(() => {
    if (!job.customer_id) return "balance";
    if (canStripe && job.customers?.stripe_payments) return "stripe"; // their usual way
    return job.plan_id ? "balance" : "now";
  });
  const [amount, setAmount] = useState(String(job.price));
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [memo, setMemo] = useState("");
  const [tip, setTip] = useState("");
  const [note, setNote] = useState("");
  const todo = checklistProgress(job.checklist ?? []);

  const MODES: { id: PayMode; label: string; disabled?: boolean }[] = [
    { id: "now", label: "Collected now" },
    { id: "stripe", label: "Email Stripe link", disabled: !canStripe },
    { id: "balance", label: "On balance" },
  ];

  return (
    <div className="well p-4 flex flex-col gap-3">
      <p className="label">Finalize job</p>
      {todo.total > 0 && todo.done < todo.total && (
        <p className="note note-warn text-dense">
          {todo.total - todo.done} of {todo.total} checklist items not ticked — fine if they were done, just saying.
        </p>
      )}
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
              if (payMode === "now") setAmount(e.target.value);
            }}
          />
        </div>
      </Field>
      {job.customer_id ? (
        <>
          <Field label="How are they paying?">
            <div className="grid grid-cols-3 gap-1.5">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  disabled={m.disabled}
                  onClick={() => setPayMode(m.id)}
                  className={`choice min-h-9 px-1 py-1.5 text-xs leading-tight ${m.disabled ? "opacity-40 pointer-events-none" : ""}`} aria-pressed={payMode === m.id}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </Field>
          {payMode === "now" && (
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
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-faint">$</span>
                <input type="number" inputMode="decimal" min={0} className="input num pl-7" placeholder="Tip" value={tip} onChange={(e) => setTip(e.target.value)} aria-label="Tip" />
              </div>
              <input className="input" placeholder="Memo" value={memo} onChange={(e) => setMemo(e.target.value)} aria-label="Memo" />
              <p className="col-span-2 text-xs text-faint -mt-1">
                Money already in hand — cash, Zelle, or a card you ran yourself.
              </p>
            </div>
          )}
          {payMode === "stripe" && (
            <p className="text-dense text-ink-2 -mt-1">
              Emails <span className="font-medium num">{email}</span> a secure payment link for the final price. The
              ledger updates itself when they pay, and Tyler gets a push.
            </p>
          )}
          {payMode === "balance" && (
            <p className="text-dense text-ink-2 -mt-1">
              The charge goes on the ledger; the balance shows what they owe. No email goes out.
            </p>
          )}
        </>
      ) : (
        <p className="text-dense note note-warn">
          Not linked to a customer — completing won&apos;t touch any ledger. Link first to track the money.
        </p>
      )}
      {owner && <WhoPicker employees={employees} value={employeeId} keepAll={keepAll} onChange={(e, k) => setWho({ employeeId: e, keepAll: k })} />}
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
              payMode === "now" && job.customer_id ? { amount: Number(amount), method, memo, tip: Number(tip) || 0 } : null,
              note.trim(),
              payMode === "stripe",
              keepAll,
              employeeId
            )
          }
        >
          {pending ? (
            <>
              <Wheel size={16} /> Saving…
            </>
          ) : payMode === "now" && job.customer_id ? (
            `Complete + ${money(Number(amount || 0))}`
          ) : payMode === "stripe" ? (
            "Complete + email link"
          ) : (
            "Complete"
          )}
        </button>
      </div>
    </div>
  );
}

// ponytail: datetime-local in the browser's timezone — Tyler and the business are both
// Eastern; skip the Intl round-trip a multi-timezone shop would need.
const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * Owner-only: fix who did any detail — past ones included. Saving re-splits every
 * payment on the job (the DB trigger rebuilds the payout rows).
 */
/** Scheduled jobs: who's on it (scheduling). Pick several for a two-person detail; none = Me. */
function AssignPanel({
  initial,
  employees,
  pending,
  onCancel,
  onSubmit,
}: {
  initial: string[];
  employees: EmployeeLite[];
  pending: boolean;
  onCancel: () => void;
  onSubmit: (employeeIds: string[]) => void;
}) {
  const [ids, setIds] = useState<string[]>(initial);
  const options = employees.filter((e) => e.active || ids.includes(e.id));
  return (
    <div className="well p-4 flex flex-col gap-3">
      <Field label="Who's on this job?" hint="Their calendar picks it up. Pick more than one for a two-person detail; Me frees everyone.">
        <div className="grid grid-cols-3 gap-1.5">
          <button type="button" onClick={() => setIds([])} className="choice min-h-9 px-1 py-1.5 text-dense" aria-pressed={ids.length === 0}>
            Me
          </button>
          {options.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => setIds((cur) => (cur.includes(e.id) ? cur.filter((i) => i !== e.id) : [...cur, e.id]))}
              className="choice min-h-9 px-1 py-1.5 text-dense"
              aria-pressed={ids.includes(e.id)}
            >
              {e.name}
            </button>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <button className="btn" onClick={onCancel}>
          Back
        </button>
        <button className="btn btn-primary" disabled={pending} onClick={() => onSubmit(ids)}>
          {pending ? <Busy>Saving…</Busy> : "Save"}
        </button>
      </div>
    </div>
  );
}

function WhoPanel({
  job,
  employees,
  pending,
  onCancel,
  onSubmit,
}: {
  job: JobWithCustomer;
  employees: EmployeeLite[];
  pending: boolean;
  onCancel: () => void;
  onSubmit: (employeeId: string | null, keepAll: boolean) => void;
}) {
  const [employeeId, setEmployeeId] = useState<string | null>(job.employee_id);
  const [keepAll, setKeepAll] = useState(job.self_done);
  return (
    <div className="well p-4 flex flex-col gap-3">
      <WhoPicker
        employees={employees}
        value={employeeId}
        keepAll={keepAll}
        label={job.status === "completed" ? "Who did this detail?" : "Who's doing this detail?"}
        onChange={(e, k) => {
          setEmployeeId(e);
          setKeepAll(k);
        }}
      />
      <p className="text-xs text-faint -mt-1">
        {job.status === "completed"
          ? "Changing this re-splits any payments already recorded on this job."
          : "Their calendar picks up the job; picking Me frees the worker's time."}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <button className="btn" onClick={onCancel}>
          Back
        </button>
        <button className="btn btn-primary" disabled={pending} onClick={() => onSubmit(employeeId, keepAll)}>
          {pending ? <Busy>Saving…</Busy> : "Save"}
        </button>
      </div>
    </div>
  );
}

/** Owner-only: correct the recorded start/finish times on a completed job. */
function TimesPanel({
  job,
  pending,
  onCancel,
  onSubmit,
}: {
  job: JobWithCustomer;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (times: { startedAt: string | null; completedAt: string }) => void;
}) {
  const [started, setStarted] = useState(toLocalInput(job.started_at));
  const [completed, setCompleted] = useState(toLocalInput(job.completed_at));

  return (
    <div className="well p-4 flex flex-col gap-3">
      <p className="label">Adjust job times</p>
      <Field label="Started (blank = not recorded)">
        <input type="datetime-local" className="input num" value={started} onChange={(e) => setStarted(e.target.value)} />
      </Field>
      <Field label="Completed">
        <input type="datetime-local" className="input num" value={completed} onChange={(e) => setCompleted(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <button className="btn" onClick={onCancel}>
          Back
        </button>
        <button
          className="btn btn-primary"
          disabled={pending || !completed}
          onClick={() =>
            onSubmit({
              startedAt: started ? new Date(started).toISOString() : null,
              completedAt: new Date(completed).toISOString(),
            })
          }
        >
          {pending ? <Busy>Saving…</Busy> : "Save times"}
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
    <div className="well p-4 flex flex-col gap-3">
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
        <SlotPicker
          date={date}
          durationMin={duration}
          value={startMin}
          onChange={(m) => setStartMin(m)}
          excludeAppointmentId={job.id}
          employeeIds={job.employee_id ? [job.employee_id] : []}
        />
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
          {pending ? <Busy>Saving…</Busy> : "Reschedule"}
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
  onSubmit: (fields: Parameters<typeof updateAppointment>[1], vehicleIds?: string[]) => void;
}) {
  const [sizeId, setSizeId] = useState<SizeId>((job.size_id as SizeId) || "sedan");
  const [addonIds, setAddonIds] = useState<string[]>(job.addons.map((a) => a.id));
  const [price, setPrice] = useState(String(job.price));
  const [address, setAddress] = useState(job.address ?? "");
  const [notes, setNotes] = useState(job.notes ?? "");
  // Linked customer: edit which of their cars this visit covers.
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleIds, setVehicleIds] = useState<string[]>([]);
  const [vehiclesLoaded, setVehiclesLoaded] = useState(false);
  // Recompute against the right base service (a ceramic job re-quotes as ceramic).
  const service = catalog.ceramic && job.service_name === catalog.ceramic.name ? ("ceramic" as const) : ("standard" as const);

  useEffect(() => {
    if (!job.customer_id) return;
    let stale = false;
    (async () => {
      const db = createClient();
      const [vQ, avQ] = await Promise.all([
        db.from("vehicles").select("*").eq("customer_id", job.customer_id),
        db.from("appointment_vehicles").select("vehicle_id").eq("appointment_id", job.id),
      ]);
      if (stale) return;
      setVehicles((vQ.data as Vehicle[]) ?? []);
      setVehicleIds(((avQ.data ?? []) as { vehicle_id: string }[]).map((r) => r.vehicle_id));
      setVehiclesLoaded(true);
    })();
    return () => {
      stale = true;
    };
  }, [job.id, job.customer_id]);

  const selVehicles = vehicles.filter((v) => vehicleIds.includes(v.id));
  const selCars = selVehicles.filter((v) => v.kind !== "boat");
  const requote = (ids: string[], addons: string[]) => {
    const sel = vehicles.filter((v) => ids.includes(v.id));
    return sel.length
      ? computeVehiclesQuote(catalog, sel, addons, service)
      : computeQuote(catalog, sizeId, addons, service);
  };
  // Add-ons are car things — boats don't take them.
  const addonPrice = (a: Catalog["addons"][number]) =>
    selVehicles.length
      ? selCars.reduce((s, v) => s + addonQuote(a, v.size_id).price, 0)
      : addonQuote(a, sizeId).price;

  return (
    <div className="well p-4 flex flex-col gap-3">
      <p className="label">Edit details</p>
      {job.customer_id && vehiclesLoaded && (
        <Field label={`Vehicles${selVehicles.length > 1 ? ` — ${selVehicles.length} cars this visit` : ""}`}>
          <VehiclePicker
            customerId={job.customer_id}
            vehicles={vehicles}
            selected={vehicleIds}
            onChange={(ids) => {
              setVehicleIds(ids);
              setPrice(String(requote(ids, addonIds).price));
            }}
            onVehiclesChange={setVehicles}
          />
        </Field>
      )}
      {selVehicles.length === 0 && (
        <Field label="Vehicle size">
          <select
            className="select"
            value={sizeId}
            onChange={(e) => {
              const next = e.target.value as SizeId;
              setSizeId(next);
              setPrice(String(computeQuote(catalog, next, addonIds, service).price));
            }}
          >
            {SIZES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
      )}
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
                  setPrice(String(requote(vehicleIds, next).price));
                }}
              />
              <span className="grow">{a.name}</span>
              <span className="text-xs text-faint num">{money(addonPrice(a))}</span>
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
            onSubmit(
              {
                size_id: selVehicles.length > 1 ? null : selVehicles[0]?.size_id ?? sizeId,
                size_label: selVehicles.length ? selVehicles.map(vehicleLabel).join(" + ") : sizeLabel(sizeId),
                addons: catalog.addons
                  .filter((a) => addonIds.includes(a.id))
                  .map((a) => ({ id: a.id, name: a.name, price: addonPrice(a) })),
                price: Number(price),
                duration_min: requote(vehicleIds, addonIds).minutes,
                address: address || null,
                notes: notes || null,
              },
              vehiclesLoaded ? vehicleIds : undefined
            )
          }
        >
          {pending ? <Busy>Saving…</Busy> : "Save changes"}
        </button>
      </div>
    </div>
  );
}

function CancelPanel({
  hasEmail,
  pending,
  onBack,
  onSubmit,
}: {
  hasEmail: boolean;
  pending: boolean;
  onBack: () => void;
  onSubmit: (notify: boolean) => void;
}) {
  const [notify, setNotify] = useState(hasEmail);
  return (
    <ConfirmPanel
      title="Cancel this job?"
      consequence="The slot opens back up. You can put it back on the schedule from this sheet."
      confirmLabel="Cancel job"
      busyLabel="Cancelling…"
      cancelLabel="Keep it"
      destructive
      pending={pending}
      onCancel={onBack}
      onConfirm={() => onSubmit(notify)}
    >
      {hasEmail && (
        <label className="flex items-center gap-2.5 text-sm">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          Send the cancellation email
        </label>
      )}
    </ConfirmPanel>
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
    <div className="well p-4 flex flex-col gap-3">
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
