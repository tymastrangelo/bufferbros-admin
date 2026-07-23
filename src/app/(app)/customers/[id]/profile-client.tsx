"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppointmentSheet } from "@/components/appointment-sheet";
import { IconMail, IconMessage, IconPhone, IconPin, IconPlus } from "@/components/icons";
import { JobSheet, type JobWithCustomer } from "@/components/job-sheet";
import { LedgerEntrySheet } from "@/components/ledger-entry-sheet";
import type { PickedCustomer } from "@/components/customer-picker";
import { Balance, ErrorNote, Field, Sheet, StatusChip } from "@/components/ui";
import { deleteVehicle, saveVehicle, setCustomerArchived, updateCustomer } from "@/lib/actions/customers";
import { cancelPaymentRequest, sendPaymentRequest } from "@/lib/actions/stripe";
import type { Catalog } from "@/lib/catalog";
import { fmtPhone, mapsHref, money, smsHref, telHref } from "@/lib/format";
import { fmtDateShort, minToLabel } from "@/lib/time";
import { SIZES, sizeLabel, type Customer, type EntryKind, type LedgerEntry, type PaymentRequest, type Plan, type SizeId, type Vehicle } from "@/lib/types";

type Tab = "overview" | "visits" | "ledger";

export function CustomerProfile({
  customer,
  vehicles,
  plans,
  appointments,
  ledger,
  catalog,
  today,
  paymentRequests,
}: {
  customer: Customer;
  vehicles: Vehicle[];
  plans: Plan[];
  appointments: JobWithCustomer[];
  ledger: LedgerEntry[];
  catalog: Catalog;
  today: string;
  paymentRequests: PaymentRequest[];
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [editOpen, setEditOpen] = useState(false);
  const [vehicleEdit, setVehicleEdit] = useState<Vehicle | "new" | null>(null);
  // Store the tapped job, render the fresh copy from server props so an open
  // sheet updates in place after any action refreshes the route.
  const [job, setJob] = useState<JobWithCustomer | null>(null);
  const openJob = job ? (appointments.find((a) => a.id === job.id) ?? job) : null;
  const [newAppt, setNewAppt] = useState(false);
  const [stripeSheet, setStripeSheet] = useState(false);
  const [ledgerSheet, setLedgerSheet] = useState<{ entry?: LedgerEntry; kind?: EntryKind } | null>(null);

  const balance = ledger.reduce((s, e) => s + e.amount, 0);
  const upcoming = appointments.filter((a) => a.status === "scheduled" && a.date >= today).reverse();
  const past = appointments.filter((a) => !(a.status === "scheduled" && a.date >= today));
  const picked: PickedCustomer = { ...customer, vehicles };

  return (
    <div className="px-4 md:px-8 py-5 md:py-7 max-w-4xl">
      <nav className="text-[13px] text-faint mb-2">
        <Link href="/customers" className="hover:text-ink">
          Customers
        </Link>{" "}
        / {customer.name}
      </nav>

      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2 flex-wrap">
            {customer.name}
            {customer.archived && <span className="chip bg-[#f1f4f9] text-faint">archived</span>}
          </h1>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {customer.tags.map((t) => (
              <span key={t} className="chip bg-[#f1f4f9] text-ink-2">
                {t}
              </span>
            ))}
            {balance !== 0 && <Balance amount={balance} />}
          </div>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <button className="btn btn-sm" onClick={() => setEditOpen(true)}>
            Edit
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setNewAppt(true)}>
            <IconPlus width={13} height={13} /> Book
          </button>
        </div>
      </header>

      {/* Contact actions */}
      <div className="mt-4 grid grid-cols-4 gap-1.5 max-w-sm">
        <ContactBtn href={customer.phone ? telHref(customer.phone) : null} icon={<IconPhone width={16} height={16} />} label="Call" />
        <ContactBtn href={customer.phone ? smsHref(customer.phone) : null} icon={<IconMessage width={16} height={16} />} label="Text" />
        <ContactBtn href={customer.email ? `mailto:${customer.email}` : null} icon={<IconMail width={16} height={16} />} label="Email" />
        <ContactBtn
          href={customer.addresses[0] ? mapsHref(customer.addresses[0].address) : null}
          icon={<IconPin width={16} height={16} />}
          label="Maps"
          newTab
        />
      </div>

      {/* Tabs */}
      <div className="mt-5 flex border-b border-line" role="tablist">
        {(["overview", "visits", "ledger"] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`px-3.5 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition-colors duration-150 ${
              tab === t ? "border-brand text-brand-deep" : "border-transparent text-faint hover:text-ink"
            }`}
          >
            {t}
            {t === "visits" && appointments.length > 0 && <span className="ml-1 text-faint num">{appointments.length}</span>}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="mt-4 flex flex-col gap-5">
          <section>
            <h2 className="label mb-1.5">Contact</h2>
            <div className="card divide-y divide-line text-sm">
              <Row k="Phone" v={fmtPhone(customer.phone) || "—"} mono />
              <Row k="Email" v={customer.email || "—"} />
              {customer.addresses.length === 0 && <Row k="Address" v="—" />}
              {customer.addresses.map((a, i) => (
                <Row key={i} k={a.label || "Address"} v={a.address} />
              ))}
              <Row k="Source" v={customer.source || "manual"} />
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between mb-1.5">
              <h2 className="label">Vehicles</h2>
              <button className="text-[13px] text-brand-deep font-medium" onClick={() => setVehicleEdit("new")}>
                + Add vehicle
              </button>
            </div>
            <div className="card divide-y divide-line">
              {vehicles.length === 0 && <p className="px-4 py-3 text-sm text-faint">No vehicles yet — size drives pricing.</p>}
              {vehicles.map((v) => (
                <button key={v.id} className="w-full text-left px-4 py-3 hover:bg-[#f8fafd] flex items-center justify-between gap-2" onClick={() => setVehicleEdit(v)}>
                  <div>
                    <p className="text-sm font-medium">
                      {[v.year, v.color, v.make, v.model].filter(Boolean).join(" ") || sizeLabel(v.size_id)}
                    </p>
                    <p className="text-xs text-faint">
                      {sizeLabel(v.size_id)}
                      {v.plate ? ` · ${v.plate}` : ""}
                    </p>
                  </div>
                  <span className="text-xs text-faint num">
                    {money(catalog.detail[v.size_id]?.price ?? 0)} · {catalog.detail[v.size_id]?.minutes ?? 0}m
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between mb-1.5">
              <h2 className="label">Plans</h2>
              <Link href={`/plans?new=1&customer=${customer.id}`} className="text-[13px] text-brand-deep font-medium">
                + New plan
              </Link>
            </div>
            <div className="card divide-y divide-line">
              {plans.length === 0 && <p className="px-4 py-3 text-sm text-faint">No recurring plan.</p>}
              {plans.map((p) => (
                <Link key={p.id} href={`/plans/${p.id}`} className="flex items-center justify-between gap-2 px-4 py-3 hover:bg-[#f8fafd]">
                  <div>
                    <p className="text-sm font-medium capitalize">
                      {p.cadence === "custom" ? `Every ${p.interval_days} days` : p.cadence} · {money(Number(p.per_visit_price))}/visit
                    </p>
                    {p.billing_note && <p className="text-xs text-warn">{p.billing_note}</p>}
                  </div>
                  <StatusChip status={p.status} />
                </Link>
              ))}
            </div>
          </section>

          {customer.notes && (
            <section>
              <h2 className="label mb-1.5">Notes</h2>
              <div className="card px-4 py-3 text-sm whitespace-pre-wrap">{customer.notes}</div>
            </section>
          )}

          <button
            className="btn btn-ghost btn-sm self-start text-faint"
            onClick={async () => {
              await setCustomerArchived(customer.id, !customer.archived);
              window.location.reload();
            }}
          >
            {customer.archived ? "Unarchive customer" : "Archive customer"}
          </button>
        </div>
      )}

      {tab === "visits" && (
        <div className="mt-4 flex flex-col gap-5">
          <VisitList title={`Upcoming — ${upcoming.length}`} jobs={upcoming} onOpen={setJob} empty="Nothing booked." />
          <VisitList title={`Past — ${past.length}`} jobs={past} onOpen={setJob} empty="No visits yet." />
        </div>
      )}

      {tab === "ledger" && (
        <div className="mt-4">
          <div className="flex flex-wrap gap-1.5 mb-3">
            <button className="btn btn-primary btn-sm" onClick={() => setLedgerSheet({ kind: "payment" })}>
              Record payment
            </button>
            <button className="btn btn-sm" onClick={() => setLedgerSheet({ kind: "credit" })}>
              Add credit
            </button>
            <button className="btn btn-sm" onClick={() => setLedgerSheet({ kind: "discount" })}>
              Discount
            </button>
            <button className="btn btn-sm" onClick={() => setStripeSheet(true)}>
              Email Stripe link
            </button>
            <span className="ml-auto self-center text-sm">
              Balance: <Balance amount={balance} />
            </span>
          </div>
          <PaymentRequestList requests={paymentRequests} />
          <div className="card overflow-x-auto">
            {ledger.length === 0 ? (
              <p className="px-4 py-8 text-sm text-faint text-center">
                Nothing on the books. Charges land here automatically when you complete a job.
              </p>
            ) : (
              <LedgerTable ledger={ledger} onEdit={(e) => setLedgerSheet({ entry: e })} />
            )}
          </div>
        </div>
      )}

      {/* Sheets */}
      {stripeSheet && (
        <StripeRequestSheet customer={customer} balance={balance} onClose={() => setStripeSheet(false)} />
      )}
      <EditCustomerSheet open={editOpen} onClose={() => setEditOpen(false)} customer={customer} />
      {vehicleEdit && (
        <VehicleSheet
          customerId={customer.id}
          vehicle={vehicleEdit === "new" ? null : vehicleEdit}
          onClose={() => setVehicleEdit(null)}
        />
      )}
      {openJob && <JobSheet job={openJob} onClose={() => setJob(null)} catalog={catalog} />}
      {newAppt && <AppointmentSheet open onClose={() => setNewAppt(false)} catalog={catalog} defaultCustomer={picked} />}
      {ledgerSheet && (
        <LedgerEntrySheet
          open
          onClose={() => setLedgerSheet(null)}
          customerId={customer.id}
          customerName={customer.name}
          entry={ledgerSheet.entry ?? null}
          defaultKind={ledgerSheet.kind ?? "payment"}
        />
      )}
    </div>
  );
}

function ContactBtn({ href, icon, label, newTab }: { href: string | null; icon: React.ReactNode; label: string; newTab?: boolean }) {
  return (
    <a
      href={href ?? undefined}
      target={newTab ? "_blank" : undefined}
      rel={newTab ? "noreferrer" : undefined}
      className={`btn flex-col h-14! gap-1 ${href ? "" : "pointer-events-none opacity-40"}`}
    >
      {icon}
      <span className="text-[11px]">{label}</span>
    </a>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex px-4 py-2.5 gap-3">
      <span className="label w-20 shrink-0 self-center">{k}</span>
      <span className={`text-sm ${mono ? "num" : ""}`}>{v}</span>
    </div>
  );
}

function VisitList({
  title,
  jobs,
  onOpen,
  empty,
}: {
  title: string;
  jobs: JobWithCustomer[];
  onOpen: (j: JobWithCustomer) => void;
  empty: string;
}) {
  return (
    <section>
      <h2 className="label mb-1.5">{title}</h2>
      <div className="card divide-y divide-line">
        {jobs.length === 0 && <p className="px-4 py-3 text-sm text-faint">{empty}</p>}
        {jobs.map((j) => (
          <button key={j.id} className="w-full text-left px-4 py-2.5 hover:bg-[#f8fafd] flex items-center gap-3" onClick={() => onOpen(j)}>
            <div className="min-w-0 grow">
              <p className="text-sm font-medium num">
                {fmtDateShort(j.date)} at {minToLabel(j.start_min)}
              </p>
              <p className="text-xs text-faint truncate">
                {j.size_label || j.service_name}
                {j.addons.length > 0 && ` +${j.addons.length}`}
                {j.plan_id && " · plan"}
              </p>
            </div>
            <span className="text-sm num font-medium shrink-0">{money(Number(j.price))}</span>
            <StatusChip status={j.status} />
          </button>
        ))}
      </div>
    </section>
  );
}

function LedgerTable({ ledger, onEdit }: { ledger: LedgerEntry[]; onEdit: (e: LedgerEntry) => void }) {
  // ledger is newest-first; compute running balance from the bottom up
  const totals: number[] = new Array(ledger.length);
  let run = 0;
  for (let i = ledger.length - 1; i >= 0; i--) {
    run += ledger[i].amount;
    totals[i] = run;
  }
  return (
    <table className="tbl tbl-link tbl-stack min-w-[480px]">
      <thead>
        <tr>
          <th>Date</th>
          <th>Entry</th>
          <th className="text-right">Amount</th>
          <th className="text-right">Balance</th>
        </tr>
      </thead>
      <tbody>
        {ledger.map((e, i) => (
          <tr key={e.id} onClick={() => onEdit(e)}>
            <td data-label="Date" className="num whitespace-nowrap">{fmtDateShort(e.occurred_on)}</td>
            <td data-label="Entry">
              <span className="capitalize font-medium">{e.kind}</span>
              {e.method && <span className="text-faint"> · {e.method}</span>}
              {e.memo && <span className="text-faint"> · {e.memo}</span>}
            </td>
            <td data-label="Amount" className={`num text-right ${e.amount < 0 ? "text-bad" : "text-ok"}`}>
              {e.amount < 0 ? "−" : "+"}
              {money(Math.abs(e.amount))}
            </td>
            <td data-label="Balance" className="num text-right text-ink-2">{money(totals[i])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const REQUEST_STATUS_TONE: Record<PaymentRequest["status"], string> = {
  pending: "bg-warn-wash text-warn",
  paid: "bg-ok-wash text-ok",
  canceled: "bg-[#f1f4f9] text-faint",
  expired: "bg-[#f1f4f9] text-faint",
};

function PaymentRequestList({ requests }: { requests: PaymentRequest[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const shown = requests.filter((r) => r.status === "pending" || r.status === "paid").slice(0, 6);
  if (shown.length === 0) return null;
  return (
    <div className="card mb-3 divide-y divide-line">
      <p className="label px-3.5 pt-2.5 pb-1.5">Stripe payment links</p>
      {shown.map((r) => (
        <div key={r.id} className="flex items-center gap-2.5 px-3.5 py-2 text-sm">
          <span className={`chip ${REQUEST_STATUS_TONE[r.status]}`}>{r.status}</span>
          <span className="num font-semibold">{money(r.amount)}</span>
          <span className="text-ink-2 truncate grow">
            {r.memo || (r.kind === "prepay" ? `${r.visits} visits prepaid` : r.kind)} · sent {fmtDateShort(r.created_at.slice(0, 10))}
          </span>
          {r.status === "pending" && r.url && (
            <button className="btn btn-sm" onClick={() => navigator.clipboard.writeText(r.url!)}>
              Copy link
            </button>
          )}
          {r.status === "pending" && (
            <button
              className="btn btn-sm btn-danger"
              disabled={busy === r.id}
              onClick={async () => {
                setBusy(r.id);
                await cancelPaymentRequest(r.id);
                setBusy(null);
                router.refresh();
              }}
            >
              Cancel
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function StripeRequestSheet({
  customer,
  balance,
  onClose,
}: {
  customer: Customer;
  balance: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState(balance < 0 ? String(-balance) : "");
  const [what, setWhat] = useState("Detailing services");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Sheet open onClose={onClose} title={`Stripe link — ${customer.name}`}>
      <div className="flex flex-col gap-4">
        {!customer.email && (
          <ErrorNote>No email on file — add one to the customer first.</ErrorNote>
        )}
        <p className="text-sm text-ink-2">
          Emails {customer.email ?? "them"} a secure Stripe checkout link. The payment books itself on the ledger when
          they pay, and you get a push.
        </p>
        <Field label="Amount" hint={balance < 0 ? `They currently owe ${money(-balance)}` : undefined}>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-faint">$</span>
            <input type="number" min={1} className="input num pl-7" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
        </Field>
        <Field label="What it's for" hint="Shows on the email and the Stripe checkout page">
          <input className="input" value={what} onChange={(e) => setWhat(e.target.value)} />
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <button
          className="btn btn-primary h-11"
          disabled={pending || !customer.email || !(Number(amount) > 0)}
          onClick={async () => {
            setError(null);
            setPending(true);
            const res = await sendPaymentRequest({
              customerId: customer.id,
              amount: Number(amount),
              kind: "balance",
              what: what.trim() || "Detailing services",
            });
            setPending(false);
            if (!res.ok) return setError(res.error);
            onClose();
            router.refresh();
          }}
        >
          {pending ? "Sending…" : `Email link for ${money(Number(amount) || 0)}`}
        </button>
      </div>
    </Sheet>
  );
}

function EditCustomerSheet({ open, onClose, customer }: { open: boolean; onClose: () => void; customer: Customer }) {
  const router = useRouter();
  const [name, setName] = useState(customer.name);
  const [phone, setPhone] = useState(customer.phone ?? "");
  const [email, setEmail] = useState(customer.email ?? "");
  const [addresses, setAddresses] = useState(customer.addresses.length ? customer.addresses : [{ label: "Home", address: "" }]);
  const [tags, setTags] = useState(customer.tags.join(", "));
  const [notes, setNotes] = useState(customer.notes ?? "");
  const [stripePay, setStripePay] = useState(customer.stripe_payments ?? false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!open) return null;
  return (
    <Sheet open onClose={onClose} title="Edit customer">
      <div className="flex flex-col gap-4">
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone">
            <input className="input num" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="Email">
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        </div>
        <Field label="Addresses">
          <div className="flex flex-col gap-2">
            {addresses.map((a, i) => (
              <div key={i} className="grid grid-cols-[88px_1fr] gap-2">
                <input
                  className="input"
                  value={a.label}
                  placeholder="Label"
                  onChange={(e) => setAddresses(addresses.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                />
                <input
                  className="input"
                  value={a.address}
                  placeholder="Street, city"
                  onChange={(e) => setAddresses(addresses.map((x, j) => (j === i ? { ...x, address: e.target.value } : x)))}
                />
              </div>
            ))}
            <button
              type="button"
              className="self-start text-[13px] text-brand-deep font-medium"
              onClick={() => setAddresses([...addresses, { label: "Work", address: "" }])}
            >
              + Add another address
            </button>
          </div>
        </Field>
        <Field label="Tags" hint="Comma-separated">
          <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
        <Field label="Notes">
          <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2.5 text-sm">
          <input type="checkbox" checked={stripePay} onChange={(e) => setStripePay(e.target.checked)} />
          <span>
            Pays through Stripe
            <span className="block text-[12px] text-faint">
              Completing their jobs defaults to “Email Stripe link” instead of collecting on site.
            </span>
          </span>
        </label>
        <ErrorNote>{error}</ErrorNote>
        <button
          className="btn btn-primary h-11"
          disabled={pending}
          onClick={async () => {
            setError(null);
            setPending(true);
            const res = await updateCustomer(customer.id, {
              name,
              phone,
              email,
              addresses,
              tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
              notes,
              stripePayments: stripePay,
            });
            setPending(false);
            if (!res.ok) return setError(res.error);
            onClose();
            router.refresh();
          }}
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </Sheet>
  );
}

function VehicleSheet({ customerId, vehicle, onClose }: { customerId: string; vehicle: Vehicle | null; onClose: () => void }) {
  const router = useRouter();
  const [sizeId, setSizeId] = useState<SizeId>(vehicle?.size_id ?? "sedan");
  const [make, setMake] = useState(vehicle?.make ?? "");
  const [model, setModel] = useState(vehicle?.model ?? "");
  const [year, setYear] = useState(vehicle?.year ? String(vehicle.year) : "");
  const [color, setColor] = useState(vehicle?.color ?? "");
  const [plate, setPlate] = useState(vehicle?.plate ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <Sheet open onClose={onClose} title={vehicle ? "Edit vehicle" : "Add vehicle"}>
      <div className="flex flex-col gap-4">
        <Field label="Size (drives pricing)">
          <select className="select" value={sizeId} onChange={(e) => setSizeId(e.target.value as SizeId)}>
            {SIZES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Make">
            <input className="input" value={make} onChange={(e) => setMake(e.target.value)} placeholder="Toyota" />
          </Field>
          <Field label="Model">
            <input className="input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="Tundra" />
          </Field>
          <Field label="Year">
            <input className="input num" type="number" value={year} onChange={(e) => setYear(e.target.value)} />
          </Field>
          <Field label="Color">
            <input className="input" value={color} onChange={(e) => setColor(e.target.value)} />
          </Field>
        </div>
        <Field label="Plate">
          <input className="input" value={plate} onChange={(e) => setPlate(e.target.value)} />
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <button
          className="btn btn-primary h-11"
          disabled={pending}
          onClick={async () => {
            setError(null);
            setPending(true);
            const res = await saveVehicle(
              customerId,
              { size_id: sizeId, make: make || null, model: model || null, year: year ? Number(year) : null, color: color || null, plate: plate || null },
              vehicle?.id
            );
            setPending(false);
            if (!res.ok) return setError(res.error);
            onClose();
            router.refresh();
          }}
        >
          {pending ? "Saving…" : "Save vehicle"}
        </button>
        {vehicle && (
          <button
            className="btn btn-danger"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              await deleteVehicle(vehicle.id);
              onClose();
              router.refresh();
            }}
          >
            Remove vehicle
          </button>
        )}
      </div>
    </Sheet>
  );
}
