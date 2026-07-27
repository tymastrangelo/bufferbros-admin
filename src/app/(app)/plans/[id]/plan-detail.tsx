"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { JobSheet, type JobWithCustomer } from "@/components/job-sheet";
import { PlanFormSheet } from "@/components/plan-form";
import { ScheduleSheet } from "@/components/schedule-sheet";
import { Balance, ErrorNote, Sheet, StatusChip } from "@/components/ui";
import { recordPlanPrepay, resumePlan, setPlanStatus } from "@/lib/actions/plans";
import { sendPaymentRequest } from "@/lib/actions/stripe";
import { initialDetailPrice, visitsPerQuarter, type Catalog } from "@/lib/catalog";
import { money } from "@/lib/format";
import { stepDays } from "@/lib/plan-projection";
import { addDays, diffDays, fmtDateShort, minToLabel, todayYmd, WEEKDAYS } from "@/lib/time";
import { PAYMENT_METHODS, vehicleLabel, type Customer, type LedgerEntry, type PaymentMethod, type Plan, type SizeId, type Vehicle } from "@/lib/types";
import type { OccurrenceConflict } from "@/lib/occurrences";

const LIST_CAP = 6; // rows shown inline before "Show all" takes over

export function PlanDetail({
  plan,
  appointments,
  ledger,
  catalog,
  today,
  hasInitialDetail,
  vehicleSize,
  vehicles,
}: {
  plan: Plan & { customers: Customer };
  appointments: JobWithCustomer[];
  ledger: LedgerEntry[];
  catalog: Catalog;
  today: string;
  /** does this customer have any completed job on record yet? */
  hasInitialDetail: boolean;
  vehicleSize: SizeId;
  /** which cars each visit covers */
  vehicles: Vehicle[];
}) {
  const router = useRouter();
  // Store the tapped job, render the fresh copy from server props so an open
  // sheet updates in place after any action refreshes the route.
  const [job, setJob] = useState<JobWithCustomer | null>(null);
  const openJob = job ? (appointments.find((a) => a.id === job.id) ?? job) : null;
  const [editOpen, setEditOpen] = useState(false);
  const [prepayOpen, setPrepayOpen] = useState(false);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [showAll, setShowAll] = useState<{ title: string; jobs: JobWithCustomer[] } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<OccurrenceConflict[]>([]);
  const [genMsg, setGenMsg] = useState<string | null>(null);

  const completed = appointments.filter((a) => a.status === "completed");
  const upcoming = appointments.filter((a) => a.status === "scheduled" && a.date >= today).reverse();
  const history = appointments.filter((a) => !(a.status === "scheduled" && a.date >= today));
  const revenue = ledger
    .filter((e) => e.plan_id === plan.id && e.kind === "charge")
    .reduce((s, e) => s + Math.abs(e.amount), 0);
  const balance = ledger.reduce((s, e) => s + e.amount, 0);
  const visitsLeft = balance > 0 && plan.per_visit_price > 0 ? Math.floor(balance / plan.per_visit_price) : 0;

  // "Set it in stone" preset: materialize exactly what their credit covers.
  // ponytail: through-date = last scheduled + remaining × step (capped at the action's
  // 18-month guard) — conflicts may land a visit or two short; the sheet reports them.
  const remainingPrepaid = visitsLeft - upcoming.length;
  const prepaidPreset =
    remainingPrepaid > 0
      ? (() => {
          const raw = addDays(upcoming[upcoming.length - 1]?.date ?? today, remainingPrepaid * stepDays(plan));
          const cap = addDays(today, 550);
          return [{ label: `Prepaid — ${visitsLeft} visit${visitsLeft === 1 ? "" : "s"}`, ymd: raw < cap ? raw : cap }];
        })()
      : undefined;

  async function act(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    setPending(true);
    const res = await fn();
    setPending(false);
    if (!res.ok) setError(res.error ?? "Something went wrong.");
    else router.refresh();
  }

  return (
    <div className="px-4 md:px-8 py-5 md:py-7 max-w-4xl">
      <nav className="text-[13px] text-faint mb-2">
        <Link href="/plans" className="hover:text-ink">
          Plans
        </Link>{" "}
        / {plan.customers.name}
      </nav>

      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
            <Link href={`/customers/${plan.customer_id}`} className="hover:underline underline-offset-2">
              {plan.customers.name}
            </Link>
            <StatusChip status={plan.status} />
          </h1>
          <p className="text-sm text-ink-2 mt-1 capitalize">
            {plan.cadence === "custom" ? `Every ${plan.interval_days} days` : plan.cadence} ·{" "}
            <span className="num">{money(plan.per_visit_price)}</span>/visit · {plan.duration_min} min
            {plan.preferred_dow != null && ` · ${WEEKDAYS[plan.preferred_dow]}s`}
            {plan.preferred_min != null && ` at ${minToLabel(plan.preferred_min)}`}
          </p>
          {vehicles.length > 0 && (
            <p className="text-sm text-ink-2 mt-0.5">
              {vehicles.length > 1 ? `${vehicles.length} cars per visit: ` : ""}
              {vehicles.map(vehicleLabel).join(" · ")}
            </p>
          )}
          {plan.billing_note && <p className="text-sm text-warn mt-0.5">{plan.billing_note}</p>}
        </div>
        <div className="flex gap-1.5 shrink-0">
          <button className="btn btn-sm" onClick={() => setEditOpen(true)}>
            Edit
          </button>
          {plan.status === "active" && plan.per_visit_price > 0 && (
            <button className="btn btn-sm" onClick={() => setPrepayOpen(true)}>
              Record prepay…
            </button>
          )}
          {plan.status === "active" && (
            <button className="btn btn-primary btn-sm" onClick={() => setScheduleOpen(true)}>
              Schedule visits…
            </button>
          )}
        </div>
      </header>

      {!hasInitialDetail && plan.status === "active" && !plan.skip_entry && (
        <div className="mt-3 rounded-md border border-[#fde68a] bg-warn-wash px-4 py-3 text-sm">
          <p className="font-medium text-warn">No completed detail on record yet.</p>
          <p className="text-warn mt-0.5">
            New maintenance clients start with a full Standard Detail at {catalog.rules.planInitialDiscountPct}% off (
            <span className="num">{money(initialDetailPrice(catalog, vehicleSize))}</span> for their size) to get the car to
            maintenance shape — book it as a one-time job before the plan visits start.
          </p>
        </div>
      )}

      {/* Economics */}
      <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-px bg-line border border-line rounded-[10px] overflow-hidden">
        <Econ label="Visits completed" value={String(completed.length)} />
        <Econ label="Revenue to date" value={money(revenue)} />
        <Econ label="Customer balance" value={<Balance amount={balance} />} />
        <Econ
          label="Credit covers"
          value={balance > 0 ? `${visitsLeft} more visit${visitsLeft === 1 ? "" : "s"}` : "—"}
        />
      </div>

      <ErrorNote>{error}</ErrorNote>
      {genMsg && <p className="mt-3 text-sm text-ok">{genMsg}</p>}
      {conflicts.length > 0 && (
        <div className="mt-3 rounded-md border border-[#fde68a] bg-warn-wash px-4 py-3">
          <p className="text-sm font-medium text-warn">Needs manual placement:</p>
          <ul className="mt-1 text-sm text-warn max-h-40 overflow-y-auto">
            {conflicts.map((c) => (
              <li key={c.date} className="num">
                {fmtDateShort(c.date)} — {c.reason}
              </li>
            ))}
          </ul>
          <Link href={`/calendar?view=week&d=${conflicts[0].date}`} className="text-sm font-semibold text-warn underline underline-offset-2">
            Open calendar to place them →
          </Link>
        </div>
      )}

      {/* Status actions */}
      <div className="mt-4 flex gap-1.5">
        {plan.status === "active" && (
          <>
            <button className="btn btn-sm" disabled={pending} onClick={() => act(() => setPlanStatus(plan.id, "paused"))}>
              Pause plan
            </button>
            <button className="btn btn-sm btn-danger" disabled={pending} onClick={() => act(() => setPlanStatus(plan.id, "ended"))}>
              End plan
            </button>
          </>
        )}
        {plan.status === "paused" && (
          <>
            <button className="btn btn-sm btn-primary" disabled={pending} onClick={() => setResumeOpen(true)}>
              Resume plan…
            </button>
            <button className="btn btn-sm btn-danger" disabled={pending} onClick={() => act(() => setPlanStatus(plan.id, "ended"))}>
              End plan
            </button>
          </>
        )}
        {plan.status === "ended" && (
          <button className="btn btn-sm" disabled={pending} onClick={() => setResumeOpen(true)}>
            Reactivate…
          </button>
        )}
      </div>
      {plan.status === "active" && (
        <p className="mt-1.5 text-[12px] text-faint">
          Pausing takes every upcoming visit off the calendar but keeps the plan (and its rate) on file — for
          snowbirds and season breaks. Ending does the same, permanently.
        </p>
      )}

      {/* Visits */}
      <VisitSection
        title={`Upcoming — ${upcoming.length}`}
        jobs={upcoming}
        empty={plan.status === "active" ? "Nothing scheduled — hit “Schedule visits.”" : "Plan is not active."}
        onOpen={setJob}
        onShowAll={() => setShowAll({ title: `All upcoming — ${upcoming.length}`, jobs: upcoming })}
      />
      <VisitSection
        title={`History — ${completed.length} completed`}
        jobs={history}
        empty="No visits yet."
        onOpen={setJob}
        onShowAll={() => setShowAll({ title: `Full history — ${history.length}`, jobs: history })}
      />

      {openJob && <JobSheet job={openJob} onClose={() => setJob(null)} catalog={catalog} />}
      {resumeOpen && (
        <ResumeSheet
          plan={plan}
          catalog={catalog}
          vehicles={vehicles}
          vehicleSize={vehicleSize}
          lastVisit={completed[0]?.date ?? null}
          onClose={() => setResumeOpen(false)}
          onDone={(msg, confl) => {
            setResumeOpen(false);
            setGenMsg(msg);
            setConflicts(confl);
            router.refresh();
          }}
        />
      )}
      {prepayOpen && (
        <PrepaySheet
          plan={plan}
          catalog={catalog}
          today={today}
          onClose={() => setPrepayOpen(false)}
          onDone={() => {
            setPrepayOpen(false);
            router.refresh();
          }}
        />
      )}
      {editOpen && (
        <PlanFormSheet
          open
          onClose={() => setEditOpen(false)}
          catalog={catalog}
          plan={plan}
          upcomingCount={upcoming.length}
        />
      )}
      <ScheduleSheet
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        today={today}
        planId={plan.id}
        scopeLabel={`${plan.customers.name}'s plan`}
        presets={prepaidPreset}
        onDone={(result) => {
          setConflicts(result.conflicts);
          setGenMsg(`Scheduled ${result.created} visit${result.created === 1 ? "" : "s"}.`);
          router.refresh();
        }}
      />
      {showAll && (
        <Sheet open onClose={() => setShowAll(null)} title={showAll.title}>
          <div className="divide-y divide-line -mx-1">
            {showAll.jobs.map((s) => appointments.find((a) => a.id === s.id) ?? s).map((j) => (
              <VisitRow
                key={j.id}
                j={j}
                onOpen={() => {
                  setShowAll(null);
                  setJob(j);
                }}
              />
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}

/**
 * Seasonal comeback: resume the plan straight at the maintenance rate, or make the
 * first visit back a full re-entry detail. Recommends based on how long they've
 * been gone relative to their cadence — a car that missed a season needs the works.
 */
function ResumeSheet({
  plan,
  catalog,
  vehicles,
  vehicleSize,
  lastVisit,
  onClose,
  onDone,
}: {
  plan: Plan & { customers: Customer };
  catalog: Catalog;
  vehicles: Vehicle[];
  vehicleSize: SizeId;
  lastVisit: string | null;
  onClose: () => void;
  onDone: (msg: string, conflicts: OccurrenceConflict[]) => void;
}) {
  const [pending, setPending] = useState<"entry" | "maintenance" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cars = vehicles.filter((v) => v.kind !== "boat");
  const sizes: SizeId[] = cars.length ? cars.map((v) => v.size_id) : [vehicleSize];
  const entryPrice = sizes.reduce((s, size) => s + initialDetailPrice(catalog, size), 0);

  const step =
    plan.cadence === "weekly" ? 7 : plan.cadence === "biweekly" ? 14 : plan.cadence === "monthly" ? 28 : plan.interval_days ?? 28;
  const gapDays = lastVisit ? diffDays(lastVisit, todayYmd()) : null;
  // Gone for 3+ cycles (or 6+ weeks, whichever is longer) = the car has lost its
  // maintenance shape; recommend starting over with the full detail.
  const recommendEntry = gapDays == null || gapDays > Math.max(45, step * 3);

  async function go(mode: "entry" | "maintenance") {
    setError(null);
    setPending(mode);
    const res = await resumePlan(plan.id, mode);
    setPending(null);
    if (!res.ok) return setError(res.error);
    const scheduled = `Scheduled ${res.result.created} visit${res.result.created === 1 ? "" : "s"}.`;
    const msg =
      mode === "entry" && res.entry
        ? res.entry.date
          ? `Plan resumed — first visit back on ${fmtDateShort(res.entry.date)} is the re-entry detail at ${money(res.entry.price)}, maintenance after that. ${scheduled}`
          : `Plan resumed, but every date needs manual placement — book the re-entry detail by hand at ${money(res.entry.price)}. ${scheduled}`
        : `Plan resumed at the maintenance rate. ${scheduled}`;
    onDone(msg, res.result.conflicts);
  }

  const options = [
    {
      mode: "entry" as const,
      title: `Re-entry detail first — ${money(entryPrice)}`,
      desc: `Their first visit back is a full detail${cars.length > 1 ? ` (${cars.length} cars)` : ""} at the plan-start price (${catalog.rules.planInitialDiscountPct}% off full), then every visit after runs at ${money(plan.per_visit_price)}.`,
      recommended: recommendEntry,
    },
    {
      mode: "maintenance" as const,
      title: `Straight back to maintenance — ${money(plan.per_visit_price)}/visit`,
      desc: "Pick up right where they left off; every visit at the plan rate.",
      recommended: !recommendEntry,
    },
  ].sort((a, b) => Number(b.recommended) - Number(a.recommended));

  return (
    <Sheet open onClose={onClose} title={`Resume — ${plan.customers.name}`}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-2">
          {lastVisit ? (
            <>
              Last visit was <span className="font-medium num">{fmtDateShort(lastVisit)}</span> —{" "}
              {Math.round((gapDays ?? 0) / 7)} weeks ago.
            </>
          ) : (
            "No completed visits on record for this plan yet."
          )}{" "}
          Visits regenerate on their usual {plan.preferred_dow != null ? `${WEEKDAYS[plan.preferred_dow]} ` : ""}schedule.
        </p>
        {options.map((o) => (
          <button
            key={o.mode}
            className={`card p-4 text-left hover:border-brand transition-colors duration-150 ${o.recommended ? "border-brand" : ""}`}
            disabled={pending != null}
            onClick={() => go(o.mode)}
          >
            <p className="text-[15px] font-semibold flex items-center gap-2">
              {pending === o.mode ? "Resuming…" : o.title}
              {o.recommended && <span className="chip bg-brand-wash text-brand-deep">recommended</span>}
            </p>
            <p className="text-[13px] text-ink-2 mt-1">{o.desc}</p>
          </button>
        ))}
        <ErrorNote>{error}</ErrorNote>
      </div>
    </Sheet>
  );
}

/**
 * Upfront block payment: quarterly-or-bigger blocks earn the prepay discount. Books a
 * payment + discount on the ledger so the balance covers the visits at full price.
 */
function PrepaySheet({
  plan,
  catalog,
  today,
  onClose,
  onDone,
}: {
  plan: Plan & { customers: Customer };
  catalog: Catalog;
  today: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const minVisits = visitsPerQuarter(plan.cadence, plan.interval_days);
  const [visits, setVisits] = useState(String(minVisits));
  const [method, setMethod] = useState<PaymentMethod>("zelle");
  const [memo, setMemo] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const n = Math.max(0, Math.floor(Number(visits) || 0));
  const qualifies = n >= minVisits;
  const full = plan.per_visit_price * n;
  const discount = qualifies ? Math.round(full * (catalog.rules.prepayDiscountPct / 100)) : 0;
  const due = full - discount;

  async function submit() {
    setError(null);
    setPending(true);
    const res = await recordPlanPrepay(plan.id, { visits: n, method, occurredOn: today, memo: memo.trim() || null });
    setPending(false);
    if (!res.ok) return setError(res.error);
    onDone();
  }

  async function submitStripe() {
    setError(null);
    setPending(true);
    const res = await sendPaymentRequest({
      customerId: plan.customer_id,
      planId: plan.id,
      kind: "prepay",
      amount: due,
      visits: n,
      discount,
      what: `Maintenance plan — ${n} visits prepaid`,
      memo: memo.trim() || null,
    });
    setPending(false);
    if (!res.ok) return setError(res.error);
    onDone();
  }

  return (
    <Sheet open onClose={onClose} title={`Prepay — ${plan.customers.name}`}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-2">
          {money(plan.per_visit_price)}/visit · {catalog.rules.prepayDiscountPct}% off when they prepay a quarter or more (
          {minVisits}+ visits on this cadence).
        </p>
        <div className="flex flex-wrap gap-1.5">
          {[
            { label: "Quarter", mult: 1 },
            { label: "Half year", mult: 2 },
            { label: "Full year", mult: 4 },
          ].map((b) => {
            const bn = minVisits * b.mult;
            const total = Math.round(plan.per_visit_price * bn * (1 - catalog.rules.prepayDiscountPct / 100));
            return (
              <button
                key={b.label}
                type="button"
                onClick={() => setVisits(String(bn))}
                className={`chip cursor-pointer num ${n === bn ? "bg-ink text-white" : "bg-[#f1f4f9] text-ink-2 hover:bg-line"}`}
              >
                {b.label} · {bn}v · {money(total)}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="label block mb-1">Visits prepaid</span>
            <input type="number" min={1} className="input num" value={visits} onChange={(e) => setVisits(e.target.value)} />
          </label>
          <label className="block">
            <span className="label block mb-1">Paid via</span>
            <select className="select" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m[0].toUpperCase() + m.slice(1)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {n > 0 && !qualifies && (
          <p className="text-[13px] text-warn bg-warn-wash border border-[#fde68a] rounded-md px-3 py-2">
            Fewer than {minVisits} visits — no discount, but the credit still goes on their balance.
          </p>
        )}
        <input className="input" placeholder="Memo (optional)" value={memo} onChange={(e) => setMemo(e.target.value)} />
        <div className="card p-3.5 text-sm flex flex-col gap-1">
          <div className="flex justify-between">
            <span className="text-ink-2">
              {n} visit{n === 1 ? "" : "s"} × {money(plan.per_visit_price)}
            </span>
            <span className="num">{money(full)}</span>
          </div>
          {discount > 0 && (
            <div className="flex justify-between text-ok">
              <span>Prepay discount ({catalog.rules.prepayDiscountPct}%)</span>
              <span className="num">−{money(discount)}</span>
            </div>
          )}
          <div className="flex justify-between font-semibold border-t border-line pt-1 mt-0.5">
            <span>They pay today</span>
            <span className="num">{money(due)}</span>
          </div>
        </div>
        <ErrorNote>{error}</ErrorNote>
        <button className="btn btn-primary h-11" disabled={pending || n < 1} onClick={submit}>
          {pending ? "Working…" : `Record ${money(due)} prepay`}
        </button>
        <button className="btn" disabled={pending || n < 1 || !plan.customers.email} onClick={submitStripe}>
          Email a Stripe link for {money(due)} instead
        </button>
        {!plan.customers.email && <p className="text-[12px] text-faint -mt-2">Stripe link needs an email on the customer.</p>}
      </div>
    </Sheet>
  );
}

function VisitSection({
  title,
  jobs,
  empty,
  onOpen,
  onShowAll,
}: {
  title: string;
  jobs: JobWithCustomer[];
  empty: string;
  onOpen: (j: JobWithCustomer) => void;
  onShowAll: () => void;
}) {
  const shown = jobs.slice(0, LIST_CAP);
  const hidden = jobs.length - shown.length;
  return (
    <section className="mt-6">
      <h2 className="label mb-1.5">{title}</h2>
      <div className="card divide-y divide-line">
        {jobs.length === 0 && <p className="px-4 py-3 text-sm text-faint">{empty}</p>}
        {shown.map((j) => (
          <VisitRow key={j.id} j={j} onOpen={() => onOpen(j)} />
        ))}
        {hidden > 0 && (
          <button className="w-full px-4 py-2.5 text-sm font-medium text-brand-deep hover:bg-[#f8fafd]" onClick={onShowAll}>
            Show all {jobs.length}
          </button>
        )}
      </div>
    </section>
  );
}

function VisitRow({ j, onOpen }: { j: JobWithCustomer; onOpen: () => void }) {
  return (
    <button className="w-full text-left px-4 py-2.5 hover:bg-[#f8fafd] flex items-center gap-3" onClick={onOpen}>
      <p className="text-sm font-medium num grow">
        {fmtDateShort(j.date)} at {minToLabel(j.start_min)}
      </p>
      <span className="text-sm num shrink-0">{money(Number(j.price))}</span>
      <StatusChip status={j.status} />
    </button>
  );
}

function Econ({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-card px-3.5 py-3">
      <p className="label">{label}</p>
      <p className="mt-1 text-lg font-semibold num leading-none">{value}</p>
    </div>
  );
}
